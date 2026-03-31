"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import PageHeader from "@/components/PageHeader";
import StatusBadge from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { withAuditHeaders } from "@/lib/auth-client";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

function apiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";
}

async function fetchJsonWithTimeout(url: string, init: RequestInit, timeoutMs: number, label: string) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") {
      throw new Error(`${label} timed out after ${Math.round(timeoutMs / 1000)}s`);
    }
    throw e;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

const MONTHS = [
  { value: "January", label: "January" },
  { value: "February", label: "February" },
  { value: "March", label: "March" },
  { value: "April", label: "April" },
  { value: "May", label: "May" },
  { value: "June", label: "June" },
  { value: "July", label: "July" },
  { value: "August", label: "August" },
  { value: "September", label: "September" },
  { value: "October", label: "October" },
  { value: "November", label: "November" },
  { value: "December", label: "December" },
];

type Client = {
  client_db_id: number;
  client_name: string | null;
  industry: string | null;
  description_long: string | null;
  website: string | null;
  year_end_month: string | null;
  company_reg: string | null;
  sic_code: string | null;
  headquarters: string | null;
  addr_line1: string | null;
  addr_line2: string | null;
  addr_city: string | null;
  addr_region: string | null;
  addr_postcode: string | null;
  addr_country: string | null;
  billing_same_as_main: boolean | null;
  billing_addr_line1: string | null;
  billing_addr_line2: string | null;
  billing_addr_city: string | null;
  billing_addr_region: string | null;
  billing_addr_postcode: string | null;
  billing_addr_country: string | null;
  create_site_from_address?: boolean | null;
  logo_url: string | null;
  crm_owner: string | null;
  status: string | null;
  net_zero_year: number | null;
  interim_year: number | null;
  interim_s1_pct: number | null;
  interim_s2_pct: number | null;
  interim_s3_pct: number | null;
  portfolio: string | null;
  benchmark_year: number | null;
  target_s1_year: number | null;
  target_s1_pct: number | null;
  target_s2_year: number | null;
  target_s2_pct: number | null;
  target_s3_year: number | null;
  target_s3_pct: number | null;
  currency: string | null;
  benchmark_period_start: string | null;
  benchmark_period_end: string | null;
  benchmark_scope_1_tco2e: number | null;
  benchmark_scope_2_tco2e: number | null;
  benchmark_scope_3_tco2e: number | null;
  benchmark_total_tco2e: number | null;
};

type Site = {
  site_id: number;
  site_name: string | null;
  location: string | null;
  is_registered_office: boolean;
  vacated_date?: string | null;
};

type CurrencyOption = {
  currency_code: string;
  currency_name: string;
  symbol: string;
  is_default?: boolean;
};

