from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import pandas as pd
import api.job_setup_routes as routes
from fastapi.encoders import jsonable_encoder
from starlette.responses import JSONResponse


def test_full_dataset_catalog_serializes_null_metadata(monkeypatch):
    frame = pd.DataFrame([
        {"dataset_id": i + 1, "name": f"Dataset {i + 1}", "year": 2025 if i else None,
         "source": None, "country": "United Kingdom", "region": float("nan"),
         "currency": None, "version": float("nan"), "archived": None,
         "archived_at": pd.NaT, "archived_by": float("nan")}
        for i in range(220)
    ])
    class Conn:
        def __enter__(self): return self
        def __exit__(self, *args): return False
        def execute(self, sql): return self
        def df(self): return frame
    monkeypatch.setattr(routes, "get_conn", lambda: Conn())
    result = routes.list_datasets({})
    response = JSONResponse(jsonable_encoder(result))
    assert response.status_code == 200
    assert len(result["items"]) == 220
    assert result["items"][0]["year"] is None
    assert result["items"][1]["year"] == 2025
    assert result["items"][0]["archived"] is False
    for key in ["region", "version", "archived_at", "archived_by"]:
        assert result["items"][0][key] is None
