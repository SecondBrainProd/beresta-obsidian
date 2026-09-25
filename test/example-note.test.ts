import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { describe, expect, test } from "vitest";

import { merge } from "../src/merge/merge";
import { defaultTemplate } from "../src/render/defaults";
import { renderSection } from "../src/render/section";
import type { SnapshotAnnotation, SnapshotBook } from "../src/snapshot/model";

/**
 * Пример заметки Obsidian — СОБИРАЕТСЯ КОДОМ, а не рисуется руками.
 *
 * **Зачем он нужен.** Отклик беты 20260923: человек написал «хотела бы увидеть
 * пример заметки, сейчас пока на работе, не могу заняться установкой,
 * настройкой». Она решает, стоит ли тратить вечер на настройку, — и ей нужен
 * результат, а не описание результата. Тот же файл идёт на `beresta.page` и в
 * описание плагина в каталоге сообщества.
 *
 * ⚠️ **Почему проверкой, а не скриптом и не руками.** Пример, набранный руками,
 * устареет с первой правкой шаблона и станет врать — ровно так, как врут пометки
 * «сверено ГГГГММДД» в бумагах (`docs/backlog.md`). Здесь он собирается тем же
 * `renderSection`, каким плагин пишет настоящую заметку, и та же проверка
 * сторожит, что в нём есть всё обещанное. Устареет шаблон — покраснеет проверка,
 * а не обманется человек.
 *
 * ⚠️ **Цитаты настоящие, и это не мелочь.** Они вынуты из `meditations.epub` —
 * одной из четырёх книг, которые едут вместе с Берестой
 * (`apps/shared/SampleBooks/`). Значит пример можно ПОВТОРИТЬ: открыть книгу,
 * которая уже стоит в библиотеке, провести по тем же строкам, и заметка выйдет
 * такая же. Выдуманная цитата под именем живого автора дала бы красивее и была
 * бы ложью; книга общественного достояния (Marcus Aurelius, перевод George
 * Long, Standard Ebooks, CC0) такой цены не требует.
 *
 * Пример из НАСТОЯЩЕЙ библиотеки владельца сюда не годится: 287 его выписок —
 * это его чтение, и публиковать их в примере на сайте нельзя.
 *
 * Файлы пишутся по флагу, чтобы обычный прогон не трогал диск:
 *
 *     BERESTA_WRITE_EXAMPLE=1 npx vitest run test/example-note.test.ts
 */
