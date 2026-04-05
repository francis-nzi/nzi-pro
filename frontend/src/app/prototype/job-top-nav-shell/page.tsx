import Link from "next/link";

export default function JobTopNavShellLandingPage() {
  const cleanApiBase = "https://nzi-pro-api-clean.onrender.com";
  const prodApiBase = "https://nzi-pro-api-prod.onrender.com";

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-10 sm:px-6 lg:px-8">
      <section className="rounded-3xl border bg-white p-8 shadow-sm">
        <div className="text-xs uppercase tracking-[0.35em] text-slate-500">Prototype</div>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-900">Job top-nav workspace shell</h1>
        <p className="mt-3 max-w-2xl text-sm text-slate-600">
          This sandbox is for testing the wider workspace layout, compact emissions summary placement, and top-level
          section navigation before we promote anything to the live Jobs page.
        </p>

        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            href={`/jobs/556/workspace-prototype?apiBase=${encodeURIComponent(cleanApiBase)}`}
            className="inline-flex items-center justify-center rounded-xl bg-emerald-800 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
          >
            Open with clean API
          </Link>
          <Link
            href={`/jobs/556/workspace-prototype?apiBase=${encodeURIComponent(prodApiBase)}`}
            className="inline-flex items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-900 hover:bg-slate-50"
          >
            Open with prod API
          </Link>
          <Link
            href="/jobs/556"
            className="inline-flex items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-900 hover:bg-slate-50"
          >
            Open stable job page
          </Link>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <InfoCard title="Why this exists" text="Use this route to review the new top-nav structure without risking the stable page." />
        <InfoCard title="What to test" text="Check desktop width, tablet width, and whether data-entry screens stay calm and wide." />
        <InfoCard title="What to keep" text="The emissions summary should live once in the header, not repeated throughout the page." />
      </section>
    </main>
  );
}

function InfoCard({ title, text }: { title: string; text: string }) {
  return (
    <article className="rounded-2xl border bg-slate-50/70 p-5 shadow-sm">
      <h2 className="text-base font-semibold text-slate-900">{title}</h2>
      <p className="mt-2 text-sm text-slate-600">{text}</p>
    </article>
  );
}
