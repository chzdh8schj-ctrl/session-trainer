import httpx
import pytest

from app import ai, repo


def test_parse_plain_json(good_answer):
    parts = ai.parse_content(good_answer)
    assert len(parts) == 2
    assert parts[0]["title"] == "Определение"
    assert parts[0]["correct_index"] == 0
    assert parts[1]["options"] == ["В агрономии", "Нигде", "В металлургии", "В химии"]
    assert parts[1]["note"] == "Учитывают при выращивании культур."


def test_parse_markdown_fence():
    content = (
        "```json\n"
        '{"parts":[{"title":"Т","question":"В?","options":["a","b"],'
        '"correct_index":1,"note":"n"}]}\n'
        "```"
    )
    parts = ai.parse_content(content)
    assert len(parts) == 1
    assert parts[0]["correct_index"] == 1


def test_parse_json_with_surrounding_text():
    content = 'Вот результат:\n{"parts":[{"title":"Т","question":"В?","options":["a","b"],"correct_index":0,"note":"n"}]}\nГотово'
    parts = ai.parse_content(content)
    assert len(parts) == 1


def test_parse_garbage_returns_empty():
    assert ai.parse_content("не json вообще") == []
    assert ai.parse_content("") == []
    assert ai.parse_content("{}") == []
    assert ai.parse_content('{"parts": "нет"}') == []


def test_parse_empty_parts_returns_empty():
    assert ai.parse_content('{"parts": []}') == []


def test_parse_nested_parts():
    content = '{"result":{"parts":[{"title":"Т","question":"В?","options":["a","b","c"],"correct_index":2,"note":"n"}]}}'
    parts = ai.parse_content(content)
    assert len(parts) == 1
    assert parts[0]["correct_index"] == 2


def test_parse_root_list():
    content = '[{"title":"Т","question":"В?","options":["a","b"],"correct_index":0,"note":"n"}]'
    assert len(ai.parse_content(content)) == 1


def test_parse_drops_parts_without_options():
    content = (
        '{"parts":['
        '{"title":"Пустая","question":"В?","options":[],"correct_index":0,"note":"n"},'
        '{"title":"Живая","question":"В?","options":["a","b"],"correct_index":1,"note":"n"}'
        "]}"
    )
    parts = ai.parse_content(content)
    assert [part["title"] for part in parts] == ["Живая"]


def test_parse_fixes_bad_correct_index():
    content = (
        '{"parts":['
        '{"title":"А","question":"В?","options":["a","b"],"correct_index":5,"note":"n"},'
        '{"title":"Б","question":"В?","options":["a","b"],"correct_index":"1","note":"n"},'
        '{"title":"В","question":"В?","options":["a","b"],"correct_index":-1,"note":"n"}'
        "]}"
    )
    indexes = [part["correct_index"] for part in ai.parse_content(content)]
    assert indexes == [0, 1, 0]


def test_parse_caps_options_at_four():
    content = (
        '{"parts":[{"title":"Т","question":"В?","options":["1","2","3","4","5"],'
        '"correct_index":3,"note":"n"}]}'
    )
    parts = ai.parse_content(content)
    assert parts[0]["options"] == ["1", "2", "3", "4"]


def test_parse_drops_single_option_part():
    content = (
        '{"parts":[{"title":"Один","question":"В?","options":["единственный"],'
        '"correct_index":0,"note":"n"}]}'
    )
    assert ai.parse_content(content) == []


ALL_ZERO = (
    '{"parts":['
    '{"title":"Первая","question":"В1?","options":["верно1","ложь1а","ложь1б"],'
    '"correct_index":0,"note":"n1"},'
    '{"title":"Вторая","question":"В2?","options":["верно2","ложь2а","ложь2б","ложь2в"],'
    '"correct_index":0,"note":"n2"},'
    '{"title":"Третья","question":"В3?","options":["верно3","ложь3а","ложь3б"],'
    '"correct_index":0,"note":"n3"},'
    '{"title":"Четвёртая","question":"В4?","options":["верно4","ложь4а","ложь4б"],'
    '"correct_index":0,"note":"n4"}'
    "]}"
)

CORRECT_TEXTS = ["верно1", "верно2", "верно3", "верно4"]


