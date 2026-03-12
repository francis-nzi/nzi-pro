"""
WorkflowMax -> NZI Pro importer (schema-aware)

This version is aligned to the current NZI schema and supports:
- Trial import by selected client IDs/names or max client count
- Dry-run validation mode (default)
- Idempotent upsert behavior using a mapping table + natural keys
- Import of clients, contacts, and jobs (including related contacts/jobs)

Usage:
  python wfm_import/wfm_import_routine.py --dry-run --max-clients 3
  python wfm_import/wfm_import_routine.py --import --max-clients 3
  python wfm_import/wfm_import_routine.py --import --client-ids "<id1>,<id2>,<id3>"
  python wfm_import/wfm_import_routine.py --import --client-names "First Event,Client B,Client C"
  python wfm_import/wfm_import_routine.py --import --job-numbers "J000547"
"""

from __future__ import annotations

import argparse
import json
import logging
import re
import sys
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any

import pandas as pd

# Ensure project root is importable when running script directly.
PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from core.database import get_conn

WFM_DIR = Path(__file__).parent / "raw_data"
LOG_FILE = Path(__file__).parent / "wfm_import.log"
TEMPLATE_LOOKUP_FILE = Path(__file__).parent / "analysis" / "wfm_template_id_lookup.json"


def _setup_logger() -> logging.Logger:
    logger = logging.getLogger("wfm_import")
    logger.setLevel(logging.INFO)
    logger.handlers.clear()
    fmt = logging.Formatter("%(asctime)s - %(levelname)s - %(message)s")
    fh = logging.FileHandler(LOG_FILE, encoding="utf-8")
    fh.setFormatter(fmt)
    sh = logging.StreamHandler()
    sh.setFormatter(fmt)
    logger.addHandler(fh)
    logger.addHandler(sh)
    return logger


def _clean(value: Any) -> str:
    if value is None:
        return ""
    s = str(value).strip()
    # WFM export often stores values like ="123"
    if s.startswith('="') and s.endswith('"'):
        s = s[2:-1].strip()
    if s == '""':
        return ""
    return s


def _to_float(value: Any) -> float | None:
    s = _clean(value)
    if not s:
        return None
    s = re.sub(r"[^\d.\-]", "", s)
    if not s:
        return None
    try:
        return float(s.replace(",", ""))
    except Exception:
        return None


def _parse_date(value: Any) -> str | None:
    s = _clean(value)
    if not s:
        return None
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y"):
        try:
            return datetime.strptime(s, fmt).strftime("%Y-%m-%d")
        except Exception:
            continue
    return None


def _col(df: pd.DataFrame, name: str, default: str = "") -> pd.Series:
    if name in df.columns:
        return df[name]
    return pd.Series([default] * len(df))


def _read_csv(path: Path) -> pd.DataFrame:
    df = pd.read_csv(path, dtype=str, keep_default_na=False, na_filter=False)
    for c in df.columns:
        df[c] = df[c].map(_clean)
    return df


@dataclass
class ImportStats:
    clients_processed: int = 0
    clients_inserted: int = 0
    clients_updated: int = 0
    contacts_processed: int = 0
    contacts_inserted: int = 0
    contacts_updated: int = 0
    jobs_processed: int = 0
    jobs_inserted: int = 0
    jobs_updated: int = 0
    warnings: list[str] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)

WFM_JOB_FIELD_CANDIDATES: dict[str, list[str]] = {
    "report_from": ["Report From", "Reporting Period From"],
    "report_to": ["Report To", "Reporting Period To"],
    "scope_1_tco2e": ["Scope 1 (tCO2e)", "Scope 1 Emissions", "Scope 1"],
    "scope_2_tco2e": ["Scope 2 (tCO2e)", "Scope 2 Emissions", "Scope 2"],
    "scope_3_tco2e": ["Scope 3 (tCO2e)", "Scope 3 Emissions", "Scope 3"],
    "total_tco2e": ["Total Emissions (tCO2e)", "Total Emissions"],
    "employees": ["Number of Employees", "Employees"],
    "turnover": ["Turnover", "Annual Turnover"],
}

WFM_CLIENT_FIELD_CANDIDATES: dict[str, list[str]] = {
    "turnover": ["Turnover", "Annual Turnover"],
}


