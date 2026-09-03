import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

import { DEFAULT_TEMPLATE } from "../src/render/defaults";
import { LINK_CFI_QUERY, LINK_HOST, LINK_SCHEME, bookOpenLink } from "../src/render/link";
import {
  ANCHOR_PREFIX,
  SECTION_BEGIN,
  SECTION_END,
  anchorFor,
  renderBookBody,
  renderSection,
  wrapSection,
} from "../src/render/section";
import { TemplateError, renderTemplate } from "../src/render/template";
import { readSnapshot, type Snapshot, type SnapshotAnnotation, type SnapshotBook, type SnapshotSource } from "../src/snapshot";
import { stampOf } from "../src/status";
import { writeVerdict } from "../src/write/gate";

/**
 * Отрисовка управляемой секции.
 *
 * **Что здесь проверяется и чего здесь нет.** Отрисовка — чистая функция от
 * данных к строке, поэтому проверяется целиком обычными тестами: ни Obsidian,
 * ни хранилища, ни файлов. Чего здесь НЕТ и быть не может: как эта строка
 * выглядит в отрисованном виде (замер задачи 2 на живом Obsidian) и как она
 * ложится в заметку человека рядом с его текстом (задача 11 — слияние, задача
 * 13 — шов на копии его хранилища).
 *
 * **Особые случаи взяты из общего со Swift образца, а не выдуманы.** У
 * владельца сегодня 287 выписок, и все 287 — `highlight` с цитатой, без меток,
 * без своей мысли у 264 из них. То есть на его данных ветки «росчерк без
 * цитаты», «метки», «выписка без книги» не выполняются НИ РАЗУ — и зелёный
 * тест на живой библиотеке про них не говорит ничего. Шов 1 на этом уже
 * споткнулся: вырез остался зелёным, потому что вырезанная ветка не работала.
 */

const FIXTURES = fileURLToPath(new URL("fixtures", import.meta.url));

/** Сдвиг владельца, UTC+5 (Караганда) — чтобы даты в проверках были постоянны. */
const OFFSET = { timeZoneOffsetMinutes: 300 };

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
    chapterPath: ["Часть 2. Мыслетопливо", "Ментальный шейлок"],
    intent: undefined,
    processed: "raw",
    topic: undefined,
    position: undefined,
    unknown: {},
    ...overrides,
  };
}

function book(overrides: Partial<SnapshotBook> = {}): SnapshotBook {
  return {
    uuid: "9504E37E-2CE3-5AD4-81F9-35414188FAC9",
    title: "Джедайские техники",
    authors: ["Максим Дорофеев"],
    source: undefined,
    shard: "9504E37E-2CE3-5AD4-81F9-35414188FAC9.jsonld",
    total: 1,
    removedTotal: 0,
    updatedAt: "2026-08-06T08:06:40Z",
    sha256: "0".repeat(64),
    annotations: [],
    tombstones: [],
    unknown: {},
    ...overrides,
  };
}

/** Уникальная выписка номер `n` — свой адрес, своё место в порядке чтения. */
function nth(n: number, overrides: Partial<SnapshotAnnotation> = {}): SnapshotAnnotation {
  const tail = String(n).padStart(4, "0");
  return annotation({
    id: `urn:uuid:AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAA${tail}`,
    uuid: `AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAA${tail}`,
    sortIndex: `${String(n).padStart(5, "0")}#.000001#0000000000`,
    quote: `Цитата номер ${n}.`,
    ...overrides,
  });
}

function lines(section: string): string[] {
  return section.split("\n");
}

function anchors(section: string): string[] {
  return [...section.matchAll(/\^hl-[0-9a-f]+/g)].map((match) => match[0]);
}

