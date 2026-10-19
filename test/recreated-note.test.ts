/**
 * Заметку удалили и завели заново под тем же путём (владелец 20261019, Warez):
 * память плагина о блоках удалённой заметки не должна переходить к новой —
 * иначе отсутствие блоков читается как «человек убрал», и секция приходит
 * пустой.
 *
 * Рез (прогнан 20261019): в `pass.ts` брать `input.memory.get(path)` и у
 * несуществующего файла — краснеет «блоки приехали».
 */
import { expect, test } from "vitest";
import type { KnownSection } from "../src/merge/fuse";
import { EMPTY_SECTION } from "../src/render/note";
import { readSnapshot } from "../src/snapshot";
import { runSync, type SyncInput } from "../src/sync/pass";
import { FakeVault } from "./harness/vault";

const PATH = "Библиотека/Новая.md";
const BOOK = "5650781E-4943-515E-B644-7745D3BB9759";

test("заведённая заново заметка получает блоки, хотя память помнит их в удалённой", async () => {
  const vault = new FakeVault();
  vault.putSnapshot("owner-library");
  const memory = new Map<string, KnownSection>();
  const create = async () =>
    await runSync({
      snapshot: await readSnapshot(vault),
      bindings: new Map([[PATH, [BOOK]]]),
      notes: vault,
      backups: vault.backups(),
      language: "ru",
      memory: {
        get: (path) => memory.get(path),
        set: (path, known) => {
          memory.set(path, known);
        },
      },
      settings: { timeZoneOffsetMinutes: 300, keepBackups: 5, removalShare: 0.2, removalCount: 20 },
      now: Date.parse("2026-10-19T09:30:00Z"),
      creating: new Set([PATH]),
      initialText: () => EMPTY_SECTION,
    } as SyncInput);

  await create();
  const blocks = (vault.peek(PATH)!.match(/\^hl-/g) ?? []).length;
  expect(blocks).toBeGreaterThan(0);
  expect(memory.get(PATH)).toBeDefined();

  vault.drop(PATH);
  await create();
  expect((vault.peek(PATH)!.match(/\^hl-/g) ?? []).length, "блоки приехали").toBe(blocks);
});