export default function EditClientPage() {
  const baseUrl = useMemo(() => apiBaseUrl(), []);
  const params = useParams<{ clientId: string }>();
  const router = useRouter();
  const clientId = Number(params?.clientId);

  const [client, setClient] = useState<Client | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [status, setStatus] = useState<string>("");
  const [portfolios, setPortfolios] = useState<string[]>([]);
  const [industries, setIndustries] = useState<string[]>([]);
  const [users, setUsers] = useState<Array<{email: string, full_name: string}>>([]);
  const [currencies, setCurrencies] = useState<CurrencyOption[]>([]);

  // Form fields
  const [clientName, setClientName] = useState<string>("");
  const [industry, setIndustry] = useState<string>("");
  const [descriptionLong, setDescriptionLong] = useState<string>("");
  const [website, setWebsite] = useState<string>("");
  const [yearEndMonth, setYearEndMonth] = useState<string>("");
  const [companyReg, setCompanyReg] = useState<string>("");
  const [sicCode, setSicCode] = useState<string>("");
  const [headquarters, setHeadquarters] = useState<string>("");
  const [addrLine1, setAddrLine1] = useState<string>("");
  const [addrLine2, setAddrLine2] = useState<string>("");
  const [addrCity, setAddrCity] = useState<string>("");
  const [addrRegion, setAddrRegion] = useState<string>("");
  const [addrPostcode, setAddrPostcode] = useState<string>("");
  const [addrCountry, setAddrCountry] = useState<string>("");
  const [billingSameAsMain, setBillingSameAsMain] = useState<boolean>(true);
  const [billingAddrLine1, setBillingAddrLine1] = useState<string>("");
  const [billingAddrLine2, setBillingAddrLine2] = useState<string>("");
  const [billingAddrCity, setBillingAddrCity] = useState<string>("");
  const [billingAddrRegion, setBillingAddrRegion] = useState<string>("");
  const [billingAddrPostcode, setBillingAddrPostcode] = useState<string>("");
  const [billingAddrCountry, setBillingAddrCountry] = useState<string>("");
  const [logoUrl, setLogoUrl] = useState<string>("");
  const [crmOwner, setCrmOwner] = useState<string>("");
  const [portfolio, setPortfolio] = useState<string>("NZI");
  const [clientStatus, setClientStatus] = useState<string>("Active");
  const [netZeroYear, setNetZeroYear] = useState<string>("2050");
  const [interimYear, setInterimYear] = useState<string>("2035");
  const [benchmarkYear, setBenchmarkYear] = useState<string>("");
  const [targetS1Year, setTargetS1Year] = useState<string>("2035");
  const [targetS1Pct, setTargetS1Pct] = useState<string>("50");
  const [targetS2Year, setTargetS2Year] = useState<string>("2035");
  const [targetS2Pct, setTargetS2Pct] = useState<string>("50");
  const [targetS3Year, setTargetS3Year] = useState<string>("2035");
  const [targetS3Pct, setTargetS3Pct] = useState<string>("50");
  const [currency, setCurrency] = useState<string>("GBP");
  const [benchmarkPeriodStart, setBenchmarkPeriodStart] = useState<string>("");
  const [benchmarkPeriodEnd, setBenchmarkPeriodEnd] = useState<string>("");
  const [benchmarkScope1, setBenchmarkScope1] = useState<string>("");
  const [benchmarkScope2, setBenchmarkScope2] = useState<string>("");
  const [benchmarkScope3, setBenchmarkScope3] = useState<string>("");
  const [benchmarkTotal, setBenchmarkTotal] = useState<string>("");
  const [createSiteFromAddress, setCreateSiteFromAddress] = useState<boolean>(true);
  
  // Site management state
  const [activeSites, setActiveSites] = useState<Site[]>([]);
  const [vacatedSites, setVacatedSites] = useState<Site[]>([]);
  const [showAddSite, setShowAddSite] = useState<boolean>(false);
  const [editingSite, setEditingSite] = useState<number | null>(null);
  const [vacatingSite, setVacatingSite] = useState<number | null>(null);
  const [vacatedDate, setVacatedDate] = useState<string>("");
  const [siteForm, setSiteForm] = useState({
    site_name: "",
    location: "",
    is_registered_office: false,
  });

  useEffect(() => {
    loadLookups();
    loadSites();
  }, [baseUrl, clientId]);

  async function loadSites() {
    if (!Number.isFinite(clientId) || clientId <= 0) return;
    try {
      const res = await fetch(`${baseUrl}/clients/${clientId}/sites`, {
        credentials: "include",
        cache: "no-store",
      });
      if (res.ok) {
        const data = await res.json();
        setActiveSites(data.active_sites || []);
        setVacatedSites(data.vacated_sites || []);
      }
    } catch (e) {
      console.error('Failed to load sites:', e);
    }
  }

  async function loadLookups() {
    try {
      const lookupInit = { credentials: "include", cache: "no-store" } as RequestInit;
      const [portfoliosRes, industriesRes, usersRes, currenciesRes] = await Promise.allSettled([
        fetchJsonWithTimeout(`${baseUrl}/admin/lookups/portfolios_lookup`, lookupInit, 10000, "Portfolio lookup"),
        fetchJsonWithTimeout(`${baseUrl}/admin/lookups/industries_lookup`, lookupInit, 10000, "Industry lookup"),
        fetchJsonWithTimeout(`${baseUrl}/admin/users`, lookupInit, 10000, "User lookup"),
        fetchJsonWithTimeout(`${baseUrl}/admin/lookups/currency_lookup`, lookupInit, 10000, "Currency lookup"),
      ]);

      if (portfoliosRes.status === "fulfilled" && portfoliosRes.value.ok) {
        const data = await portfoliosRes.value.json();
        const portfolioList = data.items?.map((i: any) => i.name).filter(Boolean) || [];
        setPortfolios(Array.from(new Set(portfolioList)) as string[]);
      }

      if (industriesRes.status === "fulfilled" && industriesRes.value.ok) {
        const data = await industriesRes.value.json();
        const industryList = data.items?.map((i: any) => i.name).filter(Boolean) || [];
        setIndustries(Array.from(new Set(industryList)) as string[]);
      }

      if (usersRes.status === "fulfilled" && usersRes.value.ok) {
        const data = await usersRes.value.json();
        const userList = (data.items || []).filter((u: any) => u && (u.email || u.full_name));
        const uniqueUsers = Array.from(
          new Map(userList.map((u: any) => [u.email || u.full_name, u])).values()
        ) as Array<{email: string, full_name: string}>;
        setUsers(uniqueUsers);
      }

      if (currenciesRes.status === "fulfilled" && currenciesRes.value.ok) {
        const data = await currenciesRes.value.json();
        const currencyItems = Array.isArray(data.items) ? data.items : [];
        const lookupCurrencies = currencyItems
          .map((row: any) => ({
            currency_code: String(row.currency_code || "").toUpperCase(),
            currency_name: String(row.currency_name || ""),
            symbol: String(row.symbol || ""),
            is_default: Boolean(row.is_default),
          }))
          .filter((row: CurrencyOption) => row.currency_code);
        setCurrencies(lookupCurrencies);
      }
    } catch (e) {
      console.error('Failed to load lookups:', e);
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!Number.isFinite(clientId) || clientId <= 0) {
        setError("Invalid client id");
        return;
      }

      setLoading(true);
      setError("");

      try {
        const res = await fetch(`${baseUrl}/clients/${clientId}`);

        if (!res.ok) {
          const t = await res.text().catch(() => "");
          throw new Error(`Failed to load client: ${res.status} ${res.statusText}${t ? ` - ${t}` : ""}`);
        }

        const json = (await res.json()) as Client;

        if (cancelled) return;

        setClient(json);
        setClientName(json.client_name || "");
        setIndustry(json.industry || "");
        setDescriptionLong(json.description_long || "");
        setWebsite(json.website || "");
        setYearEndMonth(json.year_end_month || "");
        setCompanyReg(json.company_reg || "");
        setSicCode(json.sic_code || "");
        setHeadquarters(json.headquarters || "");
        setAddrLine1(json.addr_line1 || "");
        setAddrLine2(json.addr_line2 || "");
        setAddrCity(json.addr_city || "");
        setAddrRegion(json.addr_region || "");
        setAddrPostcode(json.addr_postcode || "");
        setAddrCountry(json.addr_country || "");
        setBillingSameAsMain(json.billing_same_as_main ?? true);
        setBillingAddrLine1(json.billing_addr_line1 || "");
        setBillingAddrLine2(json.billing_addr_line2 || "");
        setBillingAddrCity(json.billing_addr_city || "");
        setBillingAddrRegion(json.billing_addr_region || "");
        setBillingAddrPostcode(json.billing_addr_postcode || "");
        setBillingAddrCountry(json.billing_addr_country || "");
        setCreateSiteFromAddress(json.create_site_from_address ?? Boolean(
          json.addr_line1 ||
          json.addr_line2 ||
          json.addr_city ||
          json.addr_region ||
          json.addr_postcode ||
          json.addr_country
        ));
        setLogoUrl(json.logo_url || "");
        setPortfolio(json.portfolio || "NZI");
        setCrmOwner(json.crm_owner || "");
        setClientStatus(json.status || "Active");
        setNetZeroYear(json.net_zero_year ? String(json.net_zero_year) : "2050");
        setInterimYear(json.interim_year ? String(json.interim_year) : "2035");
        setBenchmarkYear(json.benchmark_year ? String(json.benchmark_year) : "");
        setTargetS1Year(json.target_s1_year ? String(json.target_s1_year) : "2035");
        setTargetS1Pct(json.target_s1_pct ? String(json.target_s1_pct) : "50");
        setTargetS2Year(json.target_s2_year ? String(json.target_s2_year) : "2035");
        setTargetS2Pct(json.target_s2_pct ? String(json.target_s2_pct) : "50");
        setTargetS3Year(json.target_s3_year ? String(json.target_s3_year) : "2035");
        setTargetS3Pct(json.target_s3_pct ? String(json.target_s3_pct) : "50");
        setCurrency(json.currency || "GBP");
        setBenchmarkPeriodStart(json.benchmark_period_start || "");
        setBenchmarkPeriodEnd(json.benchmark_period_end || "");
        setBenchmarkScope1(json.benchmark_scope_1_tco2e != null ? String(json.benchmark_scope_1_tco2e) : "");
        setBenchmarkScope2(json.benchmark_scope_2_tco2e != null ? String(json.benchmark_scope_2_tco2e) : "");
        setBenchmarkScope3(json.benchmark_scope_3_tco2e != null ? String(json.benchmark_scope_3_tco2e) : "");
        setBenchmarkTotal(json.benchmark_total_tco2e != null ? String(json.benchmark_total_tco2e) : "");
      } catch (e) {
        if (cancelled) return;
        setError((e as Error).message);
        setClient(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [baseUrl, clientId]);

  async function handleAddSite() {
    try {
      const res = await fetch(`${baseUrl}/clients/${clientId}/sites`, {
        method: "POST",
        headers: withAuditHeaders(
          { "Content-Type": "application/json" },
          { page: "Clients", section: "Sites", container: "Add Site" }
        ),
        body: JSON.stringify(siteForm),
      });

      if (!res.ok) throw new Error("Failed to add site");

      await loadSites();
      setSiteForm({ site_name: "", location: "", is_registered_office: false });
      setShowAddSite(false);
    } catch (e) {
      alert((e as Error).message);
    }
  }

  async function handleEditSite(siteId: number) {
    try {
      const res = await fetch(`${baseUrl}/clients/${clientId}/sites/${siteId}`, {
        method: "PATCH",
        headers: withAuditHeaders(
          { "Content-Type": "application/json" },
          { page: "Clients", section: "Sites", container: "Edit Site" }
        ),
        body: JSON.stringify(siteForm),
      });

      if (!res.ok) throw new Error("Failed to update site");

      await loadSites();
      setSiteForm({ site_name: "", location: "", is_registered_office: false });
      setEditingSite(null);
    } catch (e) {
      alert((e as Error).message);
    }
  }

  async function handleVacateSite(siteId: number) {
    if (!vacatedDate) {
      alert("Please select a vacated date");
      return;
    }

    try {
      const res = await fetch(`${baseUrl}/clients/${clientId}/sites/${siteId}/vacate`, {
        method: "PATCH",
        headers: withAuditHeaders(
          { "Content-Type": "application/json" },
          { page: "Clients", section: "Sites", container: "Vacate Site" }
        ),
        body: JSON.stringify({ vacated_date: vacatedDate }),
      });

      if (!res.ok) throw new Error("Failed to vacate site");

      await loadSites();
      setVacatingSite(null);
      setVacatedDate("");
    } catch (e) {
      alert((e as Error).message);
    }
  }

  function startEditSite(site: Site) {
    setSiteForm({
      site_name: site.site_name ?? "",
      location: site.location ?? "",
      is_registered_office: site.is_registered_office,
    });
    setEditingSite(site.site_id);
    setShowAddSite(false);
  }

  function cancelSiteEdit() {
    setSiteForm({ site_name: "", location: "", is_registered_office: false });
    setEditingSite(null);
    setShowAddSite(false);
  }

  async function saveClient() {
    if (!Number.isFinite(clientId) || clientId <= 0) return;

    // Validate required fields
    if (!crmOwner || !crmOwner.trim()) {
      setError("Client Owner is required");
      return;
    }
    if (!portfolio || !portfolio.trim()) {
      setError("Portfolio is required");
      return;
    }
    if (!industry || !industry.trim()) {
      setError("Industry is required");
      return;
    }
    if (!yearEndMonth || !yearEndMonth.trim()) {
      setError("Financial Year End is required");
      return;
    }

    setSaving(true);
    setStatus("Saving...");
    setError("");

    try {
      const res = await fetch(`${baseUrl}/clients/${clientId}`, {
        method: "PATCH",
        headers: withAuditHeaders(
          {
            "Content-Type": "application/json",
          },
          { page: "Clients", section: "Basic Information", container: "Edit Client" }
        ),
        body: JSON.stringify({
          client_name: clientName || null,
          industry: industry || null,
          description_long: descriptionLong || null,
          website: website || null,
          year_end_month: yearEndMonth || null,
          company_reg: companyReg || null,
          sic_code: sicCode || null,
          headquarters: headquarters || null,
          addr_line1: addrLine1 || null,
          addr_line2: addrLine2 || null,
          addr_city: addrCity || null,
          addr_region: addrRegion || null,
          addr_postcode: addrPostcode || null,
          addr_country: addrCountry || null,
          billing_same_as_main: billingSameAsMain,
          billing_addr_line1: billingAddrLine1 || null,
          billing_addr_line2: billingAddrLine2 || null,
          billing_addr_city: billingAddrCity || null,
          billing_addr_region: billingAddrRegion || null,
          billing_addr_postcode: billingAddrPostcode || null,
          billing_addr_country: billingAddrCountry || null,
          logo_url: logoUrl || null,
          portfolio: portfolio || null,
          crm_owner: crmOwner || null,
          status: clientStatus || null,
          net_zero_year: netZeroYear ? Number(netZeroYear) : null,
          interim_year: interimYear ? Number(interimYear) : null,
          benchmark_year: benchmarkYear ? Number(benchmarkYear) : null,
          target_s1_year: targetS1Year ? Number(targetS1Year) : null,
          target_s1_pct: targetS1Pct ? Number(targetS1Pct) : null,
          target_s2_year: targetS2Year ? Number(targetS2Year) : null,
          target_s2_pct: targetS2Pct ? Number(targetS2Pct) : null,
          target_s3_year: targetS3Year ? Number(targetS3Year) : null,
          target_s3_pct: targetS3Pct ? Number(targetS3Pct) : null,
          currency: currency || "GBP",
          benchmark_scope_1_tco2e: benchmarkScope1 ? Number(benchmarkScope1) : null,
          benchmark_scope_2_tco2e: benchmarkScope2 ? Number(benchmarkScope2) : null,
          benchmark_scope_3_tco2e: benchmarkScope3 ? Number(benchmarkScope3) : null,
          benchmark_total_tco2e: benchmarkTotal ? Number(benchmarkTotal) : null,
          benchmark_period_start: benchmarkPeriodStart || null,
          benchmark_period_end: benchmarkPeriodEnd || null,
          create_site_from_address: createSiteFromAddress,
        }),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Save failed: ${res.status} ${res.statusText}${text ? ` - ${text}` : ""}`);
      }

      setStatus("Client updated successfully!");
      setTimeout(() => {
        router.push(`/clients/${clientId}`);
      }, 1000);
    } catch (e) {
      setError((e as Error).message);
      setStatus("");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto w-full max-w-7xl px-6 py-10">
        <PageHeader
          title="Edit Client"
          subtitle={clientName || "Loading..."}
          breadcrumbs={[
            { label: "Clients", href: "/clients" },
            { label: clientName || "Client", href: `/clients/${clientId}` },
            { label: "Edit" },
          ]}
          titleSuffix={<StatusBadge status={clientStatus} label={clientStatus || "Status"} />}
          actions={
            <>
              <Button variant="secondary" asChild>
                <Link href={`/clients/${clientId}`}>Cancel</Link>
              </Button>
              <Button onClick={saveClient} disabled={saving || loading}>
                Save Changes
              </Button>
            </>
          }
        />

        {error ? <div className="mb-4 text-sm text-destructive">{error}</div> : null}
        {status ? <div className="mb-4 text-sm text-muted-foreground">{status}</div> : null}
        {loading ? <div className="mb-4 text-sm text-muted-foreground">Loading...</div> : null}

        <div className="grid gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Basic Information</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-3">
                <div className="space-y-2">
                  <Label htmlFor="clientName">Client Name *</Label>
                  <Input
                    id="clientName"
                    value={clientName}
                    onChange={(e) => setClientName(e.target.value)}
                    placeholder="Company Ltd"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="portfolio">Portfolio</Label>
                  <Select value={portfolio} onValueChange={setPortfolio}>
                    <SelectTrigger id="portfolio">
                      <SelectValue placeholder="Select portfolio..." />
                    </SelectTrigger>
                    <SelectContent>
                      {portfolios.map((p, idx) => (
                        <SelectItem key={`portfolio-${idx}`} value={p}>{p}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="crmOwner">Client Owner</Label>
                  <Select value={crmOwner} onValueChange={setCrmOwner}>
                    <SelectTrigger id="crmOwner">
                      <SelectValue placeholder="Select client owner..." />
                    </SelectTrigger>
                    <SelectContent>
                      {users.map((u, idx) => (
                        <SelectItem key={u.email || `user-${idx}`} value={u.full_name || u.email}>
                          {u.full_name || u.email}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-3">
                <div className="space-y-2">
                  <Label htmlFor="website">Website</Label>
                  <Input
                    id="website"
                    value={website}
                    onChange={(e) => setWebsite(e.target.value)}
                    placeholder="https://example.com"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="industry">Industry</Label>
                  <Select value={industry} onValueChange={setIndustry}>
                    <SelectTrigger id="industry">
                      <SelectValue placeholder="Select industry..." />
                    </SelectTrigger>
                    <SelectContent>
                      {industries.map((ind, idx) => (
                        <SelectItem key={`industry-${idx}`} value={ind}>{ind}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="companyReg">Company Registration</Label>
                  <Input
                    id="companyReg"
                    value={companyReg}
                    onChange={(e) => setCompanyReg(e.target.value)}
                    placeholder="12345678"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="sicCode">Industry Code (SIC)</Label>
                  <Input
                    id="sicCode"
                    value={sicCode}
                    onChange={(e) => setSicCode(e.target.value)}
                    placeholder="e.g. 62012"
                  />
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-3">
                <div className="space-y-2">
                  <Label htmlFor="headquarters">Headquarters</Label>
                  <Input
                    id="headquarters"
                    value={headquarters}
                    onChange={(e) => setHeadquarters(e.target.value)}
                    placeholder="London, UK"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="yearEndMonth">Financial Year End</Label>
                  <Select value={yearEndMonth || undefined} onValueChange={setYearEndMonth}>
                    <SelectTrigger id="yearEndMonth">
                      <SelectValue placeholder="Select month..." />
                    </SelectTrigger>
                    <SelectContent>
                      {MONTHS.map((m) => (
                        <SelectItem key={m.value} value={m.value}>
                          {m.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="currency">Currency</Label>
                  <Select value={currency} onValueChange={setCurrency}>
                    <SelectTrigger id="currency">
                      <SelectValue placeholder="Select currency..." />
                    </SelectTrigger>
                    <SelectContent>
                      {currencies.length > 0 ? (
                        currencies.map((c) => (
                          <SelectItem key={c.currency_code} value={c.currency_code}>
                            {c.currency_code}
                            {c.symbol ? ` (${c.symbol})` : ""}
                            {c.currency_name ? ` - ${c.currency_name}` : ""}
                          </SelectItem>
                        ))
                      ) : (
                        <SelectItem value="GBP">GBP</SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-1">
                <div className="space-y-2">
                  <Label htmlFor="logoUrl">Logo URL</Label>
                  <Input
                    id="logoUrl"
                    value={logoUrl}
                    onChange={(e) => setLogoUrl(e.target.value)}
                    placeholder="https://..."
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">Company Description</Label>
                <Textarea
                  id="description"
                  value={descriptionLong}
                  onChange={(e) => setDescriptionLong(e.target.value)}
                  placeholder="Brief description of the company..."
                  rows={4}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="status">Status</Label>
                <Select value={clientStatus} onValueChange={setClientStatus}>
                  <SelectTrigger id="status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Active">Active</SelectItem>
                    <SelectItem value="Inactive">Inactive</SelectItem>
                    <SelectItem value="Prospect">Prospect</SelectItem>
                    <SelectItem value="Archived">Archived</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Net Zero Targets</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="netZeroYear">Net Zero Target Year</Label>
                  <Input
                    id="netZeroYear"
                    type="number"
                    value={netZeroYear}
                    onChange={(e) => setNetZeroYear(e.target.value)}
                    min="2025"
                    max="2100"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="benchmarkYear">Benchmark Year (Legacy)</Label>
                  <Input
                    id="benchmarkYear"
                    type="number"
                    value={benchmarkYear}
                    onChange={(e) => setBenchmarkYear(e.target.value)}
                    min="2000"
                    max="2100"
                    placeholder="e.g. 2024"
                  />
                  <p className="text-xs text-muted-foreground">Use benchmark period dates below for new clients</p>
                </div>
              </div>

              <div className="rounded-md border bg-orange-50 p-4 space-y-4">
                <div>
                  <h3 className="font-semibold text-sm mb-1">Benchmark Period (Financial Year)</h3>
                  <p className="text-xs text-muted-foreground">Define the benchmark reporting period. This should align with the client&apos;s financial year. All subsequent annual jobs will automatically follow this period structure.</p>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="benchmarkPeriodStart">Benchmark Period Start</Label>
                    <Input
                      id="benchmarkPeriodStart"
                      type="date"
                      value={benchmarkPeriodStart}
                      onChange={(e) => setBenchmarkPeriodStart(e.target.value)}
                      placeholder="dd/mm/yyyy"
                    />
                    <p className="text-xs text-muted-foreground">e.g. 01/08/2022</p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="benchmarkPeriodEnd">Benchmark Period End</Label>
                    <Input
                      id="benchmarkPeriodEnd"
                      type="date"
                      value={benchmarkPeriodEnd}
                      onChange={(e) => setBenchmarkPeriodEnd(e.target.value)}
                      placeholder="dd/mm/yyyy"
                    />
                    <p className="text-xs text-muted-foreground">e.g. 31/07/2023</p>
                  </div>
                </div>
              </div>

              <div className="rounded-md border bg-slate-50 p-4 space-y-4">
                <div>
                  <h3 className="font-semibold text-sm mb-1">Historical Benchmark Emissions</h3>
                  <p className="text-xs text-muted-foreground">Capture third-party benchmark values for Scope 1, 2, 3 and total so reports can compare against the client&apos;s own baseline.</p>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="benchmarkScope1">Benchmark Scope 1</Label>
                    <Input
                      id="benchmarkScope1"
                      type="number"
                      step="0.1"
                      min="0"
                      value={benchmarkScope1}
                      onChange={(e) => setBenchmarkScope1(e.target.value)}
                      placeholder="e.g. 123.4"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="benchmarkScope2">Benchmark Scope 2</Label>
                    <Input
                      id="benchmarkScope2"
                      type="number"
                      step="0.1"
                      min="0"
                      value={benchmarkScope2}
                      onChange={(e) => setBenchmarkScope2(e.target.value)}
                      placeholder="e.g. 456.7"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="benchmarkScope3">Benchmark Scope 3</Label>
                    <Input
                      id="benchmarkScope3"
                      type="number"
                      step="0.1"
                      min="0"
                      value={benchmarkScope3}
                      onChange={(e) => setBenchmarkScope3(e.target.value)}
                      placeholder="e.g. 789.0"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="benchmarkTotal">Benchmark Total</Label>
                    <Input
                      id="benchmarkTotal"
                      type="number"
                      step="0.1"
                      min="0"
                      value={benchmarkTotal}
                      onChange={(e) => setBenchmarkTotal(e.target.value)}
                      placeholder="e.g. 1369.1"
                    />
                  </div>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-3">
                <div className="space-y-2">
                  <Label htmlFor="targetS1Year">Scope 1 Target Year</Label>
                  <Input
                    id="targetS1Year"
                    type="number"
                    value={targetS1Year}
                    onChange={(e) => setTargetS1Year(e.target.value)}
                    min="2025"
                    max="2100"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="targetS1Pct">Scope 1 Reduction %</Label>
                  <Input
                    id="targetS1Pct"
                    type="number"
                    value={targetS1Pct}
                    onChange={(e) => setTargetS1Pct(e.target.value)}
                    min="0"
                    max="100"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="targetS2Year">Scope 2 Target Year</Label>
                  <Input
                    id="targetS2Year"
                    type="number"
                    value={targetS2Year}
                    onChange={(e) => setTargetS2Year(e.target.value)}
                    min="2025"
                    max="2100"
                  />
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-3">
                <div className="space-y-2">
                  <Label htmlFor="targetS2Pct">Scope 2 Reduction %</Label>
                  <Input
                    id="targetS2Pct"
                    type="number"
                    value={targetS2Pct}
                    onChange={(e) => setTargetS2Pct(e.target.value)}
                    min="0"
                    max="100"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="targetS3Year">Scope 3 Target Year</Label>
                  <Input
                    id="targetS3Year"
                    type="number"
                    value={targetS3Year}
                    onChange={(e) => setTargetS3Year(e.target.value)}
                    min="2025"
                    max="2100"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="targetS3Pct">Scope 3 Reduction %</Label>
                  <Input
                    id="targetS3Pct"
                    type="number"
                    value={targetS3Pct}
                    onChange={(e) => setTargetS3Pct(e.target.value)}
                    min="0"
                    max="100"
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Address</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <h3 className="text-sm font-semibold">Main address</h3>
                <p className="text-xs text-muted-foreground">
                  This is the client&apos;s primary registered or trading address.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="addrLine1">Address Line 1</Label>
                <Input
                  id="addrLine1"
                  value={addrLine1}
                  onChange={(e) => setAddrLine1(e.target.value)}
                  placeholder="123 Business Street"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="addrLine2">Address Line 2</Label>
                <Input
                  id="addrLine2"
                  value={addrLine2}
                  onChange={(e) => setAddrLine2(e.target.value)}
                  placeholder="Suite 100"
                />
              </div>

              <div className="grid gap-4 md:grid-cols-3">
                <div className="space-y-2">
                  <Label htmlFor="addrCity">City</Label>
                  <Input
                    id="addrCity"
                    value={addrCity}
                    onChange={(e) => setAddrCity(e.target.value)}
                    placeholder="London"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="addrRegion">Region/County</Label>
                  <Input
                    id="addrRegion"
                    value={addrRegion}
                    onChange={(e) => setAddrRegion(e.target.value)}
                    placeholder="Greater London"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="addrPostcode">Postcode</Label>
                  <Input
                    id="addrPostcode"
                    value={addrPostcode}
                    onChange={(e) => setAddrPostcode(e.target.value)}
                    placeholder="SW1A 1AA"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="addrCountry">Country</Label>
                <Input
                  id="addrCountry"
                  value={addrCountry}
                  onChange={(e) => setAddrCountry(e.target.value)}
                  placeholder="United Kingdom"
                />
              </div>

              <div className="flex items-center space-x-2 border-t pt-2">
                <input
                  type="checkbox"
                  id="billingSameAsMain"
                  checked={billingSameAsMain}
                  onChange={(e) => setBillingSameAsMain(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300"
                />
                <Label htmlFor="billingSameAsMain" className="font-normal cursor-pointer">
                  Billing address same as main address
                </Label>
              </div>

              {!billingSameAsMain && (
                <div className="space-y-4 rounded-md border bg-muted/30 p-4">
                  <div>
                    <h3 className="text-sm font-semibold">Billing address</h3>
                    <p className="text-xs text-muted-foreground">
                      Use this only if invoices should go to a different address.
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="billingAddrLine1">Billing Address Line 1</Label>
                    <Input
                      id="billingAddrLine1"
                      value={billingAddrLine1}
                      onChange={(e) => setBillingAddrLine1(e.target.value)}
                      placeholder="123 Finance Street"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="billingAddrLine2">Billing Address Line 2</Label>
                    <Input
                      id="billingAddrLine2"
                      value={billingAddrLine2}
                      onChange={(e) => setBillingAddrLine2(e.target.value)}
                      placeholder="Suite 200"
                    />
                  </div>

                  <div className="grid gap-4 md:grid-cols-3">
                    <div className="space-y-2">
                      <Label htmlFor="billingAddrCity">Billing City</Label>
                      <Input
                        id="billingAddrCity"
                        value={billingAddrCity}
                        onChange={(e) => setBillingAddrCity(e.target.value)}
                        placeholder="London"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="billingAddrRegion">Billing Region/County</Label>
                      <Input
                        id="billingAddrRegion"
                        value={billingAddrRegion}
                        onChange={(e) => setBillingAddrRegion(e.target.value)}
                        placeholder="Greater London"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="billingAddrPostcode">Billing Postcode</Label>
                      <Input
                        id="billingAddrPostcode"
                        value={billingAddrPostcode}
                        onChange={(e) => setBillingAddrPostcode(e.target.value)}
                        placeholder="SW1A 1AA"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="billingAddrCountry">Billing Country</Label>
                    <Input
                      id="billingAddrCountry"
                      value={billingAddrCountry}
                      onChange={(e) => setBillingAddrCountry(e.target.value)}
                      placeholder="United Kingdom"
                    />
                  </div>
                </div>
              )}

              <div className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  id="createSiteFromAddress"
                  checked={createSiteFromAddress}
                  onChange={(e) => setCreateSiteFromAddress(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300"
                />
                <Label htmlFor="createSiteFromAddress" className="font-normal cursor-pointer">
                  Create site from this address (Registered Office)
                </Label>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Active Sites ({activeSites.length})</CardTitle>
                <Button 
                  size="sm" 
                  onClick={() => {
                    setShowAddSite(true);
                    setEditingSite(null);
                    setSiteForm({ site_name: "", location: "", is_registered_office: false });
                  }}
                >
                  + Add Site
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {showAddSite || editingSite ? (
                <div className="mb-4 space-y-3 rounded-md border p-4">
                  <div className="space-y-2">
                    <Label htmlFor="siteName">Site Name</Label>
                    <Input
                      id="siteName"
                      value={siteForm.site_name}
                      onChange={(e) => setSiteForm({ ...siteForm, site_name: e.target.value })}
                      placeholder="Main Office"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="siteLocation">Location</Label>
                    <Input
                      id="siteLocation"
                      value={siteForm.location}
                      onChange={(e) => setSiteForm({ ...siteForm, location: e.target.value })}
                      placeholder="London, UK"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="is_registered_office"
                      checked={siteForm.is_registered_office}
                      onChange={(e) => setSiteForm({ ...siteForm, is_registered_office: e.target.checked })}
                      className="h-4 w-4 rounded border-gray-300"
                    />
                    <Label htmlFor="is_registered_office" className="font-normal cursor-pointer">
                      Registered Office
                    </Label>
                  </div>
                  <div className="flex gap-2">
                    <Button 
                      size="sm" 
                      onClick={() => editingSite ? handleEditSite(editingSite) : handleAddSite()}
                    >
                      {editingSite ? "Update" : "Add"}
                    </Button>
                    <Button size="sm" variant="outline" onClick={cancelSiteEdit}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : null}

              {activeSites.length === 0 ? (
                <div className="text-sm text-muted-foreground">No active sites.</div>
              ) : (
                <div className="space-y-2">
                  {activeSites.map((site) => (
                    <div key={site.site_id} className="rounded-md border px-3 py-2 text-sm">
                      {vacatingSite === site.site_id ? (
                        <div className="space-y-3">
                          <div className="font-medium">Vacate Site: {site.site_name}</div>
                          <div className="space-y-2">
                            <Label htmlFor="vacatedDate">Vacated Date</Label>
                            <Input
                              id="vacatedDate"
                              type="date"
                              value={vacatedDate}
                              onChange={(e) => setVacatedDate(e.target.value)}
                            />
                          </div>
                          <div className="flex gap-2">
                            <Button size="sm" onClick={() => handleVacateSite(site.site_id)}>
                              Confirm Vacate
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => { setVacatingSite(null); setVacatedDate(""); }}>
                              Cancel
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1">
                            <div className="font-medium">
                              {site.site_name ?? ""}
                              {site.is_registered_office && (
                                <span className="ml-2 rounded-full bg-primary px-2 py-0.5 text-xs text-primary-foreground">
                                  Registered Office
                                </span>
                              )}
                            </div>
                            {site.location && (
                              <div className="text-muted-foreground">{site.location}</div>
                            )}
                          </div>
                          <div className="flex gap-1">
                            <Button 
                              size="sm" 
                              variant="outline"
                              onClick={() => startEditSite(site)}
                            >
                              Edit
                            </Button>
                            <Button 
                              size="sm" 
                              variant="destructive"
                              onClick={() => { setVacatingSite(site.site_id); setVacatedDate(""); }}
                            >
                              Vacate
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Vacated Sites ({vacatedSites.length})</CardTitle>
            </CardHeader>
            <CardContent>
              {vacatedSites.length === 0 ? (
                <div className="text-sm text-muted-foreground">No vacated sites.</div>
              ) : (
                <div className="space-y-2">
                  {vacatedSites.map((site) => (
                    <div key={site.site_id} className="rounded-md border px-3 py-2 text-sm bg-muted/50">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1">
                          <div className="font-medium">
                            {site.site_name ?? ""}
                            {site.is_registered_office && (
                              <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-xs">
                                Registered Office
                              </span>
                            )}
                          </div>
                          {site.location && (
                            <div className="text-muted-foreground">{site.location}</div>
                          )}
                          {site.vacated_date && (
                            <div className="text-sm text-muted-foreground mt-1">
                              Vacated: {new Date(site.vacated_date).toLocaleDateString('en-GB')}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
