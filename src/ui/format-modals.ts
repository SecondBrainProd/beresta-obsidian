/**
 * Окна выбора для форматов заметок (план `20261008-шаблоны-плагина-план.md`,
 * задачи 4–5): книга для новой заметки и формат.
 *
 * Поиск по набору — штатный нечёткий у Obsidian, как у Zotero Integration:
 * человек печатает кусок названия или автора.
 */
import { FuzzySuggestModal, Modal, type App } from "obsidian";
import { choiceText, type BookChoice } from "../book-choice";
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

/**
 * Запись для «Хайлайты книги…» — ВСЕ книги и статьи снимка, с заметкой и без
 * (Р2 постановки 20261019), с пометками «статья» и «заметка: путь».
 */
export class BookChoiceModal extends FuzzySuggestModal<BookChoice> {
  constructor(
    app: App,
    private readonly choices: readonly BookChoice[],
    placeholder: string,
    private readonly marks: { article: string; note: string },
    private readonly chosen: (choice: BookChoice) => void,
  ) {
    super(app);
    this.setPlaceholder(placeholder);
  }

  getItems(): BookChoice[] {
    return [...this.choices];
  }

  getItemText(choice: BookChoice): string {
    return choiceText(choice, this.marks);
  }

  onChooseItem(choice: BookChoice): void {
    this.chosen(choice);
  }
}

/**
 * Форматов нет — предложить готовые одним нажатием и продолжить (Р5): команда
 * не молчит и не отсылает в настройки. Закрытое без выбора окно — «без
 * формата», как у окна формата в панели привязки.
 */
export class OfferDefaultsModal extends Modal {
  private answered = false;

  constructor(
    app: App,
    private readonly words: { text: string; yes: string; no: string },
    private readonly answer: (install: boolean) => void,
  ) {
    super(app);
  }

  override onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("p", { text: this.words.text });
    const line = contentEl.createDiv({ cls: "beresta-binding-choice" });
    const yes = line.createEl("button", { text: this.words.yes, cls: "mod-cta" });
    yes.addEventListener("click", () => this.reply(true));
    const no = line.createEl("button", { text: this.words.no });
    no.addEventListener("click", () => this.reply(false));
  }

  override onClose(): void {
    this.contentEl.empty();
    if (!this.answered) {
      this.answered = true;
      this.answer(false);
    }
  }

  private reply(install: boolean): void {
    this.answered = true;
    this.answer(install);
    this.close();
  }
}
