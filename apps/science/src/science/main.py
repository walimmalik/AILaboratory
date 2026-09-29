from fastapi import FastAPI

app = FastAPI(title="AILaboratory science service")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "science"}
