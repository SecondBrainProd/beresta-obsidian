import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Язык интерфейса — у самого Obsidian (`getLanguage()`, ревью каталога
 * 20260927), а без него (Obsidian до 1.8) — из настроек, как раньше.
 *
 * Хранилище настроек в узле подставное — тем же приёмом, что в
 * `note-language.test.ts`: у узла своего `localStorage` нет.
 *
 * Рез: уберите в `interfaceLanguage` обращение к `getLanguage` — краснеет
 * «язык взят не у приложения».
 */
describe("язык интерфейса", () => {
  const storage = globalThis.localStorage;

  afterEach(() => {
    vi.doUnmock("obsidian");
    vi.resetModules();
    if (storage === undefined) {
      delete (globalThis as { localStorage?: unknown }).localStorage;
    } else {
      (globalThis as { localStorage?: unknown }).localStorage = storage;
    }
  });

  function pretendSettings(value: string | null): void {
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (key: string) => (key === "language" ? value : null),
    };
  }

  it("берёт язык у приложения, а не из настроек, когда есть оба", async () => {
    vi.doMock("obsidian", () => ({ getLanguage: () => "de" }));
    pretendSettings("ru");
    const { interfaceLanguage } = await import("../src/render/defaults");
    expect(interfaceLanguage(), "язык взят не у приложения").toBe("de");
  });

  it("без getLanguage (старый Obsidian) читает настройки", async () => {
    vi.doMock("obsidian", () => ({}));
    pretendSettings("ru");
    const { interfaceLanguage } = await import("../src/render/defaults");
    expect(interfaceLanguage()).toBe("ru");
  });

  it("приложение ответило пустотой, настроек нет — английский", async () => {
    vi.doMock("obsidian", () => ({ getLanguage: () => "" }));
    pretendSettings(null);
    const { interfaceLanguage } = await import("../src/render/defaults");
    expect(interfaceLanguage()).toBe("en");
  });
});
