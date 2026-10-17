"use client"

import { useEffect, useRef, useState } from "react"
import useSWR from "swr"
import { DownloadIcon, Loader2Icon, RefreshCwIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { ApiError, textFetcher } from "@/lib/api"
import type { App } from "@/lib/types"

const tails = [
  { value: "100", label: "Last 100 lines" },
  { value: "200", label: "Last 200 lines" },
  { value: "500", label: "Last 500 lines" },
  { value: "1000", label: "Last 1000 lines" },
  { value: "all", label: "All lines" },
]

// Container output often includes terminal color codes.
const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "")

export function LogsPanel({ app }: { app: App }) {
  const [tail, setTail] = useState("200")
  const [follow, setFollow] = useState(true)
  const { data, error, isValidating, mutate } = useSWR(`/api/apps/${app.id}/logs?tail=${tail}`, textFetcher, {
    refreshInterval: follow ? 3000 : 0,
    keepPreviousData: true,
  })
  const ref = useRef<HTMLPreElement>(null)
  const stickToBottom = useRef(true)

  useEffect(() => {
    const el = ref.current
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight
  }, [data])

  const notDeployed = error instanceof ApiError && error.status === 404

  function download() {
    const blob = new Blob([data ?? ""], { type: "text/plain" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `${app.name}-logs.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <Card>
      <CardContent className="grid gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <Select value={tail} onValueChange={(v) => v && setTail(v as string)} items={tails}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {tails.map((t) => (
                <SelectItem key={t.value} value={t.value}>
                  {t.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={follow} onCheckedChange={setFollow} />
            Auto-refresh
          </label>
          <div className="ml-auto flex gap-2">
            <Button variant="outline" size="sm" onClick={() => mutate()} disabled={isValidating}>
              {isValidating ? <Loader2Icon className="animate-spin" /> : <RefreshCwIcon />}
              Refresh
            </Button>
            <Button variant="outline" size="sm" onClick={download} disabled={!data}>
              <DownloadIcon /> Download
            </Button>
          </div>
        </div>
        <pre
          ref={ref}
          onScroll={(e) => {
            const el = e.currentTarget
            stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
          }}
          className="h-[60vh] overflow-auto rounded-lg bg-zinc-950 p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap text-zinc-100"
        >
          {notDeployed
            ? "This app is not deployed yet."
            : error
              ? `Could not load logs: ${error.message}`
              : data === undefined
                ? "Loading…"
                : stripAnsi(data) || "No output yet."}
        </pre>
      </CardContent>
    </Card>
  )
}
