import * as Sentry from "@sentry/nextjs";

const dsn = String(process.env.SENTRY_DSN || "").trim();

if (dsn) {
  Sentry.init({
    dsn,
    environment: String(process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || "production").trim(),
    sendDefaultPii: false,
    tracesSampleRate: 0,
  });
}
