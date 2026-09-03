import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

import {
  BACKUP_FOLDER,
  BACKUP_INDEX,
  listBackups,
  rememberBefore,
  restoreBackup,
  type BackupStore,
} from "../src/write/backup";

/**
 * Запасная копия перед КАЖДОЙ записью в чужой файл.
 *
 * Склад подставной и живёт в памяти: сам склад — три вызова `vault.adapter`, и
 * проверять здесь надо не их, а правила — что копия снимается, что она не
 * плодится на ровном месте, что круг версий не растёт бесконечно и что
 * испорченный указатель не роняет запись заметки.
 */
function memoryStore(): BackupStore & { files: Map<string, string> } {
  const files = new Map<string, string>();
  return {
    files,
    read: (path) => Promise.resolve(files.get(path)),
    write: (path, text) => {
      files.set(path, text);
      return Promise.resolve();
    },
    remove: (path) => {
      files.delete(path);
      return Promise.resolve();
    },
  };
}

const NOTE = "Base/Библиотека/Джедайские техники.md";
const OTHER = "Base/Библиотека/Путь джедая. Поиск собственной методики продуктивности.md";

describe("запасная копия", () => {
  test("копия снимается байт в байт и лежит в папке плагина", async () => {
    const store = memoryStore();
    const text = "---\ntags: 📖\n---\n## Джедайские техники\n\nМоя мысль.\n";

    const record = await rememberBefore(store, {
      path: NOTE,
      text,
      savedAt: "20260812 1647",
      stamp: "20260812-164701",
    });

    expect(record).toBeDefined();
    expect(store.files.get(`${BACKUP_FOLDER}/${record!.id}`)).toBe(text);
    for (const key of store.files.keys()) expect(key.startsWith(`${BACKUP_FOLDER}/`)).toBe(true);
    expect(store.files.has(BACKUP_INDEX)).toBe(true);
  });

  /**
   * Находка 13 прогона глазами 20260818: слова и поведение разошлись.
   *
   * Три места плагина обещали копию «перед ПЕРВОЙ записью» — заголовок модуля,
   * страница настроек и окно версий. На живом хранилище за один заход у
   * `Тихая инженерия` накопились две копии. Здесь заперто поведение: вторая
   * запись в ту же заметку снимает вторую копию, и старая остаётся на месте.
   */
  test("вторая запись в ту же заметку снимает вторую копию", async () => {
    const store = memoryStore();
    const first = await rememberBefore(store, {
      path: NOTE,
      text: "заметка без секции",
      savedAt: "20260818 1125",
      stamp: "20260818-112501",
    });
    const second = await rememberBefore(store, {
      path: NOTE,
      text: "заметка с секцией Beresta",
      savedAt: "20260818 1152",
      stamp: "20260818-115201",
    });

    expect(first).toBeDefined();
    expect(second).toBeDefined();
    const kept = await listBackups(store, NOTE);
    expect(kept.map((one) => one.savedAt)).toEqual(["20260818 1125", "20260818 1152"]);
    // Обе версии лежат файлами: круг из пяти вытеснять пока нечего.
    expect(store.files.get(`${BACKUP_FOLDER}/${first!.id}`)).toBe("заметка без секции");
    expect(store.files.get(`${BACKUP_FOLDER}/${second!.id}`)).toBe("заметка с секцией Beresta");
  });

  test("тот же текст второй копии не порождает", async () => {
    const store = memoryStore();
    const request = {
      path: NOTE,
      text: "то же самое",
      savedAt: "20260812 1647",
      stamp: "20260812-164701",
    };

    await rememberBefore(store, request);
    const again = await rememberBefore(store, { ...request, stamp: "20260812-164702" });

    expect(again).toBeUndefined();
    expect(await listBackups(store, NOTE)).toHaveLength(1);
  });

  test("держим последние версии, старшие уходят вместе с файлами", async () => {
    const store = memoryStore();
    for (let index = 1; index <= 7; index += 1) {
      await rememberBefore(store, {
        path: NOTE,
        text: `версия ${index}`,
        savedAt: `20260812 16${String(index).padStart(2, "0")}`,
        stamp: `20260812-1647${String(index).padStart(2, "0")}`,
        keep: 3,
      });
    }

    const kept = await listBackups(store, NOTE);
    expect(kept.map((item) => item.savedAt)).toEqual(["20260812 1605", "20260812 1606", "20260812 1607"]);
    // Файлы вытесненных версий тоже убраны: указатель и папка не расходятся.
    expect(store.files.size).toBe(3 + 1);
  });

  test("копии разных заметок не вытесняют друг друга", async () => {
    const store = memoryStore();
    for (let index = 1; index <= 4; index += 1) {
      await rememberBefore(store, {
        path: NOTE,
        text: `версия ${index}`,
        savedAt: "20260812 1647",
        stamp: `20260812-16470${index}`,
        keep: 2,
      });
    }
    await rememberBefore(store, {
      path: OTHER,
      text: "другая заметка",
      savedAt: "20260812 1648",
      stamp: "20260812-164800",
      keep: 2,
    });

    expect(await listBackups(store, NOTE)).toHaveLength(2);
    expect(await listBackups(store, OTHER)).toHaveLength(1);
  });

  test("восстановление возвращает путь и текст той версии", async () => {
    const store = memoryStore();
    const first = await rememberBefore(store, {
      path: NOTE,
      text: "первая версия",
      savedAt: "20260812 1647",
      stamp: "20260812-164701",
    });
    await rememberBefore(store, {
      path: NOTE,
      text: "вторая версия",
      savedAt: "20260812 1648",
      stamp: "20260812-164802",
    });

    expect(await restoreBackup(store, first!.id)).toEqual({ path: NOTE, text: "первая версия" });
    expect(await restoreBackup(store, "нет такой копии")).toBeUndefined();
  });

  test("испорченный указатель не роняет запись и не стирает файлы копий", async () => {
    const store = memoryStore();
    await rememberBefore(store, {
      path: NOTE,
      text: "первая версия",
      savedAt: "20260812 1647",
      stamp: "20260812-164701",
    });
    const files = new Set(store.files.keys());
    store.files.set(BACKUP_INDEX, "{это не JSON");

    expect(await listBackups(store)).toEqual([]);
    const record = await rememberBefore(store, {
      path: NOTE,
      text: "вторая версия",
      savedAt: "20260812 1648",
      stamp: "20260812-164802",
    });

    expect(record).toBeDefined();
    for (const key of files) expect(store.files.has(key)).toBe(true);
  });
});

