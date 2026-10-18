// Package remote connects to servers over SSH and runs commands on them.
package remote

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"strconv"
	"strings"
	"sync"
	"time"

	"golang.org/x/crypto/ssh"
)

type Target struct {
	Host       string
	Port       int
	Username   string
	Password   string
	PrivateKey string
	// HostKey is the pinned host key in authorized_keys format; empty means trust on first use.
	HostKey string
}

var ErrHostKeyMismatch = errors.New("SSH host key changed since it was first saved; if you reinstalled the VPS, delete and re-add the server")

// Dial opens an SSH connection. When the target has no pinned host key, the key the
// server presents is returned as newHostKey so the caller can pin it.
func Dial(ctx context.Context, t Target) (client *ssh.Client, newHostKey string, err error) {
	var auth []ssh.AuthMethod
	if t.PrivateKey != "" {
		signer, err := ssh.ParsePrivateKey([]byte(t.PrivateKey))
		if err != nil {
			return nil, "", fmt.Errorf("parse private key (passphrase-protected keys are not supported): %w", err)
		}
		auth = append(auth, ssh.PublicKeys(signer))
	}
	if t.Password != "" {
		auth = append(auth, ssh.Password(t.Password),
			ssh.KeyboardInteractive(func(_, _ string, questions []string, _ []bool) ([]string, error) {
				answers := make([]string, len(questions))
				for i := range answers {
					answers[i] = t.Password
				}
				return answers, nil
			}))
	}

	cfg := &ssh.ClientConfig{
		User:    t.Username,
		Auth:    auth,
		Timeout: 15 * time.Second,
		HostKeyCallback: func(_ string, _ net.Addr, key ssh.PublicKey) error {
			got := strings.TrimSpace(string(ssh.MarshalAuthorizedKey(key)))
			if t.HostKey == "" {
				newHostKey = got
				return nil
			}
			if got != t.HostKey {
				return ErrHostKeyMismatch
			}
			return nil
		},
	}

	addr := net.JoinHostPort(t.Host, strconv.Itoa(t.Port))
	dialer := net.Dialer{Timeout: 15 * time.Second}
	conn, err := dialer.DialContext(ctx, "tcp", addr)
	if err != nil {
		return nil, "", fmt.Errorf("connect to %s: %w", addr, err)
	}
	if deadline, ok := ctx.Deadline(); ok {
		_ = conn.SetDeadline(deadline)
	}
	c, chans, reqs, err := ssh.NewClientConn(conn, addr, cfg)
	if err != nil {
		conn.Close()
		if errors.Is(err, ErrHostKeyMismatch) {
			return nil, "", err
		}
		return nil, "", fmt.Errorf("ssh login to %s as %s failed; check the username and password/private key (%w)", addr, t.Username, err)
	}
	_ = conn.SetDeadline(time.Time{})
	return ssh.NewClient(c, chans, reqs), newHostKey, nil
}

// Fingerprint returns the SHA256 fingerprint of an authorized_keys-format key, as shown by ssh-keygen -l.
func Fingerprint(authorizedKey string) string {
	key, _, _, _, err := ssh.ParseAuthorizedKey([]byte(authorizedKey))
	if err != nil {
		return ""
	}
	return ssh.FingerprintSHA256(key)
}

// Run executes a shell command, streaming stdout and stderr to out.
func Run(client *ssh.Client, cmd, stdin string, out io.Writer) error {
	session, err := client.NewSession()
	if err != nil {
		return err
	}
	defer session.Close()
	// The SSH library copies stdout and stderr from separate goroutines.
	w := &syncWriter{w: out}
	session.Stdout, session.Stderr = w, w
	if stdin != "" {
		session.Stdin = strings.NewReader(stdin)
	}
	return session.Run(cmd)
}

type syncWriter struct {
	mu sync.Mutex
	w  io.Writer
}

func (s *syncWriter) Write(p []byte) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.w.Write(p)
}

// Output executes a command and returns its combined, trimmed output.
func Output(client *ssh.Client, cmd string) (string, error) {
	var buf bytes.Buffer
	err := Run(client, cmd, "", &buf)
	return strings.TrimSpace(buf.String()), err
}
