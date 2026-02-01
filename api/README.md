# NZI Pro API

This folder contains a minimal FastAPI app intended to run alongside the Streamlit app.

## Run locally

```bash
python -m uvicorn api.main:app --reload --port 8000
```

## Endpoints

- `GET /health`
- `GET /jobs/{job_id}/excel-template?site=...&include_prev_year=true`
