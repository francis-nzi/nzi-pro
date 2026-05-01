"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

type GlobalErrorProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function GlobalError({ error, reset }: GlobalErrorProps) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body className="flex min-h-screen items-center justify-center bg-white px-6 text-slate-900">
        <div className="max-w-lg space-y-4 rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
          <h1 className="text-2xl font-semibold">Something went wrong</h1>
          <p className="text-sm text-slate-600">
            We logged this error for the team to review. You can try again now or refresh the page.
          </p>
          <pre className="max-h-40 overflow-auto rounded-lg bg-slate-50 p-3 text-xs text-slate-700">
            {error.message}
          </pre>
          <button
            type="button"
            onClick={reset}
            className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800"
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
