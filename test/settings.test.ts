import { describe, expect, test } from "vitest";

import {
  DEFAULT_SETTINGS,
  INTERVAL_FIELD,
  KEEP_BACKUPS_FIELD,
  OFFSET_FIELD,
  REMOVAL_COUNT_FIELD,
  initialState,
  readFolderField,
  readNumberField,
  readState,
  readTemplateField,
  stateToJSON,
} from "../src/settings";

/**
 * Настройки и память в `data.json`.
 *
 * **Главное здесь — сдвиг часового пояса.** Он единственная настройка, которая
 * меняет БАЙТЫ заметки: время выделения печатается в каждом блоке, а блок с
 * другими байтами задача 11 читает как правку человека и замораживает навсегда.
 * Возьми плагин сдвиг у машины при каждом проходе — хранилище,
 * синхронизированное между двумя Маками в разных поясах, замораживало бы блоки
 * друг другу молча, и виноватым выглядел бы человек.
 *
 * **Второе — разбор чужого файла.** `data.json` лежит открытым текстом, его
 * правят руками и возит чужая синхронизация. Плагин, который не включается
 * из-за испорченного вспомогательного файла, не защищает заметки, а перестаёт
 * их обновлять молча.
 */

const KARAGANDA = 300;
const MOSCOW = 180;

describe("настройки", () => {
  test("сдвиг пояса спрашивается у машины один раз и дальше живёт своей жизнью", () => {
    const saved = stateToJSON(initialState(KARAGANDA));
    // Хранилище открыли на второй машине — в Москве. Сдвиг обязан остаться
    // карагандинским: иначе перелёт владельца перерисует все блоки.
    const state = readState(saved, MOSCOW);
    expect(state.settings.timeZoneOffsetMinutes).toBe(KARAGANDA);
  });

  test("сдвига в файле нет — берётся машинный, но только тогда", () => {
    expect(readState({}, MOSCOW).settings.timeZoneOffsetMinutes).toBe(MOSCOW);
    expect(readState({ settings: {} }, MOSCOW).settings.timeZoneOffsetMinutes).toBe(MOSCOW);
  });

  test("испорченный `data.json` не роняет плагин, а даёт начальные настройки", () => {
    for (const rubbish of [undefined, null, 42, "строка", [], { settings: "нет" }]) {
      const state = readState(rubbish, KARAGANDA);
      expect(state.settings.libraryFolder).toBe(DEFAULT_SETTINGS.libraryFolder);
      expect(state.settings.timeZoneOffsetMinutes).toBe(KARAGANDA);
      expect(state.known).toEqual({});
      expect(state.watch.hash).toBeUndefined();
    }
  });

  test("негодное значение заменяется своим, а не принимается на веру", () => {
    const state = readState(
      {
        settings: {
          libraryFolder: 17,
          timeZoneOffsetMinutes: "три часа",
          focusedIntervalMs: 0,
          keepBackups: -5,
          removalShare: 12,
          removalCount: "много",
        },
      },
      KARAGANDA,
    );
    expect(state.settings.libraryFolder).toBe(DEFAULT_SETTINGS.libraryFolder);
    expect(state.settings.timeZoneOffsetMinutes).toBe(KARAGANDA);
    expect(state.settings.focusedIntervalMs).toBe(DEFAULT_SETTINGS.focusedIntervalMs);
    expect(state.settings.keepBackups).toBe(DEFAULT_SETTINGS.keepBackups);
    expect(state.settings.removalShare).toBe(DEFAULT_SETTINGS.removalShare);
    expect(state.settings.removalCount).toBe(DEFAULT_SETTINGS.removalCount);
  });
});

