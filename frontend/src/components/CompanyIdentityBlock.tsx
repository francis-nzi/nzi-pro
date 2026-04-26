"use client";

import { useEffect, useState } from "react";

type CompanyProfile = {
  company_display_name: string;
  company_legal_name: string;
  registered_address_line_1: string;
  registered_address_line_2: string;
  registered_address_city: string;
  registered_address_region: string;
  registered_address_postcode: string;
  registered_address_country: string;
  website_url: string;
  contact_email: string;
  contact_phone: string;
  vat_number: string;
  company_registration_number: string;
};

const defaultProfile: CompanyProfile = {
  company_display_name: "Net Zero International",
  company_legal_name: "Net Zero International Limited",
  registered_address_line_1: "167-169 Great Portland Street",
  registered_address_line_2: "",
  registered_address_city: "London",
  registered_address_region: "",
  registered_address_postcode: "W1W 9PF",
  registered_address_country: "United Kingdom",
  website_url: "https://netzero.international",
  contact_email: "info@netzero.international",
  contact_phone: "",
  vat_number: "",
  company_registration_number: "",
};

function addressLines(profile: CompanyProfile): string[] {
  return [
    profile.registered_address_line_1,
    profile.registered_address_line_2,
    profile.registered_address_city,
    profile.registered_address_region,
    profile.registered_address_postcode,
    profile.registered_address_country,
  ].filter((value) => String(value || "").trim().length > 0);
}

export function CompanyIdentityBlock({ baseUrl, logoClassName = "ml-auto mb-3 h-auto w-[220px] object-contain" }: { baseUrl: string; logoClassName?: string }) {
  const [profile, setProfile] = useState<CompanyProfile>(defaultProfile);
  const [logoFailed, setLogoFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function loadProfile() {
      try {
        const res = await fetch(`${baseUrl}/system-settings/profile`, { credentials: "include" });
        if (!res.ok) return;
        const payload = await res.json();
        if (cancelled) return;
        setProfile({ ...defaultProfile, ...(payload.profile || {}) });
      } catch {
        // keep defaults
      }
    }
    void loadProfile();
    return () => {
      cancelled = true;
    };
  }, [baseUrl]);

  return (
    <div className="text-right">
      {logoFailed ? (
        <div className="ml-auto mb-3 flex h-20 w-20 items-center justify-center rounded-2xl border bg-muted/40 text-sm font-semibold tracking-[0.2em] text-muted-foreground shadow-sm">
          NZI
        </div>
      ) : (
        <img
          src="/uploads/system/nzi-logo.png"
          alt={profile.company_display_name}
          className={logoClassName}
          onError={() => setLogoFailed(true)}
        />
      )}
      <div className="text-2xl">{profile.company_display_name}</div>
      <div className="mt-2 text-lg leading-8">
        {addressLines(profile).map((line) => (
          <div key={line}>{line}</div>
        ))}
      </div>
    </div>
  );
}

export function CompanyLegalFooter({ baseUrl, className = "text-xs text-muted-foreground" }: { baseUrl: string; className?: string }) {
  const [profile, setProfile] = useState<CompanyProfile>(defaultProfile);

  useEffect(() => {
    let cancelled = false;
    async function loadProfile() {
      try {
        const res = await fetch(`${baseUrl}/system-settings/profile`, { credentials: "include" });
        if (!res.ok) return;
        const payload = await res.json();
        if (cancelled) return;
        setProfile({ ...defaultProfile, ...(payload.profile || {}) });
      } catch {
        // keep defaults
      }
    }
    void loadProfile();
    return () => {
      cancelled = true;
    };
  }, [baseUrl]);

  const footerParts = [
    profile.company_legal_name,
    profile.website_url,
    profile.company_registration_number ? `Company No: ${profile.company_registration_number}` : "",
    profile.vat_number ? `VAT No: ${profile.vat_number}` : "",
  ].filter((value) => String(value || "").trim().length > 0);

  return <div className={className}>{footerParts.join(" | ")}</div>;
}
