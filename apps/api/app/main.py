from fastapi import FastAPI

from app.api.router import api_router

app = FastAPI(title="LigaMX API", version="0.1.0")

# Prefix keeps room for future versioning, e.g. /api/v1.
app.include_router(api_router)
