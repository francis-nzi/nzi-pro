import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const DEFAULT_JOB_ID = 556;

export default function JobTopNavShellPrototypePage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-5xl px-6 py-10">
        <Card className="border-slate-200 shadow-sm">
          <CardHeader className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge className="border-slate-200 bg-slate-50 text-slate-700">Prototype</Badge>
              <Badge variant="outline">Jobs workspace shell</Badge>
            </div>
            <CardTitle className="text-3xl">Top-nav job workspace prototype</CardTitle>
            <CardDescription className="max-w-3xl">
              Use this page to review the experimental job shell without touching the stable Jobs page.
              It keeps the header, emissions summary, and navigation in a top workspace band instead of a
              tall left rail.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-6 md:grid-cols-[1.1fr_0.9fr]">
            <div className="space-y-4">
              <div className="rounded-2xl border bg-slate-50/80 p-4">
                <div className="text-xs uppercase tracking-[0.2em] text-slate-500">What to check</div>
                <ul className="mt-3 space-y-2 text-sm text-slate-700">
                  <li>Header uses the full width instead of a left job rail.</li>
                  <li>Emissions summary sits in the top context band.</li>
                  <li>Workspace tabs are grouped horizontally.</li>
                  <li>Prototype content stays isolated from the live job route.</li>
                </ul>
              </div>

              <div className="flex flex-wrap gap-3">
                <Button asChild>
                  <Link href={`/jobs/${DEFAULT_JOB_ID}/workspace-prototype`}>Open prototype workspace</Link>
                </Button>
                <Button variant="outline" asChild>
                  <Link href={`/jobs/${DEFAULT_JOB_ID}`}>Open stable job page</Link>
                </Button>
              </div>
            </div>

            <div className="rounded-2xl border bg-white p-4">
              <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Default test route</div>
              <div className="mt-2 text-2xl font-semibold text-slate-950">Job {DEFAULT_JOB_ID}</div>
              <p className="mt-3 text-sm text-slate-600">
                This is the sample job used for shell testing. Swap the job ID in the route if you want to
                inspect a different job record in the prototype shell.
              </p>
              <div className="mt-4 rounded-xl border bg-slate-50 p-3 text-sm text-slate-700">
                Route: <span className="font-mono">/jobs/{DEFAULT_JOB_ID}/workspace-prototype</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
