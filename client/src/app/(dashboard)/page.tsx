"use client"

import Link from "next/link"
import useSWR from "swr"
import { ArrowRightIcon, BoxesIcon, PlusIcon, ServerIcon } from "lucide-react"

import { ErrorState, PageHeader } from "@/components/page-header"
import { StatusBadge } from "@/components/status-badge"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { timeAgo } from "@/lib/format"
import type { App, Server } from "@/lib/types"

function Stat({ label, value, sub }: { label: string; value?: number; sub?: string }) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-3xl tabular-nums">{value ?? <Skeleton className="h-9 w-12" />}</CardTitle>
      </CardHeader>
      {sub && <CardContent className="text-xs text-muted-foreground">{sub}</CardContent>}
    </Card>
  )
}

export default function OverviewPage() {
  const { data: servers, error: serversError, mutate: refetchServers } = useSWR<Server[]>("/api/servers", {
    refreshInterval: 15000,
  })
  const { data: apps, error: appsError, mutate: refetchApps } = useSWR<App[]>("/api/apps", { refreshInterval: 15000 })

  const running = apps?.filter((a) => a.container?.state === "running").length
  const ready = servers?.filter((s) => s.status === "ready").length
  const problems = apps?.filter((a) => a.container && !["running", "not_deployed"].includes(a.container.state)).length
  const serverName = new Map(servers?.map((s) => [s.id, s.name]))

  return (
    <>
      <PageHeader
        title="Overview"
        description="Your servers and the apps running on them."
        actions={
          <Button render={<Link href="/apps/new" />} nativeButton={false}>
            <PlusIcon /> New app
          </Button>
        }
      />

      {(serversError || appsError) && (
        <div className="mb-6">
          <ErrorState
            error={serversError || appsError}
            onRetry={() => {
              refetchServers()
              refetchApps()
            }}
          />
        </div>
      )}

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Servers" value={servers?.length} sub={ready !== undefined ? `${ready} ready` : undefined} />
        <Stat label="Apps" value={apps?.length} />
        <Stat label="Running" value={running} />
        <Stat label="Need attention" value={problems} sub="Stopped, exited or restarting" />
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Apps</CardTitle>
            <CardAction>
              <Button variant="ghost" size="sm" render={<Link href="/apps" />} nativeButton={false}>
                All apps <ArrowRightIcon />
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent>
            {!apps ? (
              <Skeleton className="h-32 w-full" />
            ) : apps.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-8 text-center text-sm text-muted-foreground">
                <BoxesIcon className="size-6" />
                No apps yet.
              </div>
            ) : (
              <ul className="divide-y">
                {apps.slice(0, 8).map((a) => (
                  <li key={a.id}>
                    <Link href={`/apps/${a.name}`} className="flex items-center justify-between gap-3 py-2.5 hover:opacity-80">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{a.name}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {serverName.get(a.server_id) ?? "—"} · {a.domain || a.image}
                        </p>
                      </div>
                      <StatusBadge status={a.container?.state} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Servers</CardTitle>
            <CardAction>
              <Button variant="ghost" size="sm" render={<Link href="/servers" />} nativeButton={false}>
                All servers <ArrowRightIcon />
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent>
            {!servers ? (
              <Skeleton className="h-32 w-full" />
            ) : servers.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-8 text-center text-sm text-muted-foreground">
                <ServerIcon className="size-6" />
                No servers yet.
                <Button size="sm" variant="outline" render={<Link href="/servers" />} nativeButton={false}>
                  Add a server
                </Button>
              </div>
            ) : (
              <ul className="divide-y">
                {servers.map((s) => (
                  <li key={s.id}>
                    <Link href={`/servers/${s.name}`} className="flex items-center justify-between gap-3 py-2.5 hover:opacity-80">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{s.name}</p>
                        <p className="truncate font-mono text-xs text-muted-foreground">
                          {s.host} · added {timeAgo(s.created_at)}
                        </p>
                      </div>
                      <StatusBadge status={s.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  )
}
