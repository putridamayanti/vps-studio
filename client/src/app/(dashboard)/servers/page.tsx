"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import useSWR from "swr"
import { LockIcon, PlusIcon, ServerIcon } from "lucide-react"

import { ErrorState, PageHeader } from "@/components/page-header"
import { ServerFormDialog } from "@/components/servers/server-form-dialog"
import { StatusBadge } from "@/components/status-badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { timeAgo } from "@/lib/format"
import type { App, Server } from "@/lib/types"

export default function ServersPage() {
  const router = useRouter()
  const { data: servers, error, mutate } = useSWR<Server[]>("/api/servers", {
    refreshInterval: (data) => (data?.some((s) => s.status === "setting_up") ? 3000 : 0),
  })
  const { data: apps } = useSWR<App[]>("/api/apps")

  const addButton = (
    <ServerFormDialog
      trigger={
        <Button>
          <PlusIcon /> Add server
        </Button>
      }
      onSaved={(s) => {
        mutate()
        router.push(`/servers/${s.name}`)
      }}
    />
  )

  return (
    <>
      <PageHeader title="Servers" description="VPS machines vps-studio reaches over SSH." actions={addButton} />
      {error ? (
        <ErrorState error={error} onRetry={() => mutate()} />
      ) : !servers ? (
        <Skeleton className="h-40 w-full" />
      ) : servers.length === 0 ? (
        <Card className="flex flex-col items-center gap-3 py-12 text-center">
          <ServerIcon className="size-8 text-muted-foreground" />
          <div>
            <p className="font-medium">No servers yet</p>
            <p className="text-sm text-muted-foreground">Add your VPS with its IP address and SSH login.</p>
          </div>
          {addButton}
        </Card>
      ) : (
        <Card className="py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Name</TableHead>
                <TableHead>Address</TableHead>
                <TableHead>HTTPS</TableHead>
                <TableHead>Apps</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="pr-4 text-right">Added</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {servers.map((s) => (
                <TableRow key={s.id} className="cursor-pointer" onClick={() => router.push(`/servers/${s.name}`)}>
                  <TableCell className="pl-4 font-medium">
                    <Link href={`/servers/${s.name}`} className="hover:underline" onClick={(e) => e.stopPropagation()}>
                      {s.name}
                    </Link>
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {s.username}@{s.host}
                    {s.port !== 22 && `:${s.port}`}
                  </TableCell>
                  <TableCell>
                    {s.acme_email ? (
                      <span className="inline-flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-400">
                        <LockIcon className="size-3" /> Enabled
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">Off</span>
                    )}
                  </TableCell>
                  <TableCell>{apps ? apps.filter((a) => a.server_id === s.id).length : "—"}</TableCell>
                  <TableCell>
                    <StatusBadge status={s.status} />
                  </TableCell>
                  <TableCell className="pr-4 text-right text-muted-foreground">{timeAgo(s.created_at)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </>
  )
}
