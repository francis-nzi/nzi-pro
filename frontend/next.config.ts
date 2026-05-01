import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";
import { execSync } from "node:child_process";

function getBuildSha(): string {
  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "dev";
  }
}

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_BUILD_SHA: getBuildSha(),
  },
  // Use an alternate build/dev cache directory to avoid stale/locked .next files
  // in synced folders (can cause EBUSY and generic 500 responses in dev).
  distDir: ".next_runtime",
  turbopack: {},

  // Optimize Fast Refresh performance
  reactStrictMode: false, // Disable strict mode in development to reduce re-renders
  
  // Optimize webpack for faster rebuilds
  webpack: (config, { dev, isServer }) => {
    if (dev && !isServer) {
      // Keep watcher noise low in synced folders without forcing polling,
      // which can trigger constant invalidations/recompiles.
      config.watchOptions = {
        ignored: ['**/node_modules/**', '**/.git/**', '**/.next*/**'],
      };
      
      // Optimize module resolution
      config.resolve.symlinks = false;
    }
    return config;
  },
};

export default withSentryConfig(
  nextConfig,
  {
    silent: true,
    sourcemaps: {
      disable: true,
    },
  },
);
