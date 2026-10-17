"use client"

import { useState } from "react"
import { Loader2Icon } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { api, errorMessage } from "@/lib/api"
import type { Server } from "@/lib/types"

type Props = {
  trigger: React.ReactElement
  // Edit mode when set.
  server?: Server
  onSaved?: (server: Server) => void
}

type Form = {
  name: string
  host: string
  port: string
  username: string
  password: string
  private_key: string
  acme_email: string
  setup: boolean
}

function initial(server?: Server): Form {
  return {
    name: server?.name ?? "",
    host: server?.host ?? "",
    port: String(server?.port ?? 22),
    username: server?.username ?? "root",
    password: "",
    private_key: "",
    acme_email: server?.acme_email ?? "",
    setup: !server,
  }
}

export function ServerFormDialog({ trigger, server, onSaved }: Props) {
  const editing = !!server
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<Form>(() => initial(server))
  const [auth, setAuth] = useState<"password" | "key">(server?.has_private_key ? "key" : "password")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }))

  function onOpenChange(next: boolean) {
    if (busy) return
    if (next) {
      setForm(initial(server))
      setAuth(server?.has_private_key ? "key" : "password")
      setError(null)
    }
    setOpen(next)
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const port = Number(form.port) || 22
    // Only send the credential for the chosen method; blank means "unchanged" when editing.
    const credential: Record<string, string> = {}
    if (auth === "password" && form.password) credential.password = form.password
    if (auth === "key" && form.private_key.trim()) credential.private_key = form.private_key.trim() + "\n"
    if (editing && credential.password) credential.private_key = ""
    if (editing && credential.private_key) credential.password = ""

    try {
      const saved = editing
        ? await api<Server>(`/api/servers/${server.id}`, {
            method: "PATCH",
            body: {
              host: form.host.trim(),
              port,
              username: form.username.trim(),
              acme_email: form.acme_email.trim(),
              setup: form.setup,
              ...credential,
            },
          })
        : await api<Server>("/api/servers", {
            method: "POST",
            body: {
              name: form.name.trim(),
              host: form.host.trim(),
              port,
              username: form.username.trim(),
              acme_email: form.acme_email.trim(),
              setup: form.setup,
              ...credential,
            },
          })
      toast.success(editing ? `Saved ${saved.name}` : `Connected to ${saved.name}`, {
        description: saved.status === "setting_up" ? "Setup is running in the background." : undefined,
      })
      setOpen(false)
      onSaved?.(saved)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger render={trigger} />
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <form onSubmit={onSubmit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{editing ? `Edit ${server.name}` : "Add a server"}</DialogTitle>
            <DialogDescription>
              {editing
                ? "Leave the password or key blank to keep the current one. The SSH login is tested when you save."
                : "vps-studio tests the SSH login, then installs Docker and the HTTPS proxy in the background."}
            </DialogDescription>
          </DialogHeader>

          {!editing && (
            <div className="grid gap-2">
              <Label htmlFor="srv-name">Name</Label>
              <Input
                id="srv-name"
                required
                placeholder="sumopod"
                pattern="[a-z0-9][a-z0-9\-]{0,39}"
                title="Lowercase letters, digits or '-', max 40 characters"
                value={form.name}
                onChange={(e) => set("name", e.target.value.toLowerCase())}
              />
            </div>
          )}

          <div className="grid grid-cols-[1fr_6rem] gap-3">
            <div className="grid gap-2">
              <Label htmlFor="srv-host">Host</Label>
              <Input
                id="srv-host"
                required
                placeholder="203.0.113.10"
                value={form.host}
                onChange={(e) => set("host", e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="srv-port">SSH port</Label>
              <Input
                id="srv-port"
                type="number"
                min={1}
                max={65535}
                value={form.port}
                onChange={(e) => set("port", e.target.value)}
              />
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="srv-user">Username</Label>
            <Input id="srv-user" required value={form.username} onChange={(e) => set("username", e.target.value)} />
            <p className="text-xs text-muted-foreground">Non-root users need sudo.</p>
          </div>

          <div className="grid gap-2">
            <Label>Authentication</Label>
            <Tabs value={auth} onValueChange={(v) => setAuth(v as "password" | "key")}>
              <TabsList>
                <TabsTrigger value="password">Password</TabsTrigger>
                <TabsTrigger value="key">Private key</TabsTrigger>
              </TabsList>
            </Tabs>
            {auth === "password" ? (
              <Input
                type="password"
                autoComplete="new-password"
                required={!editing || !server.has_password}
                placeholder={editing && server.has_password ? "•••••••• (unchanged)" : "VPS password"}
                value={form.password}
                onChange={(e) => set("password", e.target.value)}
              />
            ) : (
              <Textarea
                required={!editing || !server.has_private_key}
                rows={4}
                className="font-mono text-xs"
                placeholder={
                  editing && server.has_private_key
                    ? "(unchanged)"
                    : "-----BEGIN OPENSSH PRIVATE KEY-----\n...\n-----END OPENSSH PRIVATE KEY-----"
                }
                value={form.private_key}
                onChange={(e) => set("private_key", e.target.value)}
              />
            )}
          </div>

          <div className="grid gap-2">
            <Label htmlFor="srv-acme">HTTPS email (optional)</Label>
            <Input
              id="srv-acme"
              type="email"
              placeholder="you@example.com"
              value={form.acme_email}
              onChange={(e) => set("acme_email", e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Enables the Traefik HTTPS proxy so apps can use a domain. Let&apos;s Encrypt sends expiry notices here.
            </p>
          </div>

          <label className="flex items-center justify-between gap-4 rounded-lg border p-3">
            <div className="grid gap-0.5">
              <span className="text-sm font-medium">{editing ? "Re-run setup after saving" : "Set up now"}</span>
              <span className="text-xs text-muted-foreground">Installs Docker, the network and the HTTPS proxy.</span>
            </div>
            <Switch checked={form.setup} onCheckedChange={(v) => set("setup", v)} />
          </label>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy && <Loader2Icon className="animate-spin" />}
              {busy ? "Connecting…" : editing ? "Save" : "Add server"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
