package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

const (
	botPostsDir   = "data/bot_posts"
	maxBotImgSize = 5 << 20 // 5 MiB
	tgSendPause   = 35 * time.Millisecond
)

func ensureBotPostsDir() error {
	return os.MkdirAll(botPostsDir, 0o755)
}

func botAPIToken() string {
	return strings.TrimSpace(os.Getenv("TELEGRAM_BOT_TOKEN"))
}

type tgAPIResp struct {
	OK          bool            `json:"ok"`
	Description string          `json:"description"`
	Result      json.RawMessage `json:"result"`
}

func tgAPI(method string, body any) error {
	token := botAPIToken()
	if token == "" {
		return errors.New("telegram bot token not set")
	}
	var rdr io.Reader
	ct := "application/json"
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return err
		}
		rdr = bytes.NewReader(b)
	}
	url := fmt.Sprintf("https://api.telegram.org/bot%s/%s", token, method)
	req, err := http.NewRequest(http.MethodPost, url, rdr)
	if err != nil {
		return err
	}
	if body != nil {
		req.Header.Set("Content-Type", ct)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	var parsed tgAPIResp
	if err := json.NewDecoder(res.Body).Decode(&parsed); err != nil {
		return err
	}
	if !parsed.OK {
		return fmt.Errorf("telegram: %s", parsed.Description)
	}
	return nil
}

func errorsNew(s string) error { return errors.New(s) }

func tgSendMessage(chatID int64, text string) error {
	return tgAPI("sendMessage", map[string]any{
		"chat_id":    chatID,
		"text":       text,
		"parse_mode": "HTML",
	})
}

func tgSendPhotoFile(chatID int64, text, imagePath string) error {
	token := botAPIToken()
	if token == "" {
		return errorsNew("telegram bot token not set")
	}
	f, err := os.Open(imagePath)
	if err != nil {
		return err
	}
	defer f.Close()

	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	_ = w.WriteField("chat_id", strconv.FormatInt(chatID, 10))
	if text != "" {
		_ = w.WriteField("caption", text)
		_ = w.WriteField("parse_mode", "HTML")
	}
	part, err := w.CreateFormFile("photo", filepath.Base(imagePath))
	if err != nil {
		return err
	}
	if _, err := io.Copy(part, f); err != nil {
		return err
	}
	if err := w.Close(); err != nil {
		return err
	}

	url := fmt.Sprintf("https://api.telegram.org/bot%s/sendPhoto", token)
	req, err := http.NewRequest(http.MethodPost, url, &buf)
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", w.FormDataContentType())
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	var parsed tgAPIResp
	if err := json.NewDecoder(res.Body).Decode(&parsed); err != nil {
		return err
	}
	if !parsed.OK {
		return fmt.Errorf("telegram: %s", parsed.Description)
	}
	return nil
}

type BotPost struct {
	ID        int64      `json:"id"`
	AdminID   *int64     `json:"adminId,omitempty"`
	Text      string     `json:"text"`
	ImagePath string     `json:"imagePath,omitempty"`
	HasImage  bool       `json:"hasImage"`
	Status    string     `json:"status"`
	SentOK    int        `json:"sentOk"`
	SentFail  int        `json:"sentFail"`
	CreatedAt time.Time  `json:"createdAt"`
	SentAt    *time.Time `json:"sentAt,omitempty"`
}

func (s *Store) ListBotPosts(limit int) ([]BotPost, error) {
	if s.pool == nil {
		return nil, ErrNoStore
	}
	if limit <= 0 || limit > 100 {
		limit = 40
	}
	ctx, cancel := dbCtx()
	defer cancel()
	rows, err := s.pool.Query(ctx, `
		SELECT id, admin_id, text, coalesce(image_path, ''), status, sent_ok, sent_fail, created_at, sent_at
		FROM bot_posts ORDER BY id DESC LIMIT $1`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]BotPost, 0)
	for rows.Next() {
		var p BotPost
		var img string
		if err := rows.Scan(&p.ID, &p.AdminID, &p.Text, &img, &p.Status, &p.SentOK, &p.SentFail, &p.CreatedAt, &p.SentAt); err != nil {
			return nil, err
		}
		p.ImagePath = img
		p.HasImage = img != ""
		// don't leak server paths to client
		p.ImagePath = ""
		out = append(out, p)
	}
	return out, rows.Err()
}

func (s *Store) CreateBotPost(adminID int64, text, imagePath string) (*BotPost, error) {
	if s.pool == nil {
		return nil, ErrNoStore
	}
	ctx, cancel := dbCtx()
	defer cancel()
	var img any
	if imagePath != "" {
		img = imagePath
	}
	var p BotPost
	var storedImg string
	err := s.pool.QueryRow(ctx, `
		INSERT INTO bot_posts (admin_id, text, image_path, status)
		VALUES ($1, $2, $3, 'draft')
		RETURNING id, admin_id, text, coalesce(image_path, ''), status, sent_ok, sent_fail, created_at, sent_at`,
		adminID, text, img).Scan(
		&p.ID, &p.AdminID, &p.Text, &storedImg, &p.Status, &p.SentOK, &p.SentFail, &p.CreatedAt, &p.SentAt)
	if err != nil {
		return nil, err
	}
	p.HasImage = storedImg != ""
	return &p, nil
}

