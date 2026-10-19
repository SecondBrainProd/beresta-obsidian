/**
 * Шаблон ВСЕЙ заметки — исполняется один раз, при создании (план
 * `20261008-шаблоны-плагина-план.md`, задача 4; слова владельца R02, R03).
 *
 * Дальше заметка принадлежит человеку: плагин правит в ней только свои два
 * ключа frontmatter и машинную секцию между маркерами. Поэтому здесь нет ни
 * слияния, ни памяти — только первый текст файла.
 *
 * **Секция выписок встаёт местом `{{annotations}}`.** На это место кладётся
 * ПУСТАЯ секция — пара маркеров; слияние прохода найдёт её и наполнит тем же
 * путём, что у любой заметки. Нет места в шаблоне — маркеров нет, и слияние
 * допишет секцию в конец, как всегда (Р2).
 */
import { splitFrontmatter } from "../merge/frontmatter";
import type { SnapshotBook } from "../snapshot/model";
import { panelWords, type PassWords } from "../ui/words";
import { interfaceLanguage } from "./defaults";
import { SECTION_BEGIN, SECTION_END } from "./section";
import { renderTemplate, TemplateError, type TemplateValue } from "./template";

/** Свойство заметки с именем её формата — рядом с `beresta-book-id`. */
export const FORMAT_KEY = "beresta-format";

/** Пустая секция: её наполнит слияние первого же прохода. */
export const EMPTY_SECTION = `${SECTION_BEGIN}\n${SECTION_END}`;

/**
 * Значения шаблона заметки: всё, что снимок знает о записи.
 *
 * Имена — как у Zotero Integration там, где смысл совпадает (`title`,
 * `authors`, `publisher`, `tags`, `collections`, `url`), чтобы шаблон владельца
 * переносился с малой правкой (П06); `date` — день издания, как у Zotero, —
 * для `{{ date | format("YYYY") }}`.
 */
export function noteValues(book: SnapshotBook): Record<string, TemplateValue> {
  const details = book.details;
  return {
    uuid: book.uuid,
    title: book.title ?? "",
    authors: book.authors,
    url: book.source ?? "",
    ownThought: book.ownThought ?? "",
    kind: details?.kind ?? "",
    subtitle: details?.subtitle ?? "",
    publisher: details?.publisher ?? "",
    date: details?.published ?? "",
    published: details?.published ?? "",
    language: details?.language ?? "",
    series: details?.series ?? "",
    seriesIndex: details?.seriesIndex,
    tags: details?.tags ?? [],
    collections: details?.collections ?? [],
    readStatus: details?.readStatus ?? "",
    rating: details?.rating,
    addedAt: details?.addedAt ?? "",
    finishedAt: details?.finishedAt ?? "",
    count: String(book.annotations.length),
    annotations: EMPTY_SECTION,
  };
}

/**
 * Первый текст новой заметки формата `format` по шаблону `template`.
 *
 * Свойство формата пишется ВСЕГДА — в имеющийся блок frontmatter шаблона или в
 * новый: по нему следующие проходы найдут шаблон блока (Р3). `beresta-book-id`
 * не пишется здесь — его ставит слияние, как у любой заметки.
 *
 * Ошибка шаблона — `TemplateError` словами с номером строки; создавать заметку
 * тогда нельзя вовсе (П05).
 */
export function renderNote(
  template: string,
  book: SnapshotBook,
  format: string,
  say: PassWords = panelWords(interfaceLanguage()).pass,
): string {
  if (looksLikeSectionTemplate(template)) throw new TemplateError(say.noteTemplateIsSection);
  const text = renderTemplate(template, { fields: {}, lists: {}, values: noteValues(book) }, say);
  return withFormatProperty(text, format);
}

/**
 * Шаблон секции хайлайтов, поставленный в поле шаблона заметки (владелец
 * 20261019): у заметки хайлайтов нет поимённо — только место
 * `{{annotations}}`, — и такой шаблон падал на первом же значении секции
 * («шаблон просит thought…») без слова о том, что перепутано поле. Признак —
 * цикл по хайлайтам или якорь блока: в шаблоне заметки их не бывает.
 */
export function looksLikeSectionTemplate(template: string): boolean {
  return (
    /\{\{\s*#\s*annotations\s*\}\}/.test(template) ||
    /\{%-?\s*for\s+\w+\s+in\s+annotations\b/.test(template) ||
    /\{\{\s*anchor\s*\}\}/.test(template)
  );
}

/** Вписывает `beresta-format: <имя>` в frontmatter (или заводит его). */
export function withFormatProperty(text: string, format: string): string {
  const lines = text.split("\n");
  const split = splitFrontmatter(lines);
  const line = `${FORMAT_KEY}: ${quoteIfNeeded(format)}`;
  if (split.frontmatter === undefined) {
    return ["---", line, "---", ...lines].join("\n");
  }
  const block = split.frontmatter;
  const kept = block.slice(0, -1).filter((entry) => !entry.startsWith(`${FORMAT_KEY}:`));
  return [...kept, line, block[block.length - 1], ...split.body].join("\n");
}

/** Имя формата в YAML: кавычки, если без них оно прочлось бы не строкой. */
function quoteIfNeeded(value: string): string {
  return /^[\p{L}\p{N} _.-]+$/u.test(value) && !/^(true|false|null|yes|no|\d+)$/i.test(value)
    ? value
    : JSON.stringify(value);
}
