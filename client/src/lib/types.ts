// Mirrors the JSON returned by the Go API (internal/api, internal/store).

export type ServerStatus = "new" | "setting_up" | "ready" | "error"

export interface Server {
  id: string
  name: string
  host: string
  port: number
  username: string
  acme_email?: string
  status: ServerStatus
  setup_log?: string
  created_at: string
  updated_at: string
  host_key_fingerprint?: string
  has_password: boolean
  has_private_key: boolean
}

export interface ContainerStatus {
  // running, exited, restarting, paused, created, dead, not_deployed
  state: string
  started_at?: string
  image?: string
}

export interface App {
  id: string
  name: string
  server_id: string
  image: string
  registry: string
  registry_username?: string
  port: number
  host_port?: number
  domain?: string
  env: Record<string, string> | null
  webhook_token: string
  created_at: string
  updated_at: string
  has_registry_token: boolean
  container?: ContainerStatus
}

export type DeploymentStatus = "queued" | "pulling" | "starting" | "succeeded" | "failed"

export interface Deployment {
  id: string
  app_id: string
  image: string
  status: DeploymentStatus
  trigger: string
  log?: string
  error?: string
  container_id?: string
  created_at: string
  finished_at?: string
}

export interface EnvUploadResult {
  added: string[]
  updated: string[]
  removed: string[]
  total: number
  note?: string
  deployment?: Deployment
}

export function isDeploymentActive(d: Pick<Deployment, "status">) {
  return d.status === "queued" || d.status === "pulling" || d.status === "starting"
}
