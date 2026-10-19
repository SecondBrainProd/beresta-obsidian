import { describe, expect, it } from "vitest";

import { BindingIndex } from "../src/binding/index";

/**
 * Указатель привязок перечисляет хранилище один раз и дальше живёт событиями.
 * Рекомендация каталога Obsidian к 0.3.3 (Vault Enumeration): до этого
 * перечисление шло на каждый такт опроса.
 *
 * Рез: в `BindingIndex.snapshot` верните `this.rebuild()` перед копией —
 * первая проверка краснеет на счётчике перечислений.
 */

type Note = { readonly path: string };

function stand(frontmatter: Map<string, readonly string[]>) {
  const files: Note[] = [...frontmatter.keys()].map((path) => ({ path }));
  let enumerated = 0;
  const index = new BindingIndex<Note>({
    files: () => {
      enumerated += 1;
      return files;
    },
    idsOf: (file) => frontmatter.get(file.path) ?? [],
  });
  return { index, files, frontmatter, enumerated: () => enumerated };
}

describe("указатель привязок", () => {
  it("перечисляет хранилище один раз, снимки берутся из памяти", () => {
    const s = stand(
      new Map([
        ["Library/Книга.md", ["b-1"]],
        ["Дневник/2026.md", []],
        ["Заметки/Мысль.md", ["b-2", "b-3"]],
      ]),
    );
    s.index.rebuild();
    expect(s.index.snapshot()).toEqual(
      new Map([
        ["Library/Книга.md", ["b-1"]],
        ["Заметки/Мысль.md", ["b-2", "b-3"]],
      ]),
    );
    // Пять тактов опроса — ни одного нового перечисления.
    for (let i = 0; i < 5; i += 1) s.index.snapshot();
    expect(s.enumerated()).toBe(1);
    expect(s.index.enumerationCount).toBe(1);
  });

  it("холодный кэш: заметка, разобранная позже, попадает по событию changed", () => {
    const fm = new Map<string, readonly string[]>([["Поздняя.md", []]]);
    const s = stand(fm);
    s.index.rebuild();
    expect(s.index.snapshot().size).toBe(0);
    // Obsidian дочитал frontmatter и сообщил `changed`.
    fm.set("Поздняя.md", ["b-9"]);
    s.index.refresh({ path: "Поздняя.md" });
    expect(s.index.snapshot().get("Поздняя.md")).toEqual(["b-9"]);
    expect(s.enumerated()).toBe(1);
  });

  it("снятая привязка, удаление и переименование правят указатель без перечисления", () => {
    const fm = new Map<string, readonly string[]>([
      ["A.md", ["b-1"]],
      ["B.md", ["b-2"]],
    ]);
    const s = stand(fm);
    s.index.rebuild();

    fm.set("A.md", []);
    s.index.refresh({ path: "A.md" });
    expect(s.index.snapshot().has("A.md")).toBe(false);

    s.index.forget("B.md");
    expect(s.index.snapshot().size).toBe(0);

    fm.set("Новое/B.md", ["b-2"]);
    s.index.rename({ path: "Новое/B.md" }, "B.md");
    expect(s.index.snapshot()).toEqual(new Map([["Новое/B.md", ["b-2"]]]));
    expect(s.enumerated()).toBe(1);
  });

  it("снимок — копия: правка снимка указатель не трогает", () => {
    const s = stand(new Map([["A.md", ["b-1"]]]));
    s.index.rebuild();
    const copy = s.index.snapshot();
    copy.delete("A.md");
    expect(s.index.snapshot().get("A.md")).toEqual(["b-1"]);
  });
});