def test_shuffle_keeps_correct_text():
    parts = ai.parse_and_shuffle(ALL_ZERO)
    assert len(parts) == 4
    for part, expected in zip(parts, CORRECT_TEXTS):
        assert part["options"][part["correct_index"]] == expected
        assert len(part["options"]) == len(set(part["options"]))


def test_shuffle_randomizes_position_of_correct_answer():
    indexes = set()
    for _ in range(30):
        parts = ai.parse_and_shuffle(ALL_ZERO)
        for part, expected in zip(parts, CORRECT_TEXTS):
            assert part["options"][part["correct_index"]] == expected
        indexes.add(parts[0]["correct_index"])
    assert len(indexes) > 1


def test_shuffle_is_not_identity_for_every_run():
    positions = []
    for _ in range(30):
        parts = ai.parse_and_shuffle(ALL_ZERO)
        positions.append(tuple(part["correct_index"] for part in parts))
    assert len(set(positions)) > 1


def test_shuffle_drops_single_option_part():
    parts = ai.shuffle_parts(
        [{"title": "Т", "question": "В?", "options": ["единственный"],
          "correct_index": 0, "note": "n"}]
    )
    assert parts == []


def test_generate_caches_shuffled_result(deepseek_key, fake_ai):
    fake = fake_ai(content=ALL_ZERO)
    first = ai.generate_parts("Билет", "Вопрос")
    second = ai.generate_parts("Билет", "Вопрос")
    assert len(fake.calls) == 1
    assert first.status == second.status == "ok"
    assert first.parts == second.parts
    for part, expected in zip(second.parts, CORRECT_TEXTS):
        assert part["options"][part["correct_index"]] == expected


def test_cache_keeps_shuffled_payload(deepseek_key, fake_ai):
    fake_ai(content=ALL_ZERO)
    result = ai.generate_parts("Билет", "Вопрос")
    cached = repo.cache_get(ai.cache_key("Билет", "Вопрос"))
    assert cached
    stored = ai.parse_content(cached)
    assert [part["options"] for part in stored] == [part["options"] for part in result.parts]
    assert [part["correct_index"] for part in stored] == [
        part["correct_index"] for part in result.parts
    ]


def test_generate_records_usage(deepseek_key, fake_ai, good_answer):
    fake = fake_ai(content=good_answer, prompt_tokens=1200, completion_tokens=400)
    result = ai.generate_parts("Билет", "Вопрос")
    assert result.status == "ok"
    assert len(result.parts) == 2
    usage = repo.month_usage()
    assert usage["requests"] == 1
    assert usage["prompt_tokens"] == 1200
    assert usage["completion_tokens"] == 400
    assert usage["cost_rub"] == pytest.approx(0.061884, abs=1e-9)
    assert len(fake.calls) == 1


def test_generate_uses_cache(deepseek_key, fake_ai, good_answer):
    fake = fake_ai(content=good_answer)
    first = ai.generate_parts("Билет", "Вопрос")
    second = ai.generate_parts("Билет", "Вопрос")
    assert first.status == second.status == "ok"
    assert len(fake.calls) == 1
    assert repo.month_usage()["requests"] == 1


def test_generate_http_error_is_error_status(deepseek_key, fake_ai):
    fake_ai(content=None, status_code=500)
    result = ai.generate_parts("Билет", "Вопрос")
    assert result.status == "error"
    assert "500" in (result.error or "")
    assert repo.month_usage()["requests"] == 0


def test_generate_network_error_is_error_status(deepseek_key, fake_ai):
    fake_ai(error=httpx.ConnectError("нет сети"))
    result = ai.generate_parts("Билет", "Вопрос")
    assert result.status == "error"
    assert "нет связи" in (result.error or "")


def test_generate_garbage_is_error_status(deepseek_key, fake_ai):
    fake_ai(content="совсем не json")
    result = ai.generate_parts("Билет", "Вопрос")
    assert result.status == "error"
    assert result.parts == []


def test_generate_without_key_is_manual():
    result = ai.generate_parts("Билет", "Вопрос")
    assert result.status == "manual"
    assert result.parts == []


def test_draft_part_shape():
    draft = ai.draft_part("Полный вопрос")
    assert draft == {
        "title": "Основное",
        "question": "Полный вопрос",
        "options": [],
        "correct_index": -1,
        "note": "",
    }
