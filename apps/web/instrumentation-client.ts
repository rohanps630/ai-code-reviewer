import { clientEnv } from "@acr/shared/env";
import * as Sentry from "@sentry/nextjs";

if (clientEnv.NEXT_PUBLIC_SENTRY_DSN) {
  Sentry.init({
    dsn: clientEnv.NEXT_PUBLIC_SENTRY_DSN,
    tracesSampleRate: 0.1,
    debug: false,
  });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
