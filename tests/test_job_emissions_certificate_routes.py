from __future__ import annotations

from pathlib import Path
import sys
from datetime import datetime, timezone

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pandas as pd
from reportlab.lib.pagesizes import A4, landscape

import api.job_emissions_certificate_routes as cert_routes


class _FakeConn:
    def __init__(self):
        self.queries: list[tuple[str, list[object] | None]] = []
        self._last_sql = ""
        self._certificate: dict[str, object] | None = None
        self._inserted_certificate_id = 7

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def execute(self, sql: str, params: list[object] | None = None):
        self.queries.append((sql, params))
        self._last_sql = sql
        if "INSERT INTO job_emissions_certificates" in sql:
            job_id = int(params[0]) if params else 3
            org_id = str(params[1]) if params else "org-a"
            client_db_id = int(params[2]) if params else 58
            client_name = str(params[3]) if params else "Hana Group"
            job_number = str(params[4]) if params else "J000003"
            reporting_year = int(params[5]) if params else 2022
            emissions = float(params[6]) if params else 6.22
            self._certificate = {
                "certificate_id": self._inserted_certificate_id,
                "job_id": job_id,
                "org_id": org_id,
                "client_db_id": client_db_id,
                "client_name": client_name,
                "job_number": job_number,
                "reporting_year": reporting_year,
                "emissions": emissions,
                "certificate_number": f"PENDING-{self._inserted_certificate_id}",
                "issued_at": datetime(2026, 4, 27, tzinfo=timezone.utc),
                "updated_at": datetime(2026, 4, 27, tzinfo=timezone.utc),
            }
        if "UPDATE job_emissions_certificates" in sql and self._certificate is not None and params:
            self._certificate["certificate_number"] = str(params[0])
            self._certificate["emissions"] = float(params[1]) if params[1] is not None else 0.0
            self._certificate["updated_at"] = datetime(2026, 4, 27, tzinfo=timezone.utc)
        return self

    def fetchone(self):
        if "RETURNING certificate_id" in self._last_sql:
            return (self._inserted_certificate_id,)
        return None

    def df(self):
        if "FROM jobs j" in self._last_sql:
            return pd.DataFrame(
                [
                    {
                        "job_id": 3,
                        "job_number": "J000003",
                        "reporting_year": 2022,
                        "reporting_period_end": pd.Timestamp("2022-06-30"),
                        "client_db_id": 58,
                        "org_id": "org-a",
                        "client_name": "Hana Group",
                    }
                ]
            )
        if "FROM job_emissions_certificates" in self._last_sql and self._certificate is not None:
            if "WHERE job_id = ?" in self._last_sql and "reporting_year = ?" in self._last_sql:
                return pd.DataFrame([self._certificate])
            if "WHERE certificate_id = ?" in self._last_sql:
                return pd.DataFrame([self._certificate])
        return pd.DataFrame([])


def test_job_emissions_certificate_issues_once_and_reuses(monkeypatch):
    fake = _FakeConn()
    monkeypatch.setattr(cert_routes, "get_conn", lambda: fake)
    monkeypatch.setattr(cert_routes, "assert_job_access", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(cert_routes, "exact_job_total_emissions", lambda *_args, **_kwargs: 6.22)

    certificate = cert_routes.get_job_emissions_certificate(3, _user={"user_id": "u1", "org_id": "org-a"})
    again = cert_routes.get_job_emissions_certificate(3, _user={"user_id": "u1", "org_id": "org-a"})

    assert certificate["certificate_number"] == "NZI-EC-2022-000007"
    assert certificate["emissions"] == 6.22
    assert certificate["client_name"] == "Hana Group"
    assert certificate["reporting_year"] == 2022
    assert certificate["signatory_name"] == "David Hawes"
    assert certificate["signatory_title"] == "Chief Executive Officer"
    assert again["certificate_number"] == certificate["certificate_number"]
    assert sum(1 for sql, _ in fake.queries if "INSERT INTO job_emissions_certificates" in sql) == 1


def test_job_emissions_certificate_pdf_returns_pdf_bytes(monkeypatch):
    fake = _FakeConn()
    monkeypatch.setattr(cert_routes, "get_conn", lambda: fake)
    monkeypatch.setattr(cert_routes, "assert_job_access", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(cert_routes, "exact_job_total_emissions", lambda *_args, **_kwargs: 6.22)
    monkeypatch.setattr(cert_routes, "get_company_profile", lambda _con: {"company_display_name": "Net Zero International"})

    response = cert_routes.get_job_emissions_certificate_pdf(3, _user={"user_id": "u1", "org_id": "org-a"})

    assert response.media_type == "application/pdf"
    assert response.body.startswith(b"%PDF")


def test_job_emissions_certificate_pdf_uses_landscape_pagesize(monkeypatch):
    fake = _FakeConn()
    captured: dict[str, object] = {}

    class _FakeCanvas:
        def __init__(self, buffer, pagesize=None, title=None, author=None):
            captured["pagesize"] = pagesize
            self._buffer = buffer

        def __getattr__(self, name):
            def _noop(*_args, **_kwargs):
                return None

            return _noop

        def save(self):
            self._buffer.write(b"%PDF-1.4\n%fake\n")

    class _FakeParagraph:
        def __init__(self, text, style):
            self.text = text
            self.style = style

        def wrap(self, width, height):
            return (width, 10)

        def drawOn(self, *_args, **_kwargs):
            return None

    monkeypatch.setattr(cert_routes, "get_conn", lambda: fake)
    monkeypatch.setattr(cert_routes, "assert_job_access", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(cert_routes, "exact_job_total_emissions", lambda *_args, **_kwargs: 6.22)
    monkeypatch.setattr(cert_routes, "get_company_profile", lambda _con: {"company_display_name": "Net Zero International"})
    monkeypatch.setattr(cert_routes.canvas, "Canvas", _FakeCanvas)
    monkeypatch.setattr(cert_routes, "Paragraph", _FakeParagraph)
    monkeypatch.setattr(cert_routes, "_get_nzi_logo_reader", lambda _con: None)
    monkeypatch.setattr(cert_routes, "_get_image_reader_from_logo_url", lambda _logo_url: None)

    response = cert_routes.get_job_emissions_certificate_pdf(3, _user={"user_id": "u1", "org_id": "org-a"})

    assert response.media_type == "application/pdf"
    assert response.body.startswith(b"%PDF")
    assert captured["pagesize"] == landscape(A4)
