import type { NextConfig } from "next";

// Default (publish pipeline / web app): standalone Node server output.
// Desktop (BUILD_TARGET=desktop): fully static export consumed by Tauri —
// no server, no network; all data goes through the Rust core commands.
const isDesktopBuild = process.env.BUILD_TARGET === "desktop";

const nextConfig: NextConfig = {
  output: isDesktopBuild ? "export" : "standalone",
  // Do not advertise the framework version.
  poweredByHeader: false,
  // Hide the floating Next.js dev tools indicator in the preview.
  devIndicators: false,
  // Allow the sandbox preview proxy to fetch dev assets without warnings.
  allowedDevOrigins: ["*.space-z.ai"],
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
};

export default nextConfig;