describe("отрисовка секции", () => {
  // Вырежьте в `render` ветку «пустое значение — кусок не рисуется» — тест
  // обязан упасть: под цитатой появятся разделитель и слово «Мысль».
  test("выписка без своей мысли не порождает пустого подзаголовка", () => {
    const out = renderSection(book(), [annotation({ comment: undefined })], DEFAULT_TEMPLATE, OFFSET);
    expect(out).not.toContain("Мысль");
    expect(out).not.toMatch(/\n>\s*\n>\s*$/m);
    expect(lines(out).filter((line) => line.trim() === ">")).toHaveLength(0);
  });

  test("выписка со своей мыслью подзаголовок получает", () => {
    const out = renderSection(
      book(),
      [annotation({ comment: "Сделать по ней дело" })],
      DEFAULT_TEMPLATE,
      OFFSET,
    );
    expect(out).toContain("> **Мысль.** Сделать по ней дело");
    // Разделитель между цитатой и мыслью — ровно один, и он есть только здесь.
    expect(lines(out).filter((line) => line === ">")).toHaveLength(1);
  });

  // Вырежьте вырождение заголовка (`return book.title ?? ""`) — тест обязан
  // упасть: в заголовке коллаута окажется пустота или `undefined`.
  test("без пути по оглавлению заголовок не пустой", () => {
    const out = renderSection(book(), [annotation({ chapterPath: [] })], DEFAULT_TEMPLATE, OFFSET);
    expect(out).not.toContain("[!quote|beresta blue]+ \n");
    expect(out).not.toContain("undefined");
    expect(out).toContain("> [!quote|beresta blue]+ Джедайские техники");
  });

  test("нет ни пути, ни названия — заголовка нет, но и мусора нет", () => {
    const out = renderSection(
      book({ title: undefined }),
      [annotation({ chapterPath: [] })],
      DEFAULT_TEMPLATE,
      OFFSET,
    );
    expect(out).toContain("> [!quote|beresta blue]+\n");
    expect(out).not.toContain("[!quote|beresta blue]+ \n");
    expect(out).not.toContain("undefined");
  });

  test("многоуровневый путь по оглавлению доезжает до заголовка целиком", () => {
    const out = renderSection(book(), [annotation()], DEFAULT_TEMPLATE, OFFSET);
    expect(out).toContain("> [!quote|beresta blue]+ Часть 2. Мыслетопливо → Ментальный шейлок");
  });

  // Вырежьте сортировку в `renderBookBody` — тест обязан упасть: тот же набор,
  // поданный в другом порядке, даст другие байты.
  test("две отрисовки одних данных совпадают побайтово", () => {
    const many = [nth(1), nth(2), nth(3), nth(4)];
    const shuffled = [many[2]!, many[0]!, many[3]!, many[1]!];
    expect(renderSection(book(), shuffled, DEFAULT_TEMPLATE, OFFSET)).toBe(
      renderSection(book(), many, DEFAULT_TEMPLATE, OFFSET),
    );
  });

  test("порядок блоков — порядок чтения, а не порядок прихода", () => {
    const out = renderSection(book(), [nth(3), nth(1), nth(2)], DEFAULT_TEMPLATE, OFFSET);
    expect(out.indexOf("Цитата номер 1.")).toBeLessThan(out.indexOf("Цитата номер 2."));
    expect(out.indexOf("Цитата номер 2.")).toBeLessThan(out.indexOf("Цитата номер 3."));
  });

  // Вырежьте в `anchorFor` полноту `uuid` (урежьте до восьми знаков) — тест
  // обязан упасть: два адреса, различающиеся последним знаком, дадут один якорь.
  test("якоря внутри файла не сталкиваются", () => {
    const colliding = [nth(1), nth(2), nth(3)];
    const found = anchors(renderSection(book(), colliding, DEFAULT_TEMPLATE, OFFSET));
    expect(found).toHaveLength(3);
    expect(new Set(found).size).toBe(found.length);
  });

  test("якорь зависит от самой выписки, а не от соседей", () => {
    const three = [nth(1), nth(2), nth(3)];
    const withoutMiddle = [nth(1), nth(3)];
    const all = anchors(renderSection(book(), three, DEFAULT_TEMPLATE, OFFSET));
    const rest = anchors(renderSection(book(), withoutMiddle, DEFAULT_TEMPLATE, OFFSET));
    // Удалили одну выписку — якоря оставшихся обязаны остаться теми же. Иначе
    // задача 11 увидит, что прежние блоки исчезли, и заведёт рядом дубликаты.
    expect(rest).toEqual([all[0]!, all[2]!]);
  });

  test("якорь виден глазами как адрес выписки в приложении", () => {
    const out = renderSection(book(), [annotation()], DEFAULT_TEMPLATE, OFFSET);
    expect(out).toContain(`^${ANCHOR_PREFIX}cdb6804dd44e5717983502f1e493bb6f`);
  });

  test("адрес не в виде uuid тоже получает якорь той же формы", () => {
    const foreign = annotation({ id: "https://example.test/annotation/17", uuid: undefined });
    expect(anchorFor(foreign)).toMatch(/^hl-[0-9a-f]{32}$/);
  });

  // Вырежьте в `citationText` ветку слов (оставьте `return quote ?? ""`) — тест
  // обязан упасть: в коллауте появится пустая строка вместо цитаты.
  test("росчерк без цитаты не рисует пустую цитаты", () => {
    const ink = annotation({
      markKind: "ink",
      quote: undefined,
      cfi: undefined,
      pageLabel: "41",
      position: '{"pageIndex":40,"type":"ink"}',
    });
    const out = renderSection(book(), [ink], DEFAULT_TEMPLATE, OFFSET);
    expect(out).toContain("> _Росчерк, стр. 41_");
    expect(lines(out).filter((line) => line === ">")).toHaveLength(0);
    expect(out).not.toContain("undefined");
  });

  test("подчёркивание без якоря-цитаты названо словами, а не пустотой", () => {
    const underline = annotation({ markKind: "underline", quote: undefined, pageLabel: undefined });
    const out = renderSection(book(), [underline], DEFAULT_TEMPLATE, OFFSET);
    expect(out).toContain("> _Подчёркивание_");
  });

  // Вырежьте наследование отступа в `indented` — тест обязан упасть: второй
  // абзац цитаты уедет из коллаута в зону человека.
  test("цитата в несколько абзацев не разваливает коллаут", () => {
    const long = annotation({ quote: "Первый абзац.\n\nВторой абзац." });
    const out = renderBookBody(book(), [long], DEFAULT_TEMPLATE, OFFSET);
    const body = lines(out).filter((line) => line !== "" && !line.startsWith("#"));
    // Каждая строка тела блока либо внутри коллаута, либо якорь. Строки без
    // «>» и без «^» здесь быть не может — это и есть побег из коллаута.
    for (const line of body) {
      expect(line.startsWith(">") || line.startsWith("^")).toBe(true);
    }
    expect(out).toContain("> Первый абзац.\n>\n> Второй абзац.");
  });

  test("подпись — дата выделения, ведущая в то самое место книги", () => {
    const out = renderSection(book(), [annotation()], DEFAULT_TEMPLATE, OFFSET);
    // Время в файле — 07:06:40Z, сдвиг владельца +5, значит 12:06.
    expect(out).toContain(
      "> [20260806 1206](beresta://open/9504E37E-2CE3-5AD4-81F9-35414188FAC9" +
        "?cfi=epubcfi%28%2F6%2F8%21%2F4%2F2%2F2%29)",
    );
  });

  /**
   * Один плагин — одна дата.
   *
   * Прогон глазами 20260818 (п. 11): во frontmatter `beresta-last-sync:
   * 20260818 1047`, а строкой ниже, в подписи блока, `19.08.2023 12:30`. Обе
   * написала Beresta. Вырежьте новый формат из `formatDate` — этот тест обязан
   * упасть: он и есть то место, где два формата в одной заметке становятся
   * невозможными.
   */
  test("дата блока — тот же формат, что у отметки во frontmatter", () => {
    const out = renderSection(book(), [annotation()], DEFAULT_TEMPLATE, OFFSET);
    const signature = lines(out).find((line) => line.includes("beresta://open/"));
    expect(signature).toBeDefined();
    // Ровно то, что печатает `stampOf` для строки состояния и `beresta-last-sync`.
    expect(signature).toContain(stampOf("2026-08-06T07:06:40Z", 300));
    // Ни точек в дате, ни двоеточия в часах — этого формата у владельца нет.
    expect(signature).not.toMatch(/\d{2}\.\d{2}\.\d{4}/);
    expect(signature).not.toMatch(/\[\d{8} \d{2}:\d{2}\]/);
  });

  test("сдвиг времени — вход, а не привычка машины", () => {
    const asUTC = renderSection(book(), [annotation()], DEFAULT_TEMPLATE, {
      timeZoneOffsetMinutes: 0,
    });
    expect(asUTC).toContain("[20260806 0706]");
  });

  test("выписка без книги: ссылки нет, дата остаётся", () => {
    const orphan = annotation({ cfi: undefined });
    const out = renderSection(book({ uuid: "", title: undefined }), [orphan], DEFAULT_TEMPLATE, OFFSET);
    expect(out).not.toContain("beresta://");
    expect(out).toContain("> 20260806 1206");
    expect(lines(out).filter((line) => line === ">")).toHaveLength(0);
  });

  test("негодное время не пишет в заметку слов «Invalid Date»", () => {
    const broken = annotation({ created: "позавчера" });
    const out = renderSection(book(), [broken], DEFAULT_TEMPLATE, OFFSET);
    expect(out).not.toContain("Invalid");
    expect(out).not.toContain("NaN");
    expect(out).toContain("> [Открыть в Beresta](beresta://open/");
  });

  test("метки: годная становится меткой, негодная остаётся текстом", () => {
    const tagged = annotation({ tags: ["внимание", "метод", "две мысли", "2026"] });
    const out = renderSection(book(), [tagged], DEFAULT_TEMPLATE, OFFSET);
    // «две мысли» с пробелом меткой Obsidian быть не может: в панели меток
    // хранилища из неё вышла бы половина. «2026» — тоже: чисто числовые метки
    // Obsidian не признаёт. Данные при этом не выбрасываются.
    expect(out).toContain("> #внимание #метод две мысли 2026");
  });

  test("меток нет — нет ни строки, ни разделителя", () => {
    const out = renderSection(book(), [annotation({ tags: [] })], DEFAULT_TEMPLATE, OFFSET);
    expect(lines(out).filter((line) => line.startsWith("> #"))).toHaveLength(0);
    expect(lines(out).filter((line) => line === ">")).toHaveLength(0);
  });

  test("хвостовых пробелов нет ни в одной строке", () => {
    const out = renderSection(
      book({ title: undefined }),
      [annotation({ chapterPath: [], comment: "мысль" })],
      DEFAULT_TEMPLATE,
      OFFSET,
    );
    // Два пробела на конце строки — жёсткий перенос Markdown, а ещё это байты,
    // отличающие две одинаковые с виду секции: задача 11 сочтёт их правкой.
    for (const line of lines(out)) expect(line).toBe(line.replace(/[\t ]+$/, ""));
  });
});

