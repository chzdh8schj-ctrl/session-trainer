"""Вход, выход и проверка сессии."""

from fastapi import APIRouter, Depends, HTTPException, Request, Response

from . import auth
from .schemas import LoginIn

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login", status_code=204)
def login(payload: LoginIn, request: Request, response: Response) -> None:
    ip = auth.client_ip(request)
    if auth.login_blocked(ip):
        raise HTTPException(status_code=429, detail="слишком много попыток, подожди")
    if not auth.password_ok(payload.password):
        auth.register_failure(ip)
        raise HTTPException(status_code=401, detail="unauthorized")
    auth.reset_failures(ip)
    auth.set_cookie(response)


@router.post("/logout", status_code=204, dependencies=[Depends(auth.require_session)])
def logout(response: Response) -> None:
    auth.clear_cookie(response)


@router.get("/me", dependencies=[Depends(auth.require_session)])
def me() -> dict:
    return {"ok": True}
