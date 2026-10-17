"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { KeyRoundIcon, Loader2Icon, ServerIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { api, ApiError, errorMessage } from "@/lib/api"
import { getApiKey, saveApiKey } from "@/lib/auth"

function nextPath() {
  const next = new URLSearchParams(window.location.search).get("next")
  // Only allow local paths.
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/"
}

export default function LoginPage() {
  const router = useRouter()
  const [key, setKey] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (getApiKey()) router.replace(nextPath())
  }, [router])

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = key.trim()
    if (!trimmed) return
    setLoading(true)
    setError(null)
    try {
      // Any authenticated endpoint works to check the key.
      await api("/api/servers", { apiKey: trimmed })
      saveApiKey(trimmed)
      router.replace(nextPath())
    } catch (err) {
      setError(err instanceof ApiError && err.status === 401 ? "That API key is not valid." : errorMessage(err))
      setLoading(false)
    }
  }

  return (
    <main className="flex flex-1 items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <div className="mb-2 flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <ServerIcon className="size-5" />
          </div>
          <CardTitle className="text-xl">Sign in to vps-studio</CardTitle>
          <CardDescription>
            Enter the <code className="font-mono text-xs">API_KEY</code> from the server&apos;s{" "}
            <code className="font-mono text-xs">.env</code>. It stays in this browser for 6 hours.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="api-key">API key</Label>
              <div className="relative">
                <KeyRoundIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="api-key"
                  type="password"
                  autoComplete="current-password"
                  autoFocus
                  className="pl-8 font-mono"
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  aria-invalid={!!error}
                />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
            </div>
            <Button type="submit" disabled={loading || !key.trim()}>
              {loading && <Loader2Icon className="animate-spin" />}
              Sign in
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  )
}
