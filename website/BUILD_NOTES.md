# Build Notes — Net Zero International marketing site

Phase 0 (audit & baseline) — completed 2026-07-20. Phase 1 — partially completed 2026-07-20 (see §6). Read alongside `NET_ZERO_INTERNATIONAL_CLAUDE_CODE_BUILD_BRIEF.md` in the repo root, which this file tracks against.

Sections 1–5 below are the original Phase 0 findings, left as written at the time. §6 records what Phase 1 work has actually landed since, and §7 replaces the old "open questions" list with what's still outstanding.

---

## 1. Route audit

Every route referenced in `navLinks` / `serviceCards` / `sitemap.ts` exists and renders, with per-page `metadata` (title + description). None are stubs.

| Route | File | Status | Notes |
|---|---|---|---|
| `/` | `app/page.tsx` | Complete | Hero, service cards, principles, "how we work", featured pages |
| `/services` | `app/services/page.tsx` | Complete | Gateway page |
| `/carbon-reduction-plans` | `app/carbon-reduction-plans/page.tsx` | Complete | Driven by `servicePages` + `ContentPage` |
| `/scope-3` | `app/scope-3/page.tsx` | Complete | Driven by `servicePages` + `ContentPage` |
| `/workshops` | `app/workshops/page.tsx` | Complete | Driven by `servicePages` + `ContentPage` |
| `/training` | `app/training/page.tsx` | Complete | Driven by `servicePages` + `ContentPage` |
| `/regulations` | `app/regulations/page.tsx` | Complete | Driven by `servicePages` + `ContentPage` |
| `/about` | `app/about/page.tsx` | Complete | Own layout, not `ContentPage` |
| `/contact` | `app/contact/page.tsx` | Complete | Own layout, not `ContentPage` |
| `/faq` | `app/faq/page.tsx` | Complete | Reads `faqs` from `site.ts` |
| `/glossary` | `app/glossary/page.tsx` | Complete | Reads `glossaryTerms` from `site.ts` |
| `/resources` | `app/resources/page.tsx` | Complete | Own layout |
| `/ai-era` | `app/ai-era/page.tsx` | Complete | Own layout |
| `/_not-found` | `app/not-found.tsx` | Complete | |
| `/robots.txt` | `app/robots.ts` | Complete | Programmatic route, blanket allow |
| `/sitemap.xml` | `app/sitemap.ts` | Complete | 13 URLs, all `lastModified: new Date()` (see §3) |

