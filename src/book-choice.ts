/**
 * «Хайлайты книги…» — выбор записи, как «Import notes» в Zotero Integration
 * (постановка `docs/plans/20261019-хайлайты-одной-книги-постановка.md`).
 *
 * Здесь только правила, без Obsidian: какие записи показать, что приписать к
 * каждой и в каком порядке предложить форматы. Окно и действия — в точке
 * входа.
 */
import type { NoteFormat } from "./settings";
import type { SnapshotBook } from "./snapshot/model";
import { fill } from "./ui/words";

/** Запись снимка в списке команды. */
export interface BookChoice {
  readonly book: SnapshotBook;
  /** Заметки, привязанные к записи, по алфавиту; пусто — заметки нет. */
  readonly notes: readonly string[];
  /** Статья, а не книга: у неё есть адрес первоисточника или вид «article». */
  readonly article: boolean;
}

/** Статья ли запись (R02: «может быть как статья, так и книга»). */
export function isArticle(book: SnapshotBook): boolean {
  return (book.source ?? "") !== "" || book.details?.kind === "article";
}

/**
 * ВСЕ записи снимка — с заметкой и без (Р2): в прежней команде формата книги с
 * заметкой не было вовсе, и найти свою заметку через неё было нельзя. Порядок —
 * по названию: нечёткий поиск Obsidian переставит по совпадению, а до набора
 * человек видит алфавит.
 */
export function bookChoices(
  books: readonly SnapshotBook[],
  bindings: ReadonlyMap<string, readonly string[]>,
): BookChoice[] {
  const notesOf = new Map<string, string[]>();
  for (const [path, ids] of bindings) {
    for (const id of ids) notesOf.set(id, [...(notesOf.get(id) ?? []), path]);
  }
  return books
    .filter((book) => book.uuid !== "")
    .map((book) => ({
      book,
      notes: [...(notesOf.get(book.uuid) ?? [])].sort((a, b) => a.localeCompare(b)),
      article: isArticle(book),
    }))
    .sort((a, b) => (a.book.title ?? "").localeCompare(b.book.title ?? ""));
}

/** Строка записи в окне: название — авторы, затем пометки статьи и заметки. */
export function choiceText(choice: BookChoice, words: { article: string; note: string }): string {
  const title = choice.book.title ?? choice.book.uuid;
  const authors = choice.book.authors.join(", ");
  const parts = [authors === "" ? title : `${title} — ${authors}`];
  if (choice.article) parts.push(words.article);
  if (choice.notes.length > 0) parts.push(fill(words.note, { path: choice.notes[0] }));
  return parts.join(" · ");
}

/**
 * Форматы в порядке предложения: подходящий виду записи — первым (у статьи
 * «Статья», у книги «Книга»), остальные как в настройках. Выбирает человек
 * (слово 20261008 «вручную при создании») — порядок лишь экономит ему шаг.
 */
export function formatsFor(choice: BookChoice, formats: readonly NoteFormat[]): NoteFormat[] {
  const hints = choice.article ? ["стат", "article"] : ["книг", "book"];
  const fits = (format: NoteFormat) => hints.some((hint) => format.name.toLowerCase().includes(hint));
  return [...formats.filter(fits), ...formats.filter((format) => !fits(format))];
}
