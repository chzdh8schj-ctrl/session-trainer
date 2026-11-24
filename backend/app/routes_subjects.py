"""Предметы."""

from fastapi import APIRouter, Depends, HTTPException, Response

from . import auth, repo
from .schemas import SubjectIn, SubjectOut, SubjectPatch, SubjectSummary

router = APIRouter(prefix="/subjects", tags=["subjects"], dependencies=[Depends(auth.require_session)])


@router.get("", response_model=list[SubjectSummary])
def list_subjects() -> list[dict]:
    return repo.list_subjects()


@router.post("", response_model=SubjectOut, status_code=201)
def create_subject(payload: SubjectIn) -> dict:
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="название не может быть пустым")
    return repo.create_subject(name)


@router.patch("/{subject_id}", response_model=SubjectOut)
def patch_subject(subject_id: str, payload: SubjectPatch) -> dict:
    subject = repo.get_subject(subject_id)
    if not subject:
        raise HTTPException(status_code=404, detail="предмет не найден")
    if payload.name is None:
        return subject
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="название не может быть пустым")
    return repo.rename_subject(subject_id, name) or subject


@router.delete("/{subject_id}", status_code=204)
def delete_subject(subject_id: str, response: Response) -> None:
    if not repo.delete_subject(subject_id):
        raise HTTPException(status_code=404, detail="предмет не найден")
