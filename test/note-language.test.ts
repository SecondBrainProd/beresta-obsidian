import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { stripWarning, warningHead, type KnownSection } from "../src/merge/fuse";
import { DEFAULT_TEMPLATE, defaultTemplate, interfaceLanguage } from "../src/render/defaults";
import { renderSection } from "../src/render/section";
import { noteWords } from "../src/render/words";
import { readSnapshot } from "../src/snapshot";
import type { SnapshotAnnotation, SnapshotBook } from "../src/snapshot/model";
import { runSync } from "../src/sync/pass";
import { FakeVault } from "./harness/vault";

// Слова, которые Beresta пишет В ЗАМЕТКУ, — по языку интерфейса Obsidian (долг
// 0.3а, решение владельца 20260925).
//
// **Беда, которую это лечит.** Шаблон писал «## Выписки из Beresta» ЛЮБОМУ, а
// плагин лежит в каталоге сообщества с полностью английским описанием: первое,
// что видел англоязычный читатель в своей заметке, — русская строка.
//
// ⚠️ **Заголовком дело не кончалось, и это нашла сборка примера заметки
// 20260925.** Замер: 429 русских строк в 24 файлах плагина, из них 18 попадают в
// саму заметку — «Мысль.», «Росчерк», «Подчёркнуто», «стр.», «Открыть в
// Beresta», хвост предупреждения о расхождении. Переведён заголовок и эти 18;
// панели плагина (остальные 411) остаются русскими и ждут слова владельца.
// Поэтому файл называется про ЗАМЕТКУ, а не про заголовок.
//
// ⚠️ **Списка известных заголовков не понадобилось, хотя решение называло его
// первым пунктом.** Секцию опознают МАРКЕРЫ (`merge/zones.ts`), а заголовок
// внутри них — обычный машинный блок с отпечатком в `data.json`. Значит у уже
// собранной заметки заголовок сам переедет на язык интерфейса, а правленный
// рукой — уцелеет и получит жалобу о расхождении. Это проверено отдельно, в
// `merge.test.ts`, и здесь только умолчание.
describe("Слова заметки по языку интерфейса", () => {
  const storage = globalThis.localStorage;

  afterEach(() => {
    if (storage === undefined) {
      delete (globalThis as { localStorage?: unknown }).localStorage;
    } else {
      (globalThis as { localStorage?: unknown }).localStorage = storage;
    }
  });

  function pretendLanguage(value: string | null): void {
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (key: string) => (key === "language" ? value : null),
    };
  }

  test("русский интерфейс — русский заголовок", () => {
    pretendLanguage("ru");
    expect(interfaceLanguage()).toBe("ru");
    expect(defaultTemplate()).toContain("## Выписки из Beresta");
    expect(defaultTemplate()).not.toContain("Highlights from Beresta");
  });

  test("английский интерфейс — английский заголовок", () => {
    pretendLanguage("en");
    expect(defaultTemplate()).toContain("## Highlights from Beresta");
    expect(defaultTemplate()).not.toContain("Выписки из Beresta");
  });

  // ⚠️ Obsidian держит английский интерфейс ОТСУТСТВИЕМ записи, а не словом
  // «en»: у языка по умолчанию ключа в настройках нет. Поэтому пустота — это
  // английский, а не «неизвестно, оставим русский».
  test("языка в настройках нет — это английский, а не русский", () => {
    pretendLanguage(null);
    expect(interfaceLanguage()).toBe("en");
    expect(defaultTemplate()).toContain("## Highlights from Beresta");
  });

  // ⚠️ Настройки бывают недоступны вовсе — проверки в узле, приватное окно,
  // запрещённые данные сайта. Ответ тот же: английский, а не падение.
  test("настройки недоступны — английский, и без исключения", () => {
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: () => {
        throw new Error("хранилище закрыто");
      },
    };
    expect(interfaceLanguage()).toBe("en");
    expect(defaultTemplate()).toContain("## Highlights from Beresta");
  });

  test("незнакомый язык — английский заголовок, а не пустая строка", () => {
    pretendLanguage("zh");
    expect(defaultTemplate()).toContain("## Highlights from Beresta");
  });

  // Всё, кроме переведённых строк, у шаблонов одно и то же: метки подстановки,
  // порядок строк, якоря. Иначе перевод унёс бы с собой разметку.
  //
  // ⚠️ Проверка называет ЧИСЛО расходящихся строк, а не только их содержимое:
  // до 20260925 она утверждала «расходится одна строка» и была права, а перевод
  // подписи мысли сделал её две. Утверждение о числе краснеет и на пропущенном
  // переводе, и на лишнем — то есть остаётся полезным, когда словарь вырастет.
  test("шаблоны расходятся ровно двумя строками: заголовок и подпись мысли", () => {
    pretendLanguage("en");
    const english = defaultTemplate().split("\n");
    const russian = DEFAULT_TEMPLATE.split("\n");
    expect(english.length).toBe(russian.length);

    const differing = russian
      .map((line, at) => (line === english[at] ? undefined : at))
      .filter((at): at is number => at !== undefined);
    expect(differing.length).toBe(2);
    expect(russian[differing[0]]).toBe("## Выписки из Beresta");
    expect(english[differing[0]]).toBe("## Highlights from Beresta");
    expect(russian[differing[1]]).toContain("**Мысль.**");
    expect(english[differing[1]]).toContain("**Thought.**");
    // И подстановка внутри строки уцелела: перевод бьёт по слову, а не по метке.
    expect(english[differing[1]]).toContain("{{comment}}");
  });

  // MARK: - Слова внутри блока

  function annotation(overrides: Partial<SnapshotAnnotation> = {}): SnapshotAnnotation {
    return {
      id: "urn:uuid:CDB6804D-D44E-5717-9835-02F1E493BB6F",
      uuid: "CDB6804D-D44E-5717-9835-02F1E493BB6F",
      bookUUID: "9504E37E-2CE3-5AD4-81F9-35414188FAC9",
      motivation: "highlighting",
      markKind: "highlight",
      created: "2026-08-06T07:06:40Z",
      modified: "2026-08-06T07:07:40Z",
      comment: undefined,
      commentFormat: undefined,
      tags: [],
      selectors: [],
      quote: "Мыслетопливо тратится не на действия, а на решения.",
      strandedText: undefined,
      cfi: "epubcfi(/6/8!/4/2/2)",
      color: "blue",
      colorHex: "#4a90d9",
      sortIndex: "00000#.000001#0000000000",
      pageLabel: undefined,
      chapterPath: ["Часть 2. Мыслетопливо"],
      intent: undefined,
      processed: "raw",
      topic: undefined,
      position: undefined,
      unknown: {},
      ...overrides,
    };
  }

  function book(): SnapshotBook {
    return {
      uuid: "9504E37E-2CE3-5AD4-81F9-35414188FAC9",
      title: "Джедайские техники",
      authors: ["Максим Дорофеев"],
      source: undefined,
      ownThought: undefined,
      shard: "9504E37E-2CE3-5AD4-81F9-35414188FAC9.jsonld",
      total: 1,
      removedTotal: 0,
      updatedAt: "2026-08-06T08:06:40Z",
      sha256: "0".repeat(64),
      annotations: [],
      tombstones: [],
      unknown: {},
    };
  }

  /// Отрисовка одной выписки на заданном языке — шаблон того же языка.
  function render(annotations: SnapshotAnnotation[], language: string): string {
    return renderSection(book(), annotations, defaultTemplate(language), {
      timeZoneOffsetMinutes: 300,
      language,
    });
  }

  // РЕЗ прогнан 20260925: в `kindNoun` (`render/section.ts`) имя вида берётся из
  // русской таблицы минуя переданные слова — покраснела эта проверка и проверка
  // живого прохода ниже, остальные двенадцать остались зелёными.
  test("жест и вид пометки — словами того языка, на котором интерфейс", () => {
    const marks = [
      annotation({ markKind: "underline" }),
      annotation({
        id: "urn:uuid:AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAA0002",
        uuid: "AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAA0002",
        markKind: "ink",
        quote: "Линия на полях",
        strandedText: "Линия на полях",
        pageLabel: "41",
        sortIndex: "00001#.000001#0000000000",
      }),
    ];

    const russian = render(marks, "ru");
    expect(russian).toContain("Подчёркнуто · ");
    expect(russian).toContain("> _Росчерк, стр. 41_");

    const english = render(marks, "en");
    expect(english).toContain("Underlined · ");
    expect(english).toContain("> _Ink, p. 41_");
    // ⚠️ Половина, без которой первая была бы наполовину вакуумной: русского в
    // английской заметке не остаётся НИ СЛОВА. Именно этим перевод заголовка и
    // был неполон — английская голова, русское слово под ней.
    expect(english).not.toContain("Подчёркнуто");
    expect(english).not.toContain("Росчерк");
    expect(english).not.toContain("стр.");
  });

  // ⚠️ Незнакомый вид пометки — не ошибка, а открытый формат
  // (`docs/vault-export.md`, п. 3). Кавычки у языков разные, и подставляется
  // вид как приехал.
  test("незнакомый вид назван на языке интерфейса и в его кавычках", () => {
    const squiggle = [annotation({ markKind: "squiggle", strandedText: undefined })];
    expect(render(squiggle, "ru")).toContain("Пометка «squiggle»");
    expect(render(squiggle, "en")).toContain("Mark “squiggle”");
  });

  // ⚠️ Подпись без даты — единственное место, где ссылка подписывается словами.
  // Негодное время в заметку не пишется вовсе (`formatDate`), и на его месте
  // остаётся именно эта подпись.
  test("ссылка без даты подписана на языке интерфейса", () => {
    const undated = [annotation({ created: "не время" })];
    expect(render(undated, "ru")).toContain("[Открыть в Beresta](beresta://open/");
    expect(render(undated, "en")).toContain("[Open in Beresta](beresta://open/");
  });

  test("подпись мысли человека — на языке интерфейса", () => {
    const withThought = [annotation({ comment: "Сделать по ней дело" })];
    expect(render(withThought, "ru")).toContain("> **Мысль.** Сделать по ней дело");
    expect(render(withThought, "en")).toContain("> **Thought.** Сделать по ней дело");
  });

  // MARK: - Предупреждение о расхождении

  test("голова предупреждения — на языке интерфейса", () => {
    expect(warningHead("ru")).toBe("> [!warning]- Beresta: в приложении текст изменился");
    expect(warningHead("en")).toBe("> [!warning]- Beresta: the text changed in the app");
  });

  // ⚠️ **Самая дорогая проверка этого файла.** Предупреждение снимается перед
  // каждым проходом, чтобы не накапливаться, и опознаётся оно по ЛАТИНСКОЙ
  // голове коллаута. Переведи опознание вместе со словами — и у человека,
  // сменившего язык Obsidian, предупреждения пошли бы по одному за проход.
  //
  // РЕЗ: включите в `WARNING_LINE` (`merge/fuse.ts`) русский хвост — краснеет
  // ровно эта проверка, обеими половинами.
  test("прежнее предупреждение снимается, даже написанное на другом языке", () => {
    for (const language of ["ru", "en"]) {
      const lines = [warningHead(language), "> прежний текст", "", "> цитата", "^hl-1"];
      expect(stripWarning(lines)).toEqual(["> цитата", "^hl-1"]);
    }
  });

  // MARK: - Проводка живого прохода

  // ⚠️ **Без этой проверки весь файл выше был бы про библиотеку, а не про
  // продукт.** Она утверждает то, чего не видно ни из одной проверки выше:
  // заметка, которую проход НАПИСАЛ НА ДИСК, целиком на одном языке — голова
  // секции и слова внутри неё не расходятся. Ровно это расхождение и было бедой:
  // заголовок перевели, слова забыли.
  //
  // РЕЗ прогнан (20260925), и он покраснел: русская таблица в `kindNoun` минуя
  // переданные слова — красная и эта проверка, и «жест и вид пометки» выше.
  //
  // ⚠️ **А вот рез «уберите `language` из настроек отрисовки в `sync/pass.ts`»
  // прогнан и остался ЗЕЛЁНЫМ** — значит явная передача языка проходом НЕ
  // несущая, и говорить, будто её сторожит проверка, было бы неправдой. Причина:
  // у `RenderOptions.language` то же умолчание, что у `defaultTemplate()`, —
  // язык интерфейса. Строка в проходе оставлена нарочно (решение о языке видно
  // в том одном месте, где оно принимается, и там же его заменит настройка, если
  // владелец её захочет), но держится язык умолчанием, а не ею. Сторожить
  // «проход передал» нечем, пока умолчания согласованы; согласованность как раз
  // и сторожит эта проверка.
  describe("проход пишет заметку целиком на языке интерфейса", () => {
    const JEDI = "9504E37E-2CE3-5AD4-81F9-35414188FAC9";
    const NOTE = "Base/Библиотека/Джедайские техники.md";
    let vault: FakeVault;
    let memory: Map<string, KnownSection>;

    beforeEach(() => {
      vault = new FakeVault();
      vault.putSnapshot("owner-library");
      vault.put(NOTE, ["---", "beresta-book-id:", `  - ${JEDI}`, "---", "", "# Книга", ""].join("\n"));
      memory = new Map();
    });

    async function pass(): Promise<string> {
      await runSync({
        snapshot: await readSnapshot(vault),
        bindings: new Map([[NOTE, [JEDI]]]),
        notes: vault,
        backups: vault.backups(),
        memory: {
          get: (path) => memory.get(path),
          set: (path, known) => {
            memory.set(path, known);
          },
        },
        settings: {
          timeZoneOffsetMinutes: 300,
          keepBackups: 5,
          removalShare: 0.2,
          removalCount: 20,
        },
        now: Date.parse("2026-08-12T16:14:03Z"),
        mayCreateSection: new Set([NOTE]),
      });
      return await vault.read(NOTE);
    }

    test("английский интерфейс — в заметке ни одного нашего русского слова", async () => {
      pretendLanguage("en");
      const written = await pass();

      expect(written).toContain("## Highlights from Beresta");
      // В образце владельца есть росчерк, подчёркивание и заметка — то есть все
      // три места, где слово вида пометки попадает в заметку.
      for (const russian of Object.values(noteWords("ru").nouns)) {
        expect(written).not.toContain(`_${russian}`);
      }
      for (const russian of Object.values(noteWords("ru").gestures)) {
        expect(written).not.toContain(`${russian} · `);
      }
      expect(written).not.toContain("**Мысль.**");
      expect(written).toContain("_Underline_");
    });

    test("русский интерфейс — заметка остаётся русской", async () => {
      pretendLanguage("ru");
      const written = await pass();

      expect(written).toContain("## Выписки из Beresta");
      expect(written).toContain("_Подчёркивание_");
      expect(written).not.toContain("Highlights from Beresta");
      expect(written).not.toContain("_Underline_");
    });
  });
});
