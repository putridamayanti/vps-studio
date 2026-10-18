"use client"

import { useMemo, useState } from "react"
import {
  DownloadIcon,
  EyeIcon,
  EyeOffIcon,
  FileUpIcon,
  Loader2Icon,
  PlusIcon,
  RocketIcon,
  SaveIcon,
  Trash2Icon,
  UndoIcon,
} from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
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
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { api, errorMessage } from "@/lib/api"
import type { App, Deployment, EnvUploadResult } from "@/lib/types"

const KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/

type Row = { id: number; key: string; value: string }

let nextId = 0
const toRows = (env: Record<string, string> | null) =>
  Object.keys(env ?? {})
    .sort()
    .map((key) => ({ id: nextId++, key, value: env![key] }))

type Props = {
  app: App
  onSaved: () => void
  onDeployed: (d: Deployment) => void
}

// Render with key={app.updated_at} so the editor resets after a save or an import.
export function EnvPanel({ app, onSaved, onDeployed }: Props) {
  const original = useMemo(() => app.env ?? {}, [app.env])
  const [rows, setRows] = useState<Row[]>(() => toRows(original))
  const [reveal, setReveal] = useState(false)
  const [busy, setBusy] = useState<"save" | "deploy" | null>(null)

  const keys = rows.map((r) => r.key.trim())
  const invalid = rows.some((r) => r.key.trim() !== "" && !KEY_RE.test(r.key.trim()))
  const duplicate = keys.some((k, i) => k !== "" && keys.indexOf(k) !== i)

  // The PATCH body: changed or new keys get their value, removed keys get null.
  const patch = useMemo(() => {
    const out: Record<string, string | null> = {}
    const current = new Map<string, string>()
    for (const r of rows) if (r.key.trim()) current.set(r.key.trim(), r.value)
    for (const [k, v] of current) if (original[k] !== v) out[k] = v
    for (const k of Object.keys(original)) if (!current.has(k)) out[k] = null
    return out
  }, [rows, original])
  const dirty = Object.keys(patch).length > 0

  const update = (id: number, field: "key" | "value", v: string) =>
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, [field]: v } : r)))

  async function save(deploy: boolean) {
    setBusy(deploy ? "deploy" : "save")
    try {
      const res = await api<{ deployment?: Deployment }>(`/api/apps/${app.id}`, {
        method: "PATCH",
        body: { env: patch, deploy },
      })
      toast.success(deploy ? "Saved, deploying" : "Saved", {
        description: deploy ? undefined : "Changes take effect on the next deploy.",
      })
      onSaved()
      if (res.deployment) onDeployed(res.deployment)
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  async function download() {
    try {
      const text = await api<string>(`/api/apps/${app.id}/env`, { text: true })
      const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }))
      const a = document.createElement("a")
      a.href = url
      a.download = `${app.name}.env`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Environment variables</CardTitle>
        <CardDescription>
          Passed to the container as real environment variables. Changes apply on the next deploy.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => setReveal((r) => !r)}>
            {reveal ? <EyeOffIcon /> : <EyeIcon />}
            {reveal ? "Hide values" : "Show values"}
          </Button>
          <ImportEnvDialog app={app} onSaved={onSaved} onDeployed={onDeployed} disabled={dirty} />
          <Button variant="outline" size="sm" onClick={download}>
            <DownloadIcon /> Download .env
          </Button>
        </div>

        <div className="grid gap-2">
          {rows.length === 0 && (
            <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              No variables yet.
            </p>
          )}
          {rows.map((r) => {
            const key = r.key.trim()
            const bad = key !== "" && (!KEY_RE.test(key) || keys.filter((k) => k === key).length > 1)
            const changed = key !== "" && original[key] !== r.value
            return (
              <div key={r.id} className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)_auto] items-center gap-2">
                <Input
                  className="font-mono text-xs"
                  placeholder="KEY"
                  aria-invalid={bad}
                  value={r.key}
                  onChange={(e) => update(r.id, "key", e.target.value)}
                />
                <Input
                  className={`font-mono text-xs ${changed ? "border-amber-500/60" : ""}`}
                  placeholder="value"
                  type={reveal ? "text" : "password"}
                  autoComplete="off"
                  value={r.value}
                  onChange={(e) => update(r.id, "value", e.target.value)}
                />
                <Button
                  variant="ghost"
                  size="icon-sm"
                  title="Remove"
                  onClick={() => setRows((rs) => rs.filter((x) => x.id !== r.id))}
                >
                  <Trash2Icon />
                  <span className="sr-only">Remove</span>
                </Button>
              </div>
            )
          })}
          <div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setRows((rs) => [...rs, { id: nextId++, key: "", value: "" }])}
            >
              <PlusIcon /> Add variable
            </Button>
          </div>
        </div>

        {(invalid || duplicate) && (
          <p className="text-sm text-destructive">
            {invalid
              ? "Names must start with a letter or _ and contain only letters, digits and _."
              : "Each name can only be used once."}
          </p>
        )}

        <div className="flex flex-wrap items-center justify-end gap-2 border-t pt-4">
          {dirty && (
            <span className="mr-auto text-sm text-muted-foreground">
              {Object.keys(patch).length} unsaved change{Object.keys(patch).length === 1 ? "" : "s"}
            </span>
          )}
          <Button variant="ghost" disabled={!dirty || !!busy} onClick={() => setRows(toRows(original))}>
            <UndoIcon /> Discard
          </Button>
          <Button variant="outline" disabled={!dirty || invalid || duplicate || !!busy} onClick={() => save(false)}>
            {busy === "save" ? <Loader2Icon className="animate-spin" /> : <SaveIcon />}
            Save
          </Button>
          <Button disabled={!dirty || invalid || duplicate || !!busy} onClick={() => save(true)}>
            {busy === "deploy" ? <Loader2Icon className="animate-spin" /> : <RocketIcon />}
            Save and deploy
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function ImportEnvDialog({ app, onSaved, onDeployed, disabled }: Props & { disabled: boolean }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState("")
  const [replace, setReplace] = useState(false)
  const [deploy, setDeploy] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (replace) params.set("replace", "true")
      if (deploy) params.set("deploy", "true")
      const res = await api<EnvUploadResult>(`/api/apps/${app.id}/env?${params}`, { method: "PUT", body: text })
      const parts = [
        res.added.length && `${res.added.length} added`,
        res.updated.length && `${res.updated.length} updated`,
        res.removed.length && `${res.removed.length} removed`,
      ].filter(Boolean)
      toast.success(parts.length ? `Imported: ${parts.join(", ")}` : "No changes", {
        description: [...res.added, ...res.updated].join(", ") || undefined,
      })
      setOpen(false)
      onSaved()
      if (res.deployment) onDeployed(res.deployment)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (busy) return
        if (o) {
          setText("")
          setError(null)
          setReplace(false)
          setDeploy(false)
        }
        setOpen(o)
      }}
    >
      <DialogTrigger
        disabled={disabled}
        render={
          <Button variant="outline" size="sm" title={disabled ? "Save or discard your changes first" : undefined}>
            <FileUpIcon /> Import .env
          </Button>
        }
      />
      <DialogContent className="sm:max-w-xl">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Import a .env file</DialogTitle>
            <DialogDescription>
              Keys in the file are added or updated; other keys stay unless you replace them all.{" "}
              <code className="font-mono">{"${VAR}"}</code> references are resolved within the file.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            rows={10}
            required
            className="font-mono text-xs"
            placeholder={"DATABASE_URL=postgres://...\nAPP_DEBUG=false"}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <div>
            <Button type="button" variant="outline" size="sm" render={<label />} nativeButton={false}>
              <FileUpIcon /> Choose file
              <input
                type="file"
                className="hidden"
                onChange={async (e) => {
                  const f = e.target.files?.[0]
                  if (f) setText(await f.text())
                  e.target.value = ""
                }}
              />
            </Button>
          </div>
          <div className="grid gap-3 rounded-lg border p-3">
            <label className="flex items-center justify-between gap-4 text-sm">
              <span>
                Replace all
                <span className="block text-xs text-muted-foreground">Remove keys that aren&apos;t in the file.</span>
              </span>
              <Switch checked={replace} onCheckedChange={setReplace} />
            </label>
            <label className="flex items-center justify-between gap-4 text-sm">
              <span>
                Deploy after import
                <span className="block text-xs text-muted-foreground">Otherwise changes apply on the next deploy.</span>
              </span>
              <Switch checked={deploy} onCheckedChange={setDeploy} />
            </label>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !text.trim()}>
              {busy && <Loader2Icon className="animate-spin" />}
              Import
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
