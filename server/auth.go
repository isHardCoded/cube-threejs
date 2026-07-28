package main

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/url"
	"os"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
)

const (
	tokenTTL     = 30 * 24 * time.Hour
	MinNickLen   = 3
	MaxNickLen   = 14
	MinPasswdLen = 6
)

var (
	ErrBadCredentials = errors.New("bad credentials")
	ErrBadToken       = errors.New("bad token")

	nickRe = regexp.MustCompile(`^[\p{L}\p{N}_-]+$`)

	jwtSecret        []byte
	telegramBotToken string
)

func initAuth() {
	if s := os.Getenv("JWT_SECRET"); s != "" {
		jwtSecret = []byte(s)
	} else {
		// Dev fallback: a random secret keeps tokens unforgeable, but every
		// restart invalidates existing logins. Always set JWT_SECRET in prod.
		jwtSecret = make([]byte, 32)
		rand.Read(jwtSecret)
		log.Println("auth: JWT_SECRET is not set, using a random secret (logins reset on restart)")
	}
	telegramBotToken = os.Getenv("TELEGRAM_BOT_TOKEN")
}

// --- passwords --------------------------------------------------------------

func hashPassword(plain string) (string, error) {
	h, err := bcrypt.GenerateFromPassword([]byte(plain), bcrypt.DefaultCost)
	return string(h), err
}

func checkPassword(hash, plain string) error {
	if hash == "" { // Telegram-only account: no password login
		return ErrBadCredentials
	}
	if bcrypt.CompareHashAndPassword([]byte(hash), []byte(plain)) != nil {
		return ErrBadCredentials
	}
	return nil
}

// --- validation -------------------------------------------------------------

func validateNickname(name string) (string, error) {
	name = strings.TrimSpace(name)
	runes := []rune(name)
	if len(runes) < MinNickLen || len(runes) > MaxNickLen {
		return "", fmt.Errorf("ник: от %d до %d символов", MinNickLen, MaxNickLen)
	}
	if !nickRe.MatchString(name) {
		return "", errors.New("ник: только буквы, цифры, дефис и подчёркивание")
	}
	return name, nil
}

func validatePassword(p string) error {
	if len([]rune(p)) < MinPasswdLen {
		return fmt.Errorf("пароль: минимум %d символов", MinPasswdLen)
	}
	return nil
}

// uniqueSuffix shortens a nickname so a numeric suffix still fits the limit.
func uniqueSuffix(name string, n int) string {
	suffix := strconv.Itoa(n)
	runes := []rune(name)
	if len(runes)+len(suffix) > MaxNickLen {
		runes = runes[:MaxNickLen-len(suffix)]
	}
	return string(runes) + suffix
}

// --- tokens -----------------------------------------------------------------

func issueToken(u *User) (string, error) {
	claims := jwt.RegisteredClaims{
		Subject:   strconv.FormatInt(u.ID, 10),
		ExpiresAt: jwt.NewNumericDate(time.Now().Add(tokenTTL)),
		IssuedAt:  jwt.NewNumericDate(time.Now()),
	}
	return jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(jwtSecret)
}

func userIDFromToken(raw string) (int64, error) {
	if raw == "" {
		return 0, ErrBadToken
	}
	var claims jwt.RegisteredClaims
	_, err := jwt.ParseWithClaims(raw, &claims, func(*jwt.Token) (any, error) {
		return jwtSecret, nil
	}, jwt.WithValidMethods([]string{"HS256"}))
	if err != nil {
		return 0, ErrBadToken
	}
	id, err := strconv.ParseInt(claims.Subject, 10, 64)
	if err != nil {
		return 0, ErrBadToken
	}
	return id, nil
}

// --- Telegram Mini App ------------------------------------------------------

type telegramUser struct {
	ID        int64  `json:"id"`
	FirstName string `json:"first_name"`
	Username  string `json:"username"`
	PhotoURL  string `json:"photo_url"`
}

// verifyTelegramInitData checks the HMAC signature Telegram puts on initData.
// See https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
func verifyTelegramInitData(initData string) (*telegramUser, error) {
	if telegramBotToken == "" {
		return nil, errors.New("telegram login is not configured")
	}
	values, err := url.ParseQuery(initData)
	if err != nil {
		return nil, ErrBadToken
	}
	hash := values.Get("hash")
	if hash == "" {
		return nil, ErrBadToken
	}
	values.Del("hash")

	keys := make([]string, 0, len(values))
	for k := range values {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	pairs := make([]string, 0, len(keys))
	for _, k := range keys {
		pairs = append(pairs, k+"="+values.Get(k))
	}

	secret := hmac.New(sha256.New, []byte("WebAppData"))
	secret.Write([]byte(telegramBotToken))
	mac := hmac.New(sha256.New, secret.Sum(nil))
	mac.Write([]byte(strings.Join(pairs, "\n")))
	if !hmac.Equal([]byte(hex.EncodeToString(mac.Sum(nil))), []byte(hash)) {
		return nil, ErrBadToken
	}

	// reject replayed payloads
	if ts, err := strconv.ParseInt(values.Get("auth_date"), 10, 64); err == nil {
		if time.Since(time.Unix(ts, 0)) > 24*time.Hour {
			return nil, ErrBadToken
		}
	}

	var tu telegramUser
	if json.Unmarshal([]byte(values.Get("user")), &tu) != nil || tu.ID == 0 {
		return nil, ErrBadToken
	}
	return &tu, nil
}

// telegramNickname derives a valid in-game nickname from a Telegram profile.
func telegramNickname(tu *telegramUser) string {
	for _, candidate := range []string{tu.Username, tu.FirstName} {
		cleaned := strings.Map(func(r rune) rune {
			if nickRe.MatchString(string(r)) {
				return r
			}
			return -1
		}, candidate)
		if name, err := validateNickname(cleaned); err == nil {
			return name
		}
	}
	return "TG" + strconv.FormatInt(tu.ID%100000000, 10)
}