class WfmImporter:
    def __init__(
        self,
        dry_run: bool,
        max_clients: int | None,
        client_ids: list[str],
        client_names: list[str],
        job_numbers: list[str],
        mapping_overrides: dict[str, dict[str, list[str]]] | None,
        logger: logging.Logger,
    ):
        self.dry_run = dry_run
        self.max_clients = max_clients
        self.client_ids = {x.strip() for x in client_ids if x.strip()}
        self.client_names = {x.strip().lower() for x in client_names if x.strip()}
        self.job_numbers = {x.strip().lower() for x in job_numbers if x.strip()}
        self.mapping_overrides = mapping_overrides or {}
        self.log = logger
        self.stats = ImportStats()
        self.data: dict[str, pd.DataFrame] = {}
        self.selected_client_ids: set[str] = set()
        self.client_map: dict[str, int] = {}
        self.contact_map: dict[str, int] = {}
        self.staff_name_by_id: dict[str, str] = {}
        self.job_custom_values: dict[str, dict[str, str]] = {}
        self.client_custom_values: dict[str, dict[str, str]] = {}
        self.template_lookup_preferred: dict[str, str] = {}
        self.template_lookup_loaded: bool = False
        self._load_template_lookup()

    def _load_template_lookup(self) -> None:
        """Load template key -> preferred factor_original_id lookup if available."""
        try:
            if not TEMPLATE_LOOKUP_FILE.exists():
                self.log.warning("Template mapping lookup not found: %s", TEMPLATE_LOOKUP_FILE)
                return
            payload = json.loads(TEMPLATE_LOOKUP_FILE.read_text(encoding="utf-8"))
            preferred = payload.get("preferred_items") or {}
            if isinstance(preferred, dict):
                self.template_lookup_preferred = {
                    _clean(k).lower(): _clean(v) for k, v in preferred.items() if _clean(k) and _clean(v)
                }
                self.template_lookup_loaded = True
                self.log.info(
                    "Loaded WFM template lookup (%s keys) from %s",
                    len(self.template_lookup_preferred),
                    TEMPLATE_LOOKUP_FILE,
                )
        except Exception as e:
            self.log.warning("Failed to load template lookup: %s", e)

    @staticmethod
    def _template_lookup_key(
        *,
        section: str,
        activity: str,
        col_2: str = "",
        col_3: str = "",
        col_4: str = "",
        col_5: str = "",
        col_6: str = "",
        col_7: str = "",
    ) -> str:
        return "|".join(
            [
                _clean(section).lower(),
                _clean(activity).lower(),
                _clean(col_2).lower(),
                _clean(col_3).lower(),
                _clean(col_4).lower(),
                _clean(col_5).lower(),
                _clean(col_6).lower(),
                _clean(col_7).lower(),
            ]
        )

    def resolve_factor_original_id(
        self,
        *,
        section: str,
        activity: str,
        col_2: str = "",
        col_3: str = "",
        col_4: str = "",
        col_5: str = "",
        col_6: str = "",
        col_7: str = "",
    ) -> str | None:
        """Resolve factor original ID using template mapping dictionary.

        Use this for incoming WFM template-based rows that don't include IDs.
        """
        key = self._template_lookup_key(
            section=section,
            activity=activity,
            col_2=col_2,
            col_3=col_3,
            col_4=col_4,
            col_5=col_5,
            col_6=col_6,
            col_7=col_7,
        )
        return self.template_lookup_preferred.get(key)

    def _candidates(self, entity: str, target_field: str, default_candidates: list[str]) -> list[str]:
        entity_map = self.mapping_overrides.get(entity, {}) if isinstance(self.mapping_overrides, dict) else {}
        custom = entity_map.get(target_field, []) if isinstance(entity_map, dict) else []
        out: list[str] = []
        for val in [*custom, *default_candidates]:
            s = _clean(val)
            if s and s.lower() not in {x.lower() for x in out}:
                out.append(s)
        return out

    def load(self) -> None:
        files = [
            "clients.csv",
            "client_addresses.csv",
            "contacts.csv",
            "client_contact.csv",
            "jobs.csv",
            "custom_fields.csv",
            "job_custom_field_values.csv",
            "client_custom_field_values.csv",
            "staff.csv",
        ]
        for f in files:
            p = WFM_DIR / f
            if not p.exists():
                raise FileNotFoundError(f"Missing required file: {p}")
            df = _read_csv(p)
            self.data[f] = df
            self.log.info("Loaded %s: %s rows", f, len(df))
        self._build_staff_index()
        self._build_custom_field_indexes()

    def _build_staff_index(self) -> None:
        staff = self.data.get("staff.csv")
        if staff is None or staff.empty:
            return
        for _, r in staff.iterrows():
            sid = _clean(r.get("Id"))
            if not sid:
                continue
            name = " ".join(
                [x for x in [_clean(r.get("First Name")), _clean(r.get("Last Name"))] if x]
            ).strip()
            self.staff_name_by_id[sid] = name or (_clean(r.get("Email")) or sid)

    def _build_custom_field_indexes(self) -> None:
        cf = self.data.get("custom_fields.csv")
        jv = self.data.get("job_custom_field_values.csv")
        cv = self.data.get("client_custom_field_values.csv")
        if cf is None:
            return
        name_by_id: dict[str, str] = {}
        for _, r in cf.iterrows():
            fid = _clean(r.get("Id"))
            nm = _clean(r.get("Name"))
            if fid and nm:
                name_by_id[fid] = nm

        if jv is not None and not jv.empty:
            for _, r in jv.iterrows():
                job_id = _clean(r.get("Job ID"))
                fid = _clean(r.get("Custom Field Id"))
                value = _clean(r.get("Value"))
                if not job_id or not fid:
                    continue
                field_name = name_by_id.get(fid, fid)
                self.job_custom_values.setdefault(job_id, {})[field_name.lower()] = value

        if cv is not None and not cv.empty:
            for _, r in cv.iterrows():
                client_id = _clean(r.get("Client ID"))
                fid = _clean(r.get("Custom Field Id"))
                value = _clean(r.get("Value"))
                if not client_id or not fid:
                    continue
                field_name = name_by_id.get(fid, fid)
                self.client_custom_values.setdefault(client_id, {})[field_name.lower()] = value

    def _pick_field_value(self, value_map: dict[str, str], candidates: list[str]) -> str:
        if not value_map:
            return ""
        for name in candidates:
            v = _clean(value_map.get(name.lower()))
            if v:
                return v
        return ""

    def pick_clients(self) -> None:
        clients = self.data["clients.csv"].copy()
        jobs_all = self.data["jobs.csv"]

        if self.job_numbers:
            job_filtered = jobs_all[jobs_all["Job No"].str.lower().isin(self.job_numbers)]
            self.client_ids.update(set(job_filtered["Client"].tolist()))

        if self.client_ids:
            clients = clients[clients["Id"].isin(self.client_ids)]
        if self.client_names:
            clients = clients[clients["Name"].str.lower().isin(self.client_names)]
        if self.max_clients and self.max_clients > 0:
            clients = clients.head(self.max_clients)
        self.selected_client_ids = set(clients["Id"].tolist())
        self.data["clients.csv"] = clients

        # Cascade filters
        self.data["client_addresses.csv"] = self.data["client_addresses.csv"][
            self.data["client_addresses.csv"]["Client Id"].isin(self.selected_client_ids)
        ]
        rel_contact_ids = set(
            self.data["client_contact.csv"][self.data["client_contact.csv"]["Client Id"].isin(self.selected_client_ids)][
                "Contact Id"
            ].tolist()
        )
        self.data["contacts.csv"] = self.data["contacts.csv"][self.data["contacts.csv"]["Id"].isin(rel_contact_ids)]
        self.data["client_contact.csv"] = self.data["client_contact.csv"][
            self.data["client_contact.csv"]["Client Id"].isin(self.selected_client_ids)
        ]
        self.data["jobs.csv"] = jobs_all[jobs_all["Client"].isin(self.selected_client_ids)]
        if self.job_numbers:
            self.data["jobs.csv"] = self.data["jobs.csv"][self.data["jobs.csv"]["Job No"].str.lower().isin(self.job_numbers)]

        self.log.info(
            "Selected %s clients, %s contacts, %s jobs",
            len(self.data["clients.csv"]),
            len(self.data["contacts.csv"]),
            len(self.data["jobs.csv"]),
        )

    def _ensure_import_tables(self, con) -> None:
        con.execute(
            """
            CREATE TABLE IF NOT EXISTS wfm_import_map (
              entity_type VARCHAR NOT NULL,
              wfm_id VARCHAR NOT NULL,
              nzi_id INTEGER NOT NULL,
              created_at TIMESTAMP NOT NULL DEFAULT NOW(),
              PRIMARY KEY (entity_type, wfm_id)
            )
            """
        )
        con.execute(
            """
            CREATE TABLE IF NOT EXISTS wfm_import_audit (
              id BIGSERIAL PRIMARY KEY,
              run_at TIMESTAMP NOT NULL DEFAULT NOW(),
              mode VARCHAR NOT NULL,
              entity_type VARCHAR NOT NULL,
              wfm_id VARCHAR,
              nzi_id INTEGER,
              action VARCHAR NOT NULL,
              message TEXT
            )
            """
        )

    def _audit(self, con, entity: str, wfm_id: str, nzi_id: int | None, action: str, message: str) -> None:
        if self.dry_run:
            return
        con.execute(
            """
            INSERT INTO wfm_import_audit (mode, entity_type, wfm_id, nzi_id, action, message)
            VALUES (%s, %s, %s, %s, %s, %s)
            """,
            ["import", entity, wfm_id or None, nzi_id, action, message],
        )

    def _upsert_map(self, con, entity: str, wfm_id: str, nzi_id: int) -> None:
        if self.dry_run:
            return
        con.execute(
            """
            INSERT INTO wfm_import_map (entity_type, wfm_id, nzi_id)
            VALUES (%s, %s, %s)
            ON CONFLICT (entity_type, wfm_id) DO UPDATE SET nzi_id = EXCLUDED.nzi_id
            """,
            [entity, wfm_id, int(nzi_id)],
        )

    def import_clients(self, con) -> None:
        clients = self.data["clients.csv"]
        addresses = self.data["client_addresses.csv"]
        addr_map: dict[str, list[dict[str, str]]] = {}
        for _, r in addresses.iterrows():
            cid = _clean(r.get("Client Id"))
            if not cid:
                continue
            addr_map.setdefault(cid, []).append(r.to_dict())

        for _, r in clients.iterrows():
            self.stats.clients_processed += 1
            wfm_id = _clean(r.get("Id"))
            name = _clean(r.get("Name"))
            if not name:
                self.stats.warnings.append(f"Client {wfm_id} skipped: missing name")
                continue

            addr = None
            rows = addr_map.get(wfm_id, [])
            postal = [x for x in rows if _clean(x.get("Type")).lower() == "postal"]
            physical = [x for x in rows if _clean(x.get("Type")).lower() == "physical"]
            if postal:
                addr = postal[0]
            elif physical:
                addr = physical[0]

            website = _clean(r.get("Website")) or None
            if website == "https://":
                website = None
            company_reg = _clean(r.get("Company Number")) or None
            year_end = _parse_date(r.get("Year End Date"))
            year_end_month = None
            if year_end:
                year_end_month = year_end[5:7]

            existing = con.execute("SELECT nzi_id FROM wfm_import_map WHERE entity_type=%s AND wfm_id=%s", ["client", wfm_id]).fetchone()
            client_id = int(existing[0]) if existing else None

            if client_id is None:
                by_name = con.execute("SELECT db_id FROM clients WHERE lower(client_name)=lower(%s) LIMIT 1", [name]).fetchone()
                client_id = int(by_name[0]) if by_name else None

            if client_id is None:
                if not self.dry_run:
                    row = con.execute(
                        """
                        INSERT INTO clients (
                          client_name, industry, website, company_reg, headquarters,
                          addr_line1, addr_city, addr_region, addr_postcode, addr_country,
                          year_end_month, status
                        )
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                        RETURNING db_id
                        """,
                        [
                            name,
                            None,
                            website,
                            company_reg,
                            name,
                            _clean((addr or {}).get("Address/Mailing Line 1")) or None,
                            _clean((addr or {}).get("Address/Mailing City")) or None,
                            _clean((addr or {}).get("Address/Mailing State")) or None,
                            _clean((addr or {}).get("Address/Mailing Postcode")) or None,
                            _clean((addr or {}).get("Address/Mailing Country")) or "United Kingdom",
                            year_end_month,
                            "Active",
                        ],
                    ).fetchone()
                    client_id = int(row[0])
                    self.stats.clients_inserted += 1
                    self._audit(con, "client", wfm_id, client_id, "insert", name)
                else:
                    client_id = -(self.stats.clients_processed)
                    self.stats.clients_inserted += 1
            else:
                if not self.dry_run:
                    con.execute(
                        """
                        UPDATE clients
                        SET website = COALESCE(%s, website),
                            company_reg = COALESCE(%s, company_reg),
                            addr_line1 = COALESCE(%s, addr_line1),
                            addr_city = COALESCE(%s, addr_city),
                            addr_region = COALESCE(%s, addr_region),
                            addr_postcode = COALESCE(%s, addr_postcode),
                            addr_country = COALESCE(%s, addr_country)
                        WHERE db_id = %s
                        """,
                        [
                            website,
                            company_reg,
                            _clean((addr or {}).get("Address/Mailing Line 1")) or None,
                            _clean((addr or {}).get("Address/Mailing City")) or None,
                            _clean((addr or {}).get("Address/Mailing State")) or None,
                            _clean((addr or {}).get("Address/Mailing Postcode")) or None,
                            _clean((addr or {}).get("Address/Mailing Country")) or None,
                            int(client_id),
                        ],
                    )
                    self._audit(con, "client", wfm_id, client_id, "update", name)
                self.stats.clients_updated += 1

            self.client_map[wfm_id] = int(client_id)
            self._upsert_map(con, "client", wfm_id, int(client_id))

    def import_contacts(self, con) -> None:
        contacts = self.data["contacts.csv"]
        links = self.data["client_contact.csv"]

        contact_data = {row["Id"]: row for _, row in contacts.iterrows()}
        for _, link in links.iterrows():
            wfm_client_id = _clean(link.get("Client Id"))
            wfm_contact_id = _clean(link.get("Contact Id"))
            if wfm_client_id not in self.client_map or wfm_contact_id not in contact_data:
                continue
            c = contact_data[wfm_contact_id]
            self.stats.contacts_processed += 1
            client_id = self.client_map[wfm_client_id]

            email = _clean(c.get("Email")) or None
            full_name = _clean(c.get("Name")) or "Unknown Contact"
            job_title = _clean(c.get("Position")) or None
            phone = _clean(c.get("Phone")) or None

            mapped = con.execute(
                "SELECT nzi_id FROM wfm_import_map WHERE entity_type=%s AND wfm_id=%s",
                ["contact", wfm_contact_id],
            ).fetchone()
            contact_id = int(mapped[0]) if mapped else None

            if contact_id is None and email:
                exists = con.execute(
                    "SELECT contact_id FROM client_contacts WHERE client_db_id=%s AND lower(email)=lower(%s) LIMIT 1",
                    [int(client_id), email],
                ).fetchone()
                contact_id = int(exists[0]) if exists else None

            if contact_id is None:
                if not self.dry_run:
                    row = con.execute(
                        """
                        INSERT INTO client_contacts (client_db_id, full_name, job_title, email, phone, is_primary)
                        VALUES (%s, %s, %s, %s, %s, FALSE)
                        RETURNING contact_id
                        """,
                        [int(client_id), full_name, job_title, email, phone],
                    ).fetchone()
                    contact_id = int(row[0])
                    self._audit(con, "contact", wfm_contact_id, contact_id, "insert", full_name)
                else:
                    contact_id = -(self.stats.contacts_processed)
                self.stats.contacts_inserted += 1
            else:
                if not self.dry_run:
                    con.execute(
                        """
                        UPDATE client_contacts
                        SET full_name = COALESCE(%s, full_name),
                            job_title = COALESCE(%s, job_title),
                            phone = COALESCE(%s, phone)
                        WHERE contact_id = %s
                        """,
                        [full_name, job_title, phone, int(contact_id)],
                    )
                    self._audit(con, "contact", wfm_contact_id, contact_id, "update", full_name)
                self.stats.contacts_updated += 1

            self.contact_map[wfm_contact_id] = int(contact_id)
            self._upsert_map(con, "contact", wfm_contact_id, int(contact_id))

    def import_jobs(self, con) -> None:
        jobs = self.data["jobs.csv"]

        for _, r in jobs.iterrows():
            self.stats.jobs_processed += 1
            wfm_job_id = _clean(r.get("Id"))
            wfm_client_id = _clean(r.get("Client"))
            if wfm_client_id not in self.client_map:
                self.stats.warnings.append(f"Job {wfm_job_id} skipped: no mapped client")
                continue
            client_id = self.client_map[wfm_client_id]

            job_custom = self.job_custom_values.get(wfm_job_id, {})
            client_custom = self.client_custom_values.get(wfm_client_id, {})
            job_number = _clean(r.get("Job No")) or None
            title = _clean(r.get("Name")) or "Imported WFM Job"
            start_date = _parse_date(r.get("Start Date (DD/MM/YYYY)"))
            due_date = _parse_date(r.get("Due Date (DD/MM/YYYY)"))
            report_from = _parse_date(
                self._pick_field_value(
                    job_custom,
                    self._candidates("job", "report_from", WFM_JOB_FIELD_CANDIDATES["report_from"]),
                )
            ) or start_date
            report_to = _parse_date(
                self._pick_field_value(
                    job_custom,
                    self._candidates("job", "report_to", WFM_JOB_FIELD_CANDIDATES["report_to"]),
                )
            ) or due_date
            reporting_year = int(report_to[:4]) if report_to and re.match(r"^\d{4}-", report_to) else None
            status = "Completed" if _parse_date(r.get("Completed Date (DD/MM/YYYY)")) else "Open"
            crm_name = self.staff_name_by_id.get(_clean(r.get("Job Manager"))) or None
            scope_1 = _to_float(
                self._pick_field_value(
                    job_custom,
                    self._candidates("job", "scope_1_tco2e", WFM_JOB_FIELD_CANDIDATES["scope_1_tco2e"]),
                )
            )
            scope_2 = _to_float(
                self._pick_field_value(
                    job_custom,
                    self._candidates("job", "scope_2_tco2e", WFM_JOB_FIELD_CANDIDATES["scope_2_tco2e"]),
                )
            )
            scope_3 = _to_float(
                self._pick_field_value(
                    job_custom,
                    self._candidates("job", "scope_3_tco2e", WFM_JOB_FIELD_CANDIDATES["scope_3_tco2e"]),
                )
            )
            employees = _to_float(
                self._pick_field_value(
                    job_custom,
                    self._candidates("job", "employees", WFM_JOB_FIELD_CANDIDATES["employees"]),
                )
            )
            turnover = _to_float(
                self._pick_field_value(
                    job_custom,
                    self._candidates("job", "turnover", WFM_JOB_FIELD_CANDIDATES["turnover"]),
                )
            )
            if turnover is None:
                turnover = _to_float(
                    self._pick_field_value(
                        client_custom,
                        self._candidates("client", "turnover", WFM_CLIENT_FIELD_CANDIDATES["turnover"]),
                    )
                )
            intensity_metrics = {
                "employees": {"label": "Employees", "value": int(employees) if employees is not None else 0, "divider": 1},
                "turnover": {"label": "Turnover (GBP)", "value": float(turnover) if turnover is not None else 0, "divider": 1000000},
            }

            mapped = con.execute(
                "SELECT nzi_id FROM wfm_import_map WHERE entity_type=%s AND wfm_id=%s",
                ["job", wfm_job_id],
            ).fetchone()
            job_id = int(mapped[0]) if mapped else None

            if job_id is None and job_number:
                exists = con.execute("SELECT job_id FROM jobs WHERE job_number=%s LIMIT 1", [job_number]).fetchone()
                job_id = int(exists[0]) if exists else None

            if job_id is None:
                if not self.dry_run:
                    row = con.execute(
                        """
                        INSERT INTO jobs (
                          client_db_id, job_number, title, reporting_year, status,
                          start_date, due_date, reporting_period_start, reporting_period_end, crm_name, intensity_metrics, is_crp
                        )
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, CAST(%s AS JSONB), TRUE)
                        RETURNING job_id
                        """,
                        [
                            int(client_id),
                            job_number,
                            title,
                            reporting_year,
                            status,
                            start_date,
                            due_date,
                            report_from,
                            report_to,
                            crm_name,
                            json.dumps(intensity_metrics),
                        ],
                    ).fetchone()
                    job_id = int(row[0])
                    self._audit(con, "job", wfm_job_id, job_id, "insert", job_number or title)
                else:
                    job_id = -(self.stats.jobs_processed)
                self.stats.jobs_inserted += 1
            else:
                if not self.dry_run:
                    con.execute(
                        """
                        UPDATE jobs
                        SET title = COALESCE(%s, title),
                            reporting_year = COALESCE(%s, reporting_year),
                            status = COALESCE(%s, status),
                            start_date = COALESCE(%s, start_date),
                            due_date = COALESCE(%s, due_date),
                            reporting_period_start = COALESCE(%s, reporting_period_start),
                            reporting_period_end = COALESCE(%s, reporting_period_end),
                            crm_name = COALESCE(%s, crm_name),
                            intensity_metrics = COALESCE(CAST(%s AS JSONB), intensity_metrics)
                        WHERE job_id = %s
                        """,
                        [
                            title,
                            reporting_year,
                            status,
                            start_date,
                            due_date,
                            report_from,
                            report_to,
                            crm_name,
                            json.dumps(intensity_metrics),
                            int(job_id),
                        ],
                    )
                    self._audit(con, "job", wfm_job_id, job_id, "update", job_number or title)
                self.stats.jobs_updated += 1

            # Keep crp_job_details aligned for reporting features.
            if not self.dry_run:
                crp = con.execute("SELECT 1 FROM crp_job_details WHERE job_id=%s LIMIT 1", [int(job_id)]).fetchone()
                if not crp:
                    con.execute(
                        """
                        INSERT INTO crp_job_details (
                          job_id, reporting_period_from, reporting_period_to,
                          reporting_year, is_benchmark, is_renewal, client_order_number,
                          num_employees, turnover_gbp
                        )
                        VALUES (%s, %s, %s, %s, FALSE, FALSE, %s, %s, %s)
                        """,
                        [
                            int(job_id),
                            report_from,
                            report_to,
                            reporting_year,
                            _clean(r.get("Client Order Number")) or job_number,
                            int(employees) if employees is not None else None,
                            float(turnover) if turnover is not None else None,
                        ],
                    )
                else:
                    con.execute(
                        """
                        UPDATE crp_job_details
                        SET reporting_period_from = COALESCE(%s, reporting_period_from),
                            reporting_period_to = COALESCE(%s, reporting_period_to),
                            reporting_year = COALESCE(%s, reporting_year),
                            num_employees = COALESCE(%s, num_employees),
                            turnover_gbp = COALESCE(%s, turnover_gbp),
                            updated_at = NOW()
                        WHERE job_id = %s
                        """,
                        [
                            report_from,
                            report_to,
                            reporting_year,
                            int(employees) if employees is not None else None,
                            float(turnover) if turnover is not None else None,
                            int(job_id),
                        ],
                    )

                self._upsert_scope_total_row(con, int(job_id), "Scope 1", scope_1)
                self._upsert_scope_total_row(con, int(job_id), "Scope 2", scope_2)
                self._upsert_scope_total_row(con, int(job_id), "Scope 3", scope_3)

            self._upsert_map(con, "job", wfm_job_id, int(job_id))

    def _upsert_scope_total_row(self, con, job_id: int, scope: str, tco2e_value: float | None) -> None:
        if tco2e_value is None:
            return
        synthetic_id = f"wfm-import-{scope.lower().replace(' ', '-')}"
        has_non_synthetic = con.execute(
            """
            SELECT 1
            FROM job_scope_rows
            WHERE job_id=%s AND scope=%s AND enabled=TRUE AND original_id <> %s
            LIMIT 1
            """,
            [int(job_id), scope, synthetic_id],
        ).fetchone()
        if has_non_synthetic:
            return

        qty = float(tco2e_value) * 1000.0
        existing = con.execute(
            """
            SELECT row_id
            FROM job_scope_rows
            WHERE job_id=%s AND scope=%s AND original_id=%s
            LIMIT 1
            """,
            [int(job_id), scope, synthetic_id],
        ).fetchone()
        if existing:
            con.execute(
                """
                UPDATE job_scope_rows
                SET qty=%s,
                    factor=1,
                    ghg_unit='kgCO2e',
                    apply_pct=100,
                    calc_tco2e=%s,
                    override_tco2e=%s,
                    category='Imported Totals',
                    level_1='Imported Totals',
                    level_2='Imported Totals',
                    level_3=%s,
                    column_text='WorkflowMax imported scope total',
                    report_label='WorkflowMax imported scope total',
                    notes='Auto-created from WFM scope custom fields',
                    data_source='WFM Import',
                    data_confidence='M',
                    is_custom_entry=TRUE,
                    enabled=TRUE,
                    updated_at=NOW()
                WHERE row_id=%s
                """,
                [qty, float(tco2e_value), float(tco2e_value), scope, int(existing[0])],
            )
            return

        con.execute(
            """
            INSERT INTO job_scope_rows (
              job_id, scope, dataset_id, factor_db_id, original_id,
              level_1, level_2, level_3, level_4, column_text, report_label, notes,
              enabled, qty, uom, factor, ghg_unit, calc_tco2e, override_tco2e, override_reason,
              apply_pct, data_source, is_custom_entry, category, data_confidence
            )
            VALUES (
              %s, %s, NULL, NULL, %s,
              'Imported Totals', 'Imported Totals', %s, NULL, 'WorkflowMax imported scope total',
              'WorkflowMax imported scope total', 'Auto-created from WFM scope custom fields',
              TRUE, %s, 'kgCO2e', 1, 'kgCO2e', %s, %s, 'Imported from WorkflowMax',
              100, 'WFM Import', TRUE, 'Imported Totals', 'M'
            )
            """,
            [int(job_id), scope, synthetic_id, scope, qty, float(tco2e_value), float(tco2e_value)],
        )

    def report(self) -> None:
        s = self.stats
        print("\nWFM IMPORT SUMMARY")
        print("=" * 60)
        print(f"Mode: {'DRY RUN' if self.dry_run else 'IMPORT'}")
        print(f"Clients:  processed={s.clients_processed} inserted={s.clients_inserted} updated={s.clients_updated}")
        print(f"Contacts: processed={s.contacts_processed} inserted={s.contacts_inserted} updated={s.contacts_updated}")
        print(f"Jobs:     processed={s.jobs_processed} inserted={s.jobs_inserted} updated={s.jobs_updated}")
        if s.warnings:
            print(f"\nWarnings ({len(s.warnings)}):")
            for w in s.warnings[:10]:
                print(f"- {w}")
            if len(s.warnings) > 10:
                print(f"- ... {len(s.warnings)-10} more")
        if s.errors:
            print(f"\nErrors ({len(s.errors)}):")
            for e in s.errors[:10]:
                print(f"- {e}")
            if len(s.errors) > 10:
                print(f"- ... {len(s.errors)-10} more")
        print("=" * 60)

    def run(self) -> int:
        self.load()
        if self.template_lookup_loaded:
            self.log.info("Template ID auto-mapping enabled for incoming WFM template rows")
        self.pick_clients()
        if len(self.data["clients.csv"]) == 0:
            self.log.error("No clients selected after filtering")
            return 2

        with get_conn() as con:
            self._ensure_import_tables(con)
            self.import_clients(con)
            self.import_contacts(con)
            self.import_jobs(con)

        self.report()
        return 0 if not self.stats.errors else 1


