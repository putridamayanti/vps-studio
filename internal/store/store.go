package store

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	_ "modernc.org/sqlite"

	"vps-studio/internal/crypto"
)

var ErrNotFound = errors.New("not found")
var ErrConflict = errors.New("already exists")

type App struct {
	ID               string            `json:"id"`
	Name             string            `json:"name"`
	ServerID         string            `json:"server_id"`
	Image            string            `json:"image"`
	Registry         string            `json:"registry"`
	RegistryUsername string            `json:"registry_username,omitempty"`
	RegistryToken    string            `json:"-"` // plaintext in memory, encrypted at rest
	Port             int               `json:"port"`
	HostPort         int               `json:"host_port,omitempty"`
	Domain           string            `json:"domain,omitempty"`
	Env              map[string]string `json:"env"`
	WebhookToken     string            `json:"webhook_token"`
	CreatedAt        time.Time         `json:"created_at"`
	UpdatedAt        time.Time         `json:"updated_at"`
}

type DeploymentStatus string

const (
	StatusQueued    DeploymentStatus = "queued"
	StatusPulling   DeploymentStatus = "pulling"
	StatusStarting  DeploymentStatus = "starting"
	StatusSucceeded DeploymentStatus = "succeeded"
	StatusFailed    DeploymentStatus = "failed"
)

type Deployment struct {
	ID          string           `json:"id"`
	AppID       string           `json:"app_id"`
	Image       string           `json:"image"`
	Status      DeploymentStatus `json:"status"`
	Trigger     string           `json:"trigger"`
	Log         string           `json:"log,omitempty"`
	Error       string           `json:"error,omitempty"`
	ContainerID string           `json:"container_id,omitempty"`
	CreatedAt   time.Time        `json:"created_at"`
	FinishedAt  *time.Time       `json:"finished_at,omitempty"`
}

type Store struct {
	db     *sql.DB
	cipher *crypto.Cipher
}

const schema = `
CREATE TABLE IF NOT EXISTS servers (
	id          TEXT PRIMARY KEY,
	name        TEXT NOT NULL UNIQUE,
	host        TEXT NOT NULL,
	port        INTEGER NOT NULL,
	username    TEXT NOT NULL,
	password    TEXT NOT NULL DEFAULT '',
	private_key TEXT NOT NULL DEFAULT '',
	host_key    TEXT NOT NULL DEFAULT '',
	acme_email  TEXT NOT NULL DEFAULT '',
	status      TEXT NOT NULL,
	setup_log   TEXT NOT NULL DEFAULT '',
	created_at  INTEGER NOT NULL,
	updated_at  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS apps (
	id                TEXT PRIMARY KEY,
	name              TEXT NOT NULL UNIQUE,
	server_id         TEXT NOT NULL REFERENCES servers(id),
	image             TEXT NOT NULL,
	registry          TEXT NOT NULL,
	registry_username TEXT NOT NULL DEFAULT '',
	registry_token    TEXT NOT NULL DEFAULT '',
	port              INTEGER NOT NULL,
	host_port         INTEGER NOT NULL DEFAULT 0,
	domain            TEXT NOT NULL DEFAULT '',
	env               TEXT NOT NULL DEFAULT '{}',
	webhook_token     TEXT NOT NULL,
	created_at        INTEGER NOT NULL,
	updated_at        INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS deployments (
	id           TEXT PRIMARY KEY,
	app_id       TEXT NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
	image        TEXT NOT NULL,
	status       TEXT NOT NULL,
	trigger      TEXT NOT NULL,
	log          TEXT NOT NULL DEFAULT '',
	error        TEXT NOT NULL DEFAULT '',
	container_id TEXT NOT NULL DEFAULT '',
	created_at   INTEGER NOT NULL,
	finished_at  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_deployments_app ON deployments(app_id, created_at DESC);
`

func Open(path string, cipher *crypto.Cipher) (*Store, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return nil, err
	}
	dsn := path + "?_pragma=foreign_keys(1)&_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)"
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	if _, err := db.Exec(schema); err != nil {
		return nil, fmt.Errorf("migrate: %w", err)
	}
	return &Store{db: db, cipher: cipher}, nil
}

func (s *Store) Close() error { return s.db.Close() }

// ---- apps ----

const appColumns = `id, name, server_id, image, registry, registry_username, registry_token, port, host_port, domain, env, webhook_token, created_at, updated_at`

