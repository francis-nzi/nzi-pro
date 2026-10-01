import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import pytest
from api.quotes_routes import _resolve_bill_to


@pytest.mark.parametrize("saved, expected", [
    ("Scotia Windows and Doors\nMontgomerie House", "Ailsa ESG Solutions - Scotia Windows and Doors\nMontgomerie House"),
    ("  scotia windows and doors  \r\nCustom address", "Ailsa ESG Solutions - Scotia Windows and Doors\nCustom address"),
    ("Custom recipient\nCustom address", "Custom recipient\nCustom address"),
    ("", "Ailsa ESG Solutions - Scotia Windows and Doors\nBilling address"),
])
def test_billing_company_replaces_only_legacy_default(saved, expected):
    assert _resolve_bill_to(saved, "Scotia Windows and Doors",
        "Ailsa ESG Solutions - Scotia Windows and Doors", ["Billing address"], ["Registered address"]) == expected


def test_no_billing_company_uses_client_and_registered_address():
    assert _resolve_bill_to("", "Client", "  ", [None], ["Registered address"]) == "Client\nRegistered address"


@pytest.mark.parametrize("linked", [False, True])
def test_invoice_uses_billing_company_with_or_without_quote(monkeypatch, linked):
    import api.quotes_routes as routes
    monkeypatch.setattr(routes, "_invoice_lines_for", lambda *a, **k: [])
    monkeypatch.setattr(routes, "get_company_profile", lambda *a: {})
    class Connection:
        def execute(self, sql, params=None):
            if "FROM invoices" in sql:
                self.row = [1, 321, None, 29 if linked else None, "INV1"] + [None] * 19
            elif "FROM quotes" in sql:
                self.row = ["", "Client\nSaved address", "", None, "Q1"]
            elif "FROM clients" in sql:
                self.row = ["Client"] + [None] * 6 + ["Billing address"] + [None] * 5 + ["Billing Company"]
            elif "FROM client_contacts" in sql:
                self.row = None
            else:
                raise AssertionError(sql)
            return self
        def fetchone(self):
            return self.row
    invoice = routes._serialize_invoice(Connection(), 1)
    assert invoice["bill_to"] == "Billing Company\n" + ("Saved address" if linked else "Billing address")
