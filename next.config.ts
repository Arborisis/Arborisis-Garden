import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: process.cwd()
  },
  typescript: {
    // Types vérifiés séparément (tsc --noEmit) ; on évite le conflit de types DOM/web-push sur Railway
    ignoreBuildErrors: true
  }
};

export default nextConfig;
