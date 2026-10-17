package main

import (
	"context"
	"errors"
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
	st, err := store.Open(cfg.DatabasePath, cipher)
	if err != nil {
		return err
	}
	defer st.Close()
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
