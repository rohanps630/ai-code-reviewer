import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {};

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
