# NZI Pro API

This folder contains the production FastAPI app for NZI Pro.

## Run locally

```bash
python -m uvicorn api.main:app --reload --port 8000
```

## Endpoints

- `GET /health`
- `GET /jobs/{job_id}/excel-template?site=...&include_prev_year=true`