/**
 * Разметка книги в заметке: росчерк, подчёркивание, цвет.
 *
 * Находка 10 прогона глазами 20260818. Три отдельные лжи одного места:
 * росчерк (пометка без цитаты) стоял в заметке коллаутом `[!quote]` и читался
 * как прямая речь автора; подчёркивание рисовалось неотличимо от выделения;
 * четыре цвета разметки не доезжали до заметки вовсе.
 *
 * Проверки здесь на то и стоят, что на живых данных владельца НЕ выполняются:
 * у него сегодня все 287 выписок — `highlight` с якорем-цитатой, синие. То
 * есть зелёный тест на его библиотеке про эти ветки не говорит ничего.
 */
describe("разметка книги доезжает до заметки честно", () => {
  /** Росчерк как он приезжает из приложения: текст есть, якоря под ним нет. */
  function ink(overrides: Partial<SnapshotAnnotation> = {}): SnapshotAnnotation {
    return annotation({
      markKind: "ink",
      // Так их и слил разборщик: якоря-цитаты нет, значит `quote` взят из
      // `beresta:text` — см. `parseItem` в `snapshot/shard.ts`.
      quote: "Обведено от руки на полях: «неделя — это единица, месяц — уже отчёт».",
      strandedText: "Обведено от руки на полях: «неделя — это единица, месяц — уже отчёт».",
      position: "page=214;path=M 120 340 L 180 352 L 240 331",
      cfi: undefined,
      pageLabel: "214",
      ...overrides,
    });
  }

  // Вырежьте в `anchoredQuote` сверку со `strandedText` (верните цитату как
  // есть) — тест обязан упасть: росчерк снова станет `[!quote]`, то есть
  // пометка человека снова будет выдана за слова автора книги.
  test("росчерк не выдаётся за цитату из книги", () => {
    const out = renderSection(book(), [ink()], DEFAULT_TEMPLATE, OFFSET);
    expect(out).toContain("> [!note|beresta blue]+");
    expect(out).not.toContain("[!quote");
  });

  test("росчерк назван словом, и его текст доезжает под этим словом", () => {
    const out = renderSection(book(), [ink()], DEFAULT_TEMPLATE, OFFSET);
    const body = lines(out);
    const name = body.findIndex((line) => line === "> _Росчерк, стр. 214_");
    expect(name).toBeGreaterThan(-1);
    // Текст не выброшен — но стоит ПОД именем пометки, а не вместо цитаты.
    expect(body[name + 1]).toBe(
      "> Обведено от руки на полях: «неделя — это единица, месяц — уже отчёт».",
    );
    // Имя пометки сказано ОДИН раз. В подписи его нет: там оно повторяло бы
    // строку, которая стоит двумя строками выше и никуда не делась.
    const signature = body.find((line) => line.includes("beresta://open/"));
    expect(signature).toBe("> [20260806 1206](beresta://open/9504E37E-2CE3-5AD4-81F9-35414188FAC9)");
  });

  test("цитата с якорем остаётся цитатой, даже когда рядом лежит текст без якоря", () => {
    // `beresta:text` бывает и у выписки с якорем — расхождение после подмены
    // файла книги. Тогда цитата настоящая, и блок обязан остаться `[!quote]`.
    const both = annotation({
      quote: "Мыслетопливо тратится не на действия, а на решения.",
      strandedText: "Мыслетопливо тратится не на действия, а на решения (другая редакция).",
    });
    const out = renderSection(book(), [both], DEFAULT_TEMPLATE, OFFSET);
    expect(out).toContain("> [!quote|beresta blue]+");
    expect(out).toContain("> Мыслетопливо тратится не на действия, а на решения.");
  });

  // Вырежьте `gestureOf` (верните пустую строку всегда) — тест обязан упасть:
  // подчёркивание снова станет неотличимо от выделения.
  test("подчёркивание отличимо от выделения", () => {
    const underlined = nth(1, { markKind: "underline" });
    const highlighted = nth(2, { markKind: "highlight" });
    const out = renderSection(book(), [underlined, highlighted], DEFAULT_TEMPLATE, OFFSET);
    const captions = lines(out).filter((line) => line.includes("beresta://open/"));
    expect(captions).toHaveLength(2);
    expect(captions[0]).toContain("Подчёркнуто · [20260806 1206]");
    expect(captions[1]).not.toContain("Подчёркнуто");
  });

  test("выделение молчит: слова «Выделено» в секции нет ни разу", () => {
    const many = [nth(1), nth(2), nth(3)];
    const out = renderSection(book(), many, DEFAULT_TEMPLATE, OFFSET);
    expect(out).not.toContain("Выделено");
    // Подпись обычного выделения — ровно дата со ссылкой, как и была.
    expect(out).toContain("> [20260806 1206](beresta://open/");
    expect(out).not.toContain(" · [20260806 1206]");
  });

  test("незнакомый вид пометки назван, а не проглочен словом «Пометка»", () => {
    const strange = annotation({ markKind: "squiggle", quote: undefined, pageLabel: undefined });
    const out = renderSection(book(), [strange], DEFAULT_TEMPLATE, OFFSET);
    expect(out).toContain("> _Пометка «squiggle»_");
    const marked = annotation({ markKind: "squiggle" });
    expect(renderSection(book(), [marked], DEFAULT_TEMPLATE, OFFSET)).toContain(
      "Пометка «squiggle» · [20260806 1206]",
    );
  });

  // Вырежьте цвет из `calloutHead` (верните один `type`) — тест обязан упасть:
  // разметка четырьмя цветами снова схлопнется в один вид.
  test("цвет доезжает меткой коллаута, а не словом в тексте", () => {
    const yellow = annotation({ color: "yellow", colorHex: "#ffd54f" });
    const out = renderSection(book(), [yellow], DEFAULT_TEMPLATE, OFFSET);
    expect(out).toContain("> [!quote|beresta yellow]+");
    // Имя цвета словом в строке чтения не появляется ни в каком падеже.
    expect(out).not.toMatch(/жёлт/i);
    expect(out).not.toContain("#ffd54f");
  });

  test("цвет блока не зависит от соседей", () => {
    // Соблазн «скрыть самый частый цвет» ломается ровно здесь: правило,
    // зависящее от большинства, переписывало бы всю секцию от одной новой
    // выписки — а переписанный блок в задаче 11 стоит запасной копии.
    const blue = [nth(1), nth(2), nth(3)];
    const yellow = nth(4, { color: "yellow" });
    const alone = renderBookBody(book(), [yellow], DEFAULT_TEMPLATE, OFFSET);
    const amid = renderBookBody(book(), [...blue, yellow], DEFAULT_TEMPLATE, OFFSET);
    const only = (section: string): string[] =>
      lines(section).filter((line) => line.includes("Цитата номер 4") || line.includes("[!"));
    expect(only(amid)).toContain("> [!quote|beresta yellow]+ Часть 2. Мыслетопливо → Ментальный шейлок");
    expect(only(alone)).toContain("> [!quote|beresta yellow]+ Часть 2. Мыслетопливо → Ментальный шейлок");
    expect(lines(alone).filter((line) => line.startsWith("> [!"))).toEqual([
      "> [!quote|beresta yellow]+ Часть 2. Мыслетопливо → Ментальный шейлок",
    ]);
  });

  test("имя цвета, которым можно разломать голову коллаута, в неё не попадает", () => {
    for (const bad of ["ярко жёлтый", "a]b", "quote|note", "\n"]) {
      const out = renderSection(
        book(),
        [annotation({ color: bad })],
        DEFAULT_TEMPLATE,
        OFFSET,
      );
      expect(lines(out).filter((line) => line.startsWith("> [!"))).toEqual([
        "> [!quote|beresta]+ Часть 2. Мыслетопливо → Ментальный шейлок",
      ]);
    }
  });

  test("чужое имя цвета уезжает в метку как есть", () => {
    // Формат открытый: восемь наших имён — не весь список. Незнакомое имя не
    // переводится и не выбрасывается, просто краски для него у нас нет.
    const out = renderSection(book(), [annotation({ color: "teal" })], DEFAULT_TEMPLATE, OFFSET);
    expect(out).toContain("> [!quote|beresta teal]+");
  });

  /**
   * Отрисовка и стиль знают одни и те же имена цветов.
   *
   * Проверка на разъезд двух файлов: метку `[!quote|beresta yellow]` ставит
   * `section.ts`, а красит её `styles.css`, и увидеть глазами, что одно
   * потеряло имя из палитры, можно только на живой книге с этим цветом.
   * Вырежьте из `styles.css` любое из семи имён — тест обязан упасть.
   */
  test("каждое имя палитры, которое красится, названо в стиле дважды", () => {
    const styles = readFileSync(fileURLToPath(new URL("../styles.css", import.meta.url)), "utf8");
    // Восемь имён палитры (`docs/schema/schema.md`) минус `gray`: серую
    // пометку красить нечем и незачем — коллаут `[!quote]` и так серый.
    for (const name of ["blue", "yellow", "green", "red", "purple", "orange", "magenta"]) {
      const rule = `[data-callout-metadata~="beresta"][data-callout-metadata~="${name}"]`;
      expect([name, styles.includes(rule)]).toEqual([name, true]);
    }
    expect(styles).not.toContain('[data-callout-metadata~="gray"]');
    // Ни одного правила по одному лишь имени цвета: красить чужие коллауты —
    // не наше дело. Вырежьте `beresta` из любого правила — тест упадёт.
    for (const rule of styles.split("\n")) {
      if (!rule.trimStart().startsWith(".callout[data-callout")) continue;
      expect([rule, rule.includes('[data-callout-metadata~="beresta"]')]).toEqual([rule, true]);
    }
    // Своих значений цвета в стиле нет ни одного: красят краски темы.
    expect(styles).not.toMatch(/--beresta-mark-color:\s*#/);
    // Пометка без цитаты не заводит СВОЕГО цвета поверх цвета разметки:
    // `[!note]` у Obsidian синий, и на жёлтой пометке спорили бы два цвета.
    // Серое здесь берётся у самого Obsidian — своего значения нет и тут.
    expect(styles).toContain(
      '.callout[data-callout="note"][data-callout-metadata~="beresta"] {\n' +
        "  --callout-color: var(--callout-quote, var(--callout-default));",
    );
  });
});

describe("границы управляемой секции", () => {
  test("секция ограничена ровно одной парой маркеров", () => {
    const out = renderSection(book(), [nth(1), nth(2)], DEFAULT_TEMPLATE, OFFSET);
    expect(lines(out)[0]).toBe(SECTION_BEGIN);
    expect(lines(out)[lines(out).length - 1]).toBe(SECTION_END);
    expect(lines(out).filter((line) => line === SECTION_BEGIN)).toHaveLength(1);
    expect(lines(out).filter((line) => line === SECTION_END)).toHaveLength(1);
  });

  test("две книги в одной заметке — два тела, одна пара маркеров", () => {
    const first = renderBookBody(book(), [nth(1)], DEFAULT_TEMPLATE, OFFSET);
    const second = renderBookBody(
      book({ uuid: "38BF6104-2690-5123-9786-20CA6C64ED88", title: "Путь джедая" }),
      [nth(2)],
      DEFAULT_TEMPLATE,
      OFFSET,
    );
    const section = wrapSection([first, second]);
    expect(lines(section).filter((line) => line === SECTION_BEGIN)).toHaveLength(1);
    expect(lines(section).filter((line) => line === SECTION_END)).toHaveLength(1);
    expect(anchors(section)).toHaveLength(2);
  });

  test("маркер внутри цитаты не выходит наружу коллаута", () => {
    // Текст книги в заметку попадает дословно: экранировать его нельзя — задача
    // 16 требует, чтобы цитата читалась и без Beresta. Защита здесь другая: в
    // шаблоне по умолчанию текст живёт под «> », и строкой-маркером стать не
    // может по устройству.
    const nasty = annotation({ quote: `строка до\n${SECTION_END}\nстрока после` });
    const out = renderSection(book(), [nasty], DEFAULT_TEMPLATE, OFFSET);
    expect(out).toContain(`> ${SECTION_END}`);
    expect(lines(out).filter((line) => line === SECTION_END)).toHaveLength(1);
  });

  // Вырежьте проверку числа маркеров в `wrapSection` — тест обязан упасть:
  // вернётся секция с двумя концами, и задача 11 запишет половину машинного
  // текста в зону человека.
  test("шаблон, выпустивший маркер наружу, не отрисовывается вовсе", () => {
    const bare = "{{#annotations}}{{text}}\n{{/annotations}}";
    const nasty = annotation({ quote: `строка до\n${SECTION_END}\nстрока после` });
    expect(() => renderSection(book(), [nasty], bare, OFFSET)).toThrow(TemplateError);
    expect(() => renderSection(book(), [nasty], bare, OFFSET)).toThrow(/маркер/);
  });

  test("шаблон, повторивший якорь, не отрисовывается вовсе", () => {
    const doubled = "{{#annotations}}\n^{{anchor}}\n^hl-одинаковый\n{{/annotations}}";
    expect(() => renderSection(book(), [nth(1), nth(2)], doubled, OFFSET)).toThrow(/якорь/);
  });
});

describe("шаблон человека ошибается словами", () => {
  const scope = { fields: { comment: "" }, lists: {} };

  // Вырежьте бросок в `lookupField` (верните пустую строку) — тест обязан
  // упасть: опечатка в шаблоне тихо выест кусок заметки.
  test("незнакомое имя — ошибка, а не пустое место", () => {
    expect(() => renderTemplate("{{коммент}}", scope)).toThrow(TemplateError);
    expect(() => renderTemplate("{{cmment}}", scope)).toThrow(/comment/);
  });

  test("незакрытый кусок назван по имени", () => {
    expect(() => renderTemplate("{{#comment}}текст", scope)).toThrow(/не закрыт/);
  });

  test("лишняя закрывающая метка названа по имени", () => {
    expect(() => renderTemplate("текст{{/comment}}", scope)).toThrow(/открывающего/);
  });

  test("куски, закрытые вперемешку, — ошибка", () => {
    const mixed = { fields: { a: "1", b: "2" }, lists: {} };
    expect(() => renderTemplate("{{#a}}{{#b}}{{/a}}{{/b}}", mixed)).toThrow(/в том же порядке/);
  });

  test("обломок скобок — ошибка, а не строка «{{ comment }» в заметке", () => {
    expect(() => renderTemplate("{{ comment }", scope)).toThrow(/без пары/);
  });

  test("ошибка шаблона не порождает текста", () => {
    // Отрисовка либо вернула строку целиком, либо не вернула ничего. Полусекции
    // не существует — значит записывать нечего, и заметка не тронута.
    let produced: string | undefined;
    try {
      produced = renderSection(book(), [annotation()], "{{#annotations}}{{нет}}{{/annotations}}");
    } catch (error) {
      expect(error).toBeInstanceOf(TemplateError);
    }
    expect(produced).toBeUndefined();
  });

  test("метка куска на своей строке не оставляет пустой строки", () => {
    // Пустая строка внутри коллаута его закрывает — поэтому правило Mustache
    // «одинокая метка съедает свою строку» здесь не косметика.
    const out = renderTemplate("до\n{{#a}}\nвнутри\n{{/a}}\nпосле", {
      fields: { a: "да" },
      lists: {},
    });
    expect(out).toBe("до\nвнутри\nпосле");
  });
});

describe("ссылка в приложение совпадает со стороной Swift", () => {
  const swiftSource = fileURLToPath(
    new URL("../../beresta-core/Sources/BerestaCore/Export/DeepLink.swift", import.meta.url),
  );

  function swiftConstant(name: string): string {
    const source = readFileSync(swiftSource, "utf8");
    const match = source.match(new RegExp(`static let ${name}\\s*=\\s*"([^"]*)"`));
    if (!match) {
      throw new Error(
        `в ${swiftSource} нет объявления «static let ${name}». Оно переехало или ` +
          "переименовано — общая граница со Swift потеряна, и её надо восстановить, " +
          "а не убрать эту проверку. Разойдись стороны, ссылка в заметке осталась бы " +
          "живой на вид и не открывала бы ничего.",
      );
    }
    return match[1]!;
  }

  test("схема, узел и имя поля — те же, что объявляет DeepLink", () => {
    expect(LINK_SCHEME).toBe(swiftConstant("scheme"));
    expect(LINK_HOST).toBe(swiftConstant("host"));
    expect(LINK_CFI_QUERY).toBe(swiftConstant("cfiQueryName"));
  });

  test("скобки CFI закодированы — иначе ссылка обрывается в разметке заметки", () => {
    const link = bookOpenLink("9504E37E-2CE3-5AD4-81F9-35414188FAC9", "epubcfi(/6/8!/4/2/2)");
    expect(link).not.toContain("(");
    expect(link).not.toContain(")");
    expect(link).toContain("%28");
    expect(link).toContain("%29");
  });

  test("книги нет — ссылки нет, а не адрес в никуда", () => {
    expect(bookOpenLink("", "epubcfi(/6/8)")).toBe("");
  });

  test("места нет — ссылка на книгу без поля", () => {
    expect(bookOpenLink("A-B")).toBe("beresta://open/A-B");
  });
});

describe("запись в открытую заметку", () => {
  const path = "Base/Библиотека/Джедайские техники.md";

  test("заметка не открыта — писать можно", () => {
    expect(writeVerdict({ path, onDisk: "текст", inEditor: undefined })).toEqual({
      kind: "may-write",
    });
  });

  test("буфер чист — писать можно", () => {
    expect(writeVerdict({ path, onDisk: "текст", inEditor: "текст" })).toEqual({
      kind: "may-write",
    });
  });

  // Вырежьте сравнение с буфером (верните «may-write» всегда) — тест обязан
  // упасть. Замер задачи 2 показал, что тогда строка человека влезает ВНУТРЬ
  // машинного блока, хеш блока становится чужим, и следующий проход замораживает
  // этот блок навсегда.
  test("несохранённые правки — запись откладывается", () => {
    const verdict = writeVerdict({
      path,
      onDisk: "## Открытый файл\n",
      inEditor: "## Открытый файл\n\nРУЧНАЯ ПРАВКА В РАБОТЕ\n",
    });
    expect(verdict.kind).toBe("defer");
    if (verdict.kind !== "defer") throw new Error("ожидалось откладывание");
    expect(verdict.reason).toBe("dirty-buffer");
  });

  test("отказ называет заметку и говорит, что делать", () => {
    const verdict = writeVerdict({ path, onDisk: "а", inEditor: "б" });
    if (verdict.kind !== "defer") throw new Error("ожидалось откладывание");
    // Молчаливое откладывание — та же беда, что молчаливая запись: человек
    // неделю ждёт выписок и не знает, что их держит.
    expect(verdict.message).toContain(path);
    expect(verdict.message).toContain("Сохраните");
  });
});

describe("секция на общем со Swift образце", () => {
  function fixtureSource(world: string): SnapshotSource {
    const root = join(FIXTURES, world);
    if (!existsSync(root)) {
      throw new Error(
        `образца «${world}» нет в ${FIXTURES}. Он не написан руками, его выписывает ` +
          "Swift: BERESTA_WRITE_FIXTURES=1 swift test --filter FixtureExport",
      );
    }
    return {
      async exists(path: string): Promise<boolean> {
        return existsSync(join(root, path));
      },
      async readBinary(path: string): Promise<ArrayBuffer> {
        const bytes = readFileSync(join(root, path));
        return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      },
    };
  }

  async function owner(): Promise<Extract<Snapshot, { kind: "present" }>> {
    const snapshot = await readSnapshot(fixtureSource("owner-library"));
    if (snapshot.kind !== "present") throw new Error("образец владельца не разобрался");
    return snapshot;
  }

  async function biggest(): Promise<SnapshotBook> {
    const snapshot = await owner();
    return snapshot.books.reduce((best, next) =>
      next.annotations.length > best.annotations.length ? next : best,
    );
  }

  test("81 выписка даёт 81 блок, 81 якорь и ни одного повтора", async () => {
    const big = await biggest();
    expect(big.annotations.length).toBeGreaterThanOrEqual(81);
    const out = renderSection(big, big.annotations, DEFAULT_TEMPLATE, OFFSET);
    const found = anchors(out);
    expect(found).toHaveLength(big.annotations.length);
    expect(new Set(found).size).toBe(found.length);
    // Блок на каждую выписку — но не всякий блок цитата: у двух выписок
    // образца якоря-цитаты нет вовсе, и они рисуются коллаутом `[!note]`.
    expect(lines(out).filter((line) => line.startsWith("> [!"))).toHaveLength(
      big.annotations.length,
    );
    expect(lines(out).filter((line) => line.startsWith("> [!note"))).toHaveLength(2);
  });

  test("каждый якорь — адрес ровно одной выписки образца", async () => {
    const big = await biggest();
    const out = renderSection(big, big.annotations, DEFAULT_TEMPLATE, OFFSET);
    for (const item of big.annotations) {
      expect(out).toContain(`^${anchorFor(item)}`);
    }
  });

  test("шесть особых случаев образца доезжают до секции", async () => {
    const big = await biggest();
    const out = renderSection(big, big.annotations, DEFAULT_TEMPLATE, OFFSET);
    // Ни одного из этих случаев нет в живой библиотеке владельца — и ровно
    // поэтому они лежат в образце.
    expect(out).toContain("> _Росчерк, стр. 41_");
    expect(out).toContain("> _Подчёркивание_");
    expect(out).toContain("> #внимание #метод");
    expect(out).toContain("> **Мысль.** Сделать по ней дело");
    expect(out).toContain("> цитата якоря");
    expect(out).toContain("> чужой селектор доезжает дословно");
    expect(out).not.toContain("undefined");
  });

  test("выписка без книги не получает ссылки в никуда", async () => {
    const snapshot = await owner();
    const orphans = snapshot.books.find((entry) => entry.uuid === "");
    expect(orphans).toBeDefined();
    const out = renderSection(orphans!, orphans!.annotations, DEFAULT_TEMPLATE, OFFSET);
    expect(out).not.toContain("beresta://open/?");
    expect(out).not.toContain("beresta://");
  });

  test("надгробия в секцию не попадают", async () => {
    const snapshot = await owner();
    const withTombstones = snapshot.books.find((entry) => entry.tombstones.length > 0);
    expect(withTombstones).toBeDefined();
    const out = renderSection(
      withTombstones!,
      withTombstones!.annotations,
      DEFAULT_TEMPLATE,
      OFFSET,
    );
    for (const stone of withTombstones!.tombstones) {
      expect(out).not.toContain(stone.uuid!.replace(/-/g, "").toLowerCase());
    }
  });

  test("отрисовка всей библиотеки образца устойчива и повторяема", async () => {
    const snapshot = await owner();
    for (const entry of snapshot.books) {
      const once = renderSection(entry, entry.annotations, DEFAULT_TEMPLATE, OFFSET);
      expect(renderSection(entry, entry.annotations, DEFAULT_TEMPLATE, OFFSET)).toBe(once);
      expect(once).not.toContain("undefined");
      expect(once).not.toContain("NaN");
      for (const line of lines(once)) expect(line).toBe(line.replace(/[\t ]+$/, ""));
    }
  });
});
