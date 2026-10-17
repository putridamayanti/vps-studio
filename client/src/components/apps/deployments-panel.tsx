"use client"

import { useEffect, useRef } from "react"
import useSWR from "swr"

import { StatusBadge } from "@/components/status-badge"
import { ErrorState } from "@/components/page-header"
import { Card } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { duration, formatDate, timeAgo } from "@/lib/format"
import { isDeploymentActive, type App, type Deployment } from "@/lib/types"

export function DeploymentsPanel({ app, onSelect }: { app: App; onSelect: (id: string) => void }) {
  const { data, error, mutate } = useSWR<Deployment[]>(`/api/apps/${app.id}/deployments?limit=50`, {
    refreshInterval: (d) => (d?.some(isDeploymentActive) ? 2000 : 15000),
  })

  if (error) return <ErrorState error={error} onRetry={() => mutate()} />
  if (!data) return <Skeleton className="h-40 w-full" />
  if (data.length === 0) {
    return <Card className="py-10 text-center text-sm text-muted-foreground">No deployments yet.</Card>
  }

  return (
    <Card className="py-0">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="pl-4">Status</TableHead>
            <TableHead>Image</TableHead>
            <TableHead>Trigger</TableHead>
            <TableHead>Duration</TableHead>
            <TableHead className="pr-4 text-right">Started</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.map((d) => (
            <TableRow key={d.id} className="cursor-pointer" onClick={() => onSelect(d.id)}>
              <TableCell className="pl-4">
                <StatusBadge status={d.status} />
              </TableCell>
              <TableCell className="max-w-72 truncate font-mono text-xs" title={d.image}>
                {d.image}
              </TableCell>
              <TableCell className="capitalize">{d.trigger}</TableCell>
              <TableCell className="tabular-nums">{duration(d.created_at, d.finished_at)}</TableCell>
              <TableCell className="pr-4 text-right text-muted-foreground" title={formatDate(d.created_at)}>
                {timeAgo(d.created_at)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  )
}

export function DeploymentLogDialog({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { data, error } = useSWR<Deployment>(id ? `/api/deployments/${id}` : null, {
    refreshInterval: (d) => (d && isDeploymentActive(d) ? 1500 : 0),
  })
  const logRef = useRef<HTMLPreElement>(null)

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [data?.log])

  return (
    <Dialog open={!!id} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Deployment {data && <StatusBadge status={data.status} />}
          </DialogTitle>
          <DialogDescription className="font-mono text-xs break-all">
            {data ? `${data.image} · ${data.trigger} · ${formatDate(data.created_at)}` : id}
          </DialogDescription>
        </DialogHeader>
        {error ? (
          <ErrorState error={error} />
        ) : (
          <>
            {data?.error && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                {data.error}
              </div>
            )}
            <pre
              ref={logRef}
              className="max-h-[60vh] min-h-48 overflow-auto rounded-lg bg-zinc-950 p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap text-zinc-100"
            >
              {data ? data.log || "Waiting for output…" : "Loading…"}
            </pre>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
