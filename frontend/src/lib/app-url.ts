import type { App, Server } from "@/lib/types"

// The public URL of an app: its domain over HTTPS, or the published host port.
export function appUrl(app: App, server?: Server) {
  if (app.domain) return `https://${app.domain}`
  if (app.host_port && server) return `http://${server.host}:${app.host_port}`
  return null
}

export const NAME_PATTERN = "[a-z0-9][a-z0-9\\-]{0,39}"
export const NAME_HINT = "Lowercase letters, digits or '-', max 40 characters"
