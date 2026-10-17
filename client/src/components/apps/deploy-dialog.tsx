"use client"

import { useState } from "react"
import { Loader2Icon, RocketIcon } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
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
import { Label } from "@/components/ui/label"
import { api, errorMessage } from "@/lib/api"
import type { App, Deployment } from "@/lib/types"

function repository(image: string) {
  const at = image.indexOf("@")
  if (at >= 0) return image.slice(0, at)
  const slash = image.lastIndexOf("/")
  const colon = image.lastIndexOf(":")
  return colon > slash ? image.slice(0, colon) : image
}

export function DeployDialog({ app, onDeployed }: { app: App; onDeployed: (d: Deployment) => void }) {
  const [open, setOpen] = useState(false)
  const [image, setImage] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function deploy(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const dep = await api<Deployment>(`/api/apps/${app.id}/deploy`, {
        method: "POST",
        body: image.trim() ? { image: image.trim() } : {},
      })
      toast.success("Deploy started")
      setOpen(false)
      onDeployed(dep)
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
          setImage("")
          setError(null)
        }
        setOpen(o)
      }}
    >
      <DialogTrigger
        render={
          <Button>
            <RocketIcon /> Deploy
          </Button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <form onSubmit={deploy} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Deploy {app.name}</DialogTitle>
            <DialogDescription>
              Pulls the image and swaps the container. If the new one stops within the grace period, the previous
              container is restored.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="deploy-image">Image (optional)</Label>
            <Input
              id="deploy-image"
              className="font-mono text-xs"
              placeholder={app.image}
              value={image}
              onChange={(e) => setImage(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Leave blank to redeploy the current image, or use another tag of{" "}
              <span className="font-mono">{repository(app.image)}</span>.
            </p>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? <Loader2Icon className="animate-spin" /> : <RocketIcon />}
              Deploy
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
