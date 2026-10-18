package config

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
	"strconv"
	"time"

	"github.com/joho/godotenv"
)

type Config struct {
	Port      string
	APIKey    string
	SecretKey string
	// DatabaseURL is a Postgres URL (e.g. Neon). When empty, the SQLite file at DatabasePath is used.
	DatabaseURL  string
	DatabasePath string

	// DockerNetwork is the bridge network every deployed app joins.
	DockerNetwork string
	// StartupGrace is how long a new container must stay running before a deploy counts as successful.
	StartupGrace time.Duration
}

func Load() (Config, error) {
	// Read .env from the working directory if present; real environment variables take precedence.
	if err := godotenv.Load(); err != nil && !errors.Is(err, fs.ErrNotExist) {
		return Config{}, fmt.Errorf("read .env: %w", err)
	}

	cfg := Config{
		Port:          getenv("PORT", "8081"),
		APIKey:        os.Getenv("API_KEY"),
		SecretKey:     os.Getenv("SECRET_KEY"),
		DatabaseURL:   os.Getenv("DATABASE_URL"),
		DatabasePath:  getenv("DATABASE_PATH", "data/vps-studio.db"),
		DockerNetwork: getenv("DOCKER_NETWORK", "vps-studio"),
	}

	grace, err := strconv.Atoi(getenv("STARTUP_GRACE_SECONDS", "5"))
	if err != nil {
		return cfg, errors.New("STARTUP_GRACE_SECONDS must be an integer")
	}
	cfg.StartupGrace = time.Duration(grace) * time.Second

	if len(cfg.APIKey) < 16 {
		return cfg, errors.New("API_KEY is required (min 16 chars)")
	}
	if len(cfg.SecretKey) < 16 {
		return cfg, errors.New("SECRET_KEY is required (min 16 chars)")
	}
	return cfg, nil
}

// DatabaseDSN is what store.Open should connect to.
func (c Config) DatabaseDSN() string {
	if c.DatabaseURL != "" {
		return c.DatabaseURL
	}
	return c.DatabasePath
}

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
