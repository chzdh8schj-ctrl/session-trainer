"""Билеты и части."""

from fastapi import APIRouter, Depends, HTTPException, Response

from . import ai, auth, repo
from .schemas import (
    GenerateIn,
    PartIn,
    PartOut,
    PartPatch,
    TicketAiOut,
    TicketIn,
    TicketOut,
    TicketPatch,
)

router = APIRouter(tags=["tickets"], dependencies=[Depends(auth.require_session)])


def _ticket_or_404(ticket_id: str) -> dict:
    ticket = repo.get_ticket(ticket_id)
    if not ticket:
        raise HTTPException(status_code=404, detail="билет не найден")
    return ticket


def _with_ai(ticket: dict, status: str, error: str | None = None) -> dict:
    payload = dict(ticket)
    payload["ai_status"] = status
    if error:
        payload["ai_error"] = error[:300]
    return payload


def _apply_result(ticket_id: str, question: str, result: ai.AiResult, replace: bool) -> None:
    if result.status == "ok":
        repo.replace_parts(ticket_id, result.parts)
    elif replace:
        repo.replace_parts(ticket_id, [ai.draft_part(question)])


@router.get("/subjects/{subject_id}/tickets", response_model=list[TicketOut])
def list_tickets(subject_id: str) -> list[dict]:
    if not repo.get_subject(subject_id):
        raise HTTPException(status_code=404, detail="предмет не найден")
    return repo.list_tickets(subject_id)


@router.post("/tickets", response_model=TicketAiOut, response_model_exclude_none=True)
def create_ticket(payload: TicketIn) -> dict:
    if not repo.get_subject(payload.subject_id):
        raise HTTPException(status_code=404, detail="предмет не найден")
    ticket = repo.create_ticket(payload.subject_id, payload.title.strip(), payload.question)
    result = ai.generate_parts(ticket["title"], ticket["question"], kind="ticket")
    _apply_result(ticket["id"], ticket["question"], result, replace=True)
    return _with_ai(repo.get_ticket(ticket["id"]), result.status, result.error)


@router.get("/tickets/{ticket_id}", response_model=TicketOut)
def get_ticket(ticket_id: str) -> dict:
    return _ticket_or_404(ticket_id)


@router.patch("/tickets/{ticket_id}", response_model=TicketOut)
def patch_ticket(ticket_id: str, payload: TicketPatch) -> dict:
    _ticket_or_404(ticket_id)
    title = payload.title.strip() if payload.title is not None else None
    ticket = repo.update_ticket(ticket_id, title, payload.question)
    return ticket or _ticket_or_404(ticket_id)


@router.delete("/tickets/{ticket_id}", status_code=204)
def delete_ticket(ticket_id: str, response: Response) -> None:
    if not repo.delete_ticket(ticket_id):
        raise HTTPException(status_code=404, detail="билет не найден")


@router.post(
    "/tickets/{ticket_id}/generate",
    response_model=TicketAiOut,
    response_model_exclude_none=True,
)
def generate_ticket(ticket_id: str, payload: GenerateIn | None = None) -> dict:
    ticket = _ticket_or_404(ticket_id)
    force = bool(payload.force) if payload else False
    if repo.has_ready_parts(ticket_id) and not force:
        raise HTTPException(status_code=409, detail="у билета уже есть варианты ответов")
    result = ai.generate_parts(ticket["title"], ticket["question"], kind="generate")
    _apply_result(ticket_id, ticket["question"], result, replace=not ticket["parts"])
    return _with_ai(repo.get_ticket(ticket_id), result.status, result.error)


@router.post("/tickets/{ticket_id}/parts", response_model=PartOut)
def create_part(ticket_id: str, payload: PartIn) -> dict:
    _ticket_or_404(ticket_id)
    part = repo.create_part(
        ticket_id,
        payload.title,
        payload.question,
        payload.options,
        payload.correct_index,
        payload.note,
    )
    if not part:
        raise HTTPException(status_code=404, detail="билет не найден")
    return part


@router.patch("/parts/{part_id}", response_model=PartOut)
def patch_part(part_id: str, payload: PartPatch) -> dict:
    if not repo.get_part(part_id):
        raise HTTPException(status_code=404, detail="часть не найдена")
    part = repo.update_part(part_id, payload.model_dump())
    return part or _part_or_404(part_id)


@router.delete("/parts/{part_id}", status_code=204)
def delete_part(part_id: str, response: Response) -> None:
    if not repo.delete_part(part_id):
        raise HTTPException(status_code=404, detail="часть не найдена")


def _part_or_404(part_id: str) -> dict:
    part = repo.get_part(part_id)
    if not part:
        raise HTTPException(status_code=404, detail="часть не найдена")
    return part