describe("Пример заметки для человека", () => {
  /** Сдвиг Караганды: даты примера постоянны и не зависят от машины. */
  const OFFSET = 300;

  /**
   * Слова ВЫДУМАННОГО ЧИТАТЕЛЯ примера — его мысли, метки, его собственный текст.
   *
   * ⚠️ Они зависят от языка не потому, что плагин переводит текст человека — он
   * его не трогает НИКОГДА. Просто читатель русского примера пишет по-русски, а
   * читатель английского (лендинг `beresta.page`, каталог сообщества) —
   * по-английски. Показать англоязычному человеку русскую мысль на месте его
   * собственной значило бы показать не пример, а чужую заметку.
   */
  function voice(language: string): {
    aboutBook: string;
    aboutQuote: string;
    tags: string[];
    own: string[];
  } {
    if (language === "ru") {
      return {
        aboutBook:
          "Читаю по одной книге за утро. Половина написана как заметки для себя — " +
          "и от этого лучше работает, чем если бы автор писал для читателя.",
        aboutQuote:
          "Утро я и правда начинаю со списка дел, а не со списка людей. " +
          "Попробовать наоборот: кого сегодня встречу и чего от них ждать.",
        tags: ["утро", "стоики"],
        own: [
          "## Зачем читаю",
          "",
          "Хочу набрать привычек, которые держатся без силы воли. Пока главное:",
          "человек сердится не на событие, а на своё суждение о событии.",
        ],
      };
    }
    return {
      aboutBook:
        "One book of it per morning. Half of it reads like notes the author kept " +
        "for himself, and it works better for that than if he had written for me.",
      aboutQuote:
        "My mornings really do start with a list of tasks, never a list of people. " +
        "Try it the other way round: who am I about to meet, and what to expect.",
      tags: ["mornings", "stoics"],
      own: [
        "## Why I am reading this",
        "",
        "I want habits that hold without willpower. So far the main one: a person",
        "is angered not by the event but by their own judgement of it.",
      ],
    };
  }

  /** Книга-образец, как её видит плагин. Адрес — примерный, у каждого свой. */
  function book(language: string): SnapshotBook {
    return {
      uuid: "7C41B0D2-9E5A-5F38-8B64-1D9A3E70C512",
      title: "Meditations",
      authors: ["Marcus Aurelius"],
      source: undefined,
      // Мысль человека о книге целиком — формат базы 1.17. Стоит под
      // заголовком секции, ДО цитат (решение владельца 20260923).
      ownThought: voice(language).aboutBook,
      shard: "7C41B0D2-9E5A-5F38-8B64-1D9A3E70C512.jsonld",
      total: 3,
      removedTotal: 0,
      updatedAt: "2026-09-20T05:41:00Z",
      sha256: "0".repeat(64),
      annotations: [],
      tombstones: [],
      unknown: {},
    };
  }

  function mark(overrides: Partial<SnapshotAnnotation>): SnapshotAnnotation {
    return {
      id: "urn:uuid:00000000-0000-0000-0000-000000000000",
      uuid: "00000000-0000-0000-0000-000000000000",
      bookUUID: "7C41B0D2-9E5A-5F38-8B64-1D9A3E70C512",
      motivation: "highlighting",
      markKind: "highlight",
      created: "2026-09-18T03:12:00Z",
      modified: "2026-09-18T03:12:00Z",
      comment: undefined,
      commentFormat: undefined,
      tags: [],
      selectors: [],
      quote: undefined,
      strandedText: undefined,
      cfi: undefined,
      color: "yellow",
      colorHex: undefined,
      sortIndex: "00000#.000001#0000000000",
      pageLabel: undefined,
      chapterPath: [],
      intent: undefined,
      processed: "raw",
      topic: undefined,
      position: undefined,
      unknown: {},
      ...overrides,
    };
  }

  // ⚠️ Три выписки нарочно РАЗНЫЕ: первая с мыслью человека и метками, вторая
  // голая, третья подчёркиванием. Пример на трёх одинаковых блоках показал бы
  // одну треть того, что умеет заметка, — а человек по нему решает, ставить ли
  // плагин.
  function marksFor(language: string): SnapshotAnnotation[] {
    const said = voice(language);
    return [
    mark({
      id: "urn:uuid:3A6F91C4-5B82-4D17-9E03-8C24F5A1B7D6",
      uuid: "3A6F91C4-5B82-4D17-9E03-8C24F5A1B7D6",
      quote:
        "Begin the morning by saying to thyself, I shall meet with the busybody, " +
        "the ungrateful, arrogant, deceitful, envious, unsocial.",
      cfi: "epubcfi(/6/14!/4/2/4,/1:0,/1:132)",
      chapterPath: ["Book II"],
      color: "yellow",
      comment: said.aboutQuote,
      tags: said.tags,
      created: "2026-09-18T03:12:00Z",
      modified: "2026-09-18T03:12:00Z",
      sortIndex: "00001#.000001#0000000000",
    }),
    mark({
      id: "urn:uuid:5D18E24B-7A63-4F92-B105-2E7C93D4A806",
      uuid: "5D18E24B-7A63-4F92-B105-2E7C93D4A806",
      quote:
        "Such as are thy habitual thoughts, such also will be the character of thy " +
        "mind; for the soul is dyed by the thoughts.",
      cfi: "epubcfi(/6/20!/4/2/30,/1:0,/1:118)",
      chapterPath: ["Book V"],
      color: "green",
      created: "2026-09-19T04:06:00Z",
      modified: "2026-09-19T04:06:00Z",
      sortIndex: "00002#.000001#0000000000",
    }),
    mark({
      id: "urn:uuid:9B7C30A5-1F48-4E56-8D72-6A05B1E9C243",
      uuid: "9B7C30A5-1F48-4E56-8D72-6A05B1E9C243",
      // Подчёркивание, а не выделение: в подписи блока появится слово жеста, и
      // человек видит, что Береста различает, ЧЕМ он помечал.
      markKind: "underline",
      quote:
        "If thou art pained by any external thing, it is not this thing that " +
        "disturbs thee, but thy own judgement about it.",
      cfi: "epubcfi(/6/26!/4/2/86,/1:0,/1:112)",
      chapterPath: ["Book VIII"],
      color: "blue",
      created: "2026-09-20T05:41:00Z",
      modified: "2026-09-20T05:41:00Z",
      sortIndex: "00003#.000001#0000000000",
    }),
    ];
  }

  /**
   * Пример на одном языке — ФАЙЛ, а не отрисовка.
   *
   * ⚠️ **Пример идёт через настоящее слияние, и это обязательно.** Отрисовка
   * даёт секцию, а на диске у каждого блока стоит ещё служебная строка с
   * отпечатком (`%% beresta:hash … %%`), и ключи `beresta-book-id` /
   * `beresta-last-sync` во frontmatter дописывает тоже слияние. Покажи человеку
   * одну отрисовку — и пример разойдётся с тем, что он откроет у себя, ровно
   * теми строками, о которых он спросит первым делом: «а это что за мусор?».
   *
   * Собственный текст человека нарочно БЕЗ наших ключей: пусть в примере будет
   * видно, что их Береста ставит сама, а его строки при этом не двигаются.
   */
  function example(language: string): string {
    const section = renderSection(book(language), marksFor(language), defaultTemplate(language), {
      timeZoneOffsetMinutes: OFFSET,
      language,
    });
    const own = [
      "---",
      "name: Meditations",
      "author: Marcus Aurelius",
      "date: 20260918 0812",
      "tags: 📖",
      "---",
      "",
      "# Meditations",
      "",
      ...voice(language).own,
      "",
    ];
    const merged = merge(own.join("\n"), section, { blocks: {} }, {
      mayCreateSection: true,
      frontmatter: {
        bookIds: ["7C41B0D2-9E5A-5F38-8B64-1D9A3E70C512"],
        lastSync: "20260920 1045",
      },
      language,
    });
    if (merged.refused !== undefined) {
      throw new Error(`пример не собрался: ${merged.message ?? merged.refused}`);
    }
    return merged.text;
  }

  /** Прежняя сборка без слияния — для проверок, которым нужна одна секция. */
  function rendered(language: string): string {
    return renderSection(book(language), marksFor(language), defaultTemplate(language), {
      timeZoneOffsetMinutes: OFFSET,
      language,
    });
  }

  // ⚠️ Проверка НЕ цитирует шаблон и не сверяет файл целиком с образцом: такая
  // сверка краснела бы от любой правки вёрстки и не говорила бы ничего о том,
  // показывает ли пример обещанное. Она считает сама — то, за чем человек в
  // пример и смотрит.
  test("пример показывает всё, за чем человек в него смотрит", () => {
    const note = example("ru");

    // Три цитаты, каждая своим коллаутом и своим цветом разметки.
    expect(note.match(/^> \[!/gm)?.length).toBe(3);
    expect(note).toContain("[!quote|beresta yellow]+");
    expect(note).toContain("[!quote|beresta green]+");
    expect(note).toContain("[!quote|beresta blue]+");

    // Мысль о книге целиком и мысль об одной выписке — две разные вещи, и обе
    // на месте: ими Береста и отличается от выгрузки выделений.
    expect(note).toContain("Читаю по одной книге за утро");
    expect(note).toContain("> **Мысль.** Утро я и правда начинаю");

    // Путь по оглавлению — заголовком коллаута, у каждой выписки свой.
    for (const chapter of ["Book II", "Book V", "Book VIII"]) {
      expect(note).toContain(`+ ${chapter}`);
    }

    // Подпись: жест словом там, где он не «выделение», и дата ссылкой в книгу.
    expect(note).toContain("> Подчёркнуто · [20260920 1041](beresta://open/");
    expect(note).toContain("> [20260919 0906](beresta://open/");

    // Якоря — по ним слияние узнаёт свои блоки и не затирает правку человека.
    // Четыре, а не три: у блока мысли о книге якорь свой, с приставкой
    // `thought-` (`thoughtAnchorFor`), иначе слиянию он был бы не виден.
    expect(note.match(/^\^hl-[0-9a-z-]+$/gm)?.length).toBe(4);
    expect(note.match(/^\^hl-thought-[0-9a-f]{32}$/gm)?.length).toBe(1);

    // Метки человека остаются метками Obsidian, а не текстом.
    expect(note).toContain("> #утро #стоики");

    // И собственный текст человека — снаружи маркеров, до секции.
    expect(note.indexOf("## Зачем читаю")).toBeLessThan(note.indexOf("%% beresta:begin %%"));

    // ⚠️ Ключи Бересты ставит СЛИЯНИЕ, а не человек: в собственном тексте
    // примера их нет вовсе (см. `example`). Если они не появились — пример
    // показывает заметку, которой у человека не будет.
    expect(note).toContain("beresta-book-id:");
    expect(note).toContain("beresta-last-sync: 20260920 1045");
    // Служебная строка отпечатка — та самая, из-за которой пример собирается
    // слиянием, а не отрисовкой. По одной на блок.
    expect(note.match(/^%% beresta:hash hl-[0-9a-z-]+ [0-9a-f]+ %%$/gm)?.length).toBe(4);
    // И ни одна строка отрисовки при слиянии не потерялась: каждая цитата на
    // месте, вместе с подписью и мыслью.
    for (const line of rendered("ru").split("\n")) {
      if (line.startsWith("> ") || line.startsWith("^hl-")) expect(note).toContain(line);
    }
  });

  // ⚠️ Английский пример — не перевод русского, а тот же код на другом языке
  // интерфейса. Он и проверяет заодно, что в примере для лендинга не осталось
  // русских слов: именно этой беды сборка примера 20260925 и нашла.
  test("английский пример не содержит наших русских слов", () => {
    const note = example("en");

    expect(note).toContain("## Highlights from Beresta");
    expect(note).toContain("> **Thought.** My mornings really do start");
    expect(note).toContain("> Underlined · [20260920 1041](beresta://open/");
    expect(note).toContain("> #mornings #stoics");
    expect(note).not.toContain("Выписки из Beresta");
    expect(note).not.toContain("**Мысль.**");
    expect(note).not.toContain("Подчёркнуто");
    // ⚠️ И ни одной русской буквы вовсе: пример уезжает на англоязычный лендинг
    // и в описание плагина, а туда русское слово попадать не имеет права —
    // включая слова выдуманного читателя.
    expect(note).not.toMatch(/[А-Яа-яЁё]/);
  });

  test("примеры пишутся файлами по флагу", () => {
    if (process.env.BERESTA_WRITE_EXAMPLE !== "1") return;
    const written: string[] = [];
    for (const [language, name] of [
      ["ru", "заметка-obsidian.md"],
      ["en", "note-obsidian-en.md"],
    ]) {
      const path = resolve(__dirname, "../../../docs/примеры", name);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, example(language), "utf8");
      written.push(path);
    }
    expect(written.length).toBe(2);
  });
});
