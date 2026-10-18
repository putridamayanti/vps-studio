# vps-studio API (Go). Listens on :8081 and stores its database in /data.
# The dashboard image (../frontend) proxies /api, /hooks and /healthz to it.

FROM golang:1.26-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY cmd ./cmd
COPY internal ./internal
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/vps-studio ./cmd/server

FROM alpine:3.22
RUN apk add --no-cache ca-certificates tzdata
COPY --from=build /out/vps-studio /usr/local/bin/vps-studio

ENV PORT=8081 \
    DATABASE_PATH=/data/vps-studio.db
VOLUME /data
EXPOSE 8081
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:8081/healthz >/dev/null || exit 1
ENTRYPOINT ["vps-studio"]
