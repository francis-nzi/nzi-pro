"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
  headquarters: string | null;
  addr_line1: string | null;
  addr_line2: string | null;
  addr_city: string | null;
  addr_region: string | null;
  addr_postcode: string | null;
  addr_country: string | null;
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

  // Form fields
  const [clientName, setClientName] = useState<string>("");
  const [industry, setIndustry] = useState<string>("");
  const [descriptionLong, setDescriptionLong] = useState<string>("");
  const [website, setWebsite] = useState<string>("");
  const [yearEndMonth, setYearEndMonth] = useState<string>("");
  const [companyReg, setCompanyReg] = useState<string>("");
  const [headquarters, setHeadquarters] = useState<string>("");
  const [addrLine1, setAddrLine1] = useState<string>("");
  const [addrLine2, setAddrLine2] = useState<string>("");
  const [addrCity, setAddrCity] = useState<string>("");
  const [addrRegion, setAddrRegion] = useState<string>("");
  const [addrPostcode, setAddrPostcode] = useState<string>("");
  const [addrCountry, setAddrCountry] = useState<string>("");
  const [logoUrl, setLogoUrl] = useState<string>("");
  const [crmOwner, setCrmOwner] = useState<string>("");
  const [portfolio, setPortfolio] = useState<string>("NZI");
  const [clientStatus, setClientStatus] = useState<string>("Active");
  const [netZeroYear, setNetZeroYear] = useState<string>("2050");
  const [interimYear, setInterimYear] = useState<string>("2035");
  const [benchmarkYear, setBenchmarkYear] = useState<string>("");
  const [targetS1Year, setTargetS1Year] = useState<string>("2050");
  const [targetS1Pct, setTargetS1Pct] = useState<string>("90");
  const [targetS2Year, setTargetS2Year] = useState<string>("2050");
  const [targetS2Pct, setTargetS2Pct] = useState<string>("90");
  const [targetS3Year, setTargetS3Year] = useState<string>("2050");
  const [targetS3Pct, setTargetS3Pct] = useState<string>("90");

  useEffect(() => {
    loadLookups();
  }, [baseUrl]);

  async function loadLookups() {
    try {
      const [portfoliosRes, industriesRes, usersRes] = await Promise.all([
        fetch(`${baseUrl}/admin/lookups/portfolios_lookup`),
        fetch(`${baseUrl}/admin/lookups/industries_lookup`),
        fetch(`${baseUrl}/admin/users`)
      ]);

      if (portfoliosRes.ok) {
        const data = await portfoliosRes.json();
        const portfolioList = data.items?.map((i: any) => i.name).filter(Boolean) || [];
        setPortfolios(Array.from(new Set(portfolioList)) as string[]);
      }

      if (industriesRes.ok) {
        const data = await industriesRes.json();
        const industryList = data.items?.map((i: any) => i.name).filter(Boolean) || [];
        setIndustries(Array.from(new Set(industryList)) as string[]);
      }

      if (usersRes.ok) {
        const data = await usersRes.json();
        const userList = (data.items || []).filter((u: any) => u && (u.email || u.full_name));
        // Deduplicate by email
        const uniqueUsers = Array.from(
          new Map(userList.map((u: any) => [u.email || u.full_name, u])).values()
        ) as Array<{email: string, full_name: string}>;
        setUsers(uniqueUsers);
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
        setHeadquarters(json.headquarters || "");
        setAddrLine1(json.addr_line1 || "");
        setAddrLine2(json.addr_line2 || "");
        setAddrCity(json.addr_city || "");
        setAddrRegion(json.addr_region || "");
        setAddrPostcode(json.addr_postcode || "");
        setAddrCountry(json.addr_country || "");
        setLogoUrl(json.logo_url || "");
        setPortfolio(json.portfolio || "NZI");
        setCrmOwner(json.crm_owner || "");
        setClientStatus(json.status || "Active");
        setNetZeroYear(json.net_zero_year ? String(json.net_zero_year) : "2050");
        setInterimYear(json.interim_year ? String(json.interim_year) : "2035");
        setBenchmarkYear(json.benchmark_year ? String(json.benchmark_year) : "");
        setTargetS1Year(json.target_s1_year ? String(json.target_s1_year) : "2050");
        setTargetS1Pct(json.target_s1_pct ? String(json.target_s1_pct) : "90");
        setTargetS2Year(json.target_s2_year ? String(json.target_s2_year) : "2050");
        setTargetS2Pct(json.target_s2_pct ? String(json.target_s2_pct) : "90");
        setTargetS3Year(json.target_s3_year ? String(json.target_s3_year) : "2050");
        setTargetS3Pct(json.target_s3_pct ? String(json.target_s3_pct) : "90");
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

  async function saveClient() {
    if (!Number.isFinite(clientId) || clientId <= 0) return;

    setSaving(true);
    setStatus("Saving...");
    setError("");

    try {
      const res = await fetch(`${baseUrl}/clients/${clientId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          client_name: clientName || null,
          industry: industry || null,
          description_long: descriptionLong || null,
          website: website || null,
          year_end_month: yearEndMonth || null,
          company_reg: companyReg || null,
          headquarters: headquarters || null,
          addr_line1: addrLine1 || null,
          addr_line2: addrLine2 || null,
          addr_city: addrCity || null,
          addr_region: addrRegion || null,
          addr_postcode: addrPostcode || null,
          addr_country: addrCountry || null,
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
      <div className="mx-auto w-full max-w-5xl px-6 py-10">
        <div className="mb-6 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">Edit Client</h1>
            <div className="text-sm text-muted-foreground">{clientName || "Loading..."}</div>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" asChild>
              <Link href={`/clients/${clientId}`}>Cancel</Link>
            </Button>
            <Button onClick={saveClient} disabled={saving || loading}>
              Save Changes
            </Button>
          </div>
        </div>

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
                  <Label htmlFor="crmOwner">CRM Owner</Label>
                  <Select value={crmOwner} onValueChange={setCrmOwner}>
                    <SelectTrigger id="crmOwner">
                      <SelectValue placeholder="Select owner..." />
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
                  <Label htmlFor="benchmarkYear">Benchmark Year</Label>
                  <Input
                    id="benchmarkYear"
                    type="number"
                    value={benchmarkYear}
                    onChange={(e) => setBenchmarkYear(e.target.value)}
                    min="2000"
                    max="2100"
                    placeholder="e.g., 2024"
                  />
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
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
