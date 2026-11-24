"""Расход ИИ, настройки, экспорт и импорт."""

from fastapi import APIRouter, Depends

from . import auth, repo
from .schemas import (
    ExportOut,
    ImportIn,
    ImportOut,
    SettingsIn,
    SettingsOut,
    UsageOut,
)

router = APIRouter(tags=["admin"], dependencies=[Depends(auth.require_session)])


@router.get("/usage", response_model=UsageOut)
def get_usage() -> dict:
    options = repo.get_settings_map()
    usage = repo.month_usage()
    limit = options["monthly_limit_rub"]
    return {
        **usage,
        "limit_rub": limit,
        "left_rub": round(max(limit - usage["cost_rub"], 0.0), 4),
        "ai_enabled": options["ai_enabled"],
    }


@router.get("/settings", response_model=SettingsOut)
def get_settings_route() -> dict:
    return repo.get_settings_map()


@router.put("/settings", response_model=SettingsOut)
def put_settings(payload: SettingsIn) -> dict:
    return repo.update_settings(payload.monthly_limit_rub, payload.ai_enabled)


@router.get("/export", response_model=ExportOut)
def export_data() -> dict:
    return {"version": 1, "exported_at": repo.now(), "subjects": repo.dump_all()}


@router.post("/import", response_model=ImportOut)
def import_data(payload: ImportIn) -> dict:
    if payload.replace:
        repo.clear_all()
    return repo.insert_imported([subject.model_dump() for subject in payload.subjects])
