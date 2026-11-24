"""Хеширование пароля входа (scrypt) и CLI для генерации хеша."""

import base64
import hashlib
import hmac
import secrets
import sys

SCRYPT_N = 2**14
SCRYPT_R = 8
SCRYPT_P = 1
DKLEN = 32
SALT_LEN = 16

MAX_N = 2**18
MAX_R = 32
MAX_P = 16
MAX_DKLEN = 64

PREFIX = "scrypt"


def _b64(value: bytes) -> str:
    return base64.b64encode(value).decode("ascii")


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(SALT_LEN)
    digest = hashlib.scrypt(
        password.encode("utf-8"),
        salt=salt,
        n=SCRYPT_N,
        r=SCRYPT_R,
        p=SCRYPT_P,
        dklen=DKLEN,
    )
    return f"{PREFIX}${SCRYPT_N}${SCRYPT_R}${SCRYPT_P}${_b64(salt)}${_b64(digest)}"


def _params(n: int, r: int, p: int) -> bool:
    return (
        2 <= n <= MAX_N
        and n & (n - 1) == 0
        and 1 <= r <= MAX_R
        and 1 <= p <= MAX_P
    )


def verify_password(password: str, stored: str) -> bool:
    if not stored or not password:
        return False
    try:
        scheme, raw_n, raw_r, raw_p, raw_salt, raw_hash = stored.split("$")
        if scheme != PREFIX:
            return False
        n, r, p = int(raw_n), int(raw_r), int(raw_p)
        if not _params(n, r, p):
            return False
        salt = base64.b64decode(raw_salt, validate=True)
        expected = base64.b64decode(raw_hash, validate=True)
        if not salt or not 0 < len(expected) <= MAX_DKLEN:
            return False
        digest = hashlib.scrypt(
            password.encode("utf-8"), salt=salt, n=n, r=r, p=p, dklen=len(expected)
        )
    except (ValueError, TypeError, AttributeError, MemoryError):
        return False
    return hmac.compare_digest(digest, expected)


def main(argv: list[str] | None = None) -> int:
    args = sys.argv[1:] if argv is None else argv
    if len(args) != 1 or not args[0]:
        print('использование: python -m app.passwords "пароль"', file=sys.stderr)
        return 2
    print(hash_password(args[0]))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
