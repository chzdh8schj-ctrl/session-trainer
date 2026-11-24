import pytest

from app.passwords import hash_password, main, verify_password


def test_hash_format():
    stored = hash_password("пароль")
    parts = stored.split("$")
    assert len(parts) == 6
    assert parts[0] == "scrypt"
    assert parts[1] == "16384"
    assert parts[2] == "8"
    assert parts[3] == "1"


def test_verify_roundtrip():
    stored = hash_password("пароль Машки")
    assert verify_password("пароль Машки", stored) is True
    assert verify_password("пароль маши", stored) is False
    assert verify_password("", stored) is False


def test_different_salts_give_different_hashes():
    assert hash_password("одинаковый") != hash_password("одинаковый")


@pytest.mark.parametrize(
    "stored",
    [
        "",
        "garbage",
        "scrypt",
        "scrypt$16384$8",
        "scrypt$16384$8$1$abc",
        "bcrypt$16384$8$1$aGVsbG8=$aGVsbG8=",
        "scrypt$16384$8$1$!!!$???",
        "scrypt$x$8$1$aGVsbG8=$aGVsbG8=",
        "scrypt$1000$8$1$aGVsbG8=$aGVsbG8=",
        "scrypt$16384$8$0$aGVsbG8=$aGVsbG8=",
        "scrypt$524288$8$1$aGVsbG8=$aGVsbG8=",
        "scrypt$16384$8$1$$",
        "scrypt$16384$8$1$aGVsbG8=$",
    ],
)
def test_broken_hash_returns_false(stored):
    assert verify_password("пароль", stored) is False


def test_verify_accepts_other_parameters():
    import base64
    import hashlib

    salt = b"0123456789abcdef"
    digest = hashlib.scrypt("пароль".encode(), salt=salt, n=2**12, r=8, p=1, dklen=16)
    stored = (
        "scrypt$4096$8$1$"
        + base64.b64encode(salt).decode()
        + "$"
        + base64.b64encode(digest).decode()
    )
    assert verify_password("пароль", stored) is True
    assert verify_password("другой", stored) is False


def test_cli_prints_hash(capsys):
    code = main(["печать"])
    captured = capsys.readouterr()
    assert code == 0
    stored = captured.out.strip()
    assert stored.startswith("scrypt$16384$8$1$")
    assert verify_password("печать", stored)


def test_cli_requires_argument(capsys):
    assert main([]) == 2
    assert main(["один", "два"]) == 2
    assert "использование" in capsys.readouterr().err
