import type { NextConfig } from "next";

// The Go API server. The browser talks to this Next.js app only; /api and /hooks are proxied.
// Read at build time: the Docker image runs both servers in one container, so the default fits it.
const apiUrl = (process.env.API_URL || "http://localhost:8080").replace(/\/$/, "");

const nextConfig: NextConfig = {
  // Self-contained server for the Docker image (see ../Dockerfile).
  output: "standalone",
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async rewrites() {
    return [
      { source: "/api/:path*", destination: `${apiUrl}/api/:path*` },
      { source: "/hooks/:path*", destination: `${apiUrl}/hooks/:path*` },
      { source: "/healthz", destination: `${apiUrl}/healthz` },
    ];
  },
};

export default nextConfig;