def _split_csv_arg(value: str | None) -> list[str]:
    if not value:
        return []
    return [x.strip() for x in value.split(",") if x.strip()]


def main() -> int:
    parser = argparse.ArgumentParser(description="Import WorkflowMax data into NZI Pro")
    parser.add_argument("--import", dest="do_import", action="store_true", help="Run live import (default is dry-run)")
    parser.add_argument("--dry-run", action="store_true", help="Force dry-run mode")
    parser.add_argument("--max-clients", type=int, default=None, help="Limit number of clients for trial import")
    parser.add_argument("--client-ids", type=str, default="", help="Comma-separated WFM client IDs")
    parser.add_argument("--client-names", type=str, default="", help="Comma-separated client names")
    parser.add_argument("--job-numbers", type=str, default="", help="Comma-separated WFM job numbers")
    args = parser.parse_args()

    dry_run = True
    if args.do_import and not args.dry_run:
        dry_run = False

    logger = _setup_logger()
    logger.info("Starting WFM importer (%s)", "dry-run" if dry_run else "import")

    importer = WfmImporter(
        dry_run=dry_run,
        max_clients=args.max_clients,
        client_ids=_split_csv_arg(args.client_ids),
        client_names=_split_csv_arg(args.client_names),
        job_numbers=_split_csv_arg(args.job_numbers),
        mapping_overrides=None,
        logger=logger,
    )
    return importer.run()


if __name__ == "__main__":
    raise SystemExit(main())
