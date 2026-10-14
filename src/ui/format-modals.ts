/**
 * Окна выбора для форматов заметок (план `20261008-шаблоны-плагина-план.md`,
 * задачи 4–5): книга для новой заметки и формат.
 *
 * Поиск по набору — штатный нечёткий у Obsidian, как у Zotero Integration:
 * человек печатает кусок названия или автора.
 */
import { FuzzySuggestModal, type App } from "obsidian";
import type { NoteFormat } from "../settings";
import type { SnapshotBook } from "../snapshot/model";

/** Книга снимка без заметки — для команды «Новая заметка — <формат>». */
export class BookPickModal extends FuzzySuggestModal<SnapshotBook> {
  constructor(
    app: App,
    private readonly books: readonly SnapshotBook[],
    placeholder: string,
    private readonly chosen: (book: SnapshotBook) => void,
  ) {
    super(app);
    this.setPlaceholder(placeholder);
  }

  getItems(): SnapshotBook[] {
    return [...this.books];
  }

  getItemText(book: SnapshotBook): string {
    const authors = book.authors.join(", ");
    return authors === "" ? (book.title ?? book.uuid) : `${book.title ?? book.uuid} — ${authors}`;
  }

  onChooseItem(book: SnapshotBook): void {
    this.chosen(book);
  }
}

/** Выбор формата; `undefined` в ответе — «без формата, как прежде». */
export class FormatPickModal extends FuzzySuggestModal<NoteFormat | "none"> {
  constructor(
    app: App,
    private readonly formats: readonly NoteFormat[],
    placeholder: string,
    private readonly noneLabel: string | undefined,
    private readonly chosen: (format: NoteFormat | undefined) => void,
  ) {
    super(app);
    this.setPlaceholder(placeholder);
  }

  getItems(): (NoteFormat | "none")[] {
    return this.noneLabel === undefined ? [...this.formats] : [...this.formats, "none"];
  }

  getItemText(item: NoteFormat | "none"): string {
    return item === "none" ? (this.noneLabel ?? "") : item.name;
  }

  onChooseItem(item: NoteFormat | "none"): void {
    this.chosen(item === "none" ? undefined : item);
  }
}
