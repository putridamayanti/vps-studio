"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import useSWR from "swr"
import { ArrowLeftIcon, Loader2Icon, UploadIcon } from "lucide-react"
import { toast } from "sonner"

import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { api, errorMessage } from "@/lib/api"
import { NAME_HINT, NAME_PATTERN } from "@/lib/app-url"
import type { App, Deployment, Server } from "@/lib/types"

export default function NewAppPage() {
  const router = useRouter()
  const { data: servers } = useSWR<Server[]>("/api/servers")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState({
    name: "",
    server: "",
    image: "",
    registry_username: "",
    registry_token: "",
    port: "3000",
    domain: "",
    host_port: "",
    env_file: "",
    deploy: true,
  })
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }))

  // Default to the first ready server.
  const serverId = form.server || (servers?.find((s) => s.status === "ready") ?? servers?.[0])?.id || ""
  const selected = servers?.find((s) => s.id === serverId)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const res = await api<{ app: App; deployment?: Deployment }>("/api/apps", {
        method: "POST",
        body: {
          name: form.name.trim(),
          server: serverId || undefined,
          image: form.image.trim(),
          registry_username: form.registry_username.trim() || undefined,
          registry_token: form.registry_token.trim() || undefined,
          port: Number(form.port),
          domain: form.domain.trim() || undefined,
          host_port: form.host_port ? Number(form.host_port) : undefined,
          env_file: form.env_file || undefined,
          deploy: form.deploy,
        },
      })
      toast.success(`Created ${res.app.name}`, {
        description: res.deployment ? "The first deploy is running." : undefined,
      })
      router.push(`/apps/${res.app.name}${res.deployment ? `?deployment=${res.deployment.id}` : ""}`)
    } catch (err) {
      setError(errorMessage(err))
      setBusy(false)
    }
  }

  async function loadEnvFile(file?: File) {
    if (!file) return
    set("env_file", await file.text())
  }

  return (
    <>
      <Link href="/apps" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeftIcon className="size-4" /> Apps
      </Link>
      <PageHeader title="New app" description="Run a Docker image on one of your servers." />

      {servers && servers.length === 0 && (
        <div className="mb-6 rounded-xl border p-4 text-sm">
          You need a server first.{" "}
          <Link href="/servers" className="font-medium underline underline-offset-4">
            Add a server
          </Link>
        </div>
      )}

      <form onSubmit={onSubmit} className="grid max-w-3xl gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Basics</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="app-name">Name</Label>
              <Input
                id="app-name"
                required
                placeholder="my-api"
                pattern={NAME_PATTERN}
                title={NAME_HINT}
                value={form.name}
                onChange={(e) => set("name", e.target.value.toLowerCase())}
              />
              <p className="text-xs text-muted-foreground">Other apps reach it at http://{form.name || "name"}:port</p>
            </div>
            <div className="grid gap-2">
              <Label>Server</Label>
              <Select
                value={serverId || null}
                onValueChange={(v) => set("server", (v as string) ?? "")}
                items={servers?.map((s) => ({ value: s.id, label: s.name })) ?? []}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Choose a server" />
                </SelectTrigger>
                <SelectContent>
                  {servers?.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name} <span className="text-muted-foreground">({s.status.replace("_", " ")})</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selected && selected.status !== "ready" && form.deploy && (
                <p className="text-xs text-destructive">This server isn&apos;t ready, so the first deploy will fail.</p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Image</CardTitle>
            <CardDescription>Only GitHub Container Registry (ghcr.io) images are supported for now.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2 sm:col-span-2">
              <Label htmlFor="app-image">Image</Label>
              <Input
                id="app-image"
                required
                placeholder="ghcr.io/my-org/my-api:latest"
                className="font-mono"
                value={form.image}
                onChange={(e) => set("image", e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="app-reg-token">Registry token</Label>
              <Input
                id="app-reg-token"
                type="password"
                autoComplete="off"
                placeholder="ghp_… (private packages only)"
                value={form.registry_token}
                onChange={(e) => set("registry_token", e.target.value)}
              />
              <p className="text-xs text-muted-foreground">GitHub PAT (classic) with read:packages.</p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="app-reg-user">Registry username</Label>
              <Input
                id="app-reg-user"
                placeholder="Defaults to the image owner"
                value={form.registry_username}
                onChange={(e) => set("registry_username", e.target.value)}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Networking</CardTitle>
            <CardDescription>
              Use a domain (needs a DNS A record to the VPS and HTTPS enabled on the server), or publish a host port.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-3">
            <div className="grid gap-2">
              <Label htmlFor="app-port">Container port</Label>
              <Input
                id="app-port"
                type="number"
                required
                min={1}
                max={65535}
                value={form.port}
                onChange={(e) => set("port", e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="app-domain">Domain</Label>
              <Input
                id="app-domain"
                placeholder="api.example.com"
                disabled={!!selected && !selected.acme_email}
                value={form.domain}
                onChange={(e) => set("domain", e.target.value)}
              />
              {selected && !selected.acme_email && (
                <p className="text-xs text-muted-foreground">HTTPS is off on this server.</p>
              )}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="app-host-port">Host port</Label>
              <Input
                id="app-host-port"
                type="number"
                min={1}
                max={65535}
                placeholder="Optional"
                value={form.host_port}
                onChange={(e) => set("host_port", e.target.value)}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Environment</CardTitle>
            <CardDescription>
              Paste a .env file or upload one. <code className="font-mono">PORT</code> is set to the container port unless
              you set it here.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2">
            <Textarea
              rows={8}
              className="font-mono text-xs"
              placeholder={"DATABASE_URL=postgres://...\nAPP_DEBUG=false"}
              value={form.env_file}
              onChange={(e) => set("env_file", e.target.value)}
            />
            <div>
              <Button type="button" variant="outline" size="sm" render={<label />} nativeButton={false}>
                <UploadIcon /> Upload .env
                <input
                  type="file"
                  className="hidden"
                  onChange={(e) => {
                    loadEnvFile(e.target.files?.[0])
                    e.target.value = ""
                  }}
                />
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <label className="flex items-center gap-3">
              <Switch checked={form.deploy} onCheckedChange={(v) => set("deploy", v)} />
              <span className="text-sm">Deploy right away</span>
            </label>
            <div className="flex flex-col gap-2 sm:items-end">
              <Button type="submit" disabled={busy || !serverId}>
                {busy && <Loader2Icon className="animate-spin" />}
                {form.deploy ? "Create and deploy" : "Create app"}
              </Button>
            </div>
          </CardContent>
          {error && <p className="px-4 text-sm text-destructive">{error}</p>}
        </Card>
      </form>
    </>
  )
}
