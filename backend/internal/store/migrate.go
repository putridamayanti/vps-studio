package store

import (
	"context"
	"fmt"
	"strings"
)

// copyTables lists tables in foreign-key order with every column, so rows are copied verbatim.
var copyTables = []struct{ name, columns string }{
	{"servers", serverColumns},
	{"apps", appColumns},
	{"deployments", deploymentColumns},
}

// CopyFrom copies every row from src into s in one transaction. Secrets are copied still
// encrypted, so s must be used with the same SECRET_KEY. s must be empty.
func (s *Store) CopyFrom(ctx context.Context, src *Store) (map[string]int, error) {
	for _, t := range copyTables {
		var n int
		if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM `+t.name).Scan(&n); err != nil {
			return nil, err
		}
		if n > 0 {
			return nil, fmt.Errorf("target database already has %d row(s) in %s; refusing to overwrite", n, t.name)
		}
	}

	// A read transaction gives a consistent snapshot even if the source is in use.
	srcTx, err := src.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer srcTx.Rollback()
	dstTx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer dstTx.Rollback()

	counts := map[string]int{}
	for _, t := range copyTables {
		n := len(strings.Split(t.columns, ","))
		insert, err := dstTx.PrepareContext(ctx, s.rebind(
			`INSERT INTO `+t.name+` (`+t.columns+`) VALUES (`+strings.TrimSuffix(strings.Repeat("?,", n), ",")+`)`))
		if err != nil {
			return nil, err
		}
		rows, err := srcTx.QueryContext(ctx, `SELECT `+t.columns+` FROM `+t.name+` ORDER BY created_at`)
		if err != nil {
			return nil, err
		}
		for rows.Next() {
			values := make([]any, n)
			ptrs := make([]any, n)
			for i := range values {
				ptrs[i] = &values[i]
			}
			if err := rows.Scan(ptrs...); err != nil {
				rows.Close()
				return nil, err
			}
			if _, err := insert.ExecContext(ctx, values...); err != nil {
				rows.Close()
				return nil, fmt.Errorf("copy %s row %v: %w", t.name, values[0], err)
			}
			counts[t.name]++
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return nil, err
		}
		insert.Close()
	}
	return counts, dstTx.Commit()
}
