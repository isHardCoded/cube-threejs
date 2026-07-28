package main

import (
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

const (
	avatarDir     = "data/avatars"
	maxAvatarSize = 2 << 20 // 2 MiB
)

var allowedAvatarTypes = map[string]string{
	"image/jpeg": ".jpg",
	"image/png":  ".png",
	"image/webp": ".webp",
}

func ensureAvatarDir() error {
	return os.MkdirAll(avatarDir, 0o755)
}

func saveAvatarUpload(r *http.Request, userID int64) (string, error) {
	if err := ensureAvatarDir(); err != nil {
		return "", errors.New("не удалось сохранить файл")
	}
	if err := r.ParseMultipartForm(maxAvatarSize); err != nil {
		return "", errors.New("файл слишком большой (макс. 2 МБ)")
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		return "", errors.New("выбери изображение")
	}
	defer file.Close()

	if header.Size > maxAvatarSize {
		return "", errors.New("файл слишком большой (макс. 2 МБ)")
	}

	sniff := make([]byte, 512)
	n, err := io.ReadFull(file, sniff)
	if err != nil && !errors.Is(err, io.ErrUnexpectedEOF) && !errors.Is(err, io.EOF) {
		return "", errors.New("не удалось прочитать файл")
	}
	sniff = sniff[:n]
	ctype := http.DetectContentType(sniff)
	ext, ok := allowedAvatarTypes[ctype]
	if !ok {
		return "", errors.New("нужен JPG, PNG или WebP")
	}

	name := fmt.Sprintf("%d%s", userID, ext)
	path := filepath.Join(avatarDir, name)
	out, err := os.Create(path)
	if err != nil {
		return "", errors.New("не удалось сохранить файл")
	}
	defer out.Close()

	if _, err := out.Write(sniff); err != nil {
		return "", errors.New("не удалось сохранить файл")
	}
	if _, err := io.Copy(out, io.LimitReader(file, maxAvatarSize)); err != nil {
		return "", errors.New("не удалось сохранить файл")
	}

	// bust caches after each upload
	return "/avatars/" + name + "?v=" + strconv.FormatInt(time.Now().Unix(), 10), nil
}

func serveAvatars(w http.ResponseWriter, r *http.Request) {
	name := strings.TrimPrefix(r.URL.Path, "/avatars/")
	name = filepath.Base(name)
	if name == "." || name == string(filepath.Separator) {
		http.NotFound(w, r)
		return
	}
	path := filepath.Join(avatarDir, name)
	http.ServeFile(w, r, path)
}
