"use client"

import { useEffect, useState, useSyncExternalStore } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { useTheme } from "next-themes"
import {
  BoxesIcon,
  ClockIcon,
  LayoutDashboardIcon,
  LogOutIcon,
  MonitorIcon,
  MoonIcon,
  ServerIcon,
  SunIcon,
} from "lucide-react"

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { clearApiKey, getExpiry } from "@/lib/auth"
import { remaining } from "@/lib/format"

const nav = [
  { href: "/", label: "Overview", icon: LayoutDashboardIcon },
  { href: "/apps", label: "Apps", icon: BoxesIcon },
  { href: "/servers", label: "Servers", icon: ServerIcon },
]

const themes = [
  { value: "light", icon: SunIcon, label: "Light" },
  { value: "dark", icon: MoonIcon, label: "Dark" },
  { value: "system", icon: MonitorIcon, label: "System" },
]

function SessionTimer() {
  const [left, setLeft] = useState<number | null>(null)
  useEffect(() => {
    const tick = () => {
      const exp = getExpiry()
      setLeft(exp ? exp - Date.now() : null)
    }
    tick()
    const id = setInterval(tick, 30_000)
    return () => clearInterval(id)
  }, [])
  if (left === null) return null
  return (
    <div className="flex items-center gap-2 px-2 text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">
      <ClockIcon className="size-3.5" />
      Session expires in {remaining(left)}
    </div>
  )
}

const subscribeNoop = () => () => {}

function ThemeSwitcher() {
  const { theme, setTheme } = useTheme()
  // The theme is only known in the browser.
  const mounted = useSyncExternalStore(
    subscribeNoop,
    () => true,
    () => false
  )
  return (
    <div className="flex gap-1 rounded-lg bg-muted p-1 group-data-[collapsible=icon]:hidden">
      {themes.map((t) => (
        <button
          key={t.value}
          type="button"
          title={t.label}
          onClick={() => setTheme(t.value)}
          className={`flex flex-1 items-center justify-center rounded-md py-1 text-muted-foreground transition-colors hover:text-foreground ${
            mounted && theme === t.value ? "bg-background text-foreground shadow-sm" : ""
          }`}
        >
          <t.icon className="size-3.5" />
          <span className="sr-only">{t.label}</span>
        </button>
      ))}
    </div>
  )
}

export function AppSidebar() {
  const pathname = usePathname()
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href))

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" render={<Link href="/" />}>
              <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <ServerIcon className="size-4" />
              </div>
              <div className="grid flex-1 text-left leading-tight">
                <span className="font-semibold">vps-studio</span>
                <span className="text-xs text-muted-foreground">Deploy to your VPS</span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {nav.map((item) => (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton
                    isActive={isActive(item.href)}
                    tooltip={item.label}
                    render={<Link href={item.href} />}
                  >
                    <item.icon />
                    <span>{item.label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="gap-3">
        <SessionTimer />
        <ThemeSwitcher />
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton tooltip="Sign out" onClick={() => clearApiKey()}>
              <LogOutIcon />
              <span>Sign out</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  )
}
