"""Решение билетов."""

from fastapi import APIRouter, Depends, HTTPException

from . import auth, repo
from .schemas import AnswerIn, AnswerOut

router = APIRouter(tags=["study"], dependencies=[Depends(auth.require_session)])


@router.post("/parts/{part_id}/answer", response_model=AnswerOut)
def answer_part(part_id: str, payload: AnswerIn) -> dict:
    part = repo.get_part(part_id)
    if not part:
        raise HTTPException(status_code=404, detail="часть не найдена")
    correct = payload.chosen_index == part["correct_index"]
    repo.add_attempt(part_id, payload.chosen_index, correct)
    return {"correct": correct, "correct_index": part["correct_index"], "note": part["note"]}
