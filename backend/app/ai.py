"""DeepSeek: разбивка на части, варианты ответов и конспекты."""

import hashlib
import json
import random
import re
from dataclasses import dataclass, field

import httpx

from . import repo
from .config import get_settings

SYSTEM_PROMPT = (
    "Ты помогаешь студентке готовиться к сессии. На входе название билета и полный текст вопроса. "
    "Разбей материал на части и для каждой части составь вопрос с вариантами ответа и мини-конспект.\n"
    "Правила:\n"
    "- короткий вопрос — одна часть, длинный или составной — от 2 до 5 частей по смыслу "
    "(например: термин, история, применение);\n"
    "- в каждой части 3–4 коротких варианта ответа, ровно один правильный, correct_index считается с нуля;\n"
    "- варианты перемешай: правильный не должен стоять первым, его позиция может быть любой;\n"
    "- note — мини-конспект на 2–4 предложения по теме части, по сути, без воды;\n"
    "- title — короткое название части без нумерации;\n"
    "- question части — вопрос, на который отвечает студентка;\n"
    "- в ответе только JSON-объект, без пояснений и без markdown.\n"
    'Формат ответа: {"parts":[{"title":"...","question":"...","options":["...","..."],'
    '"correct_index":0,"note":"..."}]}'
)

MAX_PARTS = 5

DRAFT_TITLE = "Основное"


class AiError(Exception):
    pass


@dataclass
class AiResult:
    status: str
    parts: list[dict] = field(default_factory=list)
    error: str | None = None


def draft_part(question: str) -> dict:
    return {
        "title": DRAFT_TITLE,
        "question": question,
        "options": [],
        "correct_index": -1,
        "note": "",
    }


def _strip_fences(text: str) -> str:
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```[A-Za-z0-9_-]*\s*", "", cleaned)
        cleaned = re.sub(r"\s*```$", "", cleaned)
    return cleaned


def load_json(text: str):
    if not text or not text.strip():
        return None
    cleaned = _strip_fences(text)
    try:
        return json.loads(cleaned)
    except (ValueError, TypeError):
        pass
    for left, right in (("{", "}"), ("[", "]")):
        start, end = cleaned.find(left), cleaned.rfind(right)
        if start != -1 and end > start:
            try:
                return json.loads(cleaned[start : end + 1])
            except (ValueError, TypeError):
                continue
    return None


def extract_parts(data, depth: int = 0) -> list:
    if data is None or depth > 3:
        return []
    if isinstance(data, list):
        return data
    if not isinstance(data, dict):
        return []
    if isinstance(data.get("parts"), list):
        return data["parts"]
    if "options" in data and "correct_index" in data:
        return [data]
    for value in data.values():
        found = extract_parts(value, depth + 1)
        if found:
            return found
    return []


def _text(value) -> str:
    return "" if value is None else str(value).strip()


def _correct_index(value, options_count: int) -> int:
    try:
        index = int(value)
    except (TypeError, ValueError):
        return 0
    return index if 0 <= index < options_count else 0


def normalize_parts(raw_parts) -> list[dict]:
    if not isinstance(raw_parts, list):
        return []
    result: list[dict] = []
    for item in raw_parts:
        if not isinstance(item, dict):
            continue
        raw_options = item.get("options")
        if not isinstance(raw_options, list):
            continue
        options = [_text(option) for option in raw_options]
        options = [option for option in options if option]
        if len(options) < 2:
            continue
        question = _text(item.get("question")) or _text(item.get("title"))
        result.append(
            {
                "title": _text(item.get("title")) or f"Часть {len(result) + 1}",
                "question": question,
                "options": options[:4],
                "correct_index": _correct_index(item.get("correct_index"), len(options[:4])),
                "note": _text(item.get("note")),
            }
        )
        if len(result) >= MAX_PARTS:
            break
    return result


