# Build Notes — Net Zero International marketing site

Phase 0 (audit & baseline) — completed 2026-07-20. Phase 1 (all 8 items) — completed 2026-07-20 (see §6–§8). Phase 2 (new service pages + regulations rewrite) — completed 2026-07-20 (see §9). Real logo + brand colours + header font — completed 2026-07-20 (see §10). Phase 3 (JSON-LD + comparison cluster) — completed 2026-07-20 (see §11). Nav restructure (Workshops/Regulations/FAQ/Glossary added) + Phase 4 (performance) + Phase 5 (UI polish) — completed 2026-07-20 (see §12). Read alongside `NET_ZERO_INTERNATIONAL_CLAUDE_CODE_BUILD_BRIEF.md` in the repo root, which this file tracks against.

Sections 1–5 below are the original Phase 0 findings, left as written at the time. §6–§8 cover Phase 1. §9 covers Phase 2. §10 covers the branding update. §11 covers Phase 3. §12 covers the nav restructure plus Phases 4–5.

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
- **Item 8 (content-completeness pass):** done — see §8.

Items 1–5 above were committed as `447f397d` ("Website Phase 1: fix mobile nav, favicons/OG image, heading order, link text").

---

## 8. Phase 1 item 8 — content-completeness pass (2026-07-20)

Read `NET_ZERO_INTERNATIONAL_SITE_STRATEGY.md` and `NET_ZERO_INTERNATIONAL_PAGE_BY_PAGE_CONTENT_PLAN.md` in full before starting this pass, since both are the source of truth for tone and per-page structure.

**Main finding:** most of the site's supporting copy (section descriptions, page leads — not the core service descriptions in `servicePages`, which were already good) was developer scaffold text describing what a section *should* do, rather than real customer-facing copy — e.g. the home page's hero note read "The public site now points visitors to the real business offerings instead of internal notes," and `/services` read "These are the reusable blocks the site can use across the homepage, cards, and future campaign pages." This directly violates the strategy doc's own explicit rule ("avoid internal project commentary... should not feel like an explanation of how the site will be built"), and it was present on essentially every page. Rewrote all of it to real, customer-facing copy grounded in the strategy doc's stated voice ("here is the problem / here is how we help / here is what you can expect / here is the next step"):

- `src/content/site.ts`: `resourcePages` (glossary/FAQ gateway descriptions).
- `src/app/page.tsx` (home): hero panel note, and the "Core offer"/"Why work with us"/"Featured pages" section descriptions.
- `src/app/services/page.tsx`: hero lead, "Service map" description, and retitled/rewrote the second "reusable blocks" grid to "At a glance" (it was ~80% duplicate of the grid above it with meta copy explaining why it existed — kept the layout, since restructuring it is a design call beyond a content pass, but gave it a real, non-duplicate framing as a quick-reference summary). Also fixed the same missing-link-text accessibility issue there as was fixed on Home in §6.
- `src/app/resources/page.tsx`, `src/app/faq/page.tsx`, `src/app/glossary/page.tsx`: hero leads and section descriptions.
- `src/app/ai-era/page.tsx`: the whole page was talking about the website's own technical build ("content map, schema, metadata... ready for later integrations") rather than anything a client would find useful. Reframed around a real angle for this audience — being easy to verify and quote, for a person or an AI research tool, whoever's doing due diligence — while keeping the existing `aiPrinciples` cards, which were already genuine content.
- `src/components/ContentPage.tsx`: the "Next step" CTA block is shared across all five service pages and read "Make this page useful in the real world / Every public page should make the next action obvious" — replaced with a real CTA.

