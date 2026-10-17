"use client"

import { useState, useSyncExternalStore } from "react"
import { EyeIcon, EyeOffIcon } from "lucide-react"

import { CopyButton } from "@/components/copy-button"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import type { App } from "@/lib/types"

const subscribeNoop = () => () => {}

export function WebhookCard({ app }: { app: App }) {
  const [reveal, setReveal] = useState(false)
  // /hooks/* is proxied to the Go server, so this app's own origin works when it's public.
  const origin = useSyncExternalStore(
    subscribeNoop,
    () => window.location.origin,
    () => "https://studio.example.com"
  )

  const url = `${origin}/hooks/apps/${app.name}/deploy`
  const snippet = `- name: Deploy
  run: |
    curl -fsS -X POST ${url} \\
      -H "X-Webhook-Token: \${{ secrets.VPS_STUDIO_WEBHOOK_TOKEN }}" \\
      -d '{"image":"${app.image.replace(/[:@][^/]*$/, "")}:sha-\${{ github.sha }}"}'`

  return (
    <Card>
      <CardHeader>
        <CardTitle>Auto-deploy from CI</CardTitle>
        <CardDescription>
          Store the token as the repo secret <code className="font-mono">VPS_STUDIO_WEBHOOK_TOKEN</code> and add this
          step after pushing the image. Only works when vps-studio is reachable from the internet.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">Webhook URL</span>
          <div className="flex items-center gap-1 rounded-lg border bg-muted/40 py-1 pr-1 pl-3">
            <code className="flex-1 truncate font-mono text-xs">{url}</code>
            <CopyButton value={url} />
          </div>
        </div>
        <div className="grid gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">Webhook token</span>
          <div className="flex items-center gap-1 rounded-lg border bg-muted/40 py-1 pr-1 pl-3">
            <code className="flex-1 truncate font-mono text-xs">
              {reveal ? app.webhook_token : "•".repeat(32)}
            </code>
            <Button variant="ghost" size="icon-sm" onClick={() => setReveal((r) => !r)} title={reveal ? "Hide" : "Show"}>
              {reveal ? <EyeOffIcon /> : <EyeIcon />}
            </Button>
            <CopyButton value={app.webhook_token} />
          </div>
        </div>
        <div className="relative">
          <pre className="overflow-x-auto rounded-lg bg-zinc-950 p-4 pr-12 font-mono text-xs leading-relaxed text-zinc-100">
            {snippet}
          </pre>
          <div className="absolute top-2 right-2 text-zinc-100 [&_button:hover]:bg-white/10 [&_button:hover]:text-white">
            <CopyButton value={snippet} />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