**Brief discrepancy:** the brief lists five empty/duplicate route folders to resolve (`cpd-accredited-training/`, `net-zero-glossary/`, `net-zero-regulations-legislation/`, `net-zero-strategy-workshops/`, `scope-3-solutions/`). None of these folders currently exist under `src/app/` — the repo has already been cleaned up since the brief was written, or they were never created here. No action needed in Phase 1 beyond confirming this stays true (i.e. don't recreate them without a redirect plan if old external links to those slugs exist).

**Services not yet built** (per brief Phase 2/2b): `/life-cycle-assessments`, `/product-carbon-footprinting`, `/cbam`, `/nz-insights-pro`. Zero code for these today — `servicePages` in `site.ts` has 5 entries, not 8.

---

## 2. `npm install`

Clean install, 345 packages, no errors.

`npm audit`: 2 vulnerabilities (1 high, 1 moderate), both transitively from `next@16.1.6` (a `postcss` ReDoS/XSS advisory + several `next` advisories — request smuggling in rewrites, CSRF bypass via null origin, various DoS/cache-poisoning issues fixed upstream). `npm audit fix --force` offers `next@16.2.10`, which stays within major version 16 (patch/minor bump, not a breaking upgrade). **Recommend taking this in Phase 1** as a low-risk, high-value fix, not deferred to Phase 4.

---

## 3. `npm run build`

Clean build (Turbopack), no warnings, no errors. All 17 routes prerender as static content (`○ (Static)`), which is correct per the brief's Phase 4 guidance (marketing pages should stay SSG).

Output JS: `.next/static/chunks` totals ~697 KB uncompressed across 9 chunk files, largest three at 224 KB / 131 KB / 113 KB. No bundle-analyzer breakdown was run — worth doing once the three new service pages and JSON-LD are added, since `lucide-react` icon imports and any future client components are the main risk to watch (brief §Phase 4 already flags tree-shaken icon imports as a requirement).

No `next.config.ts` exists yet — currently running on framework defaults. This will be needed in Phase 1 for the 301 redirects the brief calls for if any legacy slugs need preserving, and later for image/caching config in Phase 4.

There is no `public/` directory at all yet — no favicon, no OG image, no static assets. This surfaced directly in the Lighthouse run below (404 on `/favicon.ico`, logged as a console error that fails a Best Practices audit). `website/public/llms.txt` also doesn't exist yet — the finished `llms.txt` content sits only in the **repo root** (untracked), not inside `website/`, so it isn't served today even locally.

---

## 4. Baseline mobile Lighthouse

Run against a production build (`next start`) on `localhost`, mobile form factor, simulated throttling, via a local Lighthouse CLI install (see method note below).

| Category | `/` | `/carbon-reduction-plans` | Target (brief §3.6) |
|---|---|---|---|
| Performance | 98 | 98 | ≥ 95 |
| Accessibility | 100 | 98 | ≥ 95 |
| Best Practices | 96 | 96 | ≥ 95 |
| SEO | 91 | 100 | ≥ 95 |

Core Web Vitals (both pages near-identical): FCP 0.8s, LCP 2.4s, TBT 40–50ms, CLS 0, Speed Index 0.8s, TTI 2.5–2.6s.

**The site is already very close to the brief's Lighthouse targets on a bare, mostly-static build** — this is a good sign for Phase 4/5, but the scores will move once real content (images, JSON-LD, more copy, potentially more client-side nav) is added, so these numbers are a baseline, not a promise.

**Specific failing audits found (all fixable, all in scope for later phases):**

- **SEO — "Links do not have descriptive text" (home only, drops SEO to 91):** the four home-page service cards below the fold all use the literal link text "Learn more" (`app/page.tsx`), which is indistinguishable to screen readers/crawlers. Fold this into Phase 1's content-model work — e.g. `Learn more about {title}` or per-card CTA copy from `site.ts`.
- **Accessibility — "Heading elements are not in a sequentially-descending order" (service pages, drops a11y to 98):** `ContentPage.tsx` renders `<h1>` then jumps straight to `<h3>` for each section card, skipping `<h2>`. Real bug, not a false positive — worth fixing early since every service page (existing and the three new ones) uses this component.
- **Best Practices — "Browser errors were logged to the console" (both pages, drops best-practices to 96):** a single 404 on `/favicon.ico`, because `website/public/` doesn't exist. Fixed by creating `public/` with a real favicon — bundle this with the `llms.txt`/OG-image work since they all need the same `public/` directory.
- **Performance — LCP scores 0.91–0.92 (not a failure, but the only sub-1.0 performance sub-score):** LCP is ~2.4s under simulated mobile throttling. Nothing alarming yet, but worth re-checking once the hero has a real image (brief Phase 4 calls for `priority` + `next/image` on the hero) rather than text-only.

**Not caught by Lighthouse but found during the code audit, and higher-severity than anything above:** the mobile nav button (`SiteHeader.tsx`, the hamburger `<button aria-label="Open navigation">`) has **no `onClick` handler and no open/close state** — it renders but does nothing. Combined with `.site-nav { display: none }` under 980px (`globals.css`), this means **on any viewport narrower than 980px there is currently no way to reach any page except Home, Contact (via the persisted header CTA... which is also `desktop-only` and hidden below 980px) or a footer link.** Lighthouse doesn't flag dead buttons, only automated axe-core rules, so this didn't show up in the scores above — but it's a real, currently-shipping mobile UX/conversion blocker and should be treated as higher priority than the Lighthouse deltas. Recommend pulling this into Phase 1 (it's a small, contained client-component change — the brief's own Phase 4 guidance to keep `"use client"` to "the smallest interactive leaf" describes exactly this component) rather than waiting for Phase 5 polish.

**Method note:** `npx lighthouse` failed with `ECOMPROMISED` / `Lock compromised` when run directly inside `website/` — this is an npm/npx file-lock heartbeat timeout (`libnpmexec/with-lock.js`), not a security or supply-chain finding; it's a known friction point when npx's lock file lives on a synced OneDrive path, which this whole repo does. Worked around by installing `lighthouse` as a one-off dependency in the OS temp scratch directory (outside the synced folder) and invoking its CLI entrypoint directly against the locally-running `next start` server. No changes were made to `website/package.json` for this — Lighthouse is a one-time audit tool, not a project dependency.

---

## 5. Phase 1 plan (content model & IA completion)

Per the brief, Phase 1 is: treat `site.ts` as the single content source, make sure the 12 existing IA pages are fully content-complete per `NET_ZERO_INTERNATIONAL_PAGE_BY_PAGE_CONTENT_PLAN.md`, resolve empty/duplicate routes, and reconcile the top nav. Given what Phase 0 found, I'd sequence Phase 1 as:

1. **Fix the mobile nav** (`SiteHeader.tsx`): add open/close state, a real mobile menu panel reusing `navLinks`, `aria-expanded` on the toggle button, close-on-route-change. Smallest possible client component per the brief's own performance guardrail.
2. **Create `website/public/`**: real favicon (`favicon.ico` + `icon.svg`/`apple-touch-icon` per Next 16 conventions), a default OG image, and copy the finished `llms.txt` from the repo root into `public/llms.txt` (brief §3c calls this out explicitly as a "missing on live site" issue).
3. **Fix heading order in `ContentPage.tsx`** — insert a real `<h2>` (visually styled to match current `<h3>` if needed) above each section-card group so `<h1>` → `<h2>` → `<h3>` is sequential on every service page.
4. **Fix the four "Learn more" home-page links** to be descriptive, sourced from `site.ts` rather than hardcoded.
5. **Take the `next@16.2.10` patch bump** to clear the two `npm audit` findings — low risk, same major version.
6. **Confirm the five brief-listed empty/duplicate folders stay absent**; no redirect work needed unless the user confirms old external links to those slugs exist.
7. **Reconcile `navLinks`** — brief flags that it currently omits Workshops, Regulations, FAQ and Glossary; decide with the user whether primary nav grows or these stay footer/gateway-page-only (brief says "keep primary nav lean" — this is a judgement call, flagged below for sign-off).
8. **Content-completeness pass** against `NET_ZERO_INTERNATIONAL_PAGE_BY_PAGE_CONTENT_PLAN.md` page by page, filling any gaps between the plan and what's currently in `site.ts` / `about` / `contact` / `resources` / `ai-era`.

Explicitly **not** in Phase 1: the three new service pages (LCA/PCF/CBAM) and `/nz-insights-pro` — that's Phase 2/2b. JSON-LD, `llms.txt` wiring beyond the `public/` copy, and the search-intent question framework — that's Phase 3. Image optimisation and CSS/bundle trimming — Phase 4. Broader visual/design-system polish — Phase 5.

---

## 6. Phase 1 — completed today (2026-07-20)

Items 1–5 from the plan above are done, verified with a clean `npm run build` + `npm run lint`, and re-measured with Lighthouse. Items 6–8 are still outstanding (see §7).

1. **Mobile nav fixed** (`SiteHeader.tsx` + `globals.css`): the hamburger button now has real open/close state, `aria-expanded`/`aria-controls`, a Menu/X icon swap, and a slide-down panel listing `navLinks` plus a Contact CTA. State resets on route change (implemented as a render-phase adjustment comparing current vs. last-seen `pathname`, per React's guidance for this pattern — not a `useEffect`, which `eslint-config-next`'s `react-hooks/set-state-in-effect` rule correctly rejected on the first pass). Below 980px, every page is now reachable again.
2. **`public/` created**: `icon.tsx`, `apple-icon.tsx` and `opengraph-image.tsx` added using Next's file-convention `ImageResponse` routes (brand-mark styling, no binary assets needed, no new dependencies) — these auto-wire the `<link rel="icon">`/OG tags. A literal `public/favicon.ico` was also generated (multi-size 16/32/48/64px, via a one-off Python/Pillow script, not checked into any build tooling) because browsers request `/favicon.ico` directly regardless of the `<link>` tag, which is what Lighthouse's console-error audit was actually catching. `public/llms.txt` copied in from the repo-root draft — note it references `/life-cycle-assessments`, `/product-carbon-footprinting`, `/cbam` and `/nz-insights-pro`, none of which exist until Phase 2, so those links 404 until then; flagging rather than trimming since the content is otherwise final and Phase 2 is next.
3. **Heading order fixed**: `ContentPage.tsx`'s per-section card titles changed from `<h3>` to `<h2>` (they sit directly under the page's only `<h1>`, so promoting them is the correct fix, not just a CSS relabel) — `h1 → h2 → h2 → h2 → h2 ("Next step")` is now sequential on every service page. CSS updated to keep the same visual size/weight.
4. **Home page link text fixed**: the four "Learn more" service-card links keep their visible text (no design change) but now carry an `.sr-only` suffix (` about {title}`) for the accessible name, resolving the Lighthouse "Links do not have descriptive text" audit without inventing new visible copy ahead of the Phase 3 content pass.
5. **`next` bumped to `16.2.10`** (`react`/`react-dom` untouched). Cleared the one **high**-severity advisory set entirely. One **moderate** advisory remains (`postcss <8.5.10`, XSS via unescaped `</style>` in stringify output) — it's bundled inside `next`'s own build tooling, not a direct dependency, and `npm audit fix --force`'s only offered fix is a downgrade to `next@9.3.3`, which is not a real option. Not exploitable in this app (no user-supplied CSS is ever stringified at runtime); left as a known, accepted, upstream-owned item to re-check next time `next` publishes a further patch.

