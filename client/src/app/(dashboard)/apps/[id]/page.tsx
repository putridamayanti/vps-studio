"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import useSWR, { useSWRConfig } from "swr"
import { ArrowLeftIcon, ExternalLinkIcon, Loader2Icon, PlayIcon, RotateCwIcon, SquareIcon } from "lucide-react"
import { toast } from "sonner"

import { DeployDialog } from "@/components/apps/deploy-dialog"
import { DeploymentLogDialog, DeploymentsPanel } from "@/components/apps/deployments-panel"
import { EnvPanel } from "@/components/apps/env-panel"
import { LogsPanel } from "@/components/apps/logs-panel"
import { SettingsPanel } from "@/components/apps/settings-panel"
import { WebhookCard } from "@/components/apps/webhook-card"
import { ConfirmDialog } from "@/components/confirm-dialog"
import { DetailRow, ErrorState, PageHeader } from "@/components/page-header"
import { StatusBadge } from "@/components/status-badge"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { api, errorMessage } from "@/lib/api"
import { appUrl } from "@/lib/app-url"
import { duration, formatDate, timeAgo } from "@/lib/format"
import { isDeploymentActive, type App, type ContainerStatus, type Deployment, type Server } from "@/lib/types"

type Tab = "overview" | "deployments" | "logs" | "env" | "settings"

