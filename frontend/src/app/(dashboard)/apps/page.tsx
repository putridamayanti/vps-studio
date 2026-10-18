"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import useSWR from "swr"
import { BoxesIcon, ExternalLinkIcon, PlusIcon } from "lucide-react"

import { ErrorState, PageHeader } from "@/components/page-header"
import { StatusBadge } from "@/components/status-badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { appUrl } from "@/lib/app-url"
import { timeAgo } from "@/lib/format"
import type { App, Server } from "@/lib/types"

export default function AppsPage() {
  const router = useRouter()
  const { data: apps, error, mutate } = useSWR<App[]>("/api/apps", { refreshInterval: 15000 })
  const { data: servers } = useSWR<Server[]>("/api/servers")
  const serverById = new Map(servers?.map((s) => [s.id, s]))

  const newButton = (
    <Button render={<Link href="/apps/new" />} nativeButton={false}>
      <PlusIcon /> New app
    </Button>
  )

  return (
    <>
      <PageHeader title="Apps" description="Docker images running on your servers." actions={newButton} />
      {error ? (
        <ErrorState error={error} onRetry={() => mutate()} />
      ) : !apps ? (
        <Skeleton className="h-40 w-full" />
      ) : apps.length === 0 ? (
        <Card className="flex flex-col items-center gap-3 py-12 text-center">
          <BoxesIcon className="size-8 text-muted-foreground" />
          <div>
            <p className="font-medium">No apps yet</p>
            <p className="text-sm text-muted-foreground">Deploy a Docker image from GHCR to one of your servers.</p>
          </div>
          {newButton}
        </Card>
      ) : (
        <Card className="py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Name</TableHead>
                <TableHead>Image</TableHead>
                <TableHead>Server</TableHead>
                <TableHead>URL</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="pr-4 text-right">Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {apps.map((a) => {
                const server = serverById.get(a.server_id)
                const url = appUrl(a, server)
                return (
                  <TableRow key={a.id} className="cursor-pointer" onClick={() => router.push(`/apps/${a.name}`)}>
                    <TableCell className="pl-4 font-medium">
                      <Link href={`/apps/${a.name}`} className="hover:underline" onClick={(e) => e.stopPropagation()}>
                        {a.name}
                      </Link>
                    </TableCell>
                    <TableCell className="max-w-64 truncate font-mono text-xs" title={a.image}>
                      {a.image}
                    </TableCell>
                    <TableCell>{server?.name ?? "—"}</TableCell>
                    <TableCell>
                      {url ? (
                        <a
                          href={url}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="inline-flex items-center gap-1 text-sm hover:underline"
                        >
                          {url.replace(/^https?:\/\//, "")}
                          <ExternalLinkIcon className="size-3" />
                        </a>
                      ) : (
                        <span className="text-muted-foreground">Internal</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={a.container?.state} />
                    </TableCell>
                    <TableCell className="pr-4 text-right text-muted-foreground">{timeAgo(a.updated_at)}</TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </Card>
      )}
    </>
  )
}
