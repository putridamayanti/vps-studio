"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import useSWR from "swr"
import { ArrowLeftIcon, Loader2Icon, PencilIcon, RefreshCwIcon, Trash2Icon } from "lucide-react"
import { toast } from "sonner"

import { ConfirmDialog } from "@/components/confirm-dialog"
import { DetailRow, ErrorState, PageHeader } from "@/components/page-header"
import { ServerFormDialog } from "@/components/servers/server-form-dialog"
import { StatusBadge } from "@/components/status-badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { api, errorMessage } from "@/lib/api"
import { formatDate, timeAgo } from "@/lib/format"
import type { App, Server } from "@/lib/types"

export default function ServerDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const { data: server, error, mutate } = useSWR<Server>(`/api/servers/${id}`, {
    refreshInterval: (data) => (data?.status === "setting_up" ? 2000 : 0),
  })
  const { data: apps } = useSWR<App[]>("/api/apps")
  const [startingSetup, setStartingSetup] = useState(false)
  const logRef = useRef<HTMLPreElement>(null)

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [server?.setup_log])

  if (error) {
    return (
      <>
        <BackLink />
        <ErrorState error={error} onRetry={() => mutate()} />
      </>
    )
  }
  if (!server) return <Skeleton className="h-64 w-full" />

  const serverApps = apps?.filter((a) => a.server_id === server.id) ?? []

  async function runSetup() {
    setStartingSetup(true)
    try {
      const updated = await api<Server>(`/api/servers/${server!.id}/setup`, { method: "POST" })
      mutate(updated, { revalidate: false })
      toast.success("Setup started")
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setStartingSetup(false)
    }
  }

  async function remove() {
    try {
      await api(`/api/servers/${server!.id}`, { method: "DELETE" })
      toast.success(`Removed ${server!.name}`)
      router.push("/servers")
    } catch (err) {
      toast.error(errorMessage(err))
      return false
    }
  }

  return (
    <>
      <BackLink />
      <PageHeader
        title={
          <>
            {server.name} <StatusBadge status={server.status} />
          </>
        }
        description={
          <span className="font-mono">
            {server.username}@{server.host}:{server.port}
          </span>
        }
        actions={
          <>
            <ServerFormDialog
              server={server}
              onSaved={(s) => mutate(s, { revalidate: true })}
              trigger={
                <Button variant="outline">
                  <PencilIcon /> Edit
                </Button>
              }
            />
            <Button variant="outline" onClick={runSetup} disabled={startingSetup || server.status === "setting_up"}>
              {startingSetup || server.status === "setting_up" ? <Loader2Icon className="animate-spin" /> : <RefreshCwIcon />}
              Run setup
            </Button>
            <ConfirmDialog
              title={`Remove ${server.name}?`}
              description={
                serverApps.length > 0
                  ? `This server still has ${serverApps.length} app(s). Delete them first.`
                  : "vps-studio forgets this server and its login. Nothing on the VPS is changed."
              }
              confirmLabel="Remove server"
              destructive
              onConfirm={remove}
              trigger={
                <Button variant="destructive">
                  <Trash2Icon /> Remove
                </Button>
              }
            />
          </>
        }
      />

      {server.status === "error" && (
        <div className="mb-6 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm">
          <p className="font-medium text-destructive">Setup failed</p>
          <p className="text-muted-foreground">
            Read the setup log below, fix the problem (or edit the server), then run setup again.
          </p>
        </div>
      )}
      {server.status === "new" && (
        <div className="mb-6 rounded-xl border p-4 text-sm text-muted-foreground">
          This server hasn&apos;t been set up yet. Run setup before deploying apps to it.
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <div className="grid content-start gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="divide-y">
                <DetailRow label="Host">
                  <span className="font-mono">{server.host}</span>
                </DetailRow>
                <DetailRow label="SSH port">{server.port}</DetailRow>
                <DetailRow label="Username">{server.username}</DetailRow>
                <DetailRow label="Login">
                  {[server.has_private_key && "Private key", server.has_password && "Password"]
                    .filter(Boolean)
                    .join(" + ") || "—"}
                </DetailRow>
                <DetailRow label="HTTPS">
                  {server.acme_email ? `Enabled (${server.acme_email})` : "Off — apps can only use a host port"}
                </DetailRow>
                <DetailRow label="Host key">
                  <span className="font-mono text-xs break-all">{server.host_key_fingerprint || "—"}</span>
                </DetailRow>
                <DetailRow label="Added">{formatDate(server.created_at)}</DetailRow>
                <DetailRow label="Updated">{timeAgo(server.updated_at)}</DetailRow>
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Apps on this server</CardTitle>
            </CardHeader>
            <CardContent>
              {serverApps.length === 0 ? (
                <p className="text-sm text-muted-foreground">No apps yet.</p>
              ) : (
                <ul className="divide-y">
                  {serverApps.map((a) => (
                    <li key={a.id} className="flex items-center justify-between gap-2 py-2">
                      <Link href={`/apps/${a.name}`} className="font-medium hover:underline">
                        {a.name}
                      </Link>
                      <StatusBadge status={a.container?.state} />
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>Setup log</CardTitle>
            <CardDescription>Docker install, network and HTTPS proxy setup output.</CardDescription>
          </CardHeader>
          <CardContent>
            <pre
              ref={logRef}
              className="max-h-[32rem] min-h-40 overflow-auto rounded-lg bg-zinc-950 p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap text-zinc-100"
            >
              {server.setup_log || "No setup output yet."}
            </pre>
          </CardContent>
        </Card>
      </div>
    </>
  )
}

function BackLink() {
  return (
    <Link href="/servers" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
      <ArrowLeftIcon className="size-4" /> Servers
    </Link>
  )
}
