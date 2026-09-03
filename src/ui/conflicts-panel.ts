/**
 * Панель расхождений — оболочка над `describeBoard`.
 *
 * Слова, порядок и тон живут в `src/conflicts-view.ts` и проверяются обычными
 * тестами. Здесь только боковая панель Obsidian: где открывается, как
 * называется и как перерисовывается.
 *
 * **Панель не открывается сама.** Ни при первом расхождении, ни при пятом:
 * расхождение — обычное дело, а окно, которое лезет вперёд, приучает закрывать
 * его не глядя. О числе расхождений говорит строка состояния, а панель
 * открывается командой.
 */

import { ItemView, type WorkspaceLeaf } from "obsidian";

import { describeBoard, type BoardEntry } from "../conflicts-view";

export const CONFLICTS_VIEW_TYPE = "beresta-conflicts";

export class ConflictsPanel extends ItemView {
  private source: () => readonly BoardEntry[] = () => [];

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
  }

  /** Откуда брать записи. Ставится точкой входа при создании панели. */
  listenTo(source: () => readonly BoardEntry[]): void {
    this.source = source;
  }

  override getViewType(): string {
    return CONFLICTS_VIEW_TYPE;
  }

  override getDisplayText(): string {
    return "Расхождения Beresta";
  }

  override getIcon(): string {
    return "book-open";
  }

  override async onOpen(): Promise<void> {
    this.draw();
  }

  /** Перерисовать: зовётся после каждого прохода, изменившего записи. */
  draw(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("beresta-conflicts");
    for (const line of describeBoard(this.source())) {
      if (line === "") contentEl.createEl("br");
      else contentEl.createEl("div", { text: line });
    }
  }
}
