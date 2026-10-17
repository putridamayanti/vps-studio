package store

import (
	"database/sql"
	"errors"
	"strings"
	"time"
)

type ServerStatus string

const (
	ServerNew       ServerStatus = "new"
	ServerSettingUp ServerStatus = "setting_up"
	ServerReady     ServerStatus = "ready"
	ServerError     ServerStatus = "error"
)

// Server is a VPS that vps-studio reaches over SSH.
type Server struct {
	ID         string       `json:"id"`
	Name       string       `json:"name"`
	Host       string       `json:"host"`
	Port       int          `json:"port"`
	Username   string       `json:"username"`
	Password   string       `json:"-"` // plaintext in memory, encrypted at rest
	PrivateKey string       `json:"-"` // plaintext in memory, encrypted at rest
	HostKey    string       `json:"-"` // pinned on first connect (authorized_keys format)
	ACMEEmail  string       `json:"acme_email,omitempty"`
	Status     ServerStatus `json:"status"`
	SetupLog   string       `json:"setup_log,omitempty"`
	CreatedAt  time.Time    `json:"created_at"`
	UpdatedAt  time.Time    `json:"updated_at"`
}

const serverColumns = `id, name, host, port, username, password, private_key, host_key, acme_email, status, setup_log, created_at, updated_at`

func (s *Store) CreateServer(srv *Server) error {
	now := time.Now().UTC()
	srv.CreatedAt, srv.UpdatedAt = now, now
	password, key, err := s.encryptServer(srv)
	if err != nil {
		return err
	}
	_, err = s.db.Exec(`INSERT INTO servers (`+serverColumns+`) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
		srv.ID, srv.Name, srv.Host, srv.Port, srv.Username, password, key, srv.HostKey, srv.ACMEEmail, srv.Status,
		srv.SetupLog, now.Unix(), now.Unix())
	if err != nil && strings.Contains(err.Error(), "UNIQUE") {
		return ErrConflict
	}
	return err
}

func (s *Store) UpdateServer(srv *Server) error {
	srv.UpdatedAt = time.Now().UTC()
	password, key, err := s.encryptServer(srv)
	if err != nil {
		return err
	}
	_, err = s.db.Exec(`UPDATE servers SET host=?, port=?, username=?, password=?, private_key=?, host_key=?, acme_email=?, updated_at=? WHERE id=?`,
		srv.Host, srv.Port, srv.Username, password, key, srv.HostKey, srv.ACMEEmail, srv.UpdatedAt.Unix(), srv.ID)
	return err
}

func (s *Store) GetServer(idOrName string) (*Server, error) {
	return s.scanServer(s.db.QueryRow(`SELECT `+serverColumns+` FROM servers WHERE id=? OR name=?`, idOrName, idOrName))
}

func (s *Store) ListServers() ([]Server, error) {
	rows, err := s.db.Query(`SELECT ` + serverColumns + ` FROM servers ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Server{}
	for rows.Next() {
		srv, err := s.scanServer(rows)
		if err != nil {
			return nil, err
		}
		srv.SetupLog = "" // keep list responses small
		out = append(out, *srv)
	}
	return out, rows.Err()
}

func (s *Store) DeleteServer(id string) error {
	_, err := s.db.Exec(`DELETE FROM servers WHERE id=?`, id)
	return err
}

func (s *Store) CountAppsOnServer(id string) (int, error) {
	var n int
	err := s.db.QueryRow(`SELECT COUNT(*) FROM apps WHERE server_id=?`, id).Scan(&n)
	return n, err
}

func (s *Store) SetServerHostKey(id, hostKey string) error {
	_, err := s.db.Exec(`UPDATE servers SET host_key=? WHERE id=?`, hostKey, id)
	return err
}

func (s *Store) SetServerStatus(id string, status ServerStatus) error {
	_, err := s.db.Exec(`UPDATE servers SET status=?, updated_at=? WHERE id=?`, status, time.Now().UTC().Unix(), id)
	return err
}

func (s *Store) ResetServerLog(id string) error {
	_, err := s.db.Exec(`UPDATE servers SET setup_log='' WHERE id=?`, id)
	return err
}

func (s *Store) AppendServerLog(id, line string) error {
	_, err := s.db.Exec(`UPDATE servers SET setup_log = setup_log || ? WHERE id=?`, line+"\n", id)
	return err
}

func (s *Store) encryptServer(srv *Server) (password, key string, err error) {
	if password, err = s.cipher.Encrypt(srv.Password); err != nil {
		return "", "", err
	}
	key, err = s.cipher.Encrypt(srv.PrivateKey)
	return password, key, err
}

func (s *Store) scanServer(row scanner) (*Server, error) {
	var srv Server
	var password, key string
	var created, updated int64
	err := row.Scan(&srv.ID, &srv.Name, &srv.Host, &srv.Port, &srv.Username, &password, &key, &srv.HostKey,
		&srv.ACMEEmail, &srv.Status, &srv.SetupLog, &created, &updated)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if srv.Password, err = s.cipher.Decrypt(password); err != nil {
		return nil, err
	}
	if srv.PrivateKey, err = s.cipher.Decrypt(key); err != nil {
		return nil, err
	}
	srv.CreatedAt, srv.UpdatedAt = time.Unix(created, 0).UTC(), time.Unix(updated, 0).UTC()
	return &srv, nil
}
