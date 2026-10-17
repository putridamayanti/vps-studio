import { Suspense } from "react"

import { AppSidebar } from "@/components/app-sidebar"
import { AuthGuard } from "@/components/auth-guard"
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar"

// Everything below reads the API key from localStorage, so it only renders in the browser.
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={null}>
      <AuthGuard>
        <SidebarProvider>
          <AppSidebar />
          <SidebarInset>
            <header className="flex h-12 items-center gap-2 border-b px-4 md:hidden">
              <SidebarTrigger />
              <span className="font-semibold">vps-studio</span>
            </header>
            <div className="mx-auto w-full max-w-6xl flex-1 p-4 md:p-8">{children}</div>
          </SidebarInset>
        </SidebarProvider>
      </AuthGuard>
    </Suspense>
  )
}
