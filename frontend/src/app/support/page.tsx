"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

type SupportTopic = {
  page: string;
  path: string;
  purpose: string;
  process: string[];
};

type DatabaseFingerprint = {
  db_name: string;
  db_user: string;
  host_ip: string;
  host_port: number | string;
  pg_version: string;
};

type SupportDiagnostics = {
  generated_at_utc?: string | null;
  database: DatabaseFingerprint;
  session: {
    user_id?: string | null;
    email?: string | null;
    role?: string | null;
    org_id?: string | null;
    mfa_enabled?: boolean | null;
    must_change_password?: boolean | null;
    is_super_admin?: boolean | null;
    effective_permissions?: string[];
  };
  current_org?: CurrentOrgSummary | null;
  can_manage_organisations?: boolean;
};

type CurrentOrgSummary = {
  org_id?: string | null;
  name?: string | null;
  slug?: string | null;
  role?: string | null;
  archived?: boolean | null;
};

type SupportOrganisation = {
  org_id: string;
  name?: string | null;
  slug?: string | null;
  is_active_org?: boolean;
  archived?: boolean | null;
};

const SUPPORT_TOPICS: SupportTopic[] = [
  { page: "Support Diagnostics", path: "/support", purpose: "Verify the live session, active organisation, and connected database before troubleshooting.", process: ["Open Support Center.", "Review the Current Organisation and Database Fingerprint cards.", "Copy the diagnostic snapshot when raising a support issue."] },
  { page: "New Organisation Checklist", path: "/support", purpose: "Guide new org users through the first setup steps inside the app.", process: ["Confirm the active organisation.", "Invite the right people in Organisation Management.", "Create the first client and first job.", "Capture a support snapshot if anything looks wrong."] },
  { page: "Dashboard", path: "/", purpose: "Platform overview and workload monitoring.", process: ["Review high-level KPIs.", "Use quick links to jump into clients/jobs.", "Check recent activity before starting work."] },
  { page: "Clients List", path: "/clients", purpose: "Search, filter, and manage clients.", process: ["Use search/status filters.", "Open client profile to view jobs and reporting.", "Create a new client when needed."] },
  { page: "New Client", path: "/clients/new", purpose: "Create a new client record.", process: ["Complete client profile and contact details.", "Set reporting and benchmark details.", "Save and verify client appears in list."] },
  { page: "Edit Client", path: "/clients/[clientId]/edit", purpose: "Update client profile data.", process: ["Open client edit.", "Update key fields (industry, owners, dates).", "Save and confirm values persist."] },
  { page: "Client Reporting", path: "/clients/[clientId]/reporting", purpose: "Client-level outputs and reporting view.", process: ["Review reporting period and emissions outputs.", "Cross-check generated summaries.", "Open related jobs for detailed reports."] },
  { page: "Jobs List", path: "/jobs", purpose: "View and manage all jobs.", process: ["Filter by status/owner.", "Open a job to continue setup or reporting.", "Create new jobs for active clients."] },
  { page: "New Job", path: "/jobs/new", purpose: "Create a new job and reporting period.", process: ["Select client and job type.", "Set reporting period and owner.", "Save and move to setup/data entry."] },
  { page: "Job Workspace", path: "/jobs/[jobId]", purpose: "Main work hub for a specific job.", process: ["Complete setup and data entry.", "Upload data/files as needed.", "Generate and review outputs/reports."] },
  { page: "Job Actions", path: "/jobs/[jobId] -> Actions", purpose: "Build a report-ready action plan for a job.", process: ["Add suggested actions from the shared library.", "Tailor names, descriptions, and time horizons for the client.", "Save and confirm the actions appear in the report output."] },
  { page: "Time Tracking", path: "/time", purpose: "Log and review team time entries.", process: ["Select subject/client/job.", "Enter hours and notes.", "Submit and review totals."] },
  { page: "Methodology Library", path: "/support/methodology", purpose: "Maintain the company-suggested conversion-factor methodology by country, scope, and label.", process: ["Start with the default country filter (UK).", "Add rows for the factor families the company recommends.", "Use these defaults as the baseline for job data-entry searches."] },
  { page: "Data Bank", path: "/support/data-bank", purpose: "Curate data cards used to enrich AI insights.", process: ["Add or edit Data Cards with source links.", "Tag by category, country, year and subject.", "Use AI Suggestions to draft and save new cards."] },
  { page: "Admin Center", path: "/admin", purpose: "System configuration and management entry point.", process: ["Open target admin section.", "Apply changes in small batches.", "Validate changes in live workflow pages."] },
  { page: "Admin Team", path: "/admin/team", purpose: "Invite and manage team access.", process: ["Invite users and set roles/positions.", "Re-invite expired invites.", "Reset passwords when needed."] },
  { page: "Admin Lookups", path: "/admin/lookups", purpose: "Maintain lookup reference tables.", process: ["Select lookup category.", "Add/edit/archive values.", "Confirm downstream dropdowns reflect updates."] },
  { page: "Admin Job Items", path: "/admin/job-items", purpose: "Manage items used in jobs, quotes, invoices.", process: ["Create or edit item details.", "Assign VAT rates and defaults.", "Archive obsolete items."] },
  { page: "Admin Datasets", path: "/admin/datasets", purpose: "Manage factor datasets and imports.", process: ["Upload dataset files.", "Validate year and scope coverage.", "Archive superseded datasets."] },
  { page: "Admin Reusable Factors", path: "/admin/custom-factors", purpose: "Create and manage reusable conversion factors.", process: ["Add factor with metadata.", "Set yearly factor values.", "Archive when no longer valid."] },
  { page: "Admin Templates", path: "/admin/templates", purpose: "Manage data/report templates.", process: ["Create template and versions.", "Define variables/metadata mappings.", "Assign templates to jobs."] },
  { page: "Admin Action Options", path: "/admin/actions-options", purpose: "Maintain the shared suggested-action library for reports.", process: ["Add or edit suggested actions.", "Set term, category, and scope focus.", "Archive outdated options without removing past job selections."] },
  { page: "Admin Milestones", path: "/admin/milestone-templates", purpose: "Configure milestone schedules.", process: ["Define milestone sequence.", "Set offsets/targets.", "Apply to job types."] },
  { page: "Admin Theme", path: "/admin/theme", purpose: "Brand and visual settings.", process: ["Adjust colors/logo.", "Preview changes.", "Save and verify navigation/pages."] },
  { page: "Admin Custom Fields", path: "/admin/custom-fields", purpose: "Define extra fields for entities.", process: ["Add field definition.", "Set type/default behavior.", "Confirm visibility in forms."] },
  { page: "Attribute Override Cheat Sheet", path: "/support/attribute-overrides", purpose: "Reference guide for bulk client and job attribute override workbooks.", process: ["Download the attribute override template before editing.", "Use value columns to set data and clear_<field> columns only when you intentionally want to remove an existing value.", "Preview the workbook, fix any blocked rows, then commit the ready rows."] },
  { page: "Admin Settings", path: "/admin/settings", purpose: "Global platform settings.", process: ["Adjust system keys/settings.", "Save changes.", "Verify with target feature flow."] },
];