**Content-plan gaps filled** (both explicitly named in the plan's "suggested sections" but missing from the shipped pages):

- `/about`: added a "Who we work with" section (client/sector types), the one sub-section from the plan's About spec that wasn't there.
- `/contact`: added a "What to include" checklist for enquiries, likewise named in the plan but missing.

**Verification:** `npm run lint` and `npm run build` both clean after every change. Grepped the whole `src/` tree afterward for leftover scaffold-style phrasing (`"should be"`, `"the site"`, `"this page helps"`, etc.) — no matches.

**Lighthouse re-check — a caveat, not a clean re-confirmation:** accessibility, best practices and SEO held at 100/100 across every re-run, which is the meaningful confirmation for a content-and-copy pass (nothing here touches JS or images). Performance, however, bounced between 74 and 98 across four consecutive re-runs with **no code change in between them** — cross-checked against `.next/static/chunks` size, which is actually slightly smaller than the Phase 0 baseline (656 KB vs. 697 KB), so this isn't a real regression from anything in this pass. The cause looks environmental: this machine had ~25 orphaned headless Chrome processes left over from earlier Lighthouse runs (a side effect of the same `EPERM`/temp-dir cleanup quirk noted in §4), plus OneDrive actively syncing this exact repo folder and Teams/VS Code running, all contending for CPU during the trace capture that "simulated" throttling is built from. Killing the stray Chrome processes didn't fix it, which points more at the background sync/app load than the leftover processes specifically. Recommend treating the §6 baseline (98/98, captured on a quieter run) as the trustworthy number, and re-running Performance specifically once on Render or another idle machine before relying on it for a Phase 4 before/after comparison — not chasing this further locally.

All of Phase 1 (items 1–8) is now complete.

---

## 9. Phase 2 — new service pages + regulations rewrite (2026-07-20)

Built the brief's Phase 2 and 2b in one pass, using the ready-to-use copy already drafted at the repo root (`NEW_SERVICE_PAGES_COPY_LCA_PCF_CBAM.md`, `NZ_INSIGHTS_PRO_PAGE_COPY.md`, `REGULATIONS_PAGE_COPY.md`). JSON-LD is explicitly out of scope here — that's Phase 3.

**Four new routes**, all in `sitemap.ts`:

- `/life-cycle-assessments` — Life Cycle Assessments (ISO 14040/14044)
- `/product-carbon-footprinting` — Product Carbon Footprinting (ISO 14067)
- `/cbam` — CBAM Calculation and Reporting (EU CBAM from 2026, UK CBAM from 2027)
- `/nz-insights-pro` — the platform page (public-safe positioning only; checked against the brief's confidentiality guardrail — no client numbers, pricing, team size or roadmap included)

**Content model changed to fit this content.** The copy docs are written as a series of question-shaped headings with full paragraph answers (the AI-search pattern from the search-intent framework), not the short bullet lists the existing `sections: { title, points }` shape was built for. Rather than force nine-paragraph pages into bullet points, extended `Section` to `{ title, points?, body? }` and `ContentPage.tsx` to render a paragraph when `body` is present. Also added optional `metaDescription`, `ctaLabel`, `nextStepTitle`, `nextStepDescription` and `relatedLinks` to the `ServicePage` type (all optional, so the five existing pages needed no changes) — the new pages use their own closing-CTA heading and a row of related-page links rather than the one generic block every page shared before. Added an explicit `ServicePage`/`ServiceSection` type to `site.ts` for this, since `servicePages` had been an inferred literal array and mixing optional fields across entries needs a real type to stay sound.

**`/regulations` was rewritten as a bespoke page**, not through `ContentPage` — the source copy groups content by region (UK, Europe, North America, Asia-Pacific, global baseline) with a visible "Last updated" date, which doesn't fit the generic service-page shape. Structure: hero with last-updated line, a "why this matters now" section, one section per region, "how we help", closing CTA with related links. Heading order verified sequential (h1 → h2 per region → h3 per question, repeating) by fetching the rendered HTML and checking the tag sequence directly, not just counting tags.

**One thing that needs your sign-off before this goes fully live:** the regulations copy doc it was drafted from flags several facts as "verify before publish" in its own guardrail notes (not just boilerplate caution — it explicitly says some regimes are "actively changing" as of July 2026). I published the substantive sentences as drafted and only stripped the internal "(verify at publish)" instruction fragments themselves, but I have no way to independently confirm these are still current. Specifically:
- The UK public-sector Carbon Reduction Plan **£5 million contract threshold** and its "Cabinet Office procurement policy" reference — the source doc explicitly notes procurement rules changed under the Procurement Act 2023 and this needs reconfirming.
- UK SDR status, UK ETS and EU ETS scope/coverage, CSRD scope and timeline (post-"Omnibus" simplification), Australia ASRS phase-in group, and Singapore ACRA timelines — each flagged in the source doc as needing a currency check.
- The US SEC rule and California SB 253/SB 261 sections were already written with full contested-status wording baked into the visible copy (stayed, proposed for rescission, under injunction), so those didn't need stripping and should already read as appropriately hedged.

None of this blocks a private review, but I wouldn't treat `/regulations` as final for real client traffic until someone checks those specific figures.

**Internal linking**, per the brief's explicit Phase 2b requirement to link to NZ Insights Pro from Home, Scope 3, Services and About:
- Home and Services: automatic — both iterate `servicePages`/`serviceCards` in full, so the four new pages appear without any JSX change.
- `/scope-3`: added a related-links row (Product Carbon Footprinting, NZ Insights Pro, Carbon Reduction Plans, Contact) — Scope 3 Category 1 connects directly to PCF per the source copy, so included that link too, not just the one the brief named.
- `/about`: added a fourth "Our platform" card alongside the existing three capability cards, linking to `/nz-insights-pro`.
- Added "NZ Insights Pro" to the primary nav (`navLinks`) — the brief explicitly asks for this one page to be in "the nav/Services gateway", which is a specific instruction for this page, distinct from the general nav-scope question in §7 that I left alone (Workshops/Regulations/FAQ/Glossary still aren't in the header nav; that decision is still open).

**Verification:** `npm run lint` and `npm run build` both clean (24 routes now, up from 20). Confirmed all nine new/changed routes return 200 locally. Checked heading order on all five by fetching rendered HTML and inspecting the actual `<h1>`/`<h2>`/`<h3>` sequence, not just tag counts. Ran Lighthouse on `/nz-insights-pro` (the longest new page, nine content sections) as a spot check: **Accessibility 100, Best Practices 100, SEO 100.** Skipped a Performance re-check here given §8's finding that this machine's Performance numbers are currently unreliable for before/after comparison — same caveat applies.

**Deliberately not done in this pass** (all explicitly later phases per the brief): JSON-LD/schema markup for any page, including the `SoftwareApplication` block for NZ Insights Pro (Phase 3); the comparison-cluster pages in `RESOURCES_COMPARISON_CLUSTER_COPY.md` (also Phase 3g); `llms.txt` still only mentions these pages, it isn't otherwise wired to them (no change needed, it already listed them); image/performance optimisation (Phase 4); further visual polish (Phase 5).

---

## 10. Real logo, brand colours, header font (2026-07-20)

The user supplied the real logo (`website/netzero-logo.png`) and asked for it to be used across the site, for the site's colour system to be derived from it, and for the header font to switch to something classic and clean (Roboto, Arial or Helvetica were suggested).

- **Logo:** copied into `public/netzero-logo.png`, plus a cropped square `public/netzero-mark.png` (the circular tree emblem only, for icon-sized uses). The source PNG had an **opaque white background baked in** (confirmed: zero fully-transparent pixels), which would have shown as a visible white box against the site's cream background — fixed by thresholding white to transparent with a soft edge (Python/Pillow, feathered so anti-aliased edges don't go jagged), applied to both files before use. Wired into: `SiteHeader.tsx` (replaces the placeholder "NZI" text badge with `next/image`), `SiteFooter.tsx` (new small mark above the eyebrow), `favicon.ico` (regenerated from the mark), `icon.tsx`/`apple-icon.tsx` (now embed the real mark via `fs.readFileSync` + base64 data URI, replacing the synthetic gradient badge), and `opengraph-image.tsx` (full logo lockup instead of the generated square).
- **Colours:** sampled the logo's actual pixel values (Python/Pillow colour histogram) rather than eyeballing: dark green `#1f5027`, mid green `#2f7a3a`, brand orange `#f16624`, foliage lime `#aad04a`, wordmark brown `#5a4a42`. Rewrote `globals.css`'s `:root` token block from these exact values — `--accent`/`--accent-2` (was `#174d2f`/`#2b7142`, an invented palette not matching the real logo), `--orange` (new, replaces `--gold` `#b57a17` everywhere it was used: stack-list bullets, phase-number gradient), `--leaf`/`--leaf-soft` (new, not yet used anywhere — reserved for Phase 5 polish), `--brown` (new, reserved), `--muted` warmed from a cool grey-green to a warm brown-grey to tie into the wordmark colour. All ten hardcoded `rgba(23, 77, 47, ...)` accents scattered through the file (hover states, shadows, gradients) were updated to the new accent's RGB so nothing was left mismatched.
- **Font:** swapped the header/display font from Fraunces (a serif, Google-hosted) to Roboto, with `Arial, Helvetica, ui-sans-serif, sans-serif` as the fallback stack — both matches the request and the logo's own sans-serif wordmark, so this doubles as a brand-consistency fix, not just a style preference. Net effect on font loading is neutral to positive (still two Google fonts total, Manrope + Roboto, same as before with Manrope + Fraunces).
- **Bonus fix found while verifying:** took actual screenshots (via a scratch Puppeteer script driving the same Chrome used for Lighthouse) to sanity-check the rendered header, and caught the primary nav wrapping to two lines at ordinary desktop widths (1024–1280px) — an 8-item nav (grown by one when NZ Insights Pro was added in Phase 2) no longer fit on one line at the previous padding/font-size. Tightened `.nav-link` padding and font-size, added `white-space: nowrap` to nav links and buttons; re-screenshotted at 1000px/1024px/1280px to confirm single-line layout at all three.
- **Verification:** `npm run lint`/`npm run build` clean; Lighthouse Accessibility/Best Practices/SEO held at 100/100/100 after the colour and font swap (the main risk was a contrast regression from the new `--muted`, which didn't materialise). Committed as `ed1b0d2d`.

---

## 11. Phase 3 — JSON-LD structured data + comparison cluster (2026-07-20)

**JSON-LD** (brief §3a/3b/3g), implemented from `NET_ZERO_INTERNATIONAL_SCHEMA_JSONLD.md`:

- New `src/components/JsonLd.tsx` (renders a `<script type="application/ld+json">` from a passed object, with `<` escaped to guard against premature tag closing) and `src/lib/schema.ts` (builder functions: `organizationSchema`, `websiteSchema`, `breadcrumbSchema`, `serviceSchema`, `courseSchema`, `faqPageSchema`, `definedTermSetSchema`, `softwareApplicationSchema`, `articleSchema`).
- `Organization` + `WebSite` injected site-wide via `layout.tsx`. The `Organization.logo` field points at `https://netzero.international/netzero-logo.png` — the source doc's own draft had a stale WordPress URL (`.../wp-content/uploads/...`), which this repo doesn't use; pointed it at the real asset added in §10 instead, closing the exact gap the brief's own Phase 6 checklist flags ("if that asset lives on the old WordPress host, copy it into public/ and update the schema").
- `Service` schema (or `Course` for `/training`, `SoftwareApplication` for `/nz-insights-pro`) plus `BreadcrumbList` added to all 8 service-type pages and `/nz-insights-pro`.
- `FAQPage` on `/faq` (all 4 questions) and on `/regulations` — only the 4 questions the source copy doc explicitly marked `[FAQ schema]` (SECR, Carbon Reduction Plan, NHS Evergreen, CSRD), not the other 9 regional entries. Built via a `faqSchema: true` flag added directly to those 4 items in the page's own `regions` data array, then filtered — so the schema text is derived from the same array the visible page renders, not retyped, which is what guarantees the wording can't drift out of sync (a requirement the brief states explicitly).
- `DefinedTermSet` on `/glossary`. Plain `BreadcrumbList` + `canonical` added to the remaining pages that don't need a more specific type (`/services`, `/about`, `/contact`, `/resources`, `/ai-era`).
- Added `alternates: { canonical: ... }` to every route's `metadata` export (brief §3b).

**Comparison cluster** (brief §3g), from `RESOURCES_COMPARISON_CLUSTER_COPY.md` — 7 standalone "difference between X and Y" pages, built as a single dynamic route (`src/app/resources/[slug]/page.tsx` + `src/content/comparisons.ts`) rather than 7 near-duplicate files, using `generateStaticParams` so all 7 still prerender as static HTML:

- `/resources/pcf-vs-lca`, `/resources/ccf-vs-pcf`, `/resources/scope-1-2-3-emissions`, `/resources/cradle-to-gate-vs-cradle-to-grave`, `/resources/eu-cbam-vs-uk-cbam`, `/resources/embodied-carbon-vs-embedded-emissions`, `/resources/primary-vs-secondary-data`.
- Each carries `Article` + single-question `FAQPage` (H1 + the lead answer, verbatim) + `BreadcrumbList` (Home → Resources → page), per the source doc's schema requirement.
- All 7 added to `sitemap.ts` and linked from a new "Guides" section on the `/resources` hub, plus each links onward to its relevant service page(s) as the source doc specifies.
- Reused the existing `page-hero`/`content-section`/`page-card`/`stack-list`/`related-links` CSS classes throughout — no new CSS needed.

**A real bug caught during verification, not by the build:** the dynamic route initially used the pre-Next-15 synchronous `params: { slug: string }` page-prop signature. `npm run build` and `npm run lint` both passed clean, and all 7 pages showed as prerendered in the build output — but every one of them, including valid slugs, was silently baking in a `404` status (confirmed by inspecting the prerendered `.meta` JSON directly, not just curling — curling alone would have shown the same 404 either way, which is what actually surfaced this). Root cause: Next.js 16 makes route `params` a `Promise`, and the old object-destructuring signature meant `params.slug` was always `undefined`, so `comparisonPages.find(...)` never matched anything and every page fell through to `notFound()`. Fixed by making `generateMetadata` and the page component both `async` and `await`-ing `params`. Re-verified: all 7 valid slugs return 200, an invalid slug still correctly 404s, and this is the kind of thing that would have shipped silently broken (looking correct in the build log) without the extra step of actually curling the routes and checking response codes/status metadata, not just trusting a clean build.

**Verification:** `npm run lint`/`npm run build` clean, 31 routes total (up from 24). Every JSON-LD block on every checked page was fetched and run through `JSON.parse` (not just grepped for presence) — all valid on `/`, `/regulations` (5 blocks), `/faq`, `/glossary`, `/nz-insights-pro`, `/cbam`, and `/resources/pcf-vs-lca` (5 blocks). The `/regulations` FAQPage schema's 4 questions were dumped and diffed against the visible page text — exact match. Lighthouse spot-checks on `/nz-insights-pro` and `/resources/pcf-vs-lca`: **Accessibility 100, Best Practices 100, SEO 100** on both.

**Deliberately not done:** the `Person`/E-E-A-T schema mentioned in brief §3f (no named individual authors are used on this site, so there's no natural entity to attach it to yet); Rich Results Test / Schema.org validator submission (needs a live public URL, can't be done against `localhost`, recommend doing this once deployed); image/performance optimisation (Phase 4); further visual/design-system polish (Phase 5); the cutover checklist (Phase 6).

---

## 12. Nav restructure + Phase 4 (performance) + Phase 5 (UI polish) (2026-07-20)

### Nav: Workshops, Regulations, FAQ, Glossary added

The primary nav previously omitted these four (a deliberate "keep it lean" default from Phase 1, left open for a decision). Adding all four flat would have made it 12 top-level items — measured out at roughly 1550–1600px of required width against a 1160px `site-wrap`, so it would never have fit at any real desktop size, not even wrapped gracefully. Restructured into two dropdown groups instead of a flat list:

- **Services** (dropdown): Carbon Reduction Plans, Scope 3, Life Cycle Assessments, Product Carbon Footprinting, CBAM, Workshops, Training, Regulations, plus a "Services overview" link to `/services` at the top of the panel.
- **NZ Insights Pro** (standalone, unchanged).
- **Resources** (dropdown): Glossary, FAQ, plus a "Resources overview" link to `/resources`.
- **About**, **Contact** (standalone, unchanged).

Implementation: `navLinks` in `site.ts` gained an optional `children` array per item. `SiteHeader.tsx` renders a `NavDropdown` sub-component for any item with children — a `<button aria-expanded aria-haspopup="true">` trigger that toggles a positioned panel, closing on outside-click, `Escape`, or route change (reusing the existing pathname-change-detection pattern already used for the mobile menu). Mobile doesn't need the dropdown mechanism at all: vertical space isn't the constraint horizontal nav has, so the mobile panel just lists every item with its children indented directly underneath, always visible, no extra toggle state.

Verified with real screenshots (a scratch Puppeteer script, not just reading the code): single-line nav at 1000px/1024px/1280px, the Services dropdown panel rendering correctly with all 8 items, and the mobile panel showing all 12 items grouped and indented correctly. Lighthouse Accessibility held at 100 with the new interactive dropdown in place.

### Phase 4 — Performance

- **Fonts:** added explicit `display: "swap"` to both `next/font/google` configs (Manrope, Roboto) — belt-and-braces alongside `next/font`'s own layout-shift prevention.
- **Long-cache headers:** added `next.config.ts` (didn't exist before) with a `headers()` function giving `favicon.ico`/`netzero-logo.png`/`netzero-mark.png` a one-year immutable `Cache-Control`, and `llms.txt` a one-hour cache so content edits still propagate reasonably fast. Verified with `curl -I` against the running production server that the headers actually apply, not just that the config is syntactically present. `/_next/static/*` chunks already had immutable long-cache headers by Next's own default, confirmed the same way.
- **CSS audit:** wrote a small script cross-referencing every class selector in `globals.css` against every `className` used across `src/**/*.tsx`. Found exactly two dead classes, `.stat-card` and `.stats-grid`, leftover from the original scaffold and never actually used by any page. Removed them (including their appearances in shared/media-query selector groups, careful not to touch the other classes sharing those same rules). Re-ran the script after: 0 unused classes out of 65.
- **Tree-shaking / SSG confirmed, not just assumed:** grepped for `lucide-react` imports across the codebase — all are named imports (`import { X, Y } from "lucide-react"`), none import the whole icon set. Build output shows all 31 routes as either `○ (Static)` or `● (SSG)` — no dynamic/server-rendered routes exist on this site.
- **Lighthouse (mobile), re-measured:** a dedicated performance-only run gave `/` 97 and `/carbon-reduction-plans` 100, with TBT 40–60ms and zero CLS on both — clean, and consistent with the machine-noise caveat already on record in §8: a combined 4-category run on the same pages moments later showed 88/93 instead, purely from the extra audits adding CPU load during capture, not from anything in this codebase. Accessibility/Best Practices/SEO held at 100/100/100 in every configuration regardless. Treat the dedicated-run numbers (97/100) as the more representative ones, and re-confirm on Render or another idle machine before citing a hard number externally.

### Phase 5 — UI polish

- **Focus-visible rings:** the site had no custom focus styling at all before this, just whatever the browser default happened to render against a rounded-pill design system, which is inconsistent across browsers and doesn't match the brand. Added a single `:focus-visible` rule (2px solid `--accent`, 2px offset) across links, buttons and form elements — keyboard-only, doesn't show on mouse click, which is the current best-practice pattern (no extra JS needed, browsers already distinguish mouse vs. keyboard focus via `:focus-visible` natively).
- **`prefers-reduced-motion`:** the site previously had `scroll-behavior: smooth` and several CSS transitions with zero accommodation for users who've asked their OS to reduce motion. Added the standard kill-switch media query: `scroll-behavior: auto` and near-zero animation/transition durations under `prefers-reduced-motion: reduce`.
- **`aria-current="page"`:** added to every nav link (desktop flat links, dropdown triggers, and every mobile link and sub-link) when it matches the current route — wasn't there before; the active state was purely visual (a CSS class), invisible to screen readers.
- **Closing CTA audit — a real content gap, not a checkbox item:** checked every page for the brief's "every page ends with a clear CTA" requirement and found six pages that didn't: `/about`, `/ai-era`, `/faq`, `/glossary`, `/resources`, `/services` all ended mid-content (a card grid or list) with no closing prompt. Built a small shared `ClosingCta` component (extracted from the block `ContentPage.tsx` already had, so the service pages, the comparison pages, and these six now all render the *same* component rather than five copies of similar-but-drifting JSX) and added it to all six, each with a short page-appropriate title/description rather than one generic block repeated verbatim six times. `Contact` was deliberately left alone — the whole page already is a CTA (mailto link + what-to-include checklist), a second generic one directly underneath would be redundant.
- **Labelled form controls:** N/A — there is no `<form>` anywhere on the site yet (Contact is a `mailto:` link, not a form), so there's nothing to check here until Phase 2's "conversion support" stage (CRM integration / lead forms) referenced in the site strategy doc actually gets built.
- **Colour contrast, alt text, hover states:** already covered in earlier phases (§8/§10 contrast checks, §10 image alt text, existing hover states on cards/links/buttons); re-confirmed via the same Lighthouse Accessibility=100 result across every page checked in this pass, so nothing regressed.

**Verification:** `npm run lint`/`npm run build` clean throughout. All 23 non-parameterised routes fetched and confirmed 200. Heading order re-checked on every page touched by the CTA addition (`/about`, `/ai-era`, `/faq`, `/glossary`, `/resources`, `/services`) by inspecting the actual `<h1>`–`<h6>` tag sequence in the rendered HTML — sequential on all six, no skips introduced by the new `ClosingCta` section. Lighthouse spot-checked on `/`, `/about`, `/faq`, `/resources`: **Accessibility 100, Best Practices 100, SEO 100** on all four.

**Deliberately not done:** Rich Results Test / Schema.org validator submission (still needs a live public URL); the cutover checklist (Phase 6, needs a decision on when cutover is actually happening); any new visual/photographic assets (hero imagery, team photos) — none exist yet to optimise or add.
