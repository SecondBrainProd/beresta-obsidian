import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

import {
  ForeignSnapshotFormat,
  SNAPSHOT_FORMAT,
  SNAPSHOT_FORMAT_VERSION,
  SnapshotTooNew,
  readSnapshot,
  sha256Hex,
  type Snapshot,
  type SnapshotSource,
} from "../src/snapshot";

/**
 * Разбор снимка на образцах, ОБЩИХ со Swift.
 *
 * **Почему образцы общие.** Снимок пишет приложение на Swift, читает плагин на
 * TypeScript. Проверь каждая сторона себя на своих же представлениях о формате
 * — и разойтись они смогут молча: приложение исправно пишет, плагин исправно
 * читает и не находит того, чего ждал, а в заметках человека ничего не
 * появляется. Ни одного красного теста при этом не будет.
 *
 * Поэтому образцы в `test/fixtures/` не написаны руками. Их выписывает
 * настоящий сериализатор Swift — тест `FixtureExportTests` в
 * `packages/beresta-core`, — и он же падает, если лежащее в репозитории
 * разошлось с тем, что сериализатор выписал бы сейчас. Один набор файлов
 * проверяет обе стороны: правка кодировщика, о которой не знает разборщик, —
 * красный тест здесь.
 *
 * **Чего эти проверки НЕ доказывают.** Что снимок правильно пишется в живое
 * хранилище (это шов 1, задача 6) и что Obsidian отдаёт файлы скрытой папки
 * так, как мы думаем (это шов на живом приложении, задача 13). Здесь только
 * разбор: байты → модель.
 */

const FIXTURES = fileURLToPath(new URL("fixtures", import.meta.url));

/** Источник поверх образца — и журнал того, что у него спрашивали. */
interface FixtureSource extends SnapshotSource {
  /** Каждый путь, который разбор запросил, в порядке запроса. */
  readonly asked: string[];
}

function fixtureSource(world: string): FixtureSource {
  const root = join(FIXTURES, world);
  if (!existsSync(root)) {
    throw new Error(
      `образца «${world}» нет в ${FIXTURES}. Он не написан руками, его выписывает ` +
        "Swift: BERESTA_WRITE_FIXTURES=1 swift test --filter FixtureExport",
    );
  }
  const asked: string[] = [];
  return {
    asked,
    async exists(path: string): Promise<boolean> {
      asked.push(path);
      return existsSync(join(root, path));
    },
    async readBinary(path: string): Promise<ArrayBuffer> {
      asked.push(path);
      const bytes = readFileSync(join(root, path));
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    },
  };
}

/** Хранилище, в котором приложение не было ни разу. */
function emptySource(): SnapshotSource {
  return {
    async exists(): Promise<boolean> {
      return false;
    },
    async readBinary(): Promise<ArrayBuffer> {
      throw new Error("читать нечего: снимка нет");
    },
  };
}

function present(snapshot: Snapshot): Extract<Snapshot, { kind: "present" }> {
  if (snapshot.kind !== "present") throw new Error(`ожидался снимок, пришло «${snapshot.kind}»`);
  return snapshot;
}

async function owner(): Promise<Extract<Snapshot, { kind: "present" }>> {
  return present(await readSnapshot(fixtureSource("owner-library")));
}

