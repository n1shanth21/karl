import type { NextConfig } from "next";

// web/ is its own app; without this Next picks the repo-root bun.lock as the workspace root.
const nextConfig: NextConfig = { turbopack: { root: __dirname } };

export default nextConfig;