describe("память", () => {
  test("память об указателе и о записанных блоках переживает запись и чтение", () => {
    const start = initialState(KARAGANDA);
    const state = {
      ...start,
      watch: { hash: "abc123", hint: { mtime: 1_700_000, size: 2048 }, whole: true },
      known: { "Base/Библиотека/Гибкое сознание.md": { blocks: { "hl-aaaa": "ffff" }, head: "eeee" } },
      dataStamp: "20260806 1306",
      health: "целый" as const,
      lookedAt: 1_755_000_000_000,
    };

    const back = readState(JSON.parse(JSON.stringify(stateToJSON(state))), MOSCOW);

    expect(back.watch).toEqual(state.watch);
    expect(back.known).toEqual(state.known);
    expect(back.dataStamp).toBe("20260806 1306");
    expect(back.health).toBe("целый");
    expect(back.lookedAt).toBe(1_755_000_000_000);
  });

  /**
   * Чьё и на какой момент разложено — переживает перезапуск.
   *
   * Без этого правило «чужой снимок постарше не применять» после каждого
   * запуска Obsidian выключено до первого прохода: сравнивать не с чем, а
   * отсутствие ответа значит «применять». Беда при этом тихая — ровно та, что
   * замерена приёмкой 20260816.
   */
  test("память о разложенном снимке переживает запись и чтение", () => {
    const start = initialState(KARAGANDA);
    const state = {
      ...start,
      appliedDeviceId: "84DDD8A9-1A69-4A64-A0AE-1B0F1D2C3B4A",
      appliedGeneratedAt: "2026-08-06T08:06:40Z",
    };

    const written = stateToJSON(state);
    const back = readState(JSON.parse(JSON.stringify(written)), MOSCOW);

    expect(back.appliedDeviceId).toBe(state.appliedDeviceId);
    expect(back.appliedGeneratedAt).toBe(state.appliedGeneratedAt);
    // И оба ключа — наши: попади они в `unknown`, файл получил бы их дважды.
    expect(back.unknown).toEqual({});
  });

  test("незнакомые ключи чужой версии не теряются при записи", () => {
    // `data.json`, написанный более поздним плагином, теряет свои поля при
    // первой записи нашей — и человек, откатившийся на неделю назад, теряет
    // настройки без следа. Незнакомое сохраняется.
    const future = { version: 1, settings: {}, "зона-чтения": { сколько: 3 } };
    const written = stateToJSON(readState(future, KARAGANDA));
    expect(written["зона-чтения"]).toEqual({ сколько: 3 });
  });

  test("здоровье снимка из будущей версии не выдаётся за известное", () => {
    expect(readState({ health: "розовое" }, KARAGANDA).health).toBe("неизвестно");
  });
});

/**
 * Поля страницы настроек: отказ обязан быть виден.
 *
 * **Находка 7 прогона глазами 20260818.** В «Часовой пояс выписок» вписано
 * слово `Караганда`. Поле показывает `Караганда`, в `data.json` по-прежнему
 * `300`. Ни рамки, ни сообщения, ни возврата прежнего значения — экран и файл
 * разошлись, и узнать об этом нельзя ничем, кроме как открыть `data.json`.
 *
 * Проверяется здесь решение, а не вёрстка: ЧТО считается годным и КАКИМИ
 * СЛОВАМИ поле отказывает. Само окно (`ui/settings-tab.ts`) поверх этих слов
 * только показывает и возвращает прежнее значение в поле.
 */
describe("поля страницы настроек", () => {
  test("слово вместо числа отвергнуто, и отказ назван словами", () => {
    const verdict = readNumberField(OFFSET_FIELD, "Караганда");
    expect(verdict.kind).toBe("refused");
    if (verdict.kind !== "refused") return;
    // Человек обязан узнать свою строку — иначе непонятно, на что ругаются.
    expect(verdict.said).toContain("«Караганда»");
    // И узнать, что теперь в настройке: без этого сообщение бесполезно.
    expect(verdict.said).toContain("настройка осталась прежней");
    // И узнать, что здесь бывает.
    expect(verdict.said).toContain("300 — Караганда");
  });

  test("число вне границ отвергнуто и границы названы", () => {
    const verdict = readNumberField(OFFSET_FIELD, "5000");
    expect(verdict.kind).toBe("refused");
    if (verdict.kind !== "refused") return;
    expect(verdict.said).toContain("от -840 до 840");
    expect(verdict.said).toContain("настройка осталась прежней");
  });

  test("годное число принимается целым", () => {
    expect(readNumberField(OFFSET_FIELD, " 300 ")).toEqual({ kind: "ok", value: 300 });
    expect(readNumberField(OFFSET_FIELD, "-180")).toEqual({ kind: "ok", value: -180 });
    expect(readNumberField(KEEP_BACKUPS_FIELD, "5.4")).toEqual({ kind: "ok", value: 5 });
  });

  test("недопечатанное — не отказ: красным на каждой букве не мигаем", () => {
    for (const typed of ["", "   ", "-", "+"]) {
      expect(readNumberField(OFFSET_FIELD, typed).kind, typed).toBe("typing");
    }
  });

  /**
   * Границы полей и границы разбора `data.json` — одни и те же.
   *
   * Разойдись они — страница примет значение, которое `readState` при
   * следующем запуске выбросит, и настройка «сама вернётся».
   */
  test("что приняло поле, то примет и разбор `data.json`", () => {
    const cases: [typeof OFFSET_FIELD, (value: number) => Record<string, number>, string][] = [
      [OFFSET_FIELD, (value) => ({ timeZoneOffsetMinutes: value }), "timeZoneOffsetMinutes"],
      [INTERVAL_FIELD, (value) => ({ focusedIntervalMs: value * 1000 }), "focusedIntervalMs"],
      [KEEP_BACKUPS_FIELD, (value) => ({ keepBackups: value }), "keepBackups"],
      [REMOVAL_COUNT_FIELD, (value) => ({ removalCount: value }), "removalCount"],
    ];
    for (const [field, patch, key] of cases) {
      for (const edge of [field.least, field.most]) {
        const verdict = readNumberField(field, String(edge));
        expect(verdict, `${field.name} ${edge}`).toEqual({ kind: "ok", value: edge });
        const settings = readState({ settings: patch(edge) }, KARAGANDA)
          .settings as unknown as Record<string, number>;
        expect(settings[key], `${field.name} ${edge}`).toBe(patch(edge)[key]);
      }
      // На шаг за границей поле отказывает — и разбор файла тоже.
      expect(readNumberField(field, String(field.least - 1)).kind).toBe("refused");
      expect(readNumberField(field, String(field.most + 1)).kind).toBe("refused");
    }
  });

  test("папки, которой нет, отказа не будет — но и молчания тоже", () => {
    const verdict = readFolderField("Нет такой папки", () => false);
    expect(verdict.kind).toBe("ok");
    if (verdict.kind !== "ok") return;
    expect(verdict.value).toBe("Нет такой папки");
    // Опечатка в этом поле разложила бы заметки туда, где человек их не ищет.
    expect(verdict.said).toContain("в хранилище нет");
  });

  test("существующая папка принимается молча, косые по краям снимаются", () => {
    expect(readFolderField("/Base/Библиотека/", (path) => path === "Base/Библиотека")).toEqual({
      kind: "ok",
      value: "Base/Библиотека",
    });
  });

  test("знак, которого файловая система не примет, отвергнут", () => {
    const verdict = readFolderField("Библиотека: книги", () => true);
    expect(verdict.kind).toBe("refused");
    if (verdict.kind !== "refused") return;
    expect(verdict.said).toContain("настройка осталась прежней");
  });
});