**Lighthouse (mobile), re-measured after the above:**

| Category | `/` before → after | `/carbon-reduction-plans` before → after | Target |
|---|---|---|---|
| Performance | 98 → 98 | 98 → 98 | ≥ 95 |
| Accessibility | 100 → 100 | 98 → **100** | ≥ 95 |
| Best Practices | 96 → **100** | 96 → **100** | ≥ 95 |
| SEO | 91 → **100** | 100 → 100 | ≥ 95 |

All four categories on both pages now meet or exceed the brief's ≥95 target (brief §3 item 6 / §Phase 6), well ahead of Phases 2–6. The only remaining sub-100 line item anywhere is Performance's LCP sub-score (0.92, i.e. "good" not "perfect", ~2.4s simulated-mobile LCP) — not a failing audit, and expected to shift once a real hero image lands in Phase 4, so left alone for now rather than chased for its own sake.

---

## 7. What's still open

- **Item 6 (empty/duplicate folders):** re-confirmed absent — no action taken, none needed unless you know of live external links to those old slugs.
- **Item 7 (nav scope):** **not changed** — `navLinks` still omits Workshops/Regulations/FAQ/Glossary, matching the brief's "keep primary nav lean" default, since footer + `/services` already make every page reachable and this is explicitly flagged in the brief as a judgement call rather than a defect. Say the word if you'd rather they were promoted into the header.
- **Item 8 (content-completeness pass against `NET_ZERO_INTERNATIONAL_PAGE_BY_PAGE_CONTENT_PLAN.md`):** not started — this is the one substantial piece of Phase 1 left, and it's a content/copy review rather than a code fix, so I've held off rather than rewriting page copy without your steer on tone/scope per page.

No commits have been made — all changes above are sitting as local working-tree edits. Let me know if you'd like item 8 done next, the nav-scope question decided, or these changes committed.
