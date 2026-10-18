import { NextResponse, type NextRequest } from "next/server"

// Forwards /api and /hooks to the Go API server, so the browser only talks to this app.
// /healthz isn't forwarded: it's only for the backend container's own health check.
// API_URL is read per request (not at build time), so one image works with any backend address.
export function proxy(request: NextRequest) {
  const apiUrl = (process.env.API_URL || "http://localhost:8081").replace(/\/$/, "")
  const { pathname, search } = request.nextUrl
  return NextResponse.rewrite(new URL(`${apiUrl}${pathname}${search}`))
}

export const config = {
  matcher: ["/api/:path*", "/hooks/:path*"],
}