describe("разбор снимка на образцах Swift", () => {
  test("образец, выписанный Swift, разбирается без потерь", async () => {
    const snapshot = await owner();
    expect(snapshot.books.length).toBeGreaterThanOrEqual(8);
    expect(snapshot.annotations.length).toBeGreaterThanOrEqual(287);
    expect(snapshot.problems).toEqual([]);
    expect(snapshot.header.format).toBe(SNAPSHOT_FORMAT);
    expect(snapshot.header.deviceId).toBeTruthy();
    // Число из указателя и число разобранных выписок обязаны сойтись у каждой
    // книги. Разойдись они — плагин молча писал бы в заметку не всё, что есть.
    for (const book of snapshot.books) {
      expect(book.annotations.length).toBe(book.total);
      expect(book.tombstones.length).toBe(book.removedTotal);
    }
  });

  // Вырежьте проверку версии — тест обязан упасть.
  test("снимок новее нас не разбирается вовсе", async () => {
    await expect(readSnapshot(fixtureSource("format-version-99"))).rejects.toThrow(SnapshotTooNew);
  });

  test("чужой формат под нашим именем файла — отказ", async () => {
    await expect(readSnapshot(fixtureSource("foreign-format"))).rejects.toThrow(
      ForeignSnapshotFormat,
    );
  });

  // Вырежьте различение — тест обязан упасть.
  test("отсутствие указателя — это не пустой снимок", async () => {
    const result = await readSnapshot(emptySource());
    expect(result.kind).toBe("absent");
    expect(result.kind).not.toBe("present");
  });

  test("пустой снимок — это не отсутствие снимка", async () => {
    const snapshot = present(await readSnapshot(fixtureSource("empty-library")));
    expect(snapshot.books).toEqual([]);
    expect(snapshot.annotations).toEqual([]);
  });

  test("незнакомые ключи доезжают до модели и не теряются", async () => {
    const snapshot = present(await readSnapshot(fixtureSource("future-writer")));
    // Три уровня: сам указатель, запись указателя, выписка. Ключи в образце
    // лежат ВНЕ алфавитного порядка — разбор, полагающийся на порядок ключей,
    // покраснеет здесь.
    expect(snapshot.header.unknown["vaultProfile"]).toBe("личное хранилище");
    const book = snapshot.books[0]!;
    expect(book.unknown["beresta:coverSHA256"]).toBe("ab".repeat(32));
    expect(book.unknown["beresta:coverage"]).toEqual({ read: 0.42 });
    const withFuture = book.annotations.find(
      (annotation) => annotation.unknown["beresta:readingSession"] !== undefined,
    );
    expect(withFuture?.unknown["beresta:readingSession"]).toBe(
      "urn:uuid:6C6F5D2E-0E9E-4C3E-9C3B-3E2A1D0F4B77",
    );
  });

  test("незнакомый селектор доезжает дословно", async () => {
    const snapshot = await owner();
    const foreign = snapshot.annotations.flatMap((annotation) =>
      annotation.selectors.filter((selector) => selector.kind === "unknown"),
    );
    expect(foreign.length).toBeGreaterThanOrEqual(1);
    expect(foreign[0]!.raw).toEqual({
      type: "CssSelector",
      value: "#chapter-3 > p:nth-child(4)",
      refinedBy: { type: "TextPositionSelector", start: 12, end: 180 },
    });
  });

  test("незнакомая привязка целиком доезжает дословно", async () => {
    const snapshot = await owner();
    const opaque = snapshot.annotations.find((annotation) =>
      annotation.position?.includes("zotero-page-layout"),
    );
    expect(opaque?.position).toBe(
      '{"kind":"zotero-page-layout","page":41,"rects":[[10.5,20.25,300,42]],"type":"layout"}',
    );
  });

  test("отсутствие пути по оглавлению — норма, а не ошибка", async () => {
    const snapshot = await owner();
    const without = snapshot.annotations.filter(
      (annotation) => annotation.chapterPath.length === 0,
    );
    expect(without.length).toBeGreaterThanOrEqual(1);
    // Пустой путь — именно пустой массив, а не `undefined` и не `[""]`:
    // отрисовке (задача 10) вырождать заголовок коллаута по одному признаку.
    expect(without[0]!.chapterPath).toEqual([]);
  });

  test("многоуровневый путь по оглавлению доезжает целиком", async () => {
    const snapshot = await owner();
    const deepest = snapshot.annotations
      .map((annotation) => annotation.chapterPath)
      .reduce((longest, path) => (path.length > longest.length ? path : longest), [] as string[]);
    expect(deepest.length).toBeGreaterThanOrEqual(4);
    expect(deepest[deepest.length - 1]).toBe("Ментальный шейлок");
  });

  test("надгробия доезжают отдельно от живых выписок", async () => {
    const snapshot = await owner();
    const tombstones = snapshot.books.flatMap((book) => book.tombstones);
    expect(tombstones.length).toBeGreaterThanOrEqual(1);
    expect(tombstones[0]!.uuid).toMatch(/^[0-9A-F-]{36}$/);
    expect(tombstones[0]!.deletedAt).toBeTruthy();
    // Надгробие — не выписка: место в книге у него больше не помечено, и в
    // списке живых его быть не может.
    const live = new Set(snapshot.annotations.map((annotation) => annotation.uuid));
    for (const tombstone of tombstones) expect(live.has(tombstone.uuid)).toBe(false);
  });

  test("выписка без книги приезжает осколком сирот", async () => {
    const snapshot = await owner();
    const orphans = snapshot.books.find((book) => book.uuid === "");
    expect(orphans?.shard).toBe("orphans.jsonld");
    expect(orphans?.annotations.length).toBeGreaterThanOrEqual(1);
    // Названия у заглушки нет и быть не может: придуманное название было бы
    // утверждением о книге, которой нет.
    expect(orphans?.title).toBeUndefined();
  });

  test("цитата берётся из якоря, а расходящаяся — из beresta:text", async () => {
    const snapshot = await owner();
    const usual = snapshot.annotations.find(
      (annotation) => annotation.quote === "Сомнение дешевле переделки.",
    );
    expect(usual?.strandedText).toBeUndefined();

    // Ноль таких строк у владельца — на его библиотеке эта ветка недоказуема,
    // и шов 1 (задача 6) на ней уже споткнулся: вырез остался зелёным.
    const divergent = snapshot.annotations.find(
      (annotation) => annotation.strandedText === "цитата из другой редакции",
    );
    expect(divergent?.quote).toBe("цитата якоря");
    expect(divergent?.selectors.filter((selector) => selector.kind === "quote")).toHaveLength(1);
  });

  test("росчерк не имеет цитаты и не выдумывает её", async () => {
    const snapshot = await owner();
    const ink = snapshot.annotations.find((annotation) => annotation.markKind === "ink");
    expect(ink?.selectors).toEqual([]);
    expect(ink?.quote).toBeUndefined();
    expect(ink?.position).toContain('"type":"ink"');
    expect(ink?.pageLabel).toBe("41");
  });

  test("метки и своя мысль разъезжаются по своим полям", async () => {
    const snapshot = await owner();
    const tagged = snapshot.annotations.find((annotation) => annotation.tags.length > 0);
    expect(tagged?.tags).toEqual(["внимание", "метод"]);
    expect(tagged?.comment).toBe("Сделать по ней дело");
    expect(tagged?.commentFormat).toBe("text/markdown");
    expect(tagged?.intent).toBe("implement");
    expect(tagged?.processed).toBe("used");
    expect(tagged?.topic).toBe("рабочие приёмы");

    // У 264 выписок владельца из 287 своей мысли нет вовсе — и ключа `body` в
    // файле тоже нет. Пустой строки на её месте быть не должно: задача 10
    // рисует подзаголовок по наличию, а «» отличается от отсутствия только
    // тем, что его не видно.
    const plain = snapshot.annotations.find((annotation) => annotation.comment === undefined);
    expect(plain).toBeDefined();
    expect(plain?.tags).toEqual([]);
  });

  // Вырежьте сверку sha256 — тест обязан упасть.
  test("осколок, не сошедшийся с отпечатком, не доезжает до заметки", async () => {
    const snapshot = present(await readSnapshot(fixtureSource("hash-mismatch")));
    expect(snapshot.books).toEqual([]);
    expect(snapshot.problems).toHaveLength(1);
    expect(snapshot.problems[0]!.kind).toBe("shard-checksum");
    expect(snapshot.problems[0]!.message).toContain("не сходится с отпечатком");
  });

  test("строка указателя мимо books/ не читается вовсе", async () => {
    const source = fixtureSource("doctored-index");
    const snapshot = present(await readSnapshot(source));
    expect(snapshot.books).toHaveLength(1);
    expect(snapshot.problems.map((problem) => problem.kind)).toEqual([
      "foreign-file",
      "foreign-file",
    ]);
    // Сильнее, чем «в списке бед две записи»: плагин не должен был даже
    // СПРОСИТЬ про эти пути. Вырежьте сторож — и здесь появится
    // `.beresta/books/../../.obsidian/…`.
    for (const path of source.asked) {
      expect(path === ".beresta/index.json" || path.startsWith(".beresta/books/")).toBe(true);
      expect(path).not.toContain("..");
    }
  });

  test("файл не в UTF-8 — это не «прочитали со звёздочкой»", async () => {
    // Единственный вход, собранный руками, а не Swift: речь не о формате, а о
    // байтах. Один негодный байт внутри строки — и мягкое раскодирование
    // молча подставит на его место «U+FFFD», то есть отдаст текст, который
    // ВЫГЛЯДИТ прочитанным. Файл снимка либо целый, либо не наш.
    const text = '{"format":"beresta-archive","formatVersion":1,"deviceId":"X","books":[]}';
    const bytes = new TextEncoder().encode(text);
    bytes[text.indexOf("X")] = 0xff;
    const broken: SnapshotSource = {
      async exists() {
        return true;
      },
      async readBinary() {
        return bytes.buffer.slice(0);
      },
    };
    await expect(readSnapshot(broken)).rejects.toThrow(/не в UTF-8/);
  });

  test("осколка нет на диске — это беда книги, а не снимка", async () => {
    const source = fixtureSource("owner-library");
    const hidden = "orphans.jsonld";
    const guarded: SnapshotSource = {
      async exists(path) {
        return path.endsWith(hidden) ? false : source.exists(path);
      },
      async readBinary(path) {
        return source.readBinary(path);
      },
    };
    const snapshot = present(await readSnapshot(guarded));
    expect(snapshot.books.length).toBeGreaterThanOrEqual(8);
    expect(snapshot.problems).toHaveLength(1);
    expect(snapshot.problems[0]!.kind).toBe("shard-missing");
  });
});

