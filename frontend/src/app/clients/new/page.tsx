"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import ClientLogoUpload from "@/components/ClientLogoUpload";
import PageHeader from "@/components/PageHeader";
import SearchableStringSelect from "@/components/SearchableStringSelect";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { STANDARD_COUNTRIES } from "@/lib/countries";
import { withAuditHeaders } from "@/lib/auth-client";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

function apiBaseUrl(): string {
  return "/api/backend";
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

type CurrencyOption = {
  currency_code: string;
  currency_name: string;
  symbol: string;
  is_default?: boolean;
};

type LookupRow = {
  name?: string | null;
  email?: string | null;
  full_name?: string | null;
  currency_code?: string | null;
  currency_name?: string | null;
  symbol?: string | null;
  is_default?: boolean | null;
};

type LookupResponse = {
  items?: LookupRow[];
};

export default function NewClientPage() {
  const baseUrl = useMemo(() => apiBaseUrl(), []);
  const router = useRouter();

  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const [portfolios, setPortfolios] = useState<string[]>([]);
  const [industries, setIndustries] = useState<string[]>([]);
  const [users, setUsers] = useState<Array<{ email: string; full_name: string }>>(
    []
  );
  const [currencies, setCurrencies] = useState<CurrencyOption[]>([]);

  // Basic Info
  const [clientName, setClientName] = useState("");
  const [industry, setIndustry] = useState("");
  const [website, setWebsite] = useState("");
  const [companyReg, setCompanyReg] = useState("");
  const [sicCode, setSicCode] = useState("");
  const [headquarters, setHeadquarters] = useState("");
  const [yearEndMonth, setYearEndMonth] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [description, setDescription] = useState("");
  const [portfolio, setPortfolio] = useState("NZI");
  const [crmOwner, setCrmOwner] = useState("");
  const [currency, setCurrency] = useState("GBP");

  // Address
  const [addrLine1, setAddrLine1] = useState("");
  const [addrLine2, setAddrLine2] = useState("");
  const [city, setCity] = useState("");
  const [region, setRegion] = useState("");
  const [postcode, setPostcode] = useState("");
  const [country, setCountry] = useState("");
  const [billingSameAsMain, setBillingSameAsMain] = useState(true);
  const [billingCompany, setBillingCompany] = useState("");
  const [billingCompanyTouched, setBillingCompanyTouched] = useState(false);
  const [billingAddrLine1, setBillingAddrLine1] = useState("");
  const [billingAddrLine2, setBillingAddrLine2] = useState("");
  const [billingCity, setBillingCity] = useState("");
  const [billingRegion, setBillingRegion] = useState("");
  const [billingPostcode, setBillingPostcode] = useState("");
  const [billingCountry, setBillingCountry] = useState("");
  const [countryMenuOpen, setCountryMenuOpen] = useState(false);
  const [countrySearchStarted, setCountrySearchStarted] = useState(false);
  const [billingCountryMenuOpen, setBillingCountryMenuOpen] = useState(false);
  const [billingCountrySearchStarted, setBillingCountrySearchStarted] =
    useState(false);

  // Targets
  const [netZeroYear, setNetZeroYear] = useState("2050");
  const [benchmarkYear, setBenchmarkYear] = useState("");
  const [benchmarkPeriodStart, setBenchmarkPeriodStart] = useState("");
  const [benchmarkPeriodEnd, setBenchmarkPeriodEnd] = useState("");
  const [benchmarkScope1, setBenchmarkScope1] = useState("");
  const [benchmarkScope2, setBenchmarkScope2] = useState("");
  const [benchmarkScope3, setBenchmarkScope3] = useState("");
  const [benchmarkTotal, setBenchmarkTotal] = useState("");
  const [targetS1Year, setTargetS1Year] = useState("2035");
  const [targetS1Pct, setTargetS1Pct] = useState("50");
  const [targetS2Year, setTargetS2Year] = useState("2035");
  const [targetS2Pct, setTargetS2Pct] = useState("50");
  const [targetS3Year, setTargetS3Year] = useState("2035");
  const [targetS3Pct, setTargetS3Pct] = useState("50");
  const [createSiteFromAddress, setCreateSiteFromAddress] = useState(true);

  const [currentStep, setCurrentStep] = useState(1);
  const [maxStepVisited, setMaxStepVisited] = useState(1);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [showValidationSummary, setShowValidationSummary] = useState(false);

  const stepConfig = [
    {
      id: 1,
      title: "Company basics",
      description: "Core details, ownership, and contact info",
    },
    {
      id: 2,
      title: "Address & sites",
      description: "Registered office details and site creation",
    },
    {
      id: 3,
      title: "Targets & benchmark",
      description: "Net zero goals and reporting period",
    },
  ];

  type ClientRequiredField =
    | "clientName"
    | "portfolio"
    | "crmOwner"
    | "industry"
    | "yearEndMonth";

  const requiredFieldLabels: Record<ClientRequiredField, string> = {
    clientName: "Client name",
    portfolio: "Portfolio",
    crmOwner: "Client owner",
    industry: "Industry",
    yearEndMonth: "Financial year end",
  };

  const requiredFieldValues: Record<ClientRequiredField, string> = {
    clientName,
    portfolio,
    crmOwner,
    industry,
    yearEndMonth,
  };

  const stepOneFields: ClientRequiredField[] = [
    "clientName",
    "portfolio",
    "crmOwner",
    "industry",
    "yearEndMonth",
  ];

  const stepOneComplete = stepOneFields.every((field) =>
    Boolean(requiredFieldValues[field]?.trim())
  );

  const stepTwoComplete =
    [
      addrLine1,
      addrLine2,
      city,
      region,
      postcode,
      country,
      billingAddrLine1,
      billingAddrLine2,
      billingCity,
      billingRegion,
      billingPostcode,
      billingCountry,
    ].some((value) => value.trim().length > 0) || createSiteFromAddress;

  const stepThreeComplete =
    [netZeroYear, benchmarkYear, targetS1Year, targetS2Year, targetS3Year].some(
      (value) => value.trim().length > 0
    ) ||
    [targetS1Pct, targetS2Pct, targetS3Pct].some(
      (value) => value.trim().length > 0
    );

  const stepCompletion = [stepOneComplete, stepTwoComplete, stepThreeComplete];
  const validationCount = Object.keys(formErrors).length;
  const validationMessages = Object.values(formErrors);
  const filteredCountryOptions = useMemo(() => {
    const query = countrySearchStarted ? country.trim().toLowerCase() : "";
    const filtered = !query
      ? STANDARD_COUNTRIES
      : STANDARD_COUNTRIES.filter((option) =>
          option.toLowerCase().includes(query)
        );
    return filtered.slice(0, 100);
  }, [country, countrySearchStarted]);
  const filteredBillingCountryOptions = useMemo(() => {
    const query = billingCountrySearchStarted
      ? billingCountry.trim().toLowerCase()
      : "";
    const filtered = !query
      ? STANDARD_COUNTRIES
      : STANDARD_COUNTRIES.filter((option) =>
          option.toLowerCase().includes(query)
        );
    return filtered.slice(0, 100);
  }, [billingCountry, billingCountrySearchStarted]);

  useEffect(() => {
    if (!billingCompanyTouched) {
      setBillingCompany(clientName);
    }
  }, [clientName, billingCompanyTouched]);

  function clearFieldError(field: ClientRequiredField) {
    if (!formErrors[field]) return;
    setFormErrors((prev) => {
      const next = { ...prev };
      delete next[field];
      return next;
    });
  }

  function validateClientFields(fields: ClientRequiredField[]) {
    const nextErrors: Record<string, string> = {};
    fields.forEach((field) => {
      if (!requiredFieldValues[field]?.trim()) {
        nextErrors[field] = `${requiredFieldLabels[field]} is required.`;
      }
    });

    setFormErrors((prev) => {
      const updated = { ...prev };
      fields.forEach((field) => {
        delete updated[field];
      });
      return { ...updated, ...nextErrors };
    });

    return nextErrors;
  }

  function handleStepChange(stepId: number) {
    if (stepId > maxStepVisited) return;
    setCurrentStep(stepId);
    setShowValidationSummary(false);
  }

  function handleNextStep() {
    if (currentStep === 1) {
      const errors = validateClientFields(stepOneFields);
      if (Object.keys(errors).length > 0) {
        setShowValidationSummary(true);
        return;
      }
    }

    const nextStep = Math.min(currentStep + 1, stepConfig.length);
    setCurrentStep(nextStep);
    setMaxStepVisited((prev) => Math.max(prev, nextStep));
    setShowValidationSummary(false);
  }

  function handlePreviousStep() {
    setCurrentStep((prev) => Math.max(1, prev - 1));
    setShowValidationSummary(false);
  }

  useEffect(() => {
    loadLookups();
  }, [baseUrl]);

  async function loadLookups() {
    try {
      const [portfoliosRes, industriesRes, usersRes, currenciesRes] = await Promise.all([
        fetch(`${baseUrl}/admin/lookups/portfolios_lookup`),
        fetch(`${baseUrl}/admin/lookups/industries_lookup`),
        fetch(`${baseUrl}/admin/users`),
        fetch(`${baseUrl}/admin/lookups/currency_lookup`),
      ]);

      if (portfoliosRes.ok) {
        const data = (await portfoliosRes.json()) as LookupResponse;
        const portfolioList =
          data.items?.map((item) => item.name).filter((item): item is string => Boolean(item)) || [];
        setPortfolios(Array.from(new Set(portfolioList)) as string[]);
      }

      if (industriesRes.ok) {
        const data = (await industriesRes.json()) as LookupResponse;
        const industryList =
          data.items?.map((item) => item.name).filter((item): item is string => Boolean(item)) || [];
        setIndustries(
          Array.from(new Set(industryList))
            .map((value) => String(value))
            .sort((a, b) => a.localeCompare(b))
        );
      }

      if (usersRes.ok) {
        const data = (await usersRes.json()) as LookupResponse;
        const userList = (data.items || [])
          .map((u) => ({
            email: String(u.email || ""),
            full_name: String(u.full_name || ""),
          }))
          .filter((u) => u.email || u.full_name);
        // Deduplicate by email
        const uniqueUsers = Array.from(
          new Map(
            userList.map((u) => [u.email || u.full_name, u] as const)
          ).values()
        ) as Array<{ email: string; full_name: string }>;
        setUsers(uniqueUsers);
      }

      if (currenciesRes.ok) {
        const data = (await currenciesRes.json()) as LookupResponse;
        const currencyItems = Array.isArray(data.items) ? data.items : [];
        const lookupCurrencies = currencyItems
          .map((row) => ({
            currency_code: String(row.currency_code || "").toUpperCase(),
            currency_name: String(row.currency_name || ""),
            symbol: String(row.symbol || ""),
            is_default: Boolean(row.is_default),
          }))
          .filter((row: CurrencyOption) => row.currency_code);
        setCurrencies(lookupCurrencies);
        const defaultCurrency =
          lookupCurrencies.find((row: CurrencyOption) => row.is_default)?.currency_code ||
          lookupCurrencies[0]?.currency_code;
        if (defaultCurrency) setCurrency(defaultCurrency);
      }
    } catch (e) {
      console.error("Failed to load lookups:", e);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    // Guard against early form submission on Step 1/2 (e.g. Enter key).
    if (currentStep < stepConfig.length) {
      handleNextStep();
      return;
    }

    if (saving) return;

    const errors = validateClientFields(stepOneFields);
    if (Object.keys(errors).length > 0) {
      setShowValidationSummary(true);
      setCurrentStep(1);
      return;
    }

    setSaving(true);
    setStatus("Creating client...");

      try {
        const res = await fetch(`${baseUrl}/clients`, {
          method: "POST",
          headers: withAuditHeaders(
            { "Content-Type": "application/json" },
            { page: "Clients", section: "Basic Information", container: "Create Client" }
          ),
          body: JSON.stringify({
            client_name: clientName.trim(),
            billing_company: billingCompany.trim() || clientName.trim() || null,
            industry: industry || null,
            description_long: description || null,
            website: website || null,
            year_end_month: yearEndMonth || null,
            company_reg: companyReg || null,
            sic_code: sicCode || null,
            headquarters: headquarters || null,
            addr_line1: addrLine1 || null,
            addr_line2: addrLine2 || null,
            addr_city: city || null,
            addr_region: region || null,
            addr_postcode: postcode || null,
            addr_country: country || null,
            billing_same_as_main: billingSameAsMain,
            billing_addr_line1: billingAddrLine1 || null,
            billing_addr_line2: billingAddrLine2 || null,
            billing_addr_city: billingCity || null,
            billing_addr_region: billingRegion || null,
            billing_addr_postcode: billingPostcode || null,
            billing_addr_country: billingCountry || null,
            logo_url: logoUrl || null,
            portfolio: portfolio || null,
            crm_owner: crmOwner || null,
            currency: (currency || "GBP").toUpperCase(),
            status: "Active",
            create_site_from_address: createSiteFromAddress,
            net_zero_year: netZeroYear ? Number(netZeroYear) : null,
            benchmark_year: benchmarkYear ? Number(benchmarkYear) : null,
            benchmark_scope_1_tco2e: benchmarkScope1 ? Number(benchmarkScope1) : null,
            benchmark_scope_2_tco2e: benchmarkScope2 ? Number(benchmarkScope2) : null,
            benchmark_scope_3_tco2e: benchmarkScope3 ? Number(benchmarkScope3) : null,
            benchmark_total_tco2e: benchmarkTotal ? Number(benchmarkTotal) : null,
            benchmark_period_start: benchmarkPeriodStart || null,
            benchmark_period_end: benchmarkPeriodEnd || null,
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
      <div className="mx-auto w-full max-w-7xl px-6 py-10">
        <PageHeader
          title="New Client"
          subtitle="Create a new client profile"
          breadcrumbs={[
            { label: "Clients", href: "/clients" },
            { label: "New Client" },
          ]}
          actions={
            <Button variant="secondary" asChild>
              <Link href="/clients">Cancel</Link>
            </Button>
          }
        />

        {status && (
          <div className="mb-4 rounded-md bg-muted p-3 text-sm">{status}</div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="rounded-md border bg-card p-4">
            <div className="grid gap-3 md:grid-cols-3">
              {stepConfig.map((step, index) => {
                const isActive = currentStep === step.id;
                const isComplete = stepCompletion[index];
                return (
                  <button
                    key={step.id}
                    type="button"
                    onClick={() => handleStepChange(step.id)}
                    disabled={step.id > maxStepVisited}
                    className={`rounded-md border px-4 py-3 text-left transition ${
                      isActive
                        ? "border-primary bg-muted/60"
                        : "border-transparent hover:border-muted"
                    } ${step.id > maxStepVisited ? "cursor-not-allowed opacity-60" : ""}`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Step {step.id}
                      </span>
                      {isComplete && <Badge variant="secondary">Completed ✓</Badge>}
                    </div>
                    <div className="mt-2 text-base font-semibold">{step.title}</div>
                    <div className="text-xs text-muted-foreground">
                      {step.description}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {showValidationSummary && validationCount > 0 && (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
              <div className="font-semibold">
                Fix these {validationCount}{" "}
                {validationCount === 1 ? "field" : "fields"}
              </div>
              <ul className="mt-2 list-disc pl-4">
                {validationMessages.map((message, index) => (
                  <li key={`validation-${index}`}>{message}</li>
                ))}
              </ul>
            </div>
          )}

          {currentStep === 1 && (
            <Card>
              <CardHeader>
                <CardTitle>Company basics</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 md:grid-cols-3">
                  <div className="space-y-2">
                    <Label htmlFor="clientName">Client Name *</Label>
                    <Input
                      id="clientName"
                      value={clientName}
                      onChange={(e) => {
                        setClientName(e.target.value);
                        clearFieldError("clientName");
                      }}
                      placeholder="Company Ltd"
                      aria-invalid={!!formErrors.clientName}
                    />
                    {formErrors.clientName && (
                      <p className="text-xs text-destructive">
                        {formErrors.clientName}
                      </p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="portfolio">Portfolio *</Label>
                    <Select
                      value={portfolio}
                      onValueChange={(value) => {
                        setPortfolio(value);
                        clearFieldError("portfolio");
                      }}
                    >
                      <SelectTrigger
                        id="portfolio"
                        aria-invalid={!!formErrors.portfolio}
                        className={formErrors.portfolio ? "border-destructive" : ""}
                      >
                        <SelectValue placeholder="Select portfolio..." />
                      </SelectTrigger>
                      <SelectContent>
                        {portfolios.map((p, idx) => (
                          <SelectItem key={`portfolio-${idx}`} value={p}>
                            {p}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {formErrors.portfolio && (
                      <p className="text-xs text-destructive">
                        {formErrors.portfolio}
                      </p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="crmOwner">Client Owner *</Label>
                    <Select
                      value={crmOwner}
                      onValueChange={(value) => {
                        setCrmOwner(value);
                        clearFieldError("crmOwner");
                      }}
                    >
                      <SelectTrigger
                        id="crmOwner"
                        aria-invalid={!!formErrors.crmOwner}
                        className={formErrors.crmOwner ? "border-destructive" : ""}
                      >
                        <SelectValue placeholder="Select client owner..." />
                      </SelectTrigger>
                      <SelectContent>
                        {users.map((u, idx) => (
                          <SelectItem
                            key={u.email || `user-${idx}`}
                            value={u.full_name || u.email}
                          >
                            {u.full_name || u.email}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {formErrors.crmOwner && (
                      <p className="text-xs text-destructive">
                        {formErrors.crmOwner}
                      </p>
                    )}
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-4">
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
                    <Label htmlFor="industry">Industry *</Label>
                    <SearchableStringSelect
                      id="industry"
                      value={industry}
                      options={industries}
                      placeholder="Search industries..."
                      ariaInvalid={!!formErrors.industry}
                      className={formErrors.industry ? "border-destructive" : ""}
                      onValueChange={(value) => {
                        setIndustry(value);
                        clearFieldError("industry");
                      }}
                    />
                    {formErrors.industry && (
                      <p className="text-xs text-destructive">
                        {formErrors.industry}
                      </p>
                    )}
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
                          <SelectItem value="GBP">GBP (£)</SelectItem>
                        )}
                      </SelectContent>
                    </Select>
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
                    <Label htmlFor="yearEndMonth">Financial Year End *</Label>
                    <Select
                      value={yearEndMonth || undefined}
                      onValueChange={(value) => {
                        setYearEndMonth(value);
                        clearFieldError("yearEndMonth");
                      }}
                    >
                      <SelectTrigger
                        id="yearEndMonth"
                        aria-invalid={!!formErrors.yearEndMonth}
                        className={
                          formErrors.yearEndMonth ? "border-destructive" : ""
                        }
                      >
                        <SelectValue placeholder="Select month..." />
                      </SelectTrigger>
                      <SelectContent>
                        {MONTHS.map((m) => (
                          <SelectItem key={m} value={m}>
                            {m}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {formErrors.yearEndMonth && (
                      <p className="text-xs text-destructive">
                        {formErrors.yearEndMonth}
                      </p>
                    )}
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

                <ClientLogoUpload
                  baseUrl={baseUrl}
                  logoUrl={logoUrl}
                  onLogoUrlChange={setLogoUrl}
                />

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
          )}

          {currentStep === 2 && (
            <Card>
              <CardHeader>
                <CardTitle>Address & sites</CardTitle>
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
                    <div className="relative">
                      <Input
                        id="country"
                        value={country}
                        onChange={(e) => {
                          setCountry(e.target.value);
                          setCountrySearchStarted(true);
                          setCountryMenuOpen(true);
                        }}
                        onFocus={() => {
                          setCountrySearchStarted(false);
                          setCountryMenuOpen(true);
                        }}
                        onBlur={() => {
                          setTimeout(() => setCountryMenuOpen(false), 120);
                        }}
                        placeholder="Search country..."
                      />
                      {countryMenuOpen && (
                        <div className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-md border bg-background shadow-sm">
                          {filteredCountryOptions.length === 0 ? (
                            <div className="px-3 py-2 text-sm text-muted-foreground">
                              No countries found
                            </div>
                          ) : (
                            filteredCountryOptions.map((countryOption) => (
                              <button
                                key={countryOption}
                                type="button"
                                className="block w-full px-3 py-2 text-left text-sm hover:bg-muted"
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => {
                                  setCountry(countryOption);
                                  setCountrySearchStarted(false);
                                  setCountryMenuOpen(false);
                                }}
                              >
                                {countryOption}
                              </button>
                            ))
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center space-x-2 border-t pt-2">
                  <input
                    type="checkbox"
                    id="billingSameAsMain"
                    checked={billingSameAsMain}
                    onChange={(e) => setBillingSameAsMain(e.target.checked)}
                    className="h-4 w-4 rounded border-gray-300"
                  />
                  <Label
                    htmlFor="billingSameAsMain"
                    className="cursor-pointer font-normal"
                  >
                    Billing address same as main address
                  </Label>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="billingCompany">Billing Company</Label>
                  <Input
                    id="billingCompany"
                    value={billingCompany}
                    onChange={(e) => {
                      setBillingCompany(e.target.value);
                      setBillingCompanyTouched(true);
                    }}
                    placeholder={clientName || "Client name"}
                  />
                  <p className="text-xs text-muted-foreground">
                    Defaults to the client name, but you can override it for invoicing.
                  </p>
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
                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="billingCity">Billing City</Label>
                        <Input
                          id="billingCity"
                          value={billingCity}
                          onChange={(e) => setBillingCity(e.target.value)}
                          placeholder="London"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="billingRegion">Billing Region/State</Label>
                        <Input
                          id="billingRegion"
                          value={billingRegion}
                          onChange={(e) => setBillingRegion(e.target.value)}
                          placeholder="Greater London"
                        />
                      </div>
                    </div>
                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="billingPostcode">Billing Postcode/ZIP</Label>
                        <Input
                          id="billingPostcode"
                          value={billingPostcode}
                          onChange={(e) => setBillingPostcode(e.target.value)}
                          placeholder="SW1A 1AA"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="billingCountry">Billing Country</Label>
                        <div className="relative">
                          <Input
                            id="billingCountry"
                            value={billingCountry}
                            onChange={(e) => {
                              setBillingCountry(e.target.value);
                              setBillingCountrySearchStarted(true);
                              setBillingCountryMenuOpen(true);
                            }}
                            onFocus={() => {
                              setBillingCountrySearchStarted(false);
                              setBillingCountryMenuOpen(true);
                            }}
                            onBlur={() => {
                              setTimeout(
                                () => setBillingCountryMenuOpen(false),
                                120
                              );
                            }}
                            placeholder="Search country..."
                          />
                          {billingCountryMenuOpen && (
                            <div className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-md border bg-background shadow-sm">
                              {filteredBillingCountryOptions.length === 0 ? (
                                <div className="px-3 py-2 text-sm text-muted-foreground">
                                  No countries found
                                </div>
                              ) : (
                                filteredBillingCountryOptions.map((countryOption) => (
                                  <button
                                    key={`billing-${countryOption}`}
                                    type="button"
                                    className="block w-full px-3 py-2 text-left text-sm hover:bg-muted"
                                    onMouseDown={(e) => e.preventDefault()}
                                    onClick={() => {
                                      setBillingCountry(countryOption);
                                      setBillingCountrySearchStarted(false);
                                      setBillingCountryMenuOpen(false);
                                    }}
                                  >
                                    {countryOption}
                                  </button>
                                ))
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                <div className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    id="createSiteFromAddress"
                    checked={createSiteFromAddress}
                    onChange={(e) =>
                      setCreateSiteFromAddress(e.target.checked)
                    }
                    className="h-4 w-4 rounded border-gray-300"
                  />
                  <Label
                    htmlFor="createSiteFromAddress"
                    className="font-normal cursor-pointer"
                  >
                    Create site from this address (Registered Office)
                  </Label>
                </div>
              </CardContent>
            </Card>
          )}

          {currentStep === 3 && (
            <Card>
              <CardHeader>
                <CardTitle>Targets & benchmark</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Capture net zero goals and the baseline reporting period. These
                  values guide job reporting and target tracking.
                </p>
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
                      placeholder="e.g., 2024"
                    />
                    <p className="text-xs text-muted-foreground">
                      Use benchmark period dates below for new clients
                    </p>
                </div>
              </div>

              <div className="rounded-md border border-orange-200 bg-orange-50 p-4">
                <h4 className="font-semibold text-sm mb-3">
                    Benchmark Period (Financial Year)
                  </h4>
                  <p className="text-xs text-muted-foreground mb-3">
                    Define the benchmark reporting period. This should align with
                    the client&apos;s financial year. All subsequent annual jobs will
                    automatically follow this period structure.
                  </p>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="benchmarkPeriodStart">
                        Benchmark Period Start
                      </Label>
                      <Input
                        id="benchmarkPeriodStart"
                        type="date"
                        value={benchmarkPeriodStart}
                        onChange={(e) => setBenchmarkPeriodStart(e.target.value)}
                        placeholder="YYYY-MM-DD"
                      />
                      <p className="text-xs text-muted-foreground">e.g., 01/08/2022</p>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="benchmarkPeriodEnd">
                        Benchmark Period End
                      </Label>
                      <Input
                        id="benchmarkPeriodEnd"
                        type="date"
                        value={benchmarkPeriodEnd}
                        onChange={(e) => setBenchmarkPeriodEnd(e.target.value)}
                        placeholder="YYYY-MM-DD"
                      />
                      <p className="text-xs text-muted-foreground">e.g., 31/07/2023</p>
                  </div>
                </div>
              </div>

              <div className="rounded-md border bg-slate-50 p-4 space-y-4">
                <div>
                  <h4 className="font-semibold text-sm mb-1">
                    Historical Benchmark Emissions
                  </h4>
                  <p className="text-xs text-muted-foreground">
                    Capture the third-party benchmark as provided. We recommend
                    filling the scope values and the total so report comparisons
                    can use the client baseline directly.
                  </p>
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
                      placeholder="e.g., 123.4"
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
                      placeholder="e.g., 456.7"
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
                      placeholder="e.g., 789.0"
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
                      placeholder="e.g., 1369.1"
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
                    <div className="relative">
                      <Input
                        id="targetS1Pct"
                        type="number"
                        value={targetS1Pct}
                        onChange={(e) => setTargetS1Pct(e.target.value)}
                        min="0"
                        max="100"
                        className="pr-10"
                      />
                      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                        %
                      </span>
                    </div>
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
                    <div className="relative">
                      <Input
                        id="targetS2Pct"
                        type="number"
                        value={targetS2Pct}
                        onChange={(e) => setTargetS2Pct(e.target.value)}
                        min="0"
                        max="100"
                        className="pr-10"
                      />
                      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                        %
                      </span>
                    </div>
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
                    <div className="relative">
                      <Input
                        id="targetS3Pct"
                        type="number"
                        value={targetS3Pct}
                        onChange={(e) => setTargetS3Pct(e.target.value)}
                        min="0"
                        max="100"
                        className="pr-10"
                      />
                      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                        %
                      </span>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={handlePreviousStep}
              disabled={currentStep === 1}
            >
              Back
            </Button>
            <div className="flex items-center gap-2">
              <Button type="button" variant="secondary" asChild>
                <Link href="/clients">Cancel</Link>
              </Button>
              {currentStep < stepConfig.length ? (
                <Button type="button" onClick={handleNextStep}>
                  Next
                </Button>
              ) : (
                <Button type="submit" disabled={saving}>
                  {saving ? "Creating..." : "Create Client"}
                </Button>
              )}
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
