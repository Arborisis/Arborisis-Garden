import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: process.cwd()
  },
  // Binaires natifs charges a l'execution cote serveur, jamais bundles.
  serverExternalPackages: ["onnxruntime-node", "sharp"],
  typescript: {
    // Types vérifiés séparément (tsc --noEmit) ; on évite le conflit de types DOM/web-push sur Railway
    ignoreBuildErrors: true
  }
};

export default nextConfig;
