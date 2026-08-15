"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { useCallback, useEffect, useMemo, useState } from "react";

import ClientLogoUpload from "@/components/ClientLogoUpload";
import PageHeader from "@/components/PageHeader";
import SearchableStringSelect from "@/components/SearchableStringSelect";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

function apiBaseUrl(): string {
  return "/api/backend";
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

const GROUP_STRUCTURE_OPTIONS = [
  "Standalone company",
  "Subsidiary (group reporting)",
  "Subsidiary (standalone reporting)",
  "Group parent / holding company",
];

const REPORTING_FRAMEWORK_OPTIONS = [
  "SECR (Streamlined Energy & Carbon Reporting)",
  "PPN 06/21",
  "GHG Protocol",
  "CDP",
  "TCFD",
  "SBTi",
  "ISO 14064",
  "ESOS",
  "CSRD",
  "Voluntary CRP",
];

const CERTIFICATION_OPTIONS = [
  "ISO 14001",
  "ISO 50001",
  "B Corp",
  "SBTi pledge",
  "RE100",
  "Race to Zero",
  "PAS 2060",
  "Carbon Neutral certified",
];

const SCOPE3_CATEGORY_OPTIONS = [
  "Cat 1: Purchased goods & services",
  "Cat 2: Capital goods",
  "Cat 3: Fuel & energy related",
  "Cat 4: Upstream transportation & distribution",
  "Cat 5: Waste in operations",
  "Cat 6: Business travel",
  "Cat 7: Employee commuting",
  "Cat 8: Upstream leased assets",
  "Cat 9: Downstream transportation & distribution",
  "Cat 10: Processing of sold products",
  "Cat 11: Use of sold products",
  "Cat 12: End-of-life treatment",
  "Cat 13: Downstream leased assets",
  "Cat 14: Franchises",
  "Cat 15: Investments",
];

function parseJsonArray(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
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
  data_frequency: string | null;
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
  billing_company: string | null;
  billing_addr_line1: string | null;
  billing_addr_line2: string | null;
  billing_addr_city: string | null;
  billing_addr_region: string | null;
  billing_addr_postcode: string | null;
  billing_addr_country: string | null;
  create_site_from_address?: boolean | null;
  logo_url: string | null;
  crm_owner: string | null;
  client_manager: string | null;
  status: string | null;
  net_zero_year: number | null;
  interim_year: number | null;
  interim_s1_pct: number | null;
  interim_s2_pct: number | null;
  interim_s3_pct: number | null;
  portfolio: string | null;
  benchmark_year: number | null;
  net_zero_target_reduction_pct: number | null;
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
  parent_company: string | null;
  group_structure: string | null;
  reporting_frameworks: string | null;
  certifications: string | null;
  primary_scope3_categories: string | null;
};

type Site = {
  site_id: number;
  site_name: string | null;
  location: string | null;
  is_registered_office: boolean;
  vacated_date?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  geocode_source?: string | null;
  geocode_precision?: string | null;
};

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

export default function EditClientPage() {
  const baseUrl = useMemo(() => apiBaseUrl(), []);
  const params = useParams<{ clientId: string }>();
  const router = useRouter();
  const clientId = Number(params?.clientId);

  const [, setClient] = useState<Client | null>(null);
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
  const [dataFrequency, setDataFrequency] = useState<string>("annual");
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
  const [billingCompany, setBillingCompany] = useState<string>("");
  const [billingAddrLine1, setBillingAddrLine1] = useState<string>("");
  const [billingAddrLine2, setBillingAddrLine2] = useState<string>("");
  const [billingAddrCity, setBillingAddrCity] = useState<string>("");
  const [billingAddrRegion, setBillingAddrRegion] = useState<string>("");
  const [billingAddrPostcode, setBillingAddrPostcode] = useState<string>("");
  const [billingAddrCountry, setBillingAddrCountry] = useState<string>("");
  const [logoUrl, setLogoUrl] = useState<string>("");
  const [crmOwner, setCrmOwner] = useState<string>("");
  const [clientManager, setClientManager] = useState<string>("");
  const [portfolio, setPortfolio] = useState<string>("NZI");
  const [clientStatus, setClientStatus] = useState<string>("Active");
  const [netZeroYear, setNetZeroYear] = useState<string>("2050");
  const [interimYear, setInterimYear] = useState<string>("2035");
  const [netZeroTargetReductionPct, setNetZeroTargetReductionPct] = useState<string>("90");
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
  const [parentCompany, setParentCompany] = useState<string>("");
  const [groupStructure, setGroupStructure] = useState<string>("");
  const [reportingFrameworks, setReportingFrameworks] = useState<string[]>([]);
  const [certifications, setCertifications] = useState<string[]>([]);
  const [primaryScope3Categories, setPrimaryScope3Categories] = useState<string[]>([]);
  
  // Site management state
  const [activeSites, setActiveSites] = useState<Site[]>([]);
  const [vacatedSites, setVacatedSites] = useState<Site[]>([]);
  const [showAddSite, setShowAddSite] = useState<boolean>(false);
  const [editingSite, setEditingSite] = useState<number | null>(null);
  const [vacatingSite, setVacatingSite] = useState<number | null>(null);
  const [vacatedDate, setVacatedDate] = useState<string>("");
  const [geocoding, setGeocoding] = useState<boolean>(false);
  const [siteForm, setSiteForm] = useState({
    site_name: "",
    location: "",
    is_registered_office: false,
    latitude: "",
    longitude: "",
  });

  const loadSites = useCallback(async () => {
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
      console.error("Failed to load sites:", e);
    }
  }, [baseUrl, clientId]);

  const loadLookups = useCallback(async () => {
    try {
      const lookupInit = { credentials: "include", cache: "no-store" } as RequestInit;
      const [portfoliosRes, industriesRes, usersRes, currenciesRes] = await Promise.allSettled([
        fetchJsonWithTimeout(`${baseUrl}/admin/lookups/portfolios_lookup`, lookupInit, 10000, "Portfolio lookup"),
        fetchJsonWithTimeout(`${baseUrl}/admin/lookups/industries_lookup`, lookupInit, 10000, "Industry lookup"),
        fetchJsonWithTimeout(`${baseUrl}/admin/users`, lookupInit, 10000, "User lookup"),
        fetchJsonWithTimeout(`${baseUrl}/admin/lookups/currency_lookup`, lookupInit, 10000, "Currency lookup"),
      ]);

      if (portfoliosRes.status === "fulfilled" && portfoliosRes.value.ok) {
        const data = (await portfoliosRes.value.json()) as LookupResponse;
        const portfolioList =
          data.items?.map((item) => item.name).filter((item): item is string => Boolean(item)) || [];
        setPortfolios(Array.from(new Set(portfolioList)) as string[]);
      }

      if (industriesRes.status === "fulfilled" && industriesRes.value.ok) {
        const data = (await industriesRes.value.json()) as LookupResponse;
        const industryList =
          data.items?.map((item) => item.name).filter((item): item is string => Boolean(item)) || [];
        setIndustries(
          Array.from(new Set(industryList))
            .map((value) => String(value))
            .sort((a, b) => a.localeCompare(b))
        );
      }

      if (usersRes.status === "fulfilled" && usersRes.value.ok) {
        const data = (await usersRes.value.json()) as LookupResponse;
        const userList = (data.items || [])
          .map((u) => ({
            email: String(u.email || ""),
            full_name: String(u.full_name || ""),
          }))
          .filter((u) => u.email || u.full_name);
        const uniqueUsers = Array.from(
          new Map(userList.map((u) => [u.email || u.full_name, u] as const)).values()
        ) as Array<{ email: string; full_name: string }>;
        setUsers(uniqueUsers);
      }

      if (currenciesRes.status === "fulfilled" && currenciesRes.value.ok) {
        const data = (await currenciesRes.value.json()) as LookupResponse;
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
      }
    } catch (e) {
      console.error("Failed to load lookups:", e);
    }
  }, [baseUrl]);

  useEffect(() => {
    loadLookups();
    loadSites();
  }, [loadLookups, loadSites]);

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
        setDataFrequency(json.data_frequency || "annual");
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
        setBillingCompany(json.billing_company || json.client_name || "");
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
        setClientManager(json.client_manager || "");
        setClientStatus(json.status || "Active");
        setNetZeroYear(json.net_zero_year ? String(json.net_zero_year) : "2050");
        setInterimYear(json.interim_year ? String(json.interim_year) : "2035");
        setNetZeroTargetReductionPct(
          json.net_zero_target_reduction_pct ? String(json.net_zero_target_reduction_pct) : "90"
        );
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
        setParentCompany(json.parent_company || "");
        setGroupStructure(json.group_structure || "");
        setReportingFrameworks(parseJsonArray(json.reporting_frameworks));
        setCertifications(parseJsonArray(json.certifications));
        setPrimaryScope3Categories(parseJsonArray(json.primary_scope3_categories));
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

  function siteFormPayload() {
    const { latitude, longitude, ...rest } = siteForm;
    const payload: Record<string, unknown> = { ...rest };
    if (latitude.trim()) payload.latitude = Number(latitude);
    if (longitude.trim()) payload.longitude = Number(longitude);
    return payload;
  }

  async function handleAddSite() {
    try {
      const res = await fetch(`${baseUrl}/clients/${clientId}/sites`, {
        method: "POST",
        headers: withAuditHeaders(
          { "Content-Type": "application/json" },
          { page: "Clients", section: "Sites", container: "Add Site" }
        ),
        body: JSON.stringify(siteFormPayload()),
      });

      if (!res.ok) throw new Error("Failed to add site");

      await loadSites();
      setSiteForm({ site_name: "", location: "", is_registered_office: false, latitude: "", longitude: "" });
      setShowAddSite(false);
      toast.success("Site added");
    } catch (e) {
      toast.error((e as Error).message);
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
        body: JSON.stringify(siteFormPayload()),
      });

      if (!res.ok) throw new Error("Failed to update site");

      await loadSites();
      setSiteForm({ site_name: "", location: "", is_registered_office: false, latitude: "", longitude: "" });
      setEditingSite(null);
      toast.success("Site updated");
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function handleGeocodeSites() {
    setGeocoding(true);
    try {
      const res = await fetch(`${baseUrl}/clients/${clientId}/sites/geocode`, {
        method: "POST",
        headers: withAuditHeaders({}, { page: "Clients", section: "Sites", container: "Geocode Sites" }),
      });
      if (!res.ok) throw new Error("Failed to geocode sites");
      const data = await res.json() as {
        attempted: number;
        geocoded: number;
        skipped: number;
        failure_counts?: Record<string, number>;
      };
      await loadSites();
      if (data.attempted === 0) {
        toast.success("All sites already have coordinates");
      } else if (data.geocoded === 0) {
        const serviceProblem = (data.failure_counts?.service_unavailable ?? 0) > 0;
        toast.warning(serviceProblem
          ? "The geocoding service is temporarily unavailable. Please try again later."
          : `Could not resolve ${data.attempted} active site(s). You can enter coordinates manually.`);
      } else if (data.skipped > 0) {
        toast.warning(`Geocoded ${data.geocoded} of ${data.attempted} active site(s); ${data.skipped} could not be resolved`);
      } else {
        toast.success(`Geocoded all ${data.geocoded} active site(s)`);
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setGeocoding(false);
    }
  }

  async function handleVacateSite(siteId: number) {
    if (!vacatedDate) {
      toast.warning("Please select a vacated date");
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
      toast.success("Site marked as vacated");
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  function startEditSite(site: Site) {
    setSiteForm({
      site_name: site.site_name ?? "",
      location: site.location ?? "",
      is_registered_office: site.is_registered_office,
      latitude: site.latitude != null ? String(site.latitude) : "",
      longitude: site.longitude != null ? String(site.longitude) : "",
    });
    setEditingSite(site.site_id);
    setShowAddSite(false);
  }

  function cancelSiteEdit() {
    setSiteForm({ site_name: "", location: "", is_registered_office: false, latitude: "", longitude: "" });
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
          billing_company: billingCompany || clientName || null,
          industry: industry || null,
          description_long: descriptionLong || null,
          website: website || null,
          year_end_month: yearEndMonth || null,
          data_frequency: dataFrequency || "annual",
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
          client_manager: clientManager || null,
          status: clientStatus || null,
          net_zero_year: netZeroYear ? Number(netZeroYear) : null,
          interim_year: interimYear ? Number(interimYear) : null,
          net_zero_target_reduction_pct: netZeroTargetReductionPct ? Number(netZeroTargetReductionPct) : null,
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
          parent_company: parentCompany || null,
          group_structure: groupStructure || null,
          reporting_frameworks: reportingFrameworks.length > 0 ? JSON.stringify(reportingFrameworks) : null,
          certifications: certifications.length > 0 ? JSON.stringify(certifications) : null,
          primary_scope3_categories: primaryScope3Categories.length > 0 ? JSON.stringify(primaryScope3Categories) : null,
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
                {saving ? "Saving…" : "Save All"}
              </Button>
            </>
          }
        />

        {error ? <div className="mb-4 text-sm text-destructive">{error}</div> : null}
        {status ? <div className="mb-4 text-sm text-muted-foreground">{status}</div> : null}
        {loading ? <div className="mb-4 text-sm text-muted-foreground">Loading…</div> : null}

        <Tabs defaultValue="details" className="mt-2">
          <TabsList className="mb-6 flex-wrap h-auto gap-1">
            <TabsTrigger value="details">Details</TabsTrigger>
            <TabsTrigger value="targets">Targets</TabsTrigger>
            <TabsTrigger value="address">Address</TabsTrigger>
            <TabsTrigger value="sites">
              Sites {activeSites.length > 0 ? `(${activeSites.length})` : ""}
            </TabsTrigger>
            <TabsTrigger value="compliance">Compliance</TabsTrigger>
          </TabsList>

          {/* ── Details tab ── */}
          <TabsContent value="details">
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
                    <SearchableStringSelect
                      id="crmOwner"
                      value={crmOwner}
                      options={users.map((u) => u.full_name || u.email)}
                      placeholder="Search owners..."
                      onValueChange={setCrmOwner}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="clientManager">Client Manager</Label>
                    <SearchableStringSelect
                      id="clientManager"
                      value={clientManager}
                      options={users.map((u) => u.full_name || u.email)}
                      placeholder="Search managers..."
                      showClearButton
                      onValueChange={setClientManager}
                    />
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
                    <SearchableStringSelect
                      id="industry"
                      value={industry}
                      options={industries}
                      placeholder="Search industries..."
                      onValueChange={setIndustry}
                    />
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

                <div className="grid gap-4 md:grid-cols-4">
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
                    <Label htmlFor="dataFrequency">Data Reporting Frequency</Label>
                    <Select value={dataFrequency} onValueChange={setDataFrequency}>
                      <SelectTrigger id="dataFrequency">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="annual">Annual (default)</SelectItem>
                        <SelectItem value="monthly">Monthly</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      Controls which view opens first on the portal&apos;s Data Completeness tab. Monthly detail is always available as a drill-down either way.
                    </p>
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

                <div className="space-y-2">
                  <Label htmlFor="logoUrl">Logo URL</Label>
                  <Input
                    id="logoUrl"
                    value={logoUrl}
                    onChange={(e) => setLogoUrl(e.target.value)}
                    placeholder="https://..."
                  />
                </div>

                <ClientLogoUpload
                  baseUrl={baseUrl}
                  logoUrl={logoUrl}
                  onLogoUrlChange={setLogoUrl}
                  clientDbId={clientId}
                />

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
                      <SelectItem value="Portfolio Owner">Portfolio Owner</SelectItem>
                      <SelectItem value="Archived">Archived</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex justify-end pt-2">
                  <Button onClick={saveClient} disabled={saving || loading}>
                    {saving ? "Saving…" : "Save"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Targets tab ── */}
          <TabsContent value="targets">
            <Card>
              <CardHeader>
                <CardTitle>Net Zero Targets</CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="rounded-lg border bg-background/70 p-4">
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
                      <Label htmlFor="netZeroTargetReductionPct">Net Zero Target Reduction %</Label>
                      <Input
                        id="netZeroTargetReductionPct"
                        type="number"
                        value={netZeroTargetReductionPct}
                        onChange={(e) => setNetZeroTargetReductionPct(e.target.value)}
                        min="0"
                        max="100"
                        placeholder="90"
                      />
                      <p className="text-xs text-muted-foreground">Default 90% in line with Net Zero requirements.</p>
                    </div>
                  </div>
                </div>

                <div className="rounded-lg border border-orange-200 bg-orange-50 p-4 space-y-4">
                  <div>
                    <h3 className="font-semibold text-sm mb-1">Baseline Period (Financial Year)</h3>
                    <p className="text-xs text-muted-foreground">Define the benchmark reporting period. This should align with the client&apos;s financial year. All subsequent annual jobs will automatically follow this period structure.</p>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="benchmarkPeriodStart">Baseline Period Start</Label>
                      <Input
                        id="benchmarkPeriodStart"
                        type="date"
                        value={benchmarkPeriodStart}
                        onChange={(e) => setBenchmarkPeriodStart(e.target.value)}
                      />
                      <p className="text-xs text-muted-foreground">e.g. 01/08/2022</p>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="benchmarkPeriodEnd">Baseline Period End</Label>
                      <Input
                        id="benchmarkPeriodEnd"
                        type="date"
                        value={benchmarkPeriodEnd}
                        onChange={(e) => setBenchmarkPeriodEnd(e.target.value)}
                      />
                      <p className="text-xs text-muted-foreground">e.g. 31/07/2023</p>
                    </div>
                  </div>
                </div>

                <div className="rounded-lg border bg-slate-50 p-4 space-y-4">
                  <div>
                    <h3 className="font-semibold text-sm mb-1">Historical Baseline Emissions</h3>
                    <p className="text-xs text-muted-foreground">Capture third-party benchmark values for Scope 1, 2, 3 and total so reports can compare against the client&apos;s own baseline.</p>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="benchmarkScope1">Baseline Scope 1</Label>
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
                      <Label htmlFor="benchmarkScope2">Baseline Scope 2</Label>
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
                      <Label htmlFor="benchmarkScope3">Baseline Scope 3</Label>
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
                      <Label htmlFor="benchmarkTotal">Baseline Total</Label>
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

                <div className="rounded-lg border bg-background/70 p-4 space-y-4">
                  <div>
                    <h3 className="text-sm font-semibold">Interim Targets</h3>
                    <p className="text-xs text-muted-foreground">
                      Scope 1, 2 and 3 interim target years and reduction percentages.
                    </p>
                  </div>
                  <div className="grid gap-4 md:grid-cols-3">
                    <div className="space-y-2">
                      <Label htmlFor="targetS1Year">Scope 1 Interim Target Year</Label>
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
                      <Label htmlFor="targetS1Pct">Scope 1 Interim Reduction %</Label>
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
                      <Label htmlFor="targetS2Year">Scope 2 Interim Target Year</Label>
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
                      <Label htmlFor="targetS2Pct">Scope 2 Interim Reduction %</Label>
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
                      <Label htmlFor="targetS3Year">Scope 3 Interim Target Year</Label>
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
                      <Label htmlFor="targetS3Pct">Scope 3 Interim Reduction %</Label>
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
                </div>

                <div className="flex justify-end">
                  <Button onClick={saveClient} disabled={saving || loading}>
                    {saving ? "Saving…" : "Save"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Address tab ── */}
          <TabsContent value="address" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Registered / Trading Address</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  The client&apos;s primary registered or trading address. Can also be used to create a site.
                </p>
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

                <div className="flex items-center space-x-2 border-t pt-3">
                  <input
                    type="checkbox"
                    id="createSiteFromAddress"
                    checked={createSiteFromAddress}
                    onChange={(e) => setCreateSiteFromAddress(e.target.checked)}
                    className="h-4 w-4 rounded border-gray-300"
                  />
                  <Label htmlFor="createSiteFromAddress" className="font-normal cursor-pointer">
                    Create site from this registered address
                  </Label>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Billing Address</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Use this only if invoices should go to a different address.
                </p>

                <div className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    id="billingSameAsMain"
                    checked={billingSameAsMain}
                    onChange={(e) => setBillingSameAsMain(e.target.checked)}
                    className="h-4 w-4 rounded border-gray-300"
                  />
                  <Label htmlFor="billingSameAsMain" className="font-normal cursor-pointer">
                    Billing address same as registered address
                  </Label>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="billingCompany">Billing Company</Label>
                  <Input
                    id="billingCompany"
                    value={billingCompany}
                    onChange={(e) => setBillingCompany(e.target.value)}
                    placeholder={clientName || "Client name"}
                  />
                  <p className="text-xs text-muted-foreground">
                    Defaults to the client name, but you can override it for invoicing.
                  </p>
                </div>

                {!billingSameAsMain && (
                  <div className="space-y-4 rounded-md border bg-muted/30 p-4">
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
              </CardContent>
            </Card>

            <div className="flex justify-end">
              <Button onClick={saveClient} disabled={saving || loading}>
                {saving ? "Saving…" : "Save"}
              </Button>
            </div>
          </TabsContent>

          {/* ── Sites tab ── */}
          <TabsContent value="sites" className="space-y-6">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between gap-4">
                  <CardTitle>Active Sites ({activeSites.length})</CardTitle>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleGeocodeSites}
                      disabled={geocoding}
                      title="Look up coordinates for any active site without them yet, via OpenStreetMap"
                    >
                      {geocoding ? "Geocoding…" : "Geocode Sites"}
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => {
                        setShowAddSite(true);
                        setEditingSite(null);
                        setSiteForm({ site_name: "", location: "", is_registered_office: false, latitude: "", longitude: "" });
                      }}
                    >
                      + Add Site
                    </Button>
                  </div>
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
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-2">
                        <Label htmlFor="siteLatitude">Latitude (optional)</Label>
                        <Input
                          id="siteLatitude"
                          type="number"
                          step="any"
                          value={siteForm.latitude}
                          onChange={(e) => setSiteForm({ ...siteForm, latitude: e.target.value })}
                          placeholder="Leave blank to auto-geocode"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="siteLongitude">Longitude (optional)</Label>
                        <Input
                          id="siteLongitude"
                          type="number"
                          step="any"
                          value={siteForm.longitude}
                          onChange={(e) => setSiteForm({ ...siteForm, longitude: e.target.value })}
                          placeholder="Leave blank to auto-geocode"
                        />
                      </div>
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
                              {site.latitude != null && site.longitude != null ? (
                                <div className="mt-0.5 text-xs text-muted-foreground">
                                  {site.latitude.toFixed(4)}, {site.longitude.toFixed(4)}
                                  {site.geocode_source === "manual" ? " (manual)" : site.geocode_precision === "city" ? " (city-level)" : site.geocode_precision === "postcode" ? " (postcode-level)" : ""}
                                </div>
                              ) : (
                                <div className="mt-0.5 text-xs text-muted-foreground">Not geocoded yet</div>
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

            {vacatedSites.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>Vacated Sites ({vacatedSites.length})</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {vacatedSites.map((site) => (
                      <div key={site.site_id} className="rounded-md border px-3 py-2 text-sm bg-muted/50">
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
                              Vacated: {new Date(site.vacated_date).toLocaleDateString("en-GB")}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* ── Compliance tab ── */}
          <TabsContent value="compliance">
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Context &amp; Compliance</CardTitle>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Used by AI insights to generate more accurate and relevant outputs.
                  </p>
                </div>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="parentCompany">Parent company / group name</Label>
                    <Input
                      id="parentCompany"
                      value={parentCompany}
                      onChange={(e) => setParentCompany(e.target.value)}
                      placeholder="e.g. Acme Group plc"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="groupStructure">Group structure</Label>
                    <Select
                      value={groupStructure || "__none__"}
                      onValueChange={(v) => setGroupStructure(v === "__none__" ? "" : v)}
                    >
                      <SelectTrigger id="groupStructure">
                        <SelectValue placeholder="Select…" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">Not specified</SelectItem>
                        {GROUP_STRUCTURE_OPTIONS.map((opt) => (
                          <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Reporting obligations &amp; frameworks</Label>
                  <p className="text-xs text-muted-foreground">Select all that apply.</p>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {REPORTING_FRAMEWORK_OPTIONS.map((opt) => (
                      <label key={opt} className="flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-muted/40">
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border-gray-300"
                          checked={reportingFrameworks.includes(opt)}
                          onChange={(e) =>
                            setReportingFrameworks((prev) =>
                              e.target.checked ? [...prev, opt] : prev.filter((x) => x !== opt)
                            )
                          }
                        />
                        {opt}
                      </label>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Certifications &amp; commitments</Label>
                  <p className="text-xs text-muted-foreground">Select all that apply.</p>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {CERTIFICATION_OPTIONS.map((opt) => (
                      <label key={opt} className="flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-muted/40">
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border-gray-300"
                          checked={certifications.includes(opt)}
                          onChange={(e) =>
                            setCertifications((prev) =>
                              e.target.checked ? [...prev, opt] : prev.filter((x) => x !== opt)
                            )
                          }
                        />
                        {opt}
                      </label>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Primary Scope 3 categories</Label>
                  <p className="text-xs text-muted-foreground">Select the categories material to this client.</p>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {SCOPE3_CATEGORY_OPTIONS.map((opt) => (
                      <label key={opt} className="flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-muted/40">
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border-gray-300"
                          checked={primaryScope3Categories.includes(opt)}
                          onChange={(e) =>
                            setPrimaryScope3Categories((prev) =>
                              e.target.checked ? [...prev, opt] : prev.filter((x) => x !== opt)
                            )
                          }
                        />
                        {opt}
                      </label>
                    ))}
                  </div>
                </div>

                <div className="flex justify-end">
                  <Button onClick={saveClient} disabled={saving || loading}>
                    {saving ? "Saving…" : "Save"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
