# vps-studio client

Web dashboard for vps-studio, built with Next.js and shadcn/ui.

## Run it

```bash
cp .env.example .env     # set API_URL if the Go server isn't on http://localhost:8080
npm install
npm run dev              # http://localhost:3000
```

Sign in with the server's `API_KEY`. The key is stored in this browser's localStorage and expires
after 6 hours, after which you're asked for it again.

The browser only talks to this app: `/api/*` and `/hooks/*` are proxied to `API_URL`
(see `next.config.ts`), so the Go server needs no CORS setup and the webhook URL shown for each app
works when this app is deployed publicly.

## Features

- **Overview**: server and app counts, apps that need attention.
- **Servers**: add (password or SSH key), edit, re-run setup with a live setup log, remove.
- **Apps**: create (GHCR image, registry token, port, domain or host port, `.env`), deploy with an
  optional tag, start/stop/restart, deployment history with live logs, container logs, an
  environment variable editor with `.env` import/download, settings, delete, and the CI webhook.
