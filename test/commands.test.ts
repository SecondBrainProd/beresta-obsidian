import { describe, expect, test } from "vitest";

import { commandSpecs, type CommandActions } from "../src/commands";

/**
 * Команды — договор о том, что плагин делает сам, а что только по просьбе.
 *
 * Проверяется не список ради списка: каждая строка здесь про решение. Что
 * плагин делает сам — ровно одно (раскладывает выписки по привязанным
 * заметкам). Что не делает без нажатия — привязка, возврат стёртой секции,
 * снятие предохранителя, откат заметки. Пропадёт любая из этих команд — пропадёт
 * и способ человеку это сделать, а тест этого не заметит, если не смотреть.
 */

function spy(): { actions: CommandActions; calls: string[] } {
  const calls: string[] = [];
  const actions: CommandActions = {
    syncNow: () => {
      calls.push("syncNow");
    },
    bindBooks: () => {
      calls.push("bindBooks");
    },
    showConflicts: () => {
      calls.push("showConflicts");
    },
    returnSection: (path) => {
      calls.push(`returnSection:${path}`);
    },
    confirmRemovals: (path) => {
      calls.push(`confirmRemovals:${path}`);
    },
    restoreVersion: (path) => {
      calls.push(`restoreVersion:${path}`);
    },
  };
  return { actions, calls };
}

describe("команды", () => {
  test("на месте все шесть, и каждая зовёт своё", () => {
    const { actions, calls } = spy();
    const specs = commandSpecs(actions);
    expect(specs.map((one) => one.id).sort()).toEqual([
      "bind-books",
      "confirm-removals",
      "restore-version",
      "return-section",
      "show-conflicts",
      "sync-now",
    ]);
    for (const spec of specs) void spec.run("Base/Библиотека/Джедайские техники.md");
    expect(calls).toEqual([
      "syncNow",
      "bindBooks",
      "showConflicts",
      "returnSection:Base/Библиотека/Джедайские техники.md",
      "confirmRemovals:Base/Библиотека/Джедайские техники.md",
      "restoreVersion:Base/Библиотека/Джедайские техники.md",
    ]);
  });

  test("команды заметки помечены — без открытой заметки их не показывают", () => {
    const specs = commandSpecs(spy().actions);
    const needing = specs.filter((one) => one.needsNote).map((one) => one.id);
    // Возврат секции, снятие предохранителя и откат версии без заметки
    // бессмысленны: показывать их и молчать в ответ на нажатие — способ
    // научить человека не доверять всему списку команд.
    expect(needing.sort()).toEqual(["confirm-removals", "restore-version", "return-section"]);
  });

  test("имена без приставки «Beresta» — её припишет Obsidian", () => {
    for (const spec of commandSpecs(spy().actions)) {
      expect(spec.name.startsWith("Beresta"), spec.id).toBe(false);
      expect(spec.name.length, spec.id).toBeGreaterThan(0);
    }
  });

  test("имена не повторяются и объясняют себя глаголом", () => {
    const specs = commandSpecs(spy().actions);
    const names = specs.map((one) => one.name);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) {
      expect(name, name).toMatch(/^(Разложить|Привязать|Показать|Вернуть|Подтвердить|Восстановить)/);
    }
  });

  test("`id` без пробелов и заглавных: он попадает в горячие клавиши", () => {
    for (const spec of commandSpecs(spy().actions)) {
      expect(spec.id, spec.id).toMatch(/^[a-z][a-z-]*[a-z]$/);
    }
  });
});
