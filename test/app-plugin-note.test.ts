import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

import {
  INTERVAL_FIELD,
  KEEP_BACKUPS_FIELD,
  OFFSET_FIELD,
  REMOVAL_COUNT_FIELD,
} from "../src/settings";

// Текст приложения про настройки плагина — против самих настроек плагина.
//
// **Живая находка 20260822.** Слепая приёмка прошла путь целиком: раздел
// «Выгрузка в Obsidian» в приложении → по его же подсказке в Obsidian →
// «Сторонние плагины» → «Beresta». Текст обещал три настройки, включая шаблон
// секции; в плагине их было пять, и шаблона среди них не значилось. Подсказка
// вела туда, где обещанного не существует.
//
// **Почему проверка живёт здесь.** Она обязана видеть обе стороны шва: имена
// настроек — константы плагина, текст — каталог строк приложения. Из vitest
// читаются оба; из Swift-теста имена плагина не достать, не разобрав его
// исходник вторым способом. Тот же приём уже держит границу формата выгрузки
// (`vault-export-doc.test.ts`).
//
// **Что именно сторожится.** Не дословное совпадение — текст человеческий, и
// «часовой пояс» в нём законно стоит без слова «выписок». Сторожится другое:
// каждая настройка плагина в тексте УПОМЯНУТА (по ключевому слову своего
// имени), и текст не называет настройки, которой в плагине нет.
const STRINGS = fileURLToPath(
  new URL("../../../apps/shared/Resources/Localizable.xcstrings", import.meta.url),
);

function appNote(): string {
  const catalogue = JSON.parse(readFileSync(STRINGS, "utf8")) as {
    strings: Record<string, { localizations?: Record<string, { stringUnit?: { value?: string } }> }>;
  };
  const entry = catalogue.strings["settings.obsidian.plugin.note"];
  const value = entry?.localizations?.ru?.stringUnit?.value;
  if (typeof value !== "string") {
    throw new Error("в каталоге строк приложения нет русского текста про плагин");
  }
  return value.toLowerCase();
}

describe("Текст приложения про настройки плагина", () => {
  test("каждая настройка плагина в тексте упомянута", () => {
    // Ключевое слово имени, по которому настройку узнаёт человек. Не всё имя:
    // текст пересказывает, а не цитирует.
    const settings: Array<{ what: string; keyword: string }> = [
      { what: "шаблон секции выписок", keyword: "шаблон" },
      { what: "папка для новых заметок", keyword: "папка" },
      { what: OFFSET_FIELD.name, keyword: "часовой пояс" },
      { what: INTERVAL_FIELD.name, keyword: "как часто" },
      { what: KEEP_BACKUPS_FIELD.name, keyword: "версий" },
      { what: REMOVAL_COUNT_FIELD.name, keyword: "предохранитель" },
    ];

    const note = appNote();
    const missing = settings.filter(({ keyword }) => !note.includes(keyword.toLowerCase()));

    expect(
      missing.map(({ what }) => what),
      "приложение не рассказывает про настройки, которые в плагине есть: человек их не найдёт",
    ).toEqual([]);
  });

  test("текст не обещает настроек, которых в плагине нет", () => {
    // Слова, которые появились бы в тексте, опиши он несуществующее. Список
    // держится коротким нарочно: он ловит выдуманное, а не сторожит стиль.
    const notThere = ["автосохранение", "синхронизац", "экспорт по расписанию", "пароль"];
    const note = appNote();
    const invented = notThere.filter((word) => note.includes(word));

    expect(invented, "приложение обещает настройки, которых в плагине нет").toEqual([]);
  });

  test("дорога до настроек названа целиком", () => {
    const note = appNote();
    // Без любого из трёх шагов человек не дойдёт: приёмка прошла ровно по ним.
    for (const step of ["obsidian", "настройки", "сторонние плагины", "beresta"]) {
      expect(note, `в дороге до настроек плагина пропущен шаг «${step}»`).toContain(step);
    }
  });
});
