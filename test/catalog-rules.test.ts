import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

// Правила каталога сообщества Obsidian — против кода, который им обязан
// отвечать.
//
// **Зачем сторожем, а не глазами.** Досье подачи
// (`docs/obsidian-catalog-submission.md`) сверено с первоисточниками 20260816,
// и один долг из него — заголовочный тег в интерфейсе — провисел до 20260828.
// Провисел он не потому, что его трудно починить (одна строка), а потому, что
// его нечем было заметить: ни один прогон не подключает `binding-modal`, а
// подставной `Setting` в проверках пуст. И правильную правку, и сломанную
// `make test-plugin` встречал одинаково зелёным.
//
// Здесь проверяется не поведение, а ИСХОДНИК — как в проверке описи чужих
// лицензий. Это дешёвый сторож ровно того рода долга, который иначе замечает
// только проверяющий в каталоге.

const root = fileURLToPath(new URL("../src", import.meta.url));

const sourceFiles = (dir: string): string[] => {
    const found: string[] = [];
    for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) {
            found.push(...sourceFiles(path));
            continue;
        }
        if (name.endsWith(".ts")) found.push(path);
    }
    return found;
};

describe("правила каталога Obsidian", () => {
    // Правило: «Use `setHeading` instead of a `<h1>`, `<h2>`…». Мы выполняем
    // его букву иначе — `div` со своим классом, — потому что `setHeading`
    // приводит внутрь карточки книги чужую строку настроек с рамкой и
    // отступами и отнимает перенос длинного названия. Но заголовочного тега в
    // интерфейсе не остаётся, и вот это и сторожится.
    test("интерфейс не создаёт заголовочных тегов", () => {
        const offenders: string[] = [];
        for (const path of sourceFiles(root)) {
            const text = readFileSync(path, "utf8");
            const found = text.match(/createEl\(\s*["'`]h[1-6]["'`]/g);
            if (found) offenders.push(`${path.slice(root.length + 1)}: ${found.join(", ")}`);
        }
        expect(offenders, `заголовочные теги в интерфейсе: ${offenders.join(" | ")}`).toEqual([]);
    });

    // Правило: «Avoid `innerHTML`, `outerHTML` and `insertAdjacentHTML`».
    // Стоит рядом и по той же причине: заметить его нечем, а цена — отказ в
    // каталоге. Проверка заведена вместе с первой, пока правило свежо.
    test("разметка не собирается строкой", () => {
        const offenders: string[] = [];
        for (const path of sourceFiles(root)) {
            const text = readFileSync(path, "utf8");
            const found = text.match(/\.(innerHTML|outerHTML|insertAdjacentHTML)\b/g);
            if (found) offenders.push(`${path.slice(root.length + 1)}: ${found.join(", ")}`);
        }
        expect(offenders, `сборка разметки строкой: ${offenders.join(" | ")}`).toEqual([]);
    });
});
