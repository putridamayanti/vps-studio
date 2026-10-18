// The API key is kept in localStorage for a limited time only.
const STORAGE_KEY = "vps-studio.auth"
export const SESSION_TTL_MS = 6 * 60 * 60 * 1000
export const AUTH_EVENT = "vps-studio:auth"

type StoredAuth = { key: string; expiresAt: number }

function read(): StoredAuth | null {
  if (typeof window === "undefined") return null
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as StoredAuth
    if (typeof parsed.key !== "string" || typeof parsed.expiresAt !== "number") return null
    if (Date.now() >= parsed.expiresAt) {
      window.localStorage.removeItem(STORAGE_KEY)
      return null
    }
    return parsed
  } catch {
    return null
  }
}

export function getApiKey(): string | null {
  return read()?.key ?? null
}

export function getExpiry(): number | null {
  return read()?.expiresAt ?? null
}

export function saveApiKey(key: string) {
  const value: StoredAuth = { key, expiresAt: Date.now() + SESSION_TTL_MS }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value))
  window.dispatchEvent(new Event(AUTH_EVENT))
}

export function clearApiKey() {
  if (typeof window === "undefined") return
  window.localStorage.removeItem(STORAGE_KEY)
  window.dispatchEvent(new Event(AUTH_EVENT))
}
