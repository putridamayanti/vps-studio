"use client"

import { useState } from "react"
import { Loader2Icon, RocketIcon, SaveIcon, Trash2Icon } from "lucide-react"
import { toast } from "sonner"

import { ConfirmDialog } from "@/components/confirm-dialog"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { api, errorMessage } from "@/lib/api"
import type { App, Deployment, Server } from "@/lib/types"

function initial(app: App) {
  return {
    image: app.image,
    registry_username: app.registry_username ?? "",
    registry_token: "",
    clear_token: false,
    port: String(app.port),
    host_port: app.host_port ? String(app.host_port) : "",
    domain: app.domain ?? "",
  }
}

type Props = {
  app: App
  server?: Server
  onSaved: () => void
  onDeployed: (d: Deployment) => void
  onDeleted: () => void
}

// Render with key={app.updated_at} so the form resets after a save but not on background refreshes.
export function SettingsPanel({ app, server, onSaved, onDeployed, onDeleted }: Props) {
  const [form, setForm] = useState(() => initial(app))
  const [busy, setBusy] = useState<"save" | "deploy" | null>(null)
  const [error, setError] = useState<string | null>(null)
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }))

  async function save(deploy: boolean) {
    setBusy(deploy ? "deploy" : "save")
    setError(null)
    const body: Record<string, unknown> = {
      image: form.image.trim(),
      registry_username: form.registry_username.trim(),
      port: Number(form.port),
      host_port: form.host_port ? Number(form.host_port) : 0,
      domain: form.domain.trim(),
      deploy,
    }
    if (form.clear_token) body.registry_token = ""
    else if (form.registry_token.trim()) body.registry_token = form.registry_token.trim()
    try {
      const res = await api<{ deployment?: Deployment }>(`/api/apps/${app.id}`, { method: "PATCH", body })
      toast.success(deploy ? "Saved, deploying" : "Saved", {
        description: deploy ? undefined : "Changes take effect on the next deploy.",
      })
      onSaved()
      if (res.deployment) onDeployed(res.deployment)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  async function remove() {
    try {
      await api(`/api/apps/${app.id}`, { method: "DELETE" })
      toast.success(`Deleted ${app.name}`)
      onDeleted()
    } catch (err) {
      toast.error(errorMessage(err))
      return false
    }
  }

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Settings</CardTitle>
          <CardDescription>Saved settings take effect on the next deploy.</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-4 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault()
              save(false)
            }}
          >
            <div className="grid gap-2 sm:col-span-2">
              <Label htmlFor="set-image">Image</Label>
              <Input
                id="set-image"
                required
                className="font-mono text-xs"
                value={form.image}
                onChange={(e) => set("image", e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="set-reg-user">Registry username</Label>
              <Input
                id="set-reg-user"
                placeholder="Defaults to the image owner"
                value={form.registry_username}
                onChange={(e) => set("registry_username", e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="set-reg-token">Registry token</Label>
              <Input
                id="set-reg-token"
                type="password"
                autoComplete="off"
                disabled={form.clear_token}
                placeholder={app.has_registry_token ? "•••••••• (unchanged)" : "None (public image)"}
                value={form.registry_token}
                onChange={(e) => set("registry_token", e.target.value)}
              />
              {app.has_registry_token && (
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Switch size="sm" checked={form.clear_token} onCheckedChange={(v) => set("clear_token", v)} />
                  Remove the saved token
                </label>
              )}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="set-port">Container port</Label>
              <Input
                id="set-port"
                type="number"
                required
                min={1}
                max={65535}
                value={form.port}
                onChange={(e) => set("port", e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="set-host-port">Host port</Label>
              <Input
                id="set-host-port"
                type="number"
                min={1}
                max={65535}
                placeholder="None"
                value={form.host_port}
                onChange={(e) => set("host_port", e.target.value)}
              />
            </div>
            <div className="grid gap-2 sm:col-span-2">
              <Label htmlFor="set-domain">Domain</Label>
              <Input
                id="set-domain"
                placeholder="api.example.com"
                value={form.domain}
                onChange={(e) => set("domain", e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                {server && !server.acme_email
                  ? `HTTPS is off on ${server.name}; set an HTTPS email on the server to use a domain.`
                  : `Point a DNS A record at ${server?.host ?? "the server"}.`}
              </p>
            </div>
            {error && <p className="text-sm text-destructive sm:col-span-2">{error}</p>}
            <div className="flex flex-wrap justify-end gap-2 border-t pt-4 sm:col-span-2">
              <Button type="button" variant="ghost" disabled={!!busy} onClick={() => setForm(initial(app))}>
                Reset
              </Button>
              <Button type="submit" variant="outline" disabled={!!busy}>
                {busy === "save" ? <Loader2Icon className="animate-spin" /> : <SaveIcon />}
                Save
              </Button>
              <Button type="button" disabled={!!busy} onClick={() => save(true)}>
                {busy === "deploy" ? <Loader2Icon className="animate-spin" /> : <RocketIcon />}
                Save and deploy
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card className="ring-destructive/30">
        <CardHeader>
          <CardTitle className="text-destructive">Delete app</CardTitle>
          <CardDescription>Stops and removes the container on the VPS, then deletes the app and its history.</CardDescription>
        </CardHeader>
        <CardContent>
          <ConfirmDialog
            title={`Delete ${app.name}?`}
            description="The container is removed from the server. This can't be undone."
            confirmLabel="Delete app"
            destructive
            onConfirm={remove}
            trigger={
              <Button variant="destructive">
                <Trash2Icon /> Delete app
              </Button>
            }
          />
        </CardContent>
      </Card>
    </div>
  )
}
