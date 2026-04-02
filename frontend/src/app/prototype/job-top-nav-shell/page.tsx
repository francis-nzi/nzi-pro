import Link from "next/link";

const DEFAULT_JOB_ID = 556;

export default function JobTopNavShellPrototypePage() {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-950">
      <div className="mx-auto max-w-5xl px-6 py-10">
        <div className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium uppercase tracking-[0.18em] text-slate-700">
              Prototype
            </span>
            <span className="rounded-full border border-slate-200 px-3 py-1 text-xs font-medium uppercase tracking-[0.18em] text-slate-600">
              Jobs workspace shell
            </span>
          </div>

          <h1 className="mt-5 text-3xl font-semibold tracking-tight">Top-nav job workspace prototype</h1>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">
            Use this page to review the experimental job shell without touching the stable Jobs page.
            It keeps the header, emissions summary, and navigation in a top workspace band instead of a
            tall left rail.
          </p>

          <div className="mt-8 grid gap-6 md:grid-cols-[1.1fr_0.9fr]">
            <div className="space-y-4">
              <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
                <div className="text-xs uppercase tracking-[0.2em] text-slate-500">What to check</div>
                <ul className="mt-3 space-y-2 text-sm text-slate-700">
                  <li>Header uses the full width instead of a left job rail.</li>
                  <li>Emissions summary sits in the top context band.</li>
                  <li>Workspace tabs are grouped horizontally.</li>
                  <li>Prototype content stays isolated from the live job route.</li>
                </ul>
              </div>

              <div className="flex flex-wrap gap-3">
                <Link
                  href={`/jobs/${DEFAULT_JOB_ID}/workspace-prototype`}
                  className="inline-flex h-10 items-center justify-center rounded-full bg-emerald-800 px-4 text-sm font-medium text-white transition-colors hover:bg-emerald-700"
                >
                  Open prototype workspace
                </Link>
                <Link
                  href={`/jobs/${DEFAULT_JOB_ID}`}
                  className="inline-flex h-10 items-center justify-center rounded-full border border-slate-200 bg-white px-4 text-sm font-medium text-slate-900 transition-colors hover:bg-slate-50"
                >
                  Open stable job page
                </Link>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Default test route</div>
              <div className="mt-2 text-2xl font-semibold text-slate-950">Job {DEFAULT_JOB_ID}</div>
              <p className="mt-3 text-sm leading-6 text-slate-600">
                This is the sample job used for shell testing. Swap the job ID in the route if you want to
                inspect a different job record in the prototype shell.
              </p>
              <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                Route: <span className="font-mono">/jobs/{DEFAULT_JOB_ID}/workspace-prototype</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
