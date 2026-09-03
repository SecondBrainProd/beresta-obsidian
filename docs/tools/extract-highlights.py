#!/usr/bin/env python3
"""Достаёт выписки из папки `.beresta/` — без Beresta, Obsidian, SQLite и сети.

Это второй критерий владельца, выраженный работающим кодом: данные принадлежат
человеку, даже если приложения больше нет. Скрипт держится в сорок строк
нарочно — он не средство, а доказательство, что средство можно написать за
вечер по одному только `docs/vault-export.md`. Ничего, кроме стандартной
библиотеки Python: `json` и `pathlib`. Ни одного импорта, который умеет в сеть.

    python3 docs/tools/extract-highlights.py <хранилище> [--json]

Читается ровно то, что лежит на диске: `<хранилище>/.beresta/index.json`
называет осколки, каждый осколок — обычный JSON-LD по словарю W3C Web
Annotation. Цитата берётся из `TextQuoteSelector` (а если её там нет —
из запасного `beresta:text`), путь по оглавлению из `beresta:chapterPath`,
своя мысль — из тела с назначением `commenting`.
"""

import json
import sys
from pathlib import Path


def quote_of(item):
    """Цитата: сперва якорь в книге, потом запасное поле."""
    for selector in item.get("target", {}).get("selector", []) or []:
        if selector.get("type") == "TextQuoteSelector" and selector.get("exact"):
            return selector["exact"]
    return item.get("beresta:text", "")


def comment_of(item):
    bodies = item.get("body") or []
    bodies = bodies if isinstance(bodies, list) else [bodies]
    return " ".join(b.get("value", "") for b in bodies if b.get("purpose") == "commenting")


def main(root, as_json=False):
    index = json.loads((root / ".beresta" / "index.json").read_text(encoding="utf-8"))
    out, total = [], 0
    for entry in index.get("books", []):
        shard = json.loads((root / ".beresta" / entry["file"]).read_text(encoding="utf-8"))
        book = shard.get("beresta:book", {})
        title = book.get("label", "книга без названия")
        authors = ", ".join(book.get("beresta:authors", []))
        if not as_json:
            print(f"\n=== {title}{' — ' + authors if authors else ''} ===")
        for item in shard.get("first", {}).get("items", []):
            total += 1
            one = {
                "книга": title,
                "автор": authors,
                "путь": " → ".join(item.get("beresta:chapterPath", [])),
                "цитата": quote_of(item),
                "мысль": comment_of(item),
                "создана": item.get("created", ""),
                "изменена": item.get("modified", ""),
            }
            if as_json:
                out.append(one)
                continue
            print(f"\n[{one['создана'][:10]}] {one['путь']}" if one["путь"] else f"\n[{one['создана'][:10]}]")
            print(f"  «{one['цитата']}»" if one["цитата"] else "  (без цитаты: росчерк или закладка)")
            if one["мысль"]:
                print(f"  мысль: {one['мысль']}")
    print(json.dumps(out, ensure_ascii=False, indent=1) if as_json else f"\nвсего выписок: {total}")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit("укажите хранилище: python3 extract-highlights.py <папка> [--json]")
    main(Path(sys.argv[1]), as_json="--json" in sys.argv)
