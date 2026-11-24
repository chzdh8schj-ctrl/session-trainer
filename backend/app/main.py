"""Сборка приложения и монтирование frontend/dist."""

from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from . import auth, db
from .config import get_settings
from .routes_admin import router as admin_router
from .routes_auth import router as auth_router
from .routes_study import router as study_router
from .routes_subjects import router as subjects_router
from .routes_tickets import router as tickets_router


@asynccontextmanager
async def lifespan(_: FastAPI):
    db.init_db()
    auth.warn_plaintext_password()
    yield


app = FastAPI(title="Тренажёр к сессии", lifespan=lifespan)

app.include_router(auth_router, prefix="/api")
app.include_router(subjects_router, prefix="/api")
app.include_router(tickets_router, prefix="/api")
app.include_router(study_router, prefix="/api")
app.include_router(admin_router, prefix="/api")


@app.get("/api/health")
def health() -> dict:
    return {"ok": True}


def _mount_frontend() -> None:
    dist = get_settings().dist_dir()
    if not dist.is_dir():
        return

    assets = dist / "assets"
    if assets.is_dir():
        app.mount("/assets", StaticFiles(directory=assets), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str):
        if path.startswith("api/") or path == "api":
            raise HTTPException(status_code=404, detail="not found")
        if path:
            candidate = (dist / path).resolve()
            if candidate.is_file() and dist.resolve() in candidate.parents:
                return FileResponse(candidate)
        return FileResponse(dist / "index.html")


_mount_frontend()


def run() -> None:
    import uvicorn

    settings = get_settings()
    uvicorn.run("app.main:app", host=settings.app_host, port=settings.app_port, reload=False)


if __name__ == "__main__":
    run()
