import { Loader2Icon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

type Tone = "success" | "progress" | "danger" | "neutral"

const tones: Record<string, Tone> = {
  // servers
  ready: "success",
  setting_up: "progress",
  error: "danger",
  new: "neutral",
  // deployments
  succeeded: "success",
  queued: "progress",
  pulling: "progress",
  starting: "progress",
  failed: "danger",
  // containers
  running: "success",
  restarting: "progress",
  exited: "danger",
  dead: "danger",
  paused: "neutral",
  created: "neutral",
  not_deployed: "neutral",
  unknown: "neutral",
}

const toneClass: Record<Tone, string> = {
  success: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  progress: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  danger: "bg-destructive/10 text-destructive",
  neutral: "bg-muted text-muted-foreground",
}

const dotClass: Record<Tone, string> = {
  success: "bg-emerald-500",
  progress: "bg-amber-500",
  danger: "bg-destructive",
  neutral: "bg-muted-foreground/50",
}

export function StatusBadge({ status, className }: { status?: string; className?: string }) {
  const value = status || "unknown"
  const tone = tones[value] ?? "neutral"
  return (
    <Badge variant="secondary" className={cn("gap-1.5 font-medium capitalize", toneClass[tone], className)}>
      {tone === "progress" ? (
        <Loader2Icon className="size-3 animate-spin" />
      ) : (
        <span className={cn("size-1.5 rounded-full", dotClass[tone])} />
      )}
      {value.replace(/_/g, " ")}
    </Badge>
  )
}
