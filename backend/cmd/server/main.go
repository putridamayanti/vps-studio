package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"vps-studio/internal/api"
	"vps-studio/internal/config"
	"vps-studio/internal/crypto"
	"vps-studio/internal/deployer"
	"vps-studio/internal/store"
)

func main() {
	if err := run(); err != nil {
		slog.Error("fatal", "err", err)
		os.Exit(1)
	}
}

func run() error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	cipher, err := crypto.New(cfg.SecretKey)
	if err != nil {
		return err
	}
	if len(os.Args) > 1 && os.Args[1] == "migrate-sqlite" {
		return migrateSQLite(cfg, cipher, os.Args[2:])
	}

	st, err := store.Open(cfg.DatabaseDSN(), cipher)
	if err != nil {
		return err
	}
	defer st.Close()
	if cfg.DatabaseURL != "" {
		slog.Info("using postgres database")
	} else {
		slog.Info("using sqlite database", "path", cfg.DatabasePath)
	}
	if err := st.FailInterrupted(); err != nil {
		return err
	}

	dep := deployer.New(cfg, st)

	srv := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           api.NewRouter(cfg.APIKey, st, dep),
		ReadHeaderTimeout: 10 * time.Second,
	}

	go func() {
		slog.Info("vps-studio listening", "addr", srv.Addr)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			slog.Error("server error", "err", err)
			os.Exit(1)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop

	shutdownCtx, cancelShutdown := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancelShutdown()
	return srv.Shutdown(shutdownCtx)
}

// migrateSQLite copies all data from a SQLite file (default DATABASE_PATH) into the Postgres
// database at DATABASE_URL. Usage: vps-studio migrate-sqlite [path/to/vps-studio.db]
func migrateSQLite(cfg config.Config, cipher *crypto.Cipher, args []string) error {
	if !store.IsPostgresURL(cfg.DatabaseURL) {
		return errors.New("set DATABASE_URL to the target postgres:// URL")
	}
	path := cfg.DatabasePath
	if len(args) > 0 {
		path = args[0]
	}
	if _, err := os.Stat(path); err != nil {
		return fmt.Errorf("sqlite database: %w", err)
	}

	src, err := store.Open(path, cipher)
	if err != nil {
		return err
	}
	defer src.Close()
	dst, err := store.Open(cfg.DatabaseURL, cipher)
	if err != nil {
		return err
	}
	defer dst.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()
	counts, err := dst.CopyFrom(ctx, src)
	if err != nil {
		return err
	}
	slog.Info("migration complete", "from", path, "servers", counts["servers"], "apps", counts["apps"], "deployments", counts["deployments"])
	return nil
}
