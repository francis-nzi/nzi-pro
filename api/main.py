from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import Response

from nzi_pages.job_folder_excel import build_excel_template_bytes

app = FastAPI(title="NZI Pro API", version="0.1.0")


@app.get("/health")
def health():
    return {"ok": True}


@app.get("/jobs/{job_id}/excel-template")
def job_excel_template(
    job_id: int,
    site: str = Query(..., min_length=1),
    include_prev_year: bool = True,
):
    try:
        data, filename = build_excel_template_bytes(
            job_id=int(job_id),
            selected_site=str(site),
            include_prev_year=bool(include_prev_year),
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to build template: {e}")

    headers = {"Content-Disposition": f"attachment; filename=\"{filename}\""}
    return Response(
        content=data,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers=headers,
    )