export default function SupportPage() {
  const [query, setQuery] = useState("");
  const [diagnostics, setDiagnostics] = useState<SupportDiagnostics | null>(null);
  const [diagnosticsError, setDiagnosticsError] = useState<string>("");
  const [currentOrg, setCurrentOrg] = useState<CurrentOrgSummary | null>(null);
  const [organisations, setOrganisations] = useState<SupportOrganisation[]>([]);
  const [orgContextError, setOrgContextError] = useState<string>("");
  const [canManageOrganisations, setCanManageOrganisations] = useState(false);
  const [copyMessage, setCopyMessage] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    async function loadDiagnostics() {
      try {
        const res = await fetch("/api/backend/support/diagnostics", { credentials: "include" });
        if (!res.ok) {
          throw new Error(`Failed to load diagnostics: ${res.status}`);
        }
        const data = (await res.json()) as SupportDiagnostics;
        if (!cancelled) {
          setDiagnostics(data);
          setDiagnosticsError("");
          setCurrentOrg(data.current_org || null);
          setCanManageOrganisations(Boolean(data.can_manage_organisations));
        }
      } catch (err) {
        if (!cancelled) {
          setDiagnostics(null);
          setDiagnosticsError((err as Error).message);
        }
      }
    }
    loadDiagnostics();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadOrganisationManagement() {
      if (!canManageOrganisations) {
        if (!cancelled) {
          setOrganisations([]);
          setOrgContextError("");
        }
        return;
      }

      try {
        const orgRes = await fetch("/api/backend/admin/organisations", { credentials: "include" });
        if (!orgRes.ok) {
          throw new Error(`Failed to load organisations: ${orgRes.status}`);
        }
        const orgPayload = await orgRes.json().catch(() => ({}));
        const items = Array.isArray(orgPayload?.items) ? orgPayload.items : [];
        if (!cancelled) {
          setOrganisations(items);
          setOrgContextError("");
        }
      } catch (err) {
        if (!cancelled) {
          setOrganisations([]);
          setOrgContextError((err as Error).message);
        }
      }
    }
    loadOrganisationManagement();
    return () => {
      cancelled = true;
    };
  }, [canManageOrganisations]);

  async function handleCopyDiagnostics() {
    if (!diagnostics || typeof navigator === "undefined" || !navigator.clipboard) {
      return;
    }
    try {
      await navigator.clipboard.writeText(JSON.stringify(diagnostics, null, 2));
      setCopyMessage("Diagnostic snapshot copied.");
      window.setTimeout(() => setCopyMessage(""), 3000);
    } catch {
      setCopyMessage("Unable to copy snapshot automatically.");
    }
  }

  const filteredTopics = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return SUPPORT_TOPICS;
    return SUPPORT_TOPICS.filter(
      (topic) =>
        topic.page.toLowerCase().includes(q) ||
        topic.path.toLowerCase().includes(q) ||
        topic.purpose.toLowerCase().includes(q) ||
        topic.process.some((step) => step.toLowerCase().includes(q)),
    );
  }, [query]);

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto w-full max-w-7xl px-6 py-10">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold" style={{ color: "#F26624" }}>Support Center</h1>
            <p className="text-muted-foreground">Help guidance for every major page and process.</p>
          </div>
          <Button variant="secondary" asChild>
            <Link href="/">Back to Hub</Link>
          </Button>
        </div>

        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Search Help</CardTitle>
            <CardDescription>Filter by page name, route, purpose, or process step.</CardDescription>
          </CardHeader>
          <CardContent>
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="e.g. reporting, lookups, /jobs/[jobId], templates"
            />
          </CardContent>
        </Card>

        <Card className="mb-6 border-primary/20 bg-primary/5">
          <CardHeader>
            <CardTitle>New Organisation Checklist</CardTitle>
            <CardDescription>
              Start here if you have just been invited into a new tenant or are setting one up for the first time.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-5 text-sm">
            <div className="rounded-lg border bg-background p-4 space-y-2">
              <div className="font-medium">1. Confirm your tenant</div>
              <p className="text-muted-foreground">Check the current organisation card above before you create clients or jobs.</p>
            </div>
            <div className="rounded-lg border bg-background p-4 space-y-2">
              <div className="font-medium">2. Invite the right people</div>
              <p className="text-muted-foreground">Use Organisation Management to add owners, admins, billing, and consultants.</p>
            </div>
            <div className="rounded-lg border bg-background p-4 space-y-2">
              <div className="font-medium">3. Create the first client</div>
              <p className="text-muted-foreground">Add the client profile, benchmark period, and reporting details before starting work.</p>
            </div>
            <div className="rounded-lg border bg-background p-4 space-y-2">
              <div className="font-medium">4. Create the first job</div>
              <p className="text-muted-foreground">Use the Jobs area to create a reporting year and move into setup and data entry.</p>
            </div>
            <div className="rounded-lg border bg-background p-4 space-y-2">
              <div className="font-medium">5. Save diagnostics</div>
              <p className="text-muted-foreground">Copy the Support Diagnostics Snapshot when you need help from the team.</p>
            </div>
          </CardContent>
        </Card>

        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Legal Documents</CardTitle>
            <CardDescription>
              Access NZI&apos;s Standard Terms &amp; Conditions, Portal Terms of Use, Privacy Policy and Cookie Notice.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center justify-between gap-4">
            <p className="text-sm text-muted-foreground">
              These documents apply to NZI services and use of the website, client portal and application.
            </p>
            <Button asChild>
              <Link href="/support/legal">Open Legal Documents</Link>
            </Button>
          </CardContent>
        </Card>

        <Card className="mb-6 border-primary/20 bg-primary/5">
          <CardHeader className="flex flex-row items-start justify-between gap-4">
            <div>
              <CardTitle>Support Diagnostics Snapshot</CardTitle>
              <CardDescription>
                Capture the active session, organisation, and database details when reporting an issue.
              </CardDescription>
            </div>
            <Button variant="secondary" type="button" onClick={handleCopyDiagnostics} disabled={!diagnostics}>
              Copy Snapshot
            </Button>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            {diagnosticsError ? (
              <p className="text-destructive">{diagnosticsError}</p>
            ) : diagnostics ? (
              <>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="rounded-lg border bg-background p-4">
                    <p className="mb-2 font-medium">Session</p>
                    <div className="space-y-1 text-muted-foreground">
                      <div><span className="font-medium text-foreground">User:</span> {diagnostics.session.email || diagnostics.session.user_id || "-"}</div>
                      <div><span className="font-medium text-foreground">Role:</span> {diagnostics.session.role || "-"}</div>
                      <div><span className="font-medium text-foreground">Org ID:</span> {diagnostics.session.org_id || "-"}</div>
                      <div><span className="font-medium text-foreground">MFA:</span> {diagnostics.session.mfa_enabled ? "Enabled" : "Disabled"}</div>
                      <div><span className="font-medium text-foreground">Password Change:</span> {diagnostics.session.must_change_password ? "Required" : "Not required"}</div>
                    </div>
                  </div>
                  <div className="rounded-lg border bg-background p-4">
                    <p className="mb-2 font-medium">Organisation</p>
                    <div className="space-y-1 text-muted-foreground">
                      <div><span className="font-medium text-foreground">Name:</span> {diagnostics.current_org?.name || diagnostics.current_org?.org_id || "-"}</div>
                      <div><span className="font-medium text-foreground">Slug:</span> {diagnostics.current_org?.slug || "-"}</div>
                      <div><span className="font-medium text-foreground">Role:</span> {diagnostics.current_org?.role || "-"}</div>
                      <div><span className="font-medium text-foreground">Archived:</span> {diagnostics.current_org?.archived ? "Yes" : "No"}</div>
                      <div><span className="font-medium text-foreground">Org management:</span> {diagnostics.can_manage_organisations ? "Available" : "Read-only"}</div>
                    </div>
                  </div>
                </div>
                <div className="rounded-lg border bg-background p-4">
                  <p className="mb-2 font-medium">Database</p>
                  <div className="grid gap-2 md:grid-cols-2">
                    <div><span className="font-medium">Database:</span> {diagnostics.database.db_name}</div>
                    <div><span className="font-medium">User:</span> {diagnostics.database.db_user}</div>
                    <div><span className="font-medium">Host:</span> {diagnostics.database.host_ip}</div>
                    <div><span className="font-medium">Port:</span> {diagnostics.database.host_port}</div>
                    <div className="md:col-span-2"><span className="font-medium">Version:</span> {diagnostics.database.pg_version}</div>
                  </div>
                </div>
                {diagnostics.generated_at_utc ? (
                  <p className="text-xs text-muted-foreground">
                    Snapshot generated at {diagnostics.generated_at_utc}
                  </p>
                ) : null}
                {copyMessage ? <p className="text-xs text-muted-foreground">{copyMessage}</p> : null}
              </>
            ) : (
              <p className="text-muted-foreground">Loading support diagnostics...</p>
            )}
          </CardContent>
        </Card>

        <div className="mb-6 grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
            <CardTitle>Current Organisation</CardTitle>
            <CardDescription>
              The tenant context the application is currently using for this session.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
              {diagnosticsError ? (
                <p className="text-destructive">{diagnosticsError}</p>
              ) : currentOrg ? (
                <>
                  <div className="grid gap-2 md:grid-cols-2">
                    <div><span className="font-medium">Name:</span> {currentOrg.name || currentOrg.org_id || "-"}</div>
                    <div><span className="font-medium">Role:</span> {currentOrg.role || "Member"}</div>
                    <div><span className="font-medium">Slug:</span> {currentOrg.slug || "-"}</div>
                    <div><span className="font-medium">Org ID:</span> {currentOrg.org_id || "-"}</div>
                  </div>
                  <p className="text-muted-foreground">
                    Use the profile menu in the top-right corner to switch organisation. Admin users can also manage
                    organisations from the Admin area.
                  </p>
                </>
              ) : (
                <p className="text-muted-foreground">Loading current organisation...</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Delegated Access</CardTitle>
              <CardDescription>
                Role-based access that controls who can switch, manage members, and handle billing.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <ul className="list-disc space-y-2 pl-5 text-muted-foreground">
                <li><span className="font-medium text-foreground">Owner:</span> full organisation control, including transfer of ownership.</li>
                <li><span className="font-medium text-foreground">Admin:</span> manage members, settings, and organisation lifecycle.</li>
                <li><span className="font-medium text-foreground">Billing:</span> manage invoices, plan status, and billing events.</li>
                <li><span className="font-medium text-foreground">Member / Consultant:</span> work inside the current organisation and switch where permitted.</li>
              </ul>
              <p className="text-muted-foreground">
                If you are not sure which role you have, check the current organisation card above.
              </p>
            </CardContent>
          </Card>
        </div>

        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Organisation Management</CardTitle>
            <CardDescription>
              Use this when you need to switch organisations, review members, or update delegated access.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center justify-between gap-4 text-sm">
            <p className="text-muted-foreground">
              {canManageOrganisations
                ? (organisations.length > 0
                  ? `You currently have access to ${organisations.length} organisation${organisations.length === 1 ? "" : "s"}.`
                  : "Open the organisation manager to review active access and switching options.")
                : "Organisation switching is available from the profile menu. Admin users can manage members and settings in the Admin area."}
            </p>
            {canManageOrganisations ? (
              <Button asChild>
                <Link href="/admin/organisations">Open Organisation Management</Link>
              </Button>
            ) : null}
          </CardContent>
        </Card>

        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Methodology Library</CardTitle>
            <CardDescription>
              Maintain the company&apos;s recommended conversion-factor choices by country, scope, category, report label and descriptor.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center justify-between gap-4">
            <p className="text-sm text-muted-foreground">
              Use this as the company baseline for default factor selection, then let jobs surface matching rows as Default in Data Entry.
            </p>
            <Button asChild>
              <Link href="/support/methodology">Open Methodology Library</Link>
            </Button>
          </CardContent>
        </Card>

        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Database Fingerprint</CardTitle>
            <CardDescription>
              Shows the live database connection the app is currently using.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {diagnosticsError ? (
              <p className="text-sm text-destructive">{diagnosticsError}</p>
            ) : diagnostics ? (
              <div className="grid gap-3 text-sm md:grid-cols-2">
                <div><span className="font-medium">Database:</span> {diagnostics.database.db_name}</div>
                <div><span className="font-medium">User:</span> {diagnostics.database.db_user}</div>
                <div><span className="font-medium">Host:</span> {diagnostics.database.host_ip}</div>
                <div><span className="font-medium">Port:</span> {diagnostics.database.host_port}</div>
                <div className="md:col-span-2"><span className="font-medium">Version:</span> {diagnostics.database.pg_version}</div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Loading database fingerprint...</p>
            )}
          </CardContent>
        </Card>

        <div className="grid gap-4">
          {filteredTopics.length === 0 ? (
            <Card>
              <CardContent className="pt-6 text-sm text-muted-foreground">
                No support topics found for that search.
              </CardContent>
            </Card>
          ) : (
            filteredTopics.map((topic) => (
              <Card key={topic.path}>
                <CardHeader>
                  <CardTitle className="text-xl">{topic.page}</CardTitle>
                  <CardDescription>{topic.path}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <p><span className="font-medium">Purpose:</span> {topic.purpose}</p>
                  <div>
                    <p className="mb-2 font-medium">Standard Process</p>
                    <ol className="list-decimal space-y-1 pl-5">
                      {topic.process.map((step) => (
                        <li key={step}>{step}</li>
                      ))}
                    </ol>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
