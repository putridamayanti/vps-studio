import { clearApiKey, getApiKey } from "@/lib/auth"

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number
  ) {
    super(message)
  }
}

type RequestOptions = {
  method?: string
  // JSON-encoded unless it's already a string (raw body, e.g. a .env file).
  body?: unknown
  // Return the response as text instead of JSON.
  text?: boolean
  // Override the stored key (used by the login form to test a key).
  apiKey?: string
}

// Requests go to /api/* on this origin; src/proxy.ts forwards them to the Go server.
export async function api<T = unknown>(path: string, opts: RequestOptions = {}): Promise<T> {
  const key = opts.apiKey ?? getApiKey()
  const headers: Record<string, string> = {}
  if (key) headers.Authorization = `Bearer ${key}`

  let body: BodyInit | undefined
  if (typeof opts.body === "string") {
    body = opts.body
    headers["Content-Type"] = "text/plain"
  } else if (opts.body !== undefined) {
    body = JSON.stringify(opts.body)
    headers["Content-Type"] = "application/json"
  }

  let res: Response
  try {
    res = await fetch(path, { method: opts.method ?? "GET", headers, body })
  } catch {
    throw new ApiError("Could not reach the vps-studio API", 0)
  }

  if (!res.ok) {
    let message = `Request failed (${res.status})`
    try {
      const data = await res.json()
      if (data?.error) message = data.error
    } catch {
      // Not JSON: usually the proxy failing to reach the Go server.
      if (res.status >= 500) message = `Could not reach the vps-studio API (${res.status})`
    }
    if (res.status === 401 && !opts.apiKey) clearApiKey()
    throw new ApiError(message, res.status)
  }

  if (res.status === 204) return undefined as T
  return (opts.text ? res.text() : res.json()) as Promise<T>
}

export const fetcher = <T,>(path: string) => api<T>(path)
export const textFetcher = (path: string) => api<string>(path, { text: true })

export function errorMessage(err: unknown) {
  return err instanceof Error ? err.message : String(err)
}
