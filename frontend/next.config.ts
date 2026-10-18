import type { NextConfig } from "next";

// /api and /hooks are forwarded to the Go API by src/proxy.ts, which reads API_URL at
// runtime so the Docker image isn't tied to one backend address.
const nextConfig: NextConfig = {
  // Self-contained server for the Docker image (see Dockerfile).
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
};

export default nextConfig;
