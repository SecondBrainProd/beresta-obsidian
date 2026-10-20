/**
 * «Выгрузки нет» называет, что сделать (владелец 20261019: «Если выгрузки в
 * этом хранилище нет, какую команду для начала надо делать?»). Прежние слова
 * — «приложение пишет её само», «сделайте выгрузку в приложении» — не говорили,
 * где это; выгрузку создаёт подключение хранилища в приложении.
 *
 * Рез (прогнан 20261019): вернуть прежний текст любого из трёх — краснеет.
 */
import { expect, test } from "vitest";
import { panelWords } from "../src/ui/words";

test("все три «выгрузки нет» называют пункт меню приложения — на обоих языках", () => {
  const menu = { ru: "Файл → Подключить Obsidian…", en: "File → Connect Obsidian…" } as const;
  for (const language of ["ru", "en"] as const) {
    const words = panelWords(language);
    for (const [where, text] of [
      ["подсказка строки состояния", words.status.hint.noExport],
      ["ответ «Разложить сейчас»", words.status.syncNow.noExport],
      ["уведомление команд", words.notices.noExport],
    ] as const) {
      expect([language, where, text.includes(menu[language])]).toEqual([language, where, true]);
    }
  }
});
