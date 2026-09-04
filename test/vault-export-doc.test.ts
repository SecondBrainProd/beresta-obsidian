import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

import { SNAPSHOT_FORMAT, SNAPSHOT_FORMAT_VERSION } from "../src/snapshot/model";
import { DOCS_ROOT, IN_MONOREPO, MONOREPO_ROOT } from "./monorepo";

// Документ открытого формата (`docs/vault-export.md`) против кода, который этот
// формат пишет и читает.
//
// **Зачем это отдельным набором.** Открытый формат — обещание СТОРОННЕМУ коду.
// Сторонний код читает не наш Swift и не наш TypeScript, а документ; значит
// документ и есть контракт, а не пересказ. Пересказ протухает молча — это уже
// случалось дважды, и оба раза замечено случайно: список миграций в
// `schema.md` отстал на одну (`v30_golden_shelf`), а версия формата выгрузки
// была объявлена только в коде. Здесь то же место, только цена выше: по этому
// документу человек пишет свой скрипт, когда Beresta у него уже нет.
//
// **Почему проверка живёт в плагине, а не в ядре.** Она обязана видеть ОБЕ
// стороны шва: документ, константы плагина и исходник Swift. Из `vitest`
// исходник Swift читается как текст — этим же приёмом уже держится граница
// имени и версии формата (`snapshot.test.ts`). Из Swift-теста не прочитать
// константы плагина без второго разбора; одна проверка вместо двух.
//
// **Разбор документа нарочно грубый и буквальный** — тот же приём, что в
// `SchemaDocument.swift`: находится обратными кавычками то, что документ
// объявляет, и сравнивается с тем, что объявляет код. Умный разбор Markdown
// умеет «не найти» поле и промолчать; грубый либо находит, либо краснеет.

function read(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, MONOREPO_ROOT)), "utf8");
}

// Документ есть в обеих раскладках: в монорепозитории — `docs/` дерева, в
// публичной копии плагина — её собственный `docs/`. Исходник приложения есть
// только в первой; в копии эти строки пусты, а проверки по ним пропущены
// (см. `monorepo.ts`).
const document = readFileSync(
  fileURLToPath(new URL("docs/vault-export.md", DOCS_ROOT)),
  "utf8",
);
const annotationJSONLD = IN_MONOREPO
  ? read("packages/beresta-core/Sources/BerestaCore/Export/AnnotationJSONLD.swift")
  : "";
const snapshotPlan = IN_MONOREPO
  ? read("packages/beresta-core/Sources/BerestaCore/Export/VaultSnapshotPlan.swift")
  : "";
const contextResource = IN_MONOREPO
  ? read("packages/beresta-core/Sources/BerestaCore/Export/Resources/context.jsonld")
  : "";

/**
 * Две языковые половины документа по отдельности.
 *
 * Проверять документ целиком было бы дырой ровно того размера, ради которой
 * половин две: правка одной половины и забытая вторая — это документ, который
 * для русского читателя обещает одно, а для английского другое, и никакая
 * проверка «упоминается где-нибудь в файле» этого не увидит.
 */
function halves(): { name: string; text: string }[] {
  const russian = document.indexOf("\n## Русский");
  const english = document.indexOf("\n## English");
  if (russian < 0 || english < 0 || english < russian) {
    throw new Error(
      "в docs/vault-export.md не нашлось обеих половин («## Русский» и «## English» " +
        "в этом порядке). Они переименованы или переставлены — восстановить надо " +
        "половины, а не убрать эту проверку.",
    );
  }
  return [
    { name: "русская половина", text: document.slice(russian, english) },
    { name: "английская половина", text: document.slice(english) },
  ];
}

/** Всё, что документ произносит в обратных кавычках. */
function backticked(text: string): Set<string> {
  const found = new Set<string>();
  for (const match of text.matchAll(/`([^`\n]+)`/g)) found.add(match[1]!);
  return found;
}

/**
 * Имена, которые документ ОПИСЫВАЕТ, — то есть открывает ими строку таблицы.
 *
 * Отдельно от «упоминает где-нибудь», и это не педантизм: разница найдена
 * вырезанием. Первая редакция проверки искала имя по всей половине, и вырез
 * «убрать строку таблицы про `removedTotal`» остался ЗЕЛЁНЫМ — поле осталось
 * упомянуто в примере с `jq` внизу раздела. Упоминание в команде не говорит
 * читателю, что это поле значит; описанием считается строка таблицы.
 */
function describedInTable(text: string): Set<string> {
  const found = new Set<string>();
  for (const match of text.matchAll(/^\|\s*`([^`\n]+)`\s*\|/gm)) found.add(match[1]!);
  return found;
}

/** Поля `beresta:`, которые УМЕЕТ ВЫПИСАТЬ сериализатор. */
function berestaKeysInCode(): string[] {
  const found = new Set<string>();
  for (const match of annotationJSONLD.matchAll(/"(beresta:[A-Za-z]+)"/g)) {
    found.add(match[1]!);
  }
  if (found.size === 0) {
    throw new Error(
      "в AnnotationJSONLD.swift не нашлось ни одного ключа «beresta:». Сериализатор " +
        "переехал или ключи собираются иначе — общая граница с документом потеряна.",
    );
  }
  return [...found].sort();
}

