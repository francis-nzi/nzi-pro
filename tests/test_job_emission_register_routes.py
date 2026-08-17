import json

import pandas as pd

from api.job_emission_register_routes import _list_register


class _FrameResult:
    def __init__(self, frame: pd.DataFrame):
        self._frame = frame

    def df(self) -> pd.DataFrame:
        return self._frame.copy()


class _RegisterConnection:
    def __init__(self, groups: pd.DataFrame, sources: pd.DataFrame):
        self._frames = iter((groups, sources))

    def execute(self, _sql, _params):
        return _FrameResult(next(self._frames))


def test_list_register_normalizes_nullable_dataframe_values_for_json():
    groups = pd.DataFrame(
        [
            {
                "group_id": 10,
                "job_id": 641,
                "scope": "Scope 3",
                "category": "Employee Commuting",
                "group_type": "employee_commuting",
                "group_name": "Car travel",
                "site_id": float("nan"),
                "site_name": None,
                "rollup_method": "sum",
                "dataset_id": 25,
                "factor_db_id": 3069,
                "original_id": "9_1-c",
                "factor": 0.1,
                "ghg_unit": "kg CO2e",
                "uom": "miles",
                "factor_report_label": float("nan"),
                "notes": None,
                "enabled": True,
                "created_at": None,
                "updated_at": None,
            }
        ]
    )
    sources = pd.DataFrame(
        [
            {
                "source_id": 20,
                "job_id": 641,
                "group_id": 10,
                "group_name": "Car travel",
                "scope": "Scope 3",
                "category": "Employee Commuting",
                "source_type": "employee_commuting",
                "source_subtype": None,
                "site_id": float("nan"),
                "site_name": None,
                "source_name": "Average Car Diesel",
                "asset_identifier": float("nan"),
                "employee_name": float("nan"),
                "group_dataset_id": 25,
                "group_factor_db_id": 3069,
                "group_original_id": "9_1-c",
                "group_factor": 0.1,
                "group_ghg_unit": "kg CO2e",
                "group_uom": "miles",
                "dataset_id": 25,
                "factor_db_id": 3069,
                "original_id": "9_1-c",
                "qty": 5760.0,
                "uom": "miles",
                "factor": 0.1,
                "ghg_unit": "kg CO2e",
                "apply_pct": 100.0,
                "data_source": "Employee Commuting (Consolidated)",
                "data_confidence": "M",
                "notes": None,
                "detail_json": None,
                "calc_tco2e": 0.576,
                "enabled": True,
                "created_at": None,
                "updated_at": None,
            }
        ]
    )

    payload = _list_register(_RegisterConnection(groups, sources), 641, "employee_commuting", False)

    # Mirrors Starlette's strict JSON behaviour: any leaked NaN fails here.
    json.dumps(payload, allow_nan=False, default=str)
    assert payload["groups"][0]["factor_report_label"] is None
    assert payload["sources"][0]["asset_identifier"] is None
    assert payload["sources"][0]["employee_name"] is None
    assert payload["sources"][0]["detail_json"] == {}
