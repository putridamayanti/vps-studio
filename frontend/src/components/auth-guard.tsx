"use client"

import { useEffect, useState } from "react"
import { usePathname, useRouter } from "next/navigation"
import { toast } from "sonner"

import { AUTH_EVENT, clearApiKey, getExpiry } from "@/lib/auth"

// Shows children only while a non-expired API key is stored, and signs out when it expires.
export function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const [authed, setAuthed] = useState(false)

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined

    const check = (reason?: "expired") => {
      clearTimeout(timer)
      const expiresAt = getExpiry()
      if (!expiresAt) {
        setAuthed(false)
        if (reason === "expired") toast.info("Your session expired. Enter the API key again.")
        router.replace(`/login?next=${encodeURIComponent(window.location.pathname)}`)
        return
      }
      setAuthed(true)
      // setTimeout caps at ~24.8 days; 6h is well within it.
      timer = setTimeout(() => {
        clearApiKey()
      }, expiresAt - Date.now())
    }

    check()
    const onAuth = () => check(getExpiry() ? undefined : "expired")
    const onStorage = (e: StorageEvent) => {
      if (e.key === null || e.key.startsWith("vps-studio")) onAuth()
    }
    window.addEventListener(AUTH_EVENT, onAuth)
    window.addEventListener("storage", onStorage)
    return () => {
      clearTimeout(timer)
      window.removeEventListener(AUTH_EVENT, onAuth)
      window.removeEventListener("storage", onStorage)
    }
  }, [router])

  // Re-check on navigation in case the key expired while the tab was asleep.
  useEffect(() => {
    if (authed && !getExpiry()) clearApiKey()
  }, [pathname, authed])

  // Children still render (hidden) before the check so Next.js can prerender the segments;
  // SWR is paused without a key, so nothing is fetched until sign-in.
  return (
    <div className={authed ? "contents" : "hidden"}>
      {children}
    </div>
  )
}