describe("отпечаток считается так же, как CryptoKit", () => {
  test("отпечаток каждого осколка сходится с указателем", async () => {
    const root = join(FIXTURES, "owner-library");
    const snapshot = await owner();
    expect(snapshot.books.length).toBeGreaterThanOrEqual(8);
    for (const book of snapshot.books) {
      const bytes = readFileSync(join(root, ".beresta", "books", book.shard));
      expect(sha256Hex(new Uint8Array(bytes))).toBe(book.sha256);
    }
  });

  test("пустые байты дают эталон FIPS", () => {
    expect(sha256Hex(new Uint8Array(0))).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  test("длина на границе блока считается верно", () => {
    // 55, 56 и 64 байта — три случая дополнения по FIPS 180-4 §5.1.1: влезает,
    // не влезает, ровно блок. Эталоны посчитаны `shasum -a 256`.
    expect(sha256Hex(new Uint8Array(55).fill(0x61))).toBe(
      "9f4390f8d30c2dd92ec9f095b65e2b9ae9b0a925a5258e241c9f1e910f734318",
    );
    expect(sha256Hex(new Uint8Array(56).fill(0x61))).toBe(
      "b35439a4ac6f0948b6d6f9e3c6af0f5f590ce20f1bde7090ef7970686ec6738a",
    );
    expect(sha256Hex(new Uint8Array(64).fill(0x61))).toBe(
      "ffe054fe7ae0cb6dc65c3af9b61d5209f439851db43d0ba5997337df154668eb",
    );
  });
});

describe("границы формата совпадают со стороной Swift", () => {
  const swiftSource = fileURLToPath(
    new URL(
      "../../beresta-core/Sources/BerestaCore/Export/ExportManifest.swift",
      import.meta.url,
    ),
  );

  function swiftConstant(name: string): string {
    const source = readFileSync(swiftSource, "utf8");
    const match = source.match(new RegExp(`static let ${name}\\s*=\\s*"?([^"\\n]*)"?`));
    if (!match) {
      throw new Error(
        `в ${swiftSource} нет объявления «static let ${name}». Оно переехало или ` +
          "переименовано — общая граница со Swift потеряна, и её надо восстановить, " +
          "а не убрать эту проверку.",
      );
    }
    return match[1]!.trim();
  }

  test("имя формата — то же, что объявляет ExportManifest", () => {
    expect(SNAPSHOT_FORMAT).toBe(swiftConstant("format"));
  });

  test("версия формата — та же, что объявляет ExportManifest", () => {
    expect(String(SNAPSHOT_FORMAT_VERSION)).toBe(swiftConstant("formatVersion"));
  });
});
