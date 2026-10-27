import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["postgres", "ssh2"],
  async rewrites() {
    // The TriLens landing page is a static file (public/landing.html); serve it at "/"
    return { beforeFiles: [{ source: "/", destination: "/landing.html" }], afterFiles: [], fallback: [] };
  },
};

export default nextConfig;