export default function AppDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const { mutate: globalMutate } = useSWRConfig()
  const [tab, setTab] = useState<Tab>("overview")
  // Opened from "create app": show the first deployment's log. Dashboard pages only render in the
  // browser (behind AuthGuard), so window is available here.
  const [openDeployment, setOpenDeployment] = useState<string | null>(() =>
    typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("deployment")
  )
  const [action, setAction] = useState<string | null>(null)

  const deploymentsKey = (appId: string) => `/api/apps/${appId}/deployments?limit=50`
  const { data: app, error, mutate } = useSWR<App>(`/api/apps/${id}`, { refreshInterval: 10000 })
  const { data: servers } = useSWR<Server[]>("/api/servers")
  const { data: deployments } = useSWR<Deployment[]>(app ? deploymentsKey(app.id) : null, {
    refreshInterval: (d) => (d?.some(isDeploymentActive) ? 2000 : 15000),
  })

  useEffect(() => {
    if (window.location.search) window.history.replaceState(null, "", window.location.pathname)
  }, [])

  // Refresh the container state once a running deploy finishes.
  const active = deployments?.some(isDeploymentActive)
  useEffect(() => {
    if (active === false) mutate()
  }, [active, mutate])

  if (error) {
    return (
      <>
        <BackLink />
        <ErrorState error={error} onRetry={() => mutate()} />
      </>
    )
  }
  if (!app) return <Skeleton className="h-64 w-full" />

  const server = servers?.find((s) => s.id === app.server_id)
  const url = appUrl(app, server)
  const latest = deployments?.[0]
  const state = app.container?.state

  function onDeployed(dep: Deployment) {
    globalMutate(deploymentsKey(app!.id))
    setOpenDeployment(dep.id)
  }

  async function containerAction(name: "restart" | "stop" | "start") {
    setAction(name)
    try {
      const st = await api<ContainerStatus>(`/api/apps/${app!.id}/${name}`, { method: "POST" })
      mutate({ ...app!, container: st }, { revalidate: false })
      toast.success(`${name === "stop" ? "Stopped" : name === "start" ? "Started" : "Restarted"} ${app!.name}`)
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setAction(null)
    }
  }

  const running = state === "running" || state === "restarting"
  const deployed = state && state !== "not_deployed"

  return (
    <>
      <BackLink />
      <PageHeader
        title={
          <>
            {app.name} <StatusBadge status={state} />
          </>
        }
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-mono text-xs">{app.image}</span>
            {url && (
              <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:underline">
                {url.replace(/^https?:\/\//, "")} <ExternalLinkIcon className="size-3" />
              </a>
            )}
          </span>
        }
        actions={
          <>
            {deployed && (
              <>
                {running ? (
                  <ConfirmDialog
                    title={`Stop ${app.name}?`}
                    description="The container stops until you start it or deploy again."
                    confirmLabel="Stop"
                    destructive
                    onConfirm={() => containerAction("stop")}
                    trigger={
                      <Button variant="outline" disabled={!!action}>
                        {action === "stop" ? <Loader2Icon className="animate-spin" /> : <SquareIcon />}
                        Stop
                      </Button>
                    }
                  />
                ) : (
                  <Button variant="outline" disabled={!!action} onClick={() => containerAction("start")}>
                    {action === "start" ? <Loader2Icon className="animate-spin" /> : <PlayIcon />}
                    Start
                  </Button>
                )}
                <Button variant="outline" disabled={!!action} onClick={() => containerAction("restart")}>
                  {action === "restart" ? <Loader2Icon className="animate-spin" /> : <RotateCwIcon />}
                  Restart
                </Button>
              </>
            )}
            <DeployDialog app={app} onDeployed={onDeployed} />
          </>
        }
      />

      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
        <div className="overflow-x-auto">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="deployments">Deployments</TabsTrigger>
            <TabsTrigger value="logs">Logs</TabsTrigger>
            <TabsTrigger value="env">Environment</TabsTrigger>
            <TabsTrigger value="settings">Settings</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="overview" className="mt-4">
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Details</CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="divide-y">
                  <DetailRow label="Server">
                    {server ? (
                      <Link href={`/servers/${server.name}`} className="hover:underline">
                        {server.name} <span className="text-muted-foreground">({server.host})</span>
                      </Link>
                    ) : (
                      "—"
                    )}
                  </DetailRow>
                  <DetailRow label="Image">
                    <span className="font-mono text-xs break-all">{app.image}</span>
                  </DetailRow>
                  <DetailRow label="Registry">
                    {app.registry}
                    {app.has_registry_token ? " · token saved" : " · public"}
                    {app.registry_username && ` · ${app.registry_username}`}
                  </DetailRow>
                  <DetailRow label="Container port">{app.port}</DetailRow>
                  <DetailRow label="Host port">{app.host_port || "—"}</DetailRow>
                  <DetailRow label="Domain">{app.domain || "—"}</DetailRow>
                  <DetailRow label="Internal URL">
                    <span className="font-mono text-xs">
                      http://{app.name}:{app.port}
                    </span>
                  </DetailRow>
                  <DetailRow label="Env vars">{Object.keys(app.env ?? {}).length}</DetailRow>
                  <DetailRow label="Created">{formatDate(app.created_at)}</DetailRow>
                </dl>
              </CardContent>
            </Card>

            <div className="grid content-start gap-6">
              <Card>
                <CardHeader>
                  <CardTitle>Container</CardTitle>
                </CardHeader>
                <CardContent>
                  <dl className="divide-y">
                    <DetailRow label="State">
                      <StatusBadge status={state} />
                    </DetailRow>
                    <DetailRow label="Started">{formatDate(app.container?.started_at)}</DetailRow>
                    <DetailRow label="Running image">
                      <span className="font-mono text-xs break-all">{app.container?.image || "—"}</span>
                    </DetailRow>
                  </dl>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Latest deployment</CardTitle>
                  {latest && (
                    <CardAction>
                      <Button variant="ghost" size="sm" onClick={() => setOpenDeployment(latest.id)}>
                        View log
                      </Button>
                    </CardAction>
                  )}
                </CardHeader>
                <CardContent>
                  {!deployments ? (
                    <Skeleton className="h-16 w-full" />
                  ) : !latest ? (
                    <p className="text-sm text-muted-foreground">Not deployed yet.</p>
                  ) : (
                    <dl className="divide-y">
                      <DetailRow label="Status">
                        <StatusBadge status={latest.status} />
                      </DetailRow>
                      <DetailRow label="Trigger">
                        <span className="capitalize">{latest.trigger}</span> · {timeAgo(latest.created_at)} ·{" "}
                        {duration(latest.created_at, latest.finished_at)}
                      </DetailRow>
                      {latest.error && (
                        <DetailRow label="Error">
                          <span className="text-destructive">{latest.error}</span>
                        </DetailRow>
                      )}
                    </dl>
                  )}
                </CardContent>
              </Card>
            </div>

            <div className="lg:col-span-2">
              <WebhookCard app={app} />
            </div>
          </div>
        </TabsContent>

        <TabsContent value="deployments" className="mt-4">
          <DeploymentsPanel app={app} onSelect={setOpenDeployment} />
        </TabsContent>

        <TabsContent value="logs" className="mt-4">
          {tab === "logs" && <LogsPanel app={app} />}
        </TabsContent>

        <TabsContent value="env" className="mt-4">
          <EnvPanel key={app.updated_at} app={app} onSaved={() => mutate()} onDeployed={onDeployed} />
        </TabsContent>

        <TabsContent value="settings" className="mt-4">
          <SettingsPanel
            key={app.updated_at}
            app={app}
            server={server}
            onSaved={() => mutate()}
            onDeployed={onDeployed}
            onDeleted={() => {
              globalMutate("/api/apps")
              router.push("/apps")
            }}
          />
        </TabsContent>
      </Tabs>

      <DeploymentLogDialog id={openDeployment} onClose={() => setOpenDeployment(null)} />
    </>
  )
}

function BackLink() {
  return (
    <Link href="/apps" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
      <ArrowLeftIcon className="size-4" /> Apps
    </Link>
  )
}
