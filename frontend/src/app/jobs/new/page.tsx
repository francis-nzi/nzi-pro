import { Suspense } from "react";
import NewJobPageClient from "./NewJobPageClient";

export default function NewJobPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-7xl p-6 text-sm text-muted-foreground">
          Loading...
        </div>
      }
    >
      <NewJobPageClient />
    </Suspense>
  );
}
