import { Suspense } from "react";
import HomePageClient from "./HomePageClient";

export default function Page() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-background">
          <div className="mx-auto w-full max-w-7xl px-6 py-10 text-sm text-muted-foreground">
            Loading dashboard...
          </div>
        </div>
      }
    >
      <HomePageClient />
    </Suspense>
  );
}
