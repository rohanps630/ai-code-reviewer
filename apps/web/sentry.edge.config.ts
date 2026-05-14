import { serverEnv } from "@acr/shared/env";
import * as Sentry from "@sentry/nextjs";

if (serverEnv.SENTRY_DSN) {
  Sentry.init({
    dsn: serverEnv.SENTRY_DSN,
    environment: serverEnv.NODE_ENV,
    tracesSampleRate: serverEnv.NODE_ENV === "production" ? 0.1 : 1.0,
    debug: false,
  });
}