/**
 * Слова, которые владелец читает глазами, — про то же поведение.
 *
 * Обычный тест поведения не ловит неверную подпись: код снимал копию перед
 * каждой записью и делал это правильно, а три места плагина одновременно
 * обещали «перед первой». Прогон глазами 20260818 нашёл расхождение только
 * потому, что человек сверил слова с папкой копий. Здесь та же сверка стоит
 * проверкой: верните в описание слово «первой» — тест обязан упасть.
 */
describe("подписи про запасные копии", () => {
  function sourceOf(file: string): string {
    return readFileSync(fileURLToPath(new URL(`../src/${file}`, import.meta.url)), "utf8");
  }

  const SEEN_BY_OWNER = ["ui/settings-tab.ts", "ui/backup-modal.ts"];

  test("ни одно окно не обещает копию «перед первой записью»", () => {
    for (const file of SEEN_BY_OWNER) {
      expect(sourceOf(file), file).not.toMatch(/перед\s+(своей\s+|первой\s+)*первой/);
    }
  });

  test("страница настроек называет каждую запись и круг версий", () => {
    const page = sourceOf("ui/settings-tab.ts");
    expect(page).toContain("перед КАЖДОЙ своей записью");
    // Настройка «сколько версий хранить» без вытеснения не значит ничего —
    // значит описание обязано сказать, что старое вытесняется.
    expect(page).toContain("вытесняется");
  });
});
