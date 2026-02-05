"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
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
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

export default function NewClientPage() {
  const baseUrl = useMemo(() => apiBaseUrl(), []);
  const router = useRouter();
  
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const [portfolios, setPortfolios] = useState<string[]>([]);
  const [industries, setIndustries] = useState<string[]>([]);
  const [users, setUsers] = useState<Array<{email: string, full_name: string}>>([]);

  // Basic Info
  const [clientName, setClientName] = useState("");
  const [industry, setIndustry] = useState("");
  const [website, setWebsite] = useState("");
  const [companyReg, setCompanyReg] = useState("");
  const [headquarters, setHeadquarters] = useState("");
  const [yearEndMonth, setYearEndMonth] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [description, setDescription] = useState("");
  const [portfolio, setPortfolio] = useState("NZI");
  const [crmOwner, setCrmOwner] = useState("");

  // Address
  const [addrLine1, setAddrLine1] = useState("");
  const [addrLine2, setAddrLine2] = useState("");
  const [city, setCity] = useState("");
  const [region, setRegion] = useState("");
  const [postcode, setPostcode] = useState("");
  const [country, setCountry] = useState("");

  // Targets
  const [netZeroYear, setNetZeroYear] = useState("2050");
  const [benchmarkYear, setBenchmarkYear] = useState("");
  const [targetS1Year, setTargetS1Year] = useState("2050");
  const [targetS1Pct, setTargetS1Pct] = useState("90");
  const [targetS2Year, setTargetS2Year] = useState("2050");
  const [targetS2Pct, setTargetS2Pct] = useState("90");
  const [targetS3Year, setTargetS3Year] = useState("2050");
  const [targetS3Pct, setTargetS3Pct] = useState("90");

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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!clientName.trim()) {
      setStatus("Client name is required");
      return;
    }

    setSaving(true);
    setStatus("Creating client...");

    try {
      const res = await fetch(`${baseUrl}/clients`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_name: clientName.trim(),
          industry: industry || null,
          description_long: description || null,
          website: website || null,
          year_end_month: yearEndMonth || null,
          company_reg: companyReg || null,
          headquarters: headquarters || null,
          addr_line1: addrLine1 || null,
          addr_line2: addrLine2 || null,
          addr_city: city || null,
          addr_region: region || null,
          addr_postcode: postcode || null,
          addr_country: country || null,
          logo_url: logoUrl || null,
          portfolio: portfolio || null,
          crm_owner: crmOwner || null,
          status: "Active",
          net_zero_year: netZeroYear ? Number(netZeroYear) : null,
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
        const text = await res.text();
        throw new Error(`Failed to create client: ${res.status} - ${text}`);
      }

      const json = await res.json();
      setStatus("Client created successfully!");
      
      setTimeout(() => {
        router.push(`/clients/${json.client_db_id}`);
      }, 500);
    } catch (e) {
      setStatus(`Error: ${(e as Error).message}`);
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto w-full max-w-5xl px-6 py-10">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">New Client</h1>
            <p className="text-sm text-muted-foreground">Create a new client profile</p>
          </div>
          <Button variant="secondary" asChild>
            <Link href="/clients">Cancel</Link>
          </Button>
        </div>

        {status && (
          <div className="mb-4 rounded-md bg-muted p-3 text-sm">
            {status}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Basic Information */}
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
                    required
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
                      <SelectValue placeholder="Select month (optional)..." />
                    </SelectTrigger>
                    <SelectContent>
                      {MONTHS.map((m) => (
                        <SelectItem key={m} value={m}>{m}</SelectItem>
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
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Brief description of the company..."
                  rows={4}
                />
              </div>
            </CardContent>
          </Card>

          {/* Address */}
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
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="city">City</Label>
                  <Input
                    id="city"
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    placeholder="London"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="region">Region/State</Label>
                  <Input
                    id="region"
                    value={region}
                    onChange={(e) => setRegion(e.target.value)}
                    placeholder="Greater London"
                  />
                </div>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="postcode">Postcode/ZIP</Label>
                  <Input
                    id="postcode"
                    value={postcode}
                    onChange={(e) => setPostcode(e.target.value)}
                    placeholder="SW1A 1AA"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="country">Country</Label>
                  <Input
                    id="country"
                    value={country}
                    onChange={(e) => setCountry(e.target.value)}
                    placeholder="United Kingdom"
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Targets */}
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

          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" asChild>
              <Link href="/clients">Cancel</Link>
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Creating..." : "Create Client"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
