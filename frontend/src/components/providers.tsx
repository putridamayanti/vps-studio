"use client"

import { ThemeProvider } from "next-themes"
import { SWRConfig } from "swr"

import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import { fetcher } from "@/lib/api"
import { getApiKey } from "@/lib/auth"

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <SWRConfig value={{ fetcher, shouldRetryOnError: false, revalidateOnFocus: true, isPaused: () => !getApiKey() }}>
        <TooltipProvider>{children}</TooltipProvider>
      </SWRConfig>
      <Toaster richColors position="top-right" />
    </ThemeProvider>
  )
}
