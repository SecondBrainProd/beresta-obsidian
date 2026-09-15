/**
 * Три зоны одной заметки — и границы между ними.
 *
 * 1. **Вне маркеров** — зона человека. Не читаем ради данных и не трогаем
 *    никогда: у владельца там `## Главная идея книги`, оценки, вики-ссылки на
 *    авторов, «Мысль номер N» — то, ради чего он вёл заметки четыре года.
 *    Довод «худший исход — испорченная заметка, а она порождается заново из
 *    базы» (`20260806-integrations.md` §6) для этой зоны **неверен**: она из
 *    базы не порождается. Отсюда и запасная копия перед каждой записью
 *    (`src/write/backup.ts`).
 * 2. **Frontmatter** — два своих ключа, остальное байт в байт (`frontmatter.ts`).
 * 3. **Внутри маркеров** — зона машины, переписывается по хешам (`fuse.ts`).
 *
 * **Этот файл отвечает за одно: где проходят границы.** Разбор устроен так,
 * что сборка обратно обязана дать исходный файл байт в байт — включая отступ
 * перед маркером, если человек его поставил, и перевод строки в конце файла.
 * Строку маркера мы не переписываем даже в том виде, в каком нарисовали бы
 * сами: переписанный отступ — это изменённые байты, а изменённые байты будят
 * чужую синхронизацию хранилища.
 *
 * **Ломаная пара маркеров — отказ по файлу.** Открывающий есть, закрывающего
 * нет; пар две; закрывающий раньше открывающего — во всех этих случаях
 * непонятно, где кончается зона машины, а угадывать здесь значит писать в
 * зону человека. Отказ говорится вслух и не пишет ни байта.
 */

import { SECTION_BEGIN, SECTION_END } from "../render/section";
import { splitFrontmatter } from "./frontmatter";

/** Строка целиком из маркера — с любыми пробелами и возвратом каретки по краям. */
const BEGIN_LINE = markerLine(SECTION_BEGIN);
const END_LINE = markerLine(SECTION_END);

/** Строка-якорь блока: `^hl-…` и ничего больше. */
export const ANCHOR_LINE = /^\^(hl-\S+)[\t \r]*$/;

/** Почему разбор отказался от файла. */
export type ZonesBreakage = "unpaired" | "extra-pair" | "reversed";

export type FileZones =
  | {
      readonly kind: "section";
      readonly frontmatterLines: readonly string[];
      readonly beforeLines: readonly string[];
      readonly innerLines: readonly string[];
      readonly afterLines: readonly string[];
      /** Собрать файл обратно: другой середины и другого frontmatter. */
      assemble(inner: readonly string[], frontmatter?: readonly string[]): string;
    }
  | {
      readonly kind: "no-section";
      readonly frontmatterLines: readonly string[];
      readonly bodyLines: readonly string[];
    }
  | { readonly kind: "broken"; readonly reason: ZonesBreakage; readonly message: string };

/**
 * Делит заметку на зоны.
 *
 * Работа идёт по строкам: `text.split("\n")` и обратная сборка через
 * `join("\n")` — превращение без потерь, поэтому «байт в байт» здесь свойство
 * устройства, а не аккуратности. Возврат каретки, если он есть, остаётся
 * внутри строки и уезжает обратно вместе с ней.
 */
export function splitFile(text: string): FileZones {
  const lines = text.split("\n");
  const { frontmatter, body } = splitFrontmatter(lines);
  const front = frontmatter ?? [];

  const begins = indexesOf(body, BEGIN_LINE);
  const ends = indexesOf(body, END_LINE);

  if (begins.length === 0 && ends.length === 0) {
    return { kind: "no-section", frontmatterLines: front, bodyLines: body };
  }
  if (begins.length > 1 || ends.length > 1) {
    return {
      kind: "broken",
      reason: "extra-pair",
      message:
        `В заметке ${begins.length} открывающих и ${ends.length} закрывающих маркеров ` +
        "Beresta вместо одной пары. Где кончается наша часть заметки, отсюда не " +
        "видно, а угадывать значит писать в ваш текст. Beresta ничего не записала: " +
        "оставьте одну пару маркеров.",
    };
  }
  if (begins.length !== ends.length) {
    return {
      kind: "broken",
      reason: "unpaired",
      message:
        (begins.length === 1
          ? "В заметке есть открывающий маркер Beresta, а закрывающего нет."
          : "В заметке есть закрывающий маркер Beresta, а открывающего нет.") +
        " Где кончается наша часть заметки, отсюда не видно. Beresta ничего не " +
        "записала: верните вторую строку маркера или уберите обе.",
    };
  }
  const begin = begins[0];
  const end = ends[0];
  if (end < begin) {
    return {
      kind: "broken",
      reason: "reversed",
      message:
        "В заметке закрывающий маркер Beresta стоит раньше открывающего. Beresta " +
        "ничего не записала: поменяйте их местами.",
    };
  }

  const beforeLines = body.slice(0, begin);
  const beginLine = body[begin];
  const innerLines = body.slice(begin + 1, end);
  const endLine = body[end];
  const afterLines = body.slice(end + 1);

  return {
    kind: "section",
    frontmatterLines: front,
    beforeLines,
    innerLines,
    afterLines,
    assemble(inner: readonly string[], frontmatterOverride?: readonly string[]): string {
      return [
        ...(frontmatterOverride ?? front),
        ...beforeLines,
        beginLine,
        ...inner,
        endLine,
        ...afterLines,
      ].join("\n");
    },
  };
}

/** Якоря `^hl-…`, найденные в зоне человека. */
export function anchorsIn(lines: readonly string[]): Set<string> {
  const found = new Set<string>();
  for (const line of lines) {
    const match = ANCHOR_LINE.exec(line);
    if (match !== null) found.add(match[1]);
  }
  return found;
}

function indexesOf(lines: readonly string[], pattern: RegExp): number[] {
  const found: number[] = [];
  lines.forEach((line, index) => {
    if (pattern.test(line)) found.push(index);
  });
  return found;
}

function markerLine(marker: string): RegExp {
  return new RegExp(`^[\\t ]*${escapeRegExp(marker)}[\\t \\r]*$`);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
