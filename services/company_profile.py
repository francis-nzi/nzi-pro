from __future__ import annotations

from typing import Any


COMPANY_PROFILE_FIELDS: list[dict[str, str]] = [
    {
        "key": "company_display_name",
        "label": "Company Display Name",
        "default": "Net Zero International",
        "description": "Trading or display name used on documents and headers.",
    },
    {
        "key": "company_legal_name",
        "label": "Company Legal Name",
        "default": "Net Zero International Limited",
        "description": "Full registered legal entity name.",
    },
    {
        "key": "registered_address_line_1",
        "label": "Registered Address Line 1",
        "default": "167-169 Great Portland Street",
        "description": "Registered office address line 1.",
    },
    {
        "key": "registered_address_line_2",
        "label": "Registered Address Line 2",
        "default": "",
        "description": "Registered office address line 2.",
    },
    {
        "key": "registered_address_city",
        "label": "Registered Address City",
        "default": "London",
        "description": "Registered office city.",
    },
    {
        "key": "registered_address_region",
        "label": "Registered Address Region",
        "default": "",
        "description": "Registered office county, state, or region.",
    },
    {
        "key": "registered_address_postcode",
        "label": "Registered Address Postcode",
        "default": "W1W 9PF",
        "description": "Registered office postcode.",
    },
    {
        "key": "registered_address_country",
        "label": "Registered Address Country",
        "default": "United Kingdom",
        "description": "Registered office country.",
    },
    {
        "key": "website_url",
        "label": "Website URL",
        "default": "https://netzero.international",
        "description": "Primary company website for letters and footers.",
    },
    {
        "key": "contact_email",
        "label": "Contact Email",
        "default": "info@netzero.international",
        "description": "General contact email shown on company documents.",
    },
    {
        "key": "contact_phone",
        "label": "Contact Phone",
        "default": "",
        "description": "General contact phone number shown on company documents.",
    },
    {
        "key": "vat_number",
        "label": "VAT Number",
        "default": "",
        "description": "VAT registration number for invoices, quotes, and legal footers.",
    },
    {
        "key": "company_registration_number",
        "label": "Company Registration Number",
        "default": "",
        "description": "Registered company number for invoices, quotes, and legal footers.",
    },
    {
        "key": "bank_account_name",
        "label": "Bank Account Name",
        "default": "",
        "description": "Account holder name shown in invoice payment details.",
    },
    {
        "key": "bank_sort_code",
        "label": "Bank Sort Code",
        "default": "",
        "description": "Sort code shown in invoice payment details.",
    },
    {
        "key": "bank_account_number",
        "label": "Bank Account Number",
        "default": "",
        "description": "Account number shown in invoice payment details.",
    },
    {
        "key": "certificate_signatory_name",
        "label": "Certificate Signatory Name",
        "default": "David Hawes",
        "description": "Name shown on emissions certificates and other sign-off documents.",
    },
    {
        "key": "certificate_signatory_title",
        "label": "Certificate Signatory Title",
        "default": "Chief Executive Officer",
        "description": "Job title shown beneath the certificate signatory name.",
    },
]

COMPANY_PROFILE_DEFAULTS: dict[str, str] = {
    item["key"]: item["default"] for item in COMPANY_PROFILE_FIELDS
}


def company_profile_metadata() -> list[dict[str, str]]:
    return [dict(item) for item in COMPANY_PROFILE_FIELDS]


def get_company_profile(con) -> dict[str, str]:
    profile = dict(COMPANY_PROFILE_DEFAULTS)
    keys = list(profile.keys())
    if not keys:
        return profile

    placeholders = ", ".join(["%s"] * len(keys))
    rows = con.execute(
        f"""
        SELECT setting_key, setting_value
        FROM system_settings
        WHERE setting_key IN ({placeholders})
        """,
        keys,
    ).fetchall()
    for row in rows:
        key = str(row[0] or "").strip()
        if not key or key not in profile:
            continue
        profile[key] = str(row[1] or "").strip()
    return profile


def company_address_lines(profile: dict[str, Any]) -> list[str]:
    out: list[str] = []
    for key in (
        "registered_address_line_1",
        "registered_address_line_2",
        "registered_address_city",
        "registered_address_region",
        "registered_address_postcode",
        "registered_address_country",
    ):
        value = str(profile.get(key) or "").strip()
        if value:
            out.append(value)
    return out


def company_address_html(profile: dict[str, Any]) -> str:
    return "<br/>".join(company_address_lines(profile))


def company_address_text(profile: dict[str, Any]) -> str:
    return "\n".join(company_address_lines(profile))


def company_bank_details_lines(profile: dict[str, Any]) -> list[tuple[str, str]]:
    """(label, value) pairs for the account name/sort code/account number,
    only including whichever of the three are actually set."""
    out: list[tuple[str, str]] = []
    for key, label in (
        ("bank_account_name", "Account Name"),
        ("bank_sort_code", "Sort Code"),
        ("bank_account_number", "Account Number"),
    ):
        value = str(profile.get(key) or "").strip()
        if value:
            out.append((label, value))
    return out


def company_footer_parts(profile: dict[str, Any]) -> list[str]:
    parts: list[str] = []
    legal_name = str(profile.get("company_legal_name") or profile.get("company_display_name") or "").strip()
    if legal_name:
        parts.append(legal_name)

    website = str(profile.get("website_url") or "").strip()
    if website:
        parts.append(website)

    reg_no = str(profile.get("company_registration_number") or "").strip()
    if reg_no:
        parts.append(f"Company No: {reg_no}")

    vat_no = str(profile.get("vat_number") or "").strip()
    if vat_no:
        parts.append(f"VAT No: {vat_no}")

    return parts


def company_footer_text(profile: dict[str, Any]) -> str:
    return " | ".join(company_footer_parts(profile))
