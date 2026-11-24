"""Вход по паролю, подписанная кука сессии и защита от перебора."""

import hashlib
import hmac
import logging
import time
from threading import Lock

from fastapi import HTTPException, Request, Response

from .config import get_settings
from .passwords import hash_password, verify_password

logger = logging.getLogger(__name__)

COOKIE_NAME = "st_session"

LOGIN_WINDOW_SECONDS = 600
LOGIN_MAX_FAILURES = 10

_fallback: tuple[str, str] | None = None
_warned = False

_failures: dict[str, list[float]] = {}
_failures_lock = Lock()


def _sign(secret: str, payload: str) -> str:
    return hmac.new(secret.encode(), payload.encode(), hashlib.sha256).hexdigest()


def make_token() -> str:
    settings = get_settings()
    issued = str(int(time.time()))
    return f"{issued}.{_sign(settings.session_secret, issued)}"


def check_token(token: str | None) -> bool:
    if not token:
        return False
    issued, _, signature = token.partition(".")
    if not issued.isdigit() or not signature:
        return False
    settings = get_settings()
    if not hmac.compare_digest(signature, _sign(settings.session_secret, issued)):
        return False
    age = int(time.time()) - int(issued)
    return 0 <= age <= settings.session_days * 86400


def password_hash() -> str:
    global _fallback
    settings = get_settings()
    if settings.site_password_hash:
        return settings.site_password_hash
    plain = settings.site_password
    if not plain:
        return ""
    if _fallback is None or _fallback[0] != plain:
        _fallback = (plain, hash_password(plain))
    return _fallback[1]


def password_ok(password: str) -> bool:
    stored = password_hash()
    if not stored:
        return False
    return verify_password(password, stored)


def warn_plaintext_password() -> None:
    global _warned
    settings = get_settings()
    if settings.site_password_hash or not settings.site_password:
        return
    password_hash()
    if _warned:
        return
    _warned = True
    logger.warning(
        "SITE_PASSWORD задан открытым текстом — пароль захеширован в памяти при старте. "
        "Лучше перейти на SITE_PASSWORD_HASH: uv run python -m app.passwords \"пароль\""
    )


def client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        first = forwarded.split(",")[0].strip()
        if first:
            return first
    return request.client.host if request.client else "unknown"


def _fresh_failures(ip: str, now: float) -> list[float]:
    stamps = [stamp for stamp in _failures.get(ip, []) if now - stamp < LOGIN_WINDOW_SECONDS]
    if stamps:
        _failures[ip] = stamps
    else:
        _failures.pop(ip, None)
    return stamps


def login_blocked(ip: str) -> bool:
    with _failures_lock:
        return len(_fresh_failures(ip, time.monotonic())) >= LOGIN_MAX_FAILURES


def register_failure(ip: str) -> None:
    now = time.monotonic()
    with _failures_lock:
        stamps = _fresh_failures(ip, now)
        stamps.append(now)
        _failures[ip] = stamps


def reset_failures(ip: str | None = None) -> None:
    with _failures_lock:
        if ip is None:
            _failures.clear()
        else:
            _failures.pop(ip, None)


def require_session(request: Request) -> None:
    if not check_token(request.cookies.get(COOKIE_NAME)):
        raise HTTPException(status_code=401, detail="unauthorized")


def set_cookie(response: Response) -> None:
    settings = get_settings()
    response.set_cookie(
        COOKIE_NAME,
        make_token(),
        max_age=settings.session_days * 86400,
        httponly=True,
        samesite="lax",
        secure=settings.cookie_secure,
        path="/",
    )


def clear_cookie(response: Response) -> None:
    response.delete_cookie(COOKIE_NAME, path="/")
