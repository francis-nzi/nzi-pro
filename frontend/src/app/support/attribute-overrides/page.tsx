import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const clientFields = [
  "industry",
  "crm_owner",
  "benchmark_period_start",
  "benchmark_period_end",
  "benchmark_year",
  "company_reg",
  "sic_code",
  "year_end_month",
  "currency",
  "description_long",
  "net_zero_year",
];

const clientClearFields = [
  "clear_industry",
  "clear_crm_owner",
  "clear_benchmark_period_start",
  "clear_benchmark_period_end",
  "clear_benchmark_year",
  "clear_company_reg",
  "clear_sic_code",
  "clear_year_end_month",
  "clear_currency",
  "clear_description_long",
  "clear_net_zero_year",
];

const jobFields = [
  "crm_name",
  "reporting_period_start",
  "reporting_period_end",
  "baseline_year",
  "title",
  "status",
  "start_date",
  "due_date",
];

const jobClearFields = [
  "clear_crm_name",
  "clear_reporting_period_start",
  "clear_reporting_period_end",
  "clear_baseline_year",
  "clear_title",
  "clear_status",
  "clear_start_date",
  "clear_due_date",
];

export default function AttributeOverridesSupportPage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto w-full max-w-5xl px-6 py-10">
        <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold" style={{ color: "#F26624" }}>Attribute Override Cheat Sheet</h1>
            <p className="text-muted-foreground">
              Use <code>attribute_override_template.xlsx</code> to bulk update existing clients and jobs.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" asChild>
              <Link href="/support">Back to Help</Link>
            </Button>
            <Button asChild>
              <Link href="/admin/import-export">Open Import / Export</Link>
            </Button>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Core Rule</CardTitle>
              <CardDescription>Every updatable field has a value column and a matching clear column.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="rounded border bg-muted/20 p-3">
                <div>Value column example: <code>sic_code</code></div>
                <div>Clear column example: <code>clear_sic_code</code></div>
              </div>
              <div className="space-y-2">
                <div>Value blank + clear blank: leave unchanged</div>
                <div>Value filled + clear blank: set or update value</div>
                <div>Value blank + clear <code>TRUE</code>: clear the existing value</div>
                <div>Value filled + clear <code>TRUE</code>: invalid, the importer warns and skips that field</div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Accepted Clear Values</CardTitle>
              <CardDescription>Any of these values are treated as a clear instruction.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-2 text-sm sm:grid-cols-2">
              {["TRUE", "1", "yes", "y", "on"].map((value) => (
                <div key={value} className="rounded border bg-muted/20 px-3 py-2">
                  <code>{value}</code>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Matching Records</CardTitle>
              <CardDescription>Each row must identify the client or job to update.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <div>
                <div className="mb-2 font-medium">Clients sheet</div>
                <div>Use one of: <code>client_db_id</code>, <code>wfm_client_id</code>, <code>client_name</code></div>
                <div className="mt-1 text-muted-foreground">
                  If <code>match_by</code> is blank, the importer uses the first populated match column.
                </div>
              </div>
              <div>
                <div className="mb-2 font-medium">Jobs sheet</div>
                <div>Use one of: <code>job_id</code>, <code>wfm_job_id</code>, <code>job_number</code></div>
                <div className="mt-1 text-muted-foreground">
                  If <code>match_by</code> is blank, the importer uses the first populated match column.
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Date Format</CardTitle>
              <CardDescription>Use ISO dates where possible for the cleanest import.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div>Recommended: <code>YYYY-MM-DD</code></div>
              <div className="rounded border bg-muted/20 p-3">
                <div className="mb-1 font-medium">Also accepted</div>
                <div><code>DD/MM/YYYY</code></div>
                <div><code>DD-MM-YYYY</code></div>
                <div><code>YYYY/MM/DD</code></div>
                <div><code>DD.MM.YYYY</code></div>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Client Fields You Can Update</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2 text-sm sm:grid-cols-2">
              {clientFields.map((field) => (
                <div key={field} className="rounded border bg-muted/20 px-3 py-2">
                  <code>{field}</code>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Client Clear Columns</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2 text-sm sm:grid-cols-2">
              {clientClearFields.map((field) => (
                <div key={field} className="rounded border bg-muted/20 px-3 py-2">
                  <code>{field}</code>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Job Fields You Can Update</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2 text-sm sm:grid-cols-2">
              {jobFields.map((field) => (
                <div key={field} className="rounded border bg-muted/20 px-3 py-2">
                  <code>{field}</code>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Job Clear Columns</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2 text-sm sm:grid-cols-2">
              {jobClearFields.map((field) => (
                <div key={field} className="rounded border bg-muted/20 px-3 py-2">
                  <code>{field}</code>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Examples</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="rounded border bg-muted/20 p-3">
                <div className="mb-1 font-medium">Update SIC code</div>
                <div><code>client_db_id</code> = <code>18</code></div>
                <div><code>sic_code</code> = <code>62012</code></div>
                <div><code>clear_sic_code</code> = blank</div>
              </div>
              <div className="rounded border bg-muted/20 p-3">
                <div className="mb-1 font-medium">Clear company registration number</div>
                <div><code>client_db_id</code> = <code>18</code></div>
                <div><code>company_reg</code> = blank</div>
                <div><code>clear_company_reg</code> = <code>TRUE</code></div>
              </div>
              <div className="rounded border bg-muted/20 p-3">
                <div className="mb-1 font-medium">Leave benchmark end unchanged</div>
                <div><code>client_db_id</code> = <code>18</code></div>
                <div><code>benchmark_period_end</code> = blank</div>
                <div><code>clear_benchmark_period_end</code> = blank</div>
              </div>
              <div className="rounded border bg-muted/20 p-3">
                <div className="mb-1 font-medium">Update a job due date</div>
                <div><code>job_number</code> = <code>J000547</code></div>
                <div><code>due_date</code> = <code>2026-04-30</code></div>
                <div><code>clear_due_date</code> = blank</div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Important Notes</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div>Blank cells do not clear values.</div>
              <div>Only use <code>clear_{"<field>"}</code> when you want to remove an existing value.</div>
              <div>Do not set a value and clear the same field in the same row.</div>
              <div><code>job_name</code> in the jobs sheet is reference-only and ignored by the importer.</div>
              <div>Preview before commit whenever possible.</div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