/**
 * Поля указателя: собственные свойства `VaultIndex` и его `Entry`.
 *
 * Берётся кусок исходника ДО `VaultSnapshotPlan` — дальше начинается план
 * прохода, чьи поля в файл не уезжают вовсе и документу не принадлежат.
 * Вычисляемые свойства (`manifest`) отсекаются по открывающей скобке в строке:
 * в JSON их нет.
 */
function indexFieldsInCode(): string[] {
  const boundary = snapshotPlan.indexOf("public struct VaultSnapshotPlan");
  if (boundary < 0) {
    throw new Error(
      "в VaultSnapshotPlan.swift не нашлось объявления «public struct VaultSnapshotPlan» — " +
        "по нему отделяются поля указателя от полей плана. Границу надо восстановить.",
    );
  }
  const region = snapshotPlan.slice(0, boundary);
  const found = new Set<string>();
  for (const match of region.matchAll(/^\s*public var ([A-Za-z]+): [^{\n]+$/gm)) {
    found.add(match[1]!);
  }
  if (found.size === 0) {
    throw new Error("в VaultIndex не нашлось ни одного поля — разбор исходника сломан.");
  }
  return [...found].sort();
}

describe("документ открытого формата согласен с плагином", () => {
  test("версия формата в документе — та же, что в коде, и названа обеими половинами", () => {
    const versions = (text: string): number[] =>
      [...text.matchAll(/`formatVersion` = (\d+)/g)].map((match) => Number(match[1]));

    // Ни одно объявление в документе не расходится с кодом — включая те, что
    // стоят в шапке до половин.
    const declared = versions(document);
    expect(declared.length).toBeGreaterThan(0);
    expect([...new Set(declared)]).toEqual([SNAPSHOT_FORMAT_VERSION]);

    // И каждая половина объявляет версию сама. Половина, которая молчит,
    // обещает читателю неизвестно что.
    for (const half of halves()) {
      expect(versions(half.text), `${half.name}: версия не объявлена`).toContain(
        SNAPSHOT_FORMAT_VERSION,
      );
    }

  });

  test("имя формата в документе — то же, что в коде, и названо обеими половинами", () => {
    // Спрашивается не «упомянуто где-нибудь», а «стоит в описании поля
    // `format`»: именно этой строкой читатель узнаёт, по какому признаку
    // отличить наш файл от чужого.
    for (const half of halves()) {
      const row = half.text
        .split("\n")
        .find((line) => /^\|\s*`format`\s*\|/.test(line));
      expect(row, `${half.name}: нет строки таблицы про поле format`).toBeDefined();
      expect(row, half.name).toContain(SNAPSHOT_FORMAT);
    }
  });

});

// Дальше — сверка с исходником приложения. В публичной копии плагина его
// нет — набор пропускается (см. `monorepo.ts`); в монорепозитории пропажа
// файла — красное с его именем.
describe.skipIf(!IN_MONOREPO)("документ открытого формата согласен с кодом приложения", () => {
  test("версия формата — та же, что объявляет ExportManifest", () => {
    const swift = read("packages/beresta-core/Sources/BerestaCore/Export/ExportManifest.swift");
    const inSwift = swift.match(/static let formatVersion\s*=\s*(\d+)/);
    if (!inSwift) {
      throw new Error(
        "в ExportManifest.swift нет объявления «static let formatVersion». Оно переехало — " +
          "восстановить надо границу, а не проверку.",
      );
    }
    expect(Number(inSwift[1])).toBe(SNAPSHOT_FORMAT_VERSION);
  });

  test("каждое поле beresta:, которое пишет сериализатор, описано обеими половинами", () => {
    const keys = berestaKeysInCode();
    for (const half of halves()) {
      const said = describedInTable(half.text);
      const missing = keys.filter((key) => !said.has(key));
      expect(missing, `${half.name}: поля не описаны`).toEqual([]);
    }
  });

  test("документ не обещает полей beresta:, которых сериализатор не пишет", () => {
    const known = new Set(berestaKeysInCode());
    // Ключи словаря `context.jsonld` — тоже часть формата: они лежат в
    // хранилище рядом с осколками, и документ вправе их называть.
    for (const match of contextResource.matchAll(/"(beresta:[A-Za-z]+)"/g)) {
      known.add(match[1]!);
    }
    const invented = [...backticked(document)]
      .filter((name) => /^beresta:[A-Za-z]+$/.test(name))
      .filter((name) => !known.has(name));
    expect(invented).toEqual([]);
  });

  test("каждое поле указателя описано обеими половинами", () => {
    const fields = indexFieldsInCode();
    for (const half of halves()) {
      const said = describedInTable(half.text);
      const missing = fields.filter((field) => !said.has(field));
      expect(missing, `${half.name}: поля указателя не описаны`).toEqual([]);
    }
  });

  test("отпечаток снимка словаря W3C в документе — тот же, что объявляет context.jsonld", () => {
    const inResource = contextResource.match(/"sha256"\s*:\s*"([0-9a-f]{64})"/);
    if (!inResource) {
      throw new Error(
        "в context.jsonld нет объявления sha256 снимка anno.jsonld — оно переехало.",
      );
    }
    for (const half of halves()) {
      expect(half.text, `${half.name}: отпечаток не назван`).toContain(inResource[1]!);
    }
  });
});