describe("шаблон секции выписок", () => {
  test("пусто — это «как у всех», а не пустая секция", () => {
    const verdict = readTemplateField("   \n  ");
    expect(verdict.kind).toBe("ok");
    if (verdict.kind !== "ok") return;
    // Именно `undefined`, а не пустая строка: пустой шаблон рисуется БЕЗ жалоб
    // и даёт секцию без якорей, которую слияние читает как «все блоки убраны».
    expect(verdict.value).toBeUndefined();
    expect(verdict.said).toContain("как у всех");
  });

  test("шаблон без {{anchor}} отвергнут, и сказано почему", () => {
    const verdict = readTemplateField("{{#annotations}}\n> {{text}}\n{{/annotations}}");
    expect(verdict.kind).toBe("refused");
    if (verdict.kind !== "refused") return;
    expect(verdict.said).toContain("{{anchor}}");
    // Человек обязан узнать цену: не «неверный шаблон», а что случится.
    expect(verdict.said).toContain("убранными");
    expect(verdict.said).toContain("не сохранён");
  });

  test("годный шаблон принимается как есть", () => {
    const template = "{{#annotations}}\n> {{text}}\n\n^{{anchor}}\n{{/annotations}}";
    const verdict = readTemplateField(template);
    expect(verdict.kind).toBe("ok");
    if (verdict.kind !== "ok") return;
    expect(verdict.value).toBe(template);
  });

  test("негодный шаблон из data.json не доезжает до отрисовки", () => {
    // `data.json` правят руками, синхронизируют между машинами и переносят из
    // чужих хранилищ. Проверка при вводе такой шаблон не остановит.
    const state = readState({
      version: 1,
      settings: { template: "{{#annotations}}{{text}}{{/annotations}}" },
    }, 300);
    expect(state.settings.template).toBeUndefined();
  });

  test("годный шаблон из data.json доезжает и переживает запись", () => {
    const template = "{{#annotations}}{{text}} ^{{anchor}}{{/annotations}}";
    const state = readState({ version: 1, settings: { template } }, 300);
    expect(state.settings.template).toBe(template);

    const written = stateToJSON(state) as { settings: { template?: string } };
    expect(written.settings.template).toBe(template);
  });

  test("нетронутый шаблон в data.json не появляется вовсе", () => {
    // Копия стандартного шаблона в файле заморозила бы человеку сегодняшний вид
    // навсегда — он ничего не настраивал, а новые версии до него не дошли бы.
    const written = stateToJSON(initialState(0)) as { settings: { template?: string } };
    expect(written.settings.template).toBeUndefined();
  });
});
