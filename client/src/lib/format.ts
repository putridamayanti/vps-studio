export function timeAgo(value?: string | number | null) {
  if (!value) return "—"
  const date = new Date(value)
  const seconds = Math.round((Date.now() - date.getTime()) / 1000)
  if (Number.isNaN(seconds)) return "—"
  if (seconds < 5) return "just now"
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  return date.toLocaleDateString()
}

export function formatDate(value?: string | null) {
  if (!value) return "—"
  const date = new Date(value)
  if (Number.isNaN(date.getTime()) || date.getFullYear() < 2000) return "—"
  return date.toLocaleString()
}

export function duration(from: string, to?: string | null) {
  const ms = (to ? new Date(to).getTime() : Date.now()) - new Date(from).getTime()
  if (ms < 0 || Number.isNaN(ms)) return "—"
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  return `${Math.floor(s / 60)}m ${s % 60}s`
}

export function remaining(ms: number) {
  if (ms <= 0) return "0m"
  const totalMinutes = Math.ceil(ms / 60000)
  const h = Math.floor(totalMinutes / 60)
  const m = totalMinutes % 60
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}