def parse_content(content: str) -> list[dict]:
    return normalize_parts(extract_parts(load_json(content)))


def shuffle_parts(parts: list[dict]) -> list[dict]:
    """Перемешивает варианты и пересчитывает correct_index под новый порядок."""
    rng = random.SystemRandom()
    shuffled: list[dict] = []
    for part in parts:
        options = list(part["options"])
        if len(options) < 2:
            continue
        order = list(range(len(options)))
        rng.shuffle(order)
        shuffled.append(
            {
                **part,
                "options": [options[index] for index in order],
                "correct_index": order.index(part["correct_index"]),
            }
        )
    return shuffled


def parse_and_shuffle(content: str) -> list[dict]:
    return shuffle_parts(parse_content(content))


def cache_key(title: str, question: str) -> str:
    base = f"{get_settings().deepseek_model}{title}{question}"
    return hashlib.sha256(base.encode()).hexdigest()


def _call_api(title: str, question: str) -> tuple[str, int, int]:
    settings = get_settings()
    payload = {
        "model": settings.deepseek_model,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {
                "role": "user",
                "content": f"Название билета: {title}\n\nТекст вопроса:\n{question}",
            },
        ],
        "response_format": {"type": "json_object"},
        "temperature": 0.2,
        "max_tokens": 2500,
    }
    headers = {
        "Authorization": f"Bearer {settings.deepseek_api_key}",
        "Content-Type": "application/json",
    }
    try:
        with httpx.Client(timeout=settings.deepseek_timeout) as client:
            response = client.post(settings.deepseek_url, json=payload, headers=headers)
    except httpx.HTTPError as exc:
        raise AiError(f"нет связи с DeepSeek: {type(exc).__name__}") from exc

    if response.status_code != 200:
        raise AiError(f"DeepSeek вернул код {response.status_code}")
    try:
        data = response.json()
        content = data["choices"][0]["message"]["content"]
        usage = data.get("usage") or {}
        prompt_tokens = int(usage.get("prompt_tokens") or 0)
        completion_tokens = int(usage.get("completion_tokens") or 0)
    except (ValueError, KeyError, IndexError, TypeError) as exc:
        raise AiError("непонятный ответ DeepSeek") from exc
    return str(content), prompt_tokens, completion_tokens


def cost_rub(prompt_tokens: int, completion_tokens: int) -> float:
    settings = get_settings()
    usd = (
        prompt_tokens / 1_000_000 * settings.price_in_usd
        + completion_tokens / 1_000_000 * settings.price_out_usd
    )
    return round(usd * settings.usd_rub, 6)


def generate_parts(title: str, question: str, kind: str = "ticket") -> AiResult:
    settings = get_settings()
    options = repo.get_settings_map()

    if not options["ai_enabled"]:
        return AiResult(status="manual")
    if not settings.deepseek_api_key:
        return AiResult(status="manual")

    month = repo.month_usage()
    if month["cost_rub"] >= options["monthly_limit_rub"]:
        return AiResult(status="budget")

    key = cache_key(title, question)
    cached = repo.cache_get(key)
    if cached:
        parts = parse_content(cached)
        if parts:
            return AiResult(status="ok", parts=parts)

    try:
        content, prompt_tokens, completion_tokens = _call_api(title, question)
        parts = parse_and_shuffle(content)
        if not parts:
            raise AiError("ИИ вернул ответ без вариантов")
    except AiError as exc:
        return AiResult(status="error", error=str(exc))
    except Exception as exc:  # никаких 5xx из-за ИИ
        return AiResult(status="error", error=f"сбой разбора ответа: {type(exc).__name__}")

    repo.cache_put(key, json.dumps({"parts": parts}, ensure_ascii=False))
    repo.add_usage(
        settings.deepseek_model,
        prompt_tokens,
        completion_tokens,
        cost_rub(prompt_tokens, completion_tokens),
        kind,
    )
    return AiResult(status="ok", parts=parts)
