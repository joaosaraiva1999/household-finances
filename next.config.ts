import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
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
