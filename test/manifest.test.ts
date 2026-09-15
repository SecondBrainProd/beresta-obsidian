import { describe, expect, test } from "vitest";

import manifest from "../manifest.json";
import versions from "../versions.json";

// Требования каталога плагинов Obsidian, проверенные тестом, а не памятью.
//
// Их соблюдают с первого коммита, а не подгоняют перед подачей: подгонка
// означает, что месяцы кода писались против одних правил, а сдаются по другим.
//
// Источник — «Submission requirements for plugins» и «Developer policies».
// **Адреса поправлены 20260816: оба документа переехали**, по прежним путям
// (`docs.obsidian.md/Plugins/Releasing/Submission+requirements+for+plugins`,
// `docs.obsidian.md/Developer+policies`) сегодня 404. Живые:
//
//   https://docs.obsidian.md/Community+directory/Submission+requirements+for+plugins
//   https://docs.obsidian.md/Community+directory/Developer+policies
//
// Заодно переехала и сама подача: не запрос на слияние в `obsidian-releases`, а
// форма на `community.obsidian.md`. Разбор — `docs/obsidian-catalog-submission.md`.
describe("манифест проходит требования каталога", () => {
  test("описание не длиннее 250 знаков и заканчивается точкой", () => {
    expect(manifest.description.length).toBeLessThanOrEqual(250);
    expect(manifest.description.endsWith(".")).toBe(true);
  });

  test("в описании нет эмодзи", () => {
    expect(/\p{Extended_Pictographic}/u.test(manifest.description)).toBe(false);
  });

  test("описание не начинается с «This is a plugin»", () => {
    expect(manifest.description.startsWith("This is a plugin")).toBe(false);
  });

  // ⚠️ **Поле теперь ОБЪЯВЛЕНО явным `false`, а не опущено** (проверка каталога
  // 20260915: «Manifest is missing an optional but recommended field»).
  // Прежде эта проверка требовала его отсутствия — молчание читалось как
  // «плагин не настольный», и это было верно по смыслу, но каталог видит в нём
  // недосмотр, а не решение. Смысл не изменился: сети и Node в плагине нет,
  // снимок читается через `vault.adapter`, и на телефоне Beresta пишет его
  // сама.
  test("плагин объявлен не настольным: сети и Node в нём нет", () => {
    expect((manifest as Record<string, unknown>).isDesktopOnly).toBe(false);
  });

  // Действующее правило (проверено 20260816) запрещает «obsidian» только в
  // `id`: «The `id` must be unique across all published plugins and can't
  // contain `obsidian`». Наша проверка СТРОЖЕ действующего правила — она
  // держит ещё и `name`, и слово «plugin»: оба слова в списке плагинов
  // подразумеваются и только удлиняют строку. Ослаблять её незачем — имя
  // «Beresta» проходит и так, — но и ссылаться на неё как на требование
  // каталога нельзя: требование меньше.
  test("в идентификаторе и названии нет слов «obsidian» и «plugin»", () => {
    for (const value of [manifest.id, manifest.name]) {
      expect(value.toLowerCase()).not.toContain("obsidian");
      expect(value.toLowerCase()).not.toContain("plugin");
    }
  });

  // Написание названий чужих продуктов каталог проверяет глазами; проверим
  // сами. Ловится «obsidian» строчной буквой в середине предложения,
  // «markdown» и «Epub» — но не «Obsidian.md» в конце предложения.
  test("Obsidian, Markdown, EPUB и PDF написаны правильно", () => {
    const wrong = [/\bobsidian\b/, /\bmarkdown\b/, /\bMardown\b/, /\bEpub\b/, /\bepub\b/, /\bPdf\b/];
    for (const pattern of wrong) {
      expect(manifest.description).not.toMatch(pattern);
    }
  });

  // ⚠️ **Планка поднята до 1.7.2 проверкой каталога 20260915.** Заявку
  // завернули с ошибкой `obsidianmd/no-unsupported-api`: `revealLeaf`
  // (`main.ts`, показ панели столкновений) объявлен в `obsidian.d.ts` как
  // `@since 1.7.2`, а манифест обещал работу с 1.4.0. Обещание работать там,
  // где работать нечем, — ровно то, что правило и ловит.
  //
  // Прежнее обоснование планки — `vault.process` — при этом оказалось
  // неточным: сегодняшний `obsidian.d.ts` помечает его `@since 1.1.0`, а не
  // 1.4.0. Запись держится на нём по-прежнему, но планку задаёт не он.
  test("minAppVersion не ниже 1.7.2 — планку задаёт revealLeaf", () => {
    const [major, minor, patch] = manifest.minAppVersion.split(".").map(Number);
    expect(major).toBeGreaterThanOrEqual(1);
    expect(major > 1 || minor > 7 || (minor === 7 && patch >= 2)).toBe(true);
  });


  test("версия плагина указана в versions.json с той же планкой", () => {
    const table = versions as Record<string, string>;
    expect(table[manifest.version]).toBe(manifest.minAppVersion);
  });

  // Поле только для служб финансовой поддержки. Донатов нет — поля нет:
  // пустая или чужая ссылка в этом поле каталогом отклоняется.
  test("fundingUrl не объявлен, пока владелец не решил иначе", () => {
    expect((manifest as Record<string, unknown>).fundingUrl).toBeUndefined();
  });
});