func (s *Store) botPostRow(id int64) (text, imagePath, status string, err error) {
	ctx, cancel := dbCtx()
	defer cancel()
	err = s.pool.QueryRow(ctx,
		`SELECT text, coalesce(image_path, ''), status FROM bot_posts WHERE id = $1`, id).
		Scan(&text, &imagePath, &status)
	return
}

func (s *Store) setBotPostStatus(id int64, status string, ok, fail int, markSent bool) error {
	ctx, cancel := dbCtx()
	defer cancel()
	if markSent {
		_, err := s.pool.Exec(ctx, `
			UPDATE bot_posts SET status=$2, sent_ok=$3, sent_fail=$4, sent_at=now() WHERE id=$1`,
			id, status, ok, fail)
		return err
	}
	_, err := s.pool.Exec(ctx, `
		UPDATE bot_posts SET status=$2, sent_ok=$3, sent_fail=$4 WHERE id=$1`,
		id, status, ok, fail)
	return err
}

func (s *Store) PublishBotPost(id int64) (*BotPost, error) {
	if s.pool == nil {
		return nil, ErrNoStore
	}
	text, imagePath, status, err := s.botPostRow(id)
	if err != nil {
		return nil, ErrNoUser
	}
	if status == "sending" {
		return nil, errorsNew("уже отправляется")
	}
	if botAPIToken() == "" {
		return nil, errorsNew("TELEGRAM_BOT_TOKEN не задан")
	}
	_ = s.setBotPostStatus(id, "sending", 0, 0, false)

	ids, err := s.ListTelegramIDs()
	if err != nil {
		_ = s.setBotPostStatus(id, "failed", 0, 0, false)
		return nil, err
	}

	okN, failN := 0, 0
	for _, chatID := range ids {
		var sendErr error
		if imagePath != "" {
			sendErr = tgSendPhotoFile(chatID, text, imagePath)
		} else {
			sendErr = tgSendMessage(chatID, text)
		}
		if sendErr != nil {
			failN++
			log.Println("tg broadcast:", chatID, sendErr)
		} else {
			okN++
		}
		time.Sleep(tgSendPause)
	}

	final := "sent"
	if okN == 0 && failN > 0 {
		final = "failed"
	}
	if err := s.setBotPostStatus(id, final, okN, failN, true); err != nil {
		return nil, err
	}

	posts, err := s.ListBotPosts(1)
	if err != nil {
		return nil, err
	}
	// re-fetch this id
	ctx, cancel := dbCtx()
	defer cancel()
	var p BotPost
	var img string
	err = s.pool.QueryRow(ctx, `
		SELECT id, admin_id, text, coalesce(image_path, ''), status, sent_ok, sent_fail, created_at, sent_at
		FROM bot_posts WHERE id = $1`, id).Scan(
		&p.ID, &p.AdminID, &p.Text, &img, &p.Status, &p.SentOK, &p.SentFail, &p.CreatedAt, &p.SentAt)
	if err != nil {
		if len(posts) > 0 {
			return &posts[0], nil
		}
		return nil, err
	}
	p.HasImage = img != ""
	return &p, nil
}

func saveBotPostImage(r *http.Request) (string, error) {
	if err := ensureBotPostsDir(); err != nil {
		return "", errorsNew("не удалось сохранить файл")
	}
	if err := r.ParseMultipartForm(maxBotImgSize); err != nil {
		return "", errorsNew("файл слишком большой (макс. 5 МБ)")
	}
	file, header, err := r.FormFile("image")
	if err != nil {
		return "", nil // optional
	}
	defer file.Close()
	if header.Size > maxBotImgSize {
		return "", errorsNew("файл слишком большой (макс. 5 МБ)")
	}
	sniff := make([]byte, 512)
	n, err := io.ReadFull(file, sniff)
	if err != nil && !errors.Is(err, io.ErrUnexpectedEOF) && !errors.Is(err, io.EOF) {
		return "", errorsNew("не удалось прочитать файл")
	}
	sniff = sniff[:n]
	ctype := http.DetectContentType(sniff)
	ext, ok := allowedAvatarTypes[ctype]
	if !ok {
		return "", errorsNew("нужен JPG, PNG или WebP")
	}
	name := fmt.Sprintf("%d%s", time.Now().UnixNano(), ext)
	path := filepath.Join(botPostsDir, name)
	out, err := os.Create(path)
	if err != nil {
		return "", errorsNew("не удалось сохранить файл")
	}
	defer out.Close()
	if _, err := out.Write(sniff); err != nil {
		return "", errorsNew("не удалось сохранить файл")
	}
	if _, err := io.Copy(out, io.LimitReader(file, maxBotImgSize)); err != nil {
		return "", errorsNew("не удалось сохранить файл")
	}
	return path, nil
}
