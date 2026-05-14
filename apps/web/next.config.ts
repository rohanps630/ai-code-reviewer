import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Workspace packages use NodeNext-style ".js" specifiers in their TS
  // source (correct ESM, but webpack needs the alias to resolve them
  // to the actual .ts files until we ship project-references + emit).
  webpack: (config) => {
    config.resolve ??= {};
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias ?? {}),
      ".js": [".ts", ".tsx", ".js"],
      ".mjs": [".mts", ".mjs"],
    };
    return config;
  },
  // Workspace packages are TS source; let Next compile them.
  transpilePackages: ["@acr/agent", "@acr/db", "@acr/shared"],
};

export default withSentryConfig(nextConfig, {
  silent: !process.env.CI,
  // Tunnel client SDK requests through a Next.js route to dodge ad blockers.
  tunnelRoute: "/monitoring",
  widenClientFileUpload: true,
  webpack: {
    treeshake: { removeDebugLogging: true },
    reactComponentAnnotation: { enabled: true },
  },
});
