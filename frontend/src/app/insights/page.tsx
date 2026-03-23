import { Suspense } from "react";

import InsightsPageClient from "./InsightsPageClient";

export default function InsightsPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-background">
          <div className="mx-auto w-full max-w-7xl px-6 py-10 text-sm text-muted-foreground">
            Loading insights...
          </div>
        </div>
      }
    >
      <InsightsPageClient />
    </Suspense>
  );
}
