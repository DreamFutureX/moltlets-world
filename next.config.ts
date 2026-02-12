import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Don't use standalone for Railway - causes issues with native modules
  // output: 'standalone',
};

export default nextConfig;
