"""Asset Register / Business Travel entries with a monthly breakdown are
priced month by month, like Data Entry rows. Job 636 (Apr 2024 - Mar 2025)
was reported entirely at 2024 factors because register rows only ever used
the tCO2e stored when they were saved."""

from services.emissions_reporting import combined_row_metrics, is_static_register_row


class _Resolver:
    def __init__(self):
        self.calls = []

    def row_metrics(self, row, include_monthly_details=True):
        self.calls.append(row)
        return {"calc_tco2e": 17.8933, "uses_monthly_factors": True}


def _register_row(**months):
    row = {"record_type": "source_register", "job_id": 636, "qty": 7080, "factor": 2.51279,
           "ghg_unit": "kgCO2e", "apply_pct": 100, "calc_tco2e": 17.7906}
    row.update({f"month_{i}": None for i in range(1, 13)})
    row.update(months)
    return row


def test_register_row_with_months_is_priced_by_the_resolver() -> None:
    resolver = _Resolver()
    row = _register_row(month_1=590, month_4=590)

    assert not is_static_register_row(row)
    assert combined_row_metrics(row, resolver)["calc_tco2e"] == 17.8933
    assert resolver.calls == [row]


def test_register_row_without_months_keeps_its_stored_tco2e() -> None:
    resolver = _Resolver()
    row = _register_row()

    assert is_static_register_row(row)
    assert combined_row_metrics(row, resolver)["calc_tco2e"] == 17.7906
    assert resolver.calls == []


def test_nan_months_count_as_missing() -> None:
    # Pandas hands NULL month columns over as NaN.
    assert is_static_register_row(_register_row(month_1=float("nan")))
