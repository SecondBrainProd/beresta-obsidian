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

import { BACKUP_INDEX, type BackupIndexState, type BackupRecord } from "../write/backup";
import { interfaceLanguage } from "../render/defaults";
import { counted, fill, panelWords, type PanelWords } from "./words";

/**
 * Строка беды об испорченном указателе копий — или `undefined`, если беды нет.
 *
 * Без неё окно молча показывало бы неполный список, и человек решил бы, что
 * прежних версий нет. Испорченный сейчас — это сам `index.json`; отложенные —
 * то, что `rememberBefore` сохранил рядом, прежде чем писать новый.
 */
export function backupTroubleLine(
  state: BackupIndexState,
  folder: string,
  say: PanelWords["pass"],
): string | undefined {
  const files = [...state.setAside];
  if (state.kind === "broken") files.unshift(BACKUP_INDEX.slice(BACKUP_INDEX.lastIndexOf("/") + 1));
  if (files.length === 0) return undefined;
  return fill(say.backupIndexTrouble, { folder, files: files.join(", ") });
}

export class BackupModal extends Modal {
  constructor(
    app: App,
    private readonly path: string,
    private readonly records: readonly BackupRecord[],
    private readonly restore: (id: string) => void,
    private readonly trouble?: string,
  ) {
    super(app);
  }

  /** Слова окна — по языку интерфейса в момент показа. */
  private get words(): PanelWords {
    return panelWords(interfaceLanguage());
  }

  override onOpen(): void {
    const { contentEl, titleEl } = this;
    titleEl.setText(this.words.pass.backupTitle);
    contentEl.empty();
    contentEl.createEl("p", { text: this.path });
    if (this.trouble !== undefined) contentEl.createEl("p", { text: this.trouble });

    if (this.records.length === 0) {
      contentEl.createEl("p", {
        text: this.words.pass.backupNone,
      });
      return;
    }

    contentEl.createEl("p", {
      cls: "beresta-muted",
      text: this.words.pass.backupExplained,
    });

    // От новых к старым: нужная версия почти всегда последняя.
    for (const record of [...this.records].reverse()) {
      const line = contentEl.createDiv({ cls: "beresta-binding-choice" });
      const button = line.createEl("button", {
        text: fill(counted(this.words, record.length, this.words.pass.backupRecord), {
          savedAt: record.savedAt,
        }),
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