func (s *Store) CreateApp(a *App) error {
	now := time.Now().UTC()
	a.CreatedAt, a.UpdatedAt = now, now
	token, env, err := s.encodeApp(a)
	if err != nil {
		return err
	}
	_, err = s.db.Exec(`INSERT INTO apps (`+appColumns+`) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
		a.ID, a.Name, a.ServerID, a.Image, a.Registry, a.RegistryUsername, token, a.Port, a.HostPort, a.Domain, env,
		a.WebhookToken, now.Unix(), now.Unix())
	if err != nil && strings.Contains(err.Error(), "UNIQUE") {
		return ErrConflict
	}
	return err
}

func (s *Store) UpdateApp(a *App) error {
	a.UpdatedAt = time.Now().UTC()
	token, env, err := s.encodeApp(a)
	if err != nil {
		return err
	}
	res, err := s.db.Exec(`UPDATE apps SET image=?, registry=?, registry_username=?, registry_token=?, port=?, host_port=?, domain=?, env=?, webhook_token=?, updated_at=? WHERE id=?`,
		a.Image, a.Registry, a.RegistryUsername, token, a.Port, a.HostPort, a.Domain, env, a.WebhookToken, a.UpdatedAt.Unix(), a.ID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// SetAppImage records the image that is now running, e.g. after a deploy of a new tag.
func (s *Store) SetAppImage(id, image string) error {
	_, err := s.db.Exec(`UPDATE apps SET image=?, updated_at=? WHERE id=?`, image, time.Now().UTC().Unix(), id)
	return err
}

func (s *Store) GetApp(id string) (*App, error) {
	row := s.db.QueryRow(`SELECT `+appColumns+` FROM apps WHERE id=? OR name=?`, id, id)
	return s.scanApp(row)
}

func (s *Store) ListApps() ([]App, error) {
	rows, err := s.db.Query(`SELECT ` + appColumns + ` FROM apps ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	apps := []App{}
	for rows.Next() {
		a, err := s.scanApp(rows)
		if err != nil {
			return nil, err
		}
		apps = append(apps, *a)
	}
	return apps, rows.Err()
}

func (s *Store) DeleteApp(id string) error {
	_, err := s.db.Exec(`DELETE FROM apps WHERE id=?`, id)
	return err
}

func (s *Store) encodeApp(a *App) (token, env string, err error) {
	token, err = s.cipher.Encrypt(a.RegistryToken)
	if err != nil {
		return "", "", err
	}
	if a.Env == nil {
		a.Env = map[string]string{}
	}
	b, err := json.Marshal(a.Env)
	return token, string(b), err
}

type scanner interface{ Scan(dest ...any) error }

func (s *Store) scanApp(row scanner) (*App, error) {
	var a App
	var token, env string
	var created, updated int64
	err := row.Scan(&a.ID, &a.Name, &a.ServerID, &a.Image, &a.Registry, &a.RegistryUsername, &token, &a.Port, &a.HostPort,
		&a.Domain, &env, &a.WebhookToken, &created, &updated)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if a.RegistryToken, err = s.cipher.Decrypt(token); err != nil {
		return nil, err
	}
	if err := json.Unmarshal([]byte(env), &a.Env); err != nil {
		return nil, err
	}
	a.CreatedAt, a.UpdatedAt = time.Unix(created, 0).UTC(), time.Unix(updated, 0).UTC()
	return &a, nil
}

// ---- deployments ----

const deploymentColumns = `id, app_id, image, status, trigger, log, error, container_id, created_at, finished_at`

func (s *Store) CreateDeployment(d *Deployment) error {
	d.CreatedAt = time.Now().UTC()
	_, err := s.db.Exec(`INSERT INTO deployments (`+deploymentColumns+`) VALUES (?,?,?,?,?,?,?,?,?,0)`,
		d.ID, d.AppID, d.Image, d.Status, d.Trigger, d.Log, d.Error, d.ContainerID, d.CreatedAt.Unix())
	return err
}

func (s *Store) SetDeploymentStatus(id string, status DeploymentStatus) error {
	_, err := s.db.Exec(`UPDATE deployments SET status=? WHERE id=?`, status, id)
	return err
}

func (s *Store) AppendDeploymentLog(id, line string) error {
	_, err := s.db.Exec(`UPDATE deployments SET log = log || ? WHERE id=?`, line+"\n", id)
	return err
}

func (s *Store) FinishDeployment(id string, status DeploymentStatus, containerID, errMsg string) error {
	_, err := s.db.Exec(`UPDATE deployments SET status=?, container_id=?, error=?, finished_at=? WHERE id=?`,
		status, containerID, errMsg, time.Now().UTC().Unix(), id)
	return err
}

func (s *Store) GetDeployment(id string) (*Deployment, error) {
	return scanDeployment(s.db.QueryRow(`SELECT `+deploymentColumns+` FROM deployments WHERE id=?`, id))
}

func (s *Store) ListDeployments(appID string, limit int) ([]Deployment, error) {
	rows, err := s.db.Query(`SELECT `+deploymentColumns+` FROM deployments WHERE app_id=? ORDER BY created_at DESC LIMIT ?`, appID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Deployment{}
	for rows.Next() {
		d, err := scanDeployment(rows)
		if err != nil {
			return nil, err
		}
		d.Log = "" // keep list responses small; fetch a single deployment for its log
		out = append(out, *d)
	}
	return out, rows.Err()
}

// FailInterrupted marks deployments left in progress by a previous process as failed.
func (s *Store) FailInterrupted() error {
	if _, err := s.db.Exec(`UPDATE servers SET status=? WHERE status=?`, ServerError, ServerSettingUp); err != nil {
		return err
	}
	_, err := s.db.Exec(`UPDATE deployments SET status=?, error='interrupted by server restart', finished_at=? WHERE status IN (?,?,?)`,
		StatusFailed, time.Now().UTC().Unix(), StatusQueued, StatusPulling, StatusStarting)
	return err
}

func scanDeployment(row scanner) (*Deployment, error) {
	var d Deployment
	var created, finished int64
	err := row.Scan(&d.ID, &d.AppID, &d.Image, &d.Status, &d.Trigger, &d.Log, &d.Error, &d.ContainerID, &created, &finished)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	d.CreatedAt = time.Unix(created, 0).UTC()
	if finished > 0 {
		t := time.Unix(finished, 0).UTC()
		d.FinishedAt = &t
	}
	return &d, nil
}
