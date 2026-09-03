/**
 * Окно «вернуть прежнюю версию заметки» — вторая половина шага 4 задачи 11.
 *
 * Сама запасная копия и откат написаны и проверены там (`src/write/backup.ts`);
 * не хватало ровно этого — списка версий и команды. Долг был записан явным
 * шагом в задачу 14, и здесь он закрыт.
 *
 * **Версия называется временем и длиной, а не номером.** «Копия 3» человеку не
 * говорит ничего; «20260812 2114, 8 431 знак» говорит, до или после его правки
 * она снята.
 */

import { Modal, type App } from "obsidian";

import type { BackupRecord } from "../write/backup";

export class BackupModal extends Modal {
  constructor(
    app: App,
    private readonly path: string,
    private readonly records: readonly BackupRecord[],
    private readonly restore: (id: string) => void,
  ) {
    super(app);
  }

  override onOpen(): void {
    const { contentEl, titleEl } = this;
    titleEl.setText("Прежние версии заметки");
    contentEl.empty();
    contentEl.createEl("p", { text: this.path });

    if (this.records.length === 0) {
      contentEl.createEl("p", {
        text:
          "Копий этой заметки нет. Beresta снимает копию перед каждой своей записью " +
          "в заметку; если она сюда ещё не писала, копировать было нечего.",
      });
      return;
    }

    contentEl.createEl("p", {
      cls: "beresta-muted",
      text:
        "Копия снимается перед каждой записью Beresta, если текст с прошлой копии " +
        "изменился; держатся последние несколько версий, число — в настройках. " +
        "Возврат перепишет заметку целиком — вместе с тем, что вы написали после " +
        "этого момента.",
    });

    // От новых к старым: нужная версия почти всегда последняя.
    for (const record of [...this.records].reverse()) {
      const line = contentEl.createDiv({ cls: "beresta-binding-choice" });
      const button = line.createEl("button", {
        text: `${record.savedAt} — ${record.length} знаков`,
      });
      button.addEventListener("click", () => {
        this.restore(record.id);
        this.close();
      });
    }
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}
