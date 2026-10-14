/**
 * Настройки и память плагина — то, что переживает перезапуск Obsidian.
 *
 * **Настройки лежат здесь и только здесь.** В заметке из нашего два ключа
 * frontmatter (`beresta-book-id`, `beresta-last-sync`), секция между маркерами
 * и служебная строка с отпечатком при каждом блоке; остальное — человека.
 * Настройки, отпечаток последнего указателя и память о разложенном снимке к
 * заметкам отношения не имеют и в них не попадают.
 *
 * **Память о записанных блоках (`known`) с 20260901 — второй эшелон.** Первым
 * отвечает сама заметка: отпечаток стоит при блоке (`merge/fuse.ts`), поэтому
 * переименование заметки, переустановка плагина и второй Мак больше не
 * замораживают её навсегда. Здешние записи остались для заметок, написанных
 * прежними сборками, и подрезаются заводилой, когда заметки по такому пути
 * больше нет.
 *
 * **Разбор чужого `data.json` не имеет права уронить плагин.** Файл лежит
 * открытым текстом, его правят руками, он едет по чужой синхронизации и
 * доезжает половиной. Поэтому `readState` ничего не требует: непонятное
 * значение заменяется своим, непонятный файл — начальным состоянием. Плагин,
 * который не включается из-за испорченного вспомогательного файла, не
 * защищает заметки, а перестаёт их обновлять молча.
 *
 * **Неизвестные ключи сохраняются.** `data.json`, написанный более поздней
 * версией плагина, теряет свои поля при первой же записи нашей — и человек,
 * откатившийся на неделю назад, теряет настройки без следа. Незнакомое
 * складывается в `unknown` и выписывается обратно, тем же приёмом, что и
 * незнакомые ключи снимка.
 */

import type { KnownSection } from "./merge/fuse";
import { EMPTY_WATCH_MEMORY, type WatchMemory } from "./poller";
import { interfaceLanguage } from "./render/defaults";
import { fill, panelWords, type SettingsWords } from "./ui/words";

/** Здоровье снимка — то, что показывает строка состояния. */
export type SnapshotHealth = "неизвестно" | "нет" | "целый" | "наполовину" | "не-читается";

export interface BerestaSettings {
  /** Куда класть заметки, которых ещё нет. */
  readonly libraryFolder: string;
  /**
   * Сдвиг часового пояса в минутах — **закреплённый, а не машинный**.
   *
   * Отрисовка обязана давать одни и те же байты на любой машине: разные байты
   * задача 11 читает как «человек правил блок» и замораживает его навсегда.
   * Возьми плагин сдвиг у машины при каждом проходе — хранилище,
   * синхронизированное между двумя Маками в разных поясах, замораживало бы
   * блоки друг другу молча. Поэтому сдвиг спрашивается у машины **один раз**,
   * при первом запуске, кладётся сюда и дальше меняется только руками.
   */
  readonly timeZoneOffsetMinutes: number;
  /** Как часто смотреть на указатель при фокусе окна, мс. */
  readonly focusedIntervalMs: number;
  /** То же без фокуса. */
  readonly unfocusedIntervalMs: number;
  /** Сколько версий заметки держать в запасных копиях. */
  readonly keepBackups: number;
  /** Доля прежних блоков, выше которой проход останавливается. */
  readonly removalShare: number;
  /** Число блоков, выше которого проход останавливается. */
  readonly removalCount: number;
  /**
   * Шаблон секции выписок — или `undefined`, если человек его не менял.
   *
   * **Почему не строка со значением по умолчанию.** `undefined` означает «как
   * у всех»: такая заметка получит новый стандартный шаблон, когда мы его
   * улучшим. Копия стандартного шаблона в `data.json` заморозила бы человеку
   * сегодняшний вид навсегда, а он об этом даже не узнал бы — он ничего не
   * настраивал.
   */
  readonly template?: string;
  /**
   * Форматы заметок — как «форматы ввоза» у Zotero Integration (план
   * `20261008-шаблоны-плагина-план.md`, задача 3; слова владельца R01, R04).
   *
   * Пусто — форматов нет, плагин работает как прежде: одна папка, стандартный
   * (или свой из `template`) шаблон блока. Имена уникальны; порядок — порядок
   * команд в палитре и списка при «создать новую заметку».
   */
  readonly formats: readonly NoteFormat[];
}

/** Формат заметки: имя и пути к файлам шаблонов в хранилище. */
export interface NoteFormat {
  /** Имя формата — им же подписана команда палитры. */
  readonly name: string;
  /** Файл шаблона ВСЕЙ заметки; пусто — заметка без шаблона, как прежде. */
  readonly noteTemplate?: string;
  /** Файл шаблона блока выписки; пусто — стандартный (или `template`). */
  readonly blockTemplate?: string;
  /**
   * Образец пути новой заметки, `Библиотека/Статьи/{{title}}.md`; пусто —
   * папка из `libraryFolder` и название, как прежде.
   */
  readonly pathPattern?: string;
}

/** Состояние плагина целиком: настройки плюс память. */
export interface PluginState {
  readonly settings: BerestaSettings;
  /** Что известно про указатель: отпечаток, подсказка, сошёлся ли снимок. */
  readonly watch: WatchMemory;
  /** Путь заметки → что мы в неё записали последним. */
  readonly known: Readonly<Record<string, KnownSection>>;
  /**
   * Путь заметки → сколько выписок Beresta держит в ней сейчас.
   *
   * **Не то же самое, что `known`, и путать их нельзя.** `known` — память о
   * том, что мы записали: она нужна слиянию и остаётся у заметки даже после
   * того, как человек стёр из неё секцию (иначе следующий проход счёл бы
   * привязку свежей и вернул бы секцию, которую убрали нарочно). Здесь —
   * сколько выписок в заметке ЛЕЖИТ, по буквам файла; у стёртой секции это
   * ноль.
   *
   * Держится в файле, а не только в памяти, ради подписи строки состояния:
   * перезапуск Obsidian на неизменившейся выгрузке прохода не делает вовсе, и
   * без записи подпись показывала бы ноль там, где выписки на местах.
   */
  readonly sections: Readonly<Record<string, number>>;
  /** На какой момент данные в заметках, `YYYYMMDD HHMM`. */
  readonly dataStamp: string | undefined;
  /**
   * Устройство, чей снимок разложен по заметкам последним.
   *
   * **Нужно ровно одному правилу — и правило это про потерю выписок.**
   * Хранилище синхронизируется чужими средствами, оба Мака пишут в одну папку
   * `.beresta/`, и снимок второй машины отстаёт на день. Применить его значит
   * убрать из заметок выписки, которых на той машине ещё нет: замер приёмки
   * 20260816 — из «Джедайских техник» ушли три блока, потолок молчаливой потери
   * 20 блоков за проход (выше встаёт предохранитель). Отсюда пара полей: чьё
   * разложено и на какой момент — `sync/runner.ts`.
   *
   * Не `dataStamp`: тот показывается человеку и потому огрублён до минут и
   * сдвинут в его часовой пояс. Сравнивать моменты двух машин надо тем, что
   * записано в указателе, — иначе разница в полминуты исчезает при сравнении.
   */
  readonly appliedDeviceId: string | undefined;
  /** Момент разложенного снимка, как он записан в указателе (`generatedAt`). */
  readonly appliedGeneratedAt: string | undefined;
  /** Здоровье снимка на последний взгляд. */
  readonly health: SnapshotHealth;
  /** Когда плагин последний раз смотрел на указатель, мс. */
  readonly lookedAt: number | undefined;
  /** Ключи чужих версий — сохраняются как есть. */
  readonly unknown: Readonly<Record<string, unknown>>;
}

/**
 * Умолчания для незнакомого языка интерфейса — английские, как и слова. Папка
 * для русского интерфейса — в словаре (`defaultLibraryFolder`), её подставляет
 * `initialState` по языку при первом запуске; записанное в `data.json` не
 * трогается (решение владельца 20260925, вопрос 10.1).
 */
export const DEFAULT_SETTINGS: Omit<BerestaSettings, "timeZoneOffsetMinutes"> = {
  libraryFolder: "Library",
  focusedIntervalMs: 5_000,
  unfocusedIntervalMs: 60_000,
  keepBackups: 5,
  removalShare: 0.2,
  removalCount: 20,
  formats: [],
};

/**
 * Начальное состояние: сдвиг пояса берётся у машины ровно здесь и один раз, папка
 * для новых заметок — по языку интерфейса, тоже один раз.
 */
export function initialState(
  timeZoneOffsetMinutes: number,
  language: string = interfaceLanguage(),
): PluginState {
  return {
    settings: {
      ...DEFAULT_SETTINGS,
      timeZoneOffsetMinutes,
      libraryFolder: panelWords(language).settings.defaultLibraryFolder,
    },
    watch: EMPTY_WATCH_MEMORY,
    known: {},
    sections: {},
    dataStamp: undefined,
    appliedDeviceId: undefined,
    appliedGeneratedAt: undefined,
    health: "неизвестно",
    lookedAt: undefined,
    unknown: {},
  };
}

/**
 * Читает `data.json`.
 *
 * `machineOffsetMinutes` подставляется **только если сдвига в файле нет**:
 * записанный однажды, он живёт своей жизнью и не сдвигается ни от перелёта, ни
 * от того, что хранилище открыли на второй машине.
 */
export function readState(
  raw: unknown,
  machineOffsetMinutes: number,
  language: string = interfaceLanguage(),
): PluginState {
  const start = initialState(machineOffsetMinutes, language);
  const document = asObject(raw);
  if (document === undefined) return start;

  const stored = asObject(document["settings"]) ?? {};
  const settings: BerestaSettings = {
    libraryFolder: string(stored["libraryFolder"]) ?? start.settings.libraryFolder,
    timeZoneOffsetMinutes:
      whole(stored["timeZoneOffsetMinutes"], -14 * 60, 14 * 60) ?? machineOffsetMinutes,
    focusedIntervalMs: whole(stored["focusedIntervalMs"], 1_000, 3_600_000) ?? start.settings.focusedIntervalMs,
    unfocusedIntervalMs:
      whole(stored["unfocusedIntervalMs"], 1_000, 3_600_000) ?? start.settings.unfocusedIntervalMs,
    keepBackups: whole(stored["keepBackups"], 1, 100) ?? start.settings.keepBackups,
    removalShare: fraction(stored["removalShare"]) ?? start.settings.removalShare,
    removalCount: whole(stored["removalCount"], 1, 100_000) ?? start.settings.removalCount,
    // Шаблон проверяется ПРИ ЧТЕНИИ, а не только при вводе: `data.json` правят
    // руками, синхронизируют между машинами и переносят из чужих хранилищ.
    // Негодный шаблон здесь означает не «покажем ошибку», а «нарисуем секцию,
    // в которой пропали все якоря», — и слияние прочтёт это как «человек убрал
    // все блоки».
    template: acceptableTemplate(string(stored["template"])),
    formats: readFormats(stored["formats"]),
  };

  const watchRaw = asObject(document["watch"]);
  const hintRaw = asObject(watchRaw?.["hint"]);
  const watch: WatchMemory = {
    hash: string(watchRaw?.["hash"]),
    hint:
      hintRaw === undefined
        ? undefined
        : {
            mtime: whole(hintRaw["mtime"], -Infinity, Infinity) ?? 0,
            size: whole(hintRaw["size"], 0, Infinity) ?? 0,
          },
    whole: watchRaw?.["whole"] === true,
  };

  const known: Record<string, KnownSection> = {};
  const knownRaw = asObject(document["known"]) ?? {};
  for (const [path, value] of Object.entries(knownRaw)) {
    const section = asObject(value);
    if (section === undefined) continue;
    const blocks: Record<string, string> = {};
    for (const [anchor, hash] of Object.entries(asObject(section["blocks"]) ?? {})) {
      const text = string(hash);
      if (text !== undefined) blocks[anchor] = text;
    }
    known[path] = { blocks, head: string(section["head"]) };
  }

  const sections: Record<string, number> = {};
  for (const [path, value] of Object.entries(asObject(document["sections"]) ?? {})) {
    const count = whole(value, 0, Infinity);
    if (count !== undefined) sections[path] = count;
  }

  return {
    settings,
    watch,
    known,
    sections,
    dataStamp: string(document["dataStamp"]),
    appliedDeviceId: string(document["appliedDeviceId"]),
    appliedGeneratedAt: string(document["appliedGeneratedAt"]),
    health: health(document["health"]),
    lookedAt: whole(document["lookedAt"], 0, Infinity),
    unknown: leftovers(document),
  };
}

/** Пишет `data.json`: своё и всё чужое, что нашлось при чтении. */
export function stateToJSON(state: PluginState): Record<string, unknown> {
  return {
    ...state.unknown,
    version: 1,
    settings: { ...state.settings, formats: state.settings.formats.map((format) => ({ ...format })) },
    watch: {
      hash: state.watch.hash,
      hint: state.watch.hint === undefined ? undefined : { ...state.watch.hint },
      whole: state.watch.whole,
    },
    known: state.known,
    sections: state.sections,
    dataStamp: state.dataStamp,
    appliedDeviceId: state.appliedDeviceId,
    appliedGeneratedAt: state.appliedGeneratedAt,
    health: state.health,
    lookedAt: state.lookedAt,
  };
}

/**
 * Годен ли шаблон к работе. Негодный отбрасывается — плагин рисует стандартным.
 *
 * **Две беды, которые проверяются здесь, тихие.** Разведка 20260822 прогнала
 * подстановщик на негодных шаблонах: пустой шаблон и шаблон без `{{anchor}}`
 * рисуются БЕЗ ЕДИНОЙ ЖАЛОБЫ. Секция получается без якорей, слияние считает
 * блоками только строки вида `^hl-…` — и читает такую секцию как «все прежние
 * блоки убраны». На существующей заметке это упрётся в предохранитель
 * (`too-many-removals`), а на новой — молча создаст пустую управляемую секцию.
 *
 * Ошибки разметки (незакрытый кусок, неизвестное поле) подстановщик ловит сам и
 * говорит человеку словами. Здесь — только то, что он пропускает.
 */
export function acceptableTemplate(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  if (raw.trim() === "") return undefined;
  if (!hasAnchor(raw)) return undefined;
  return raw;
}

/**
 * Есть ли в шаблоне блока якорь — `{{anchor}}` в любом написании второй
 * версии: `{{ anchor }}`, `{{- anchor -}}`. Прежняя проверка искала строку
 * буквально и молча отбрасывала бы шаблон, написанный с пробелами.
 */
export function hasAnchor(template: string): boolean {
  // Якорь бывает и путём внутри цикла второй версии — `{{ a.anchor }}` в
  // `{% for a in annotations %}`: приёмка вслепую 20261012 (Н2) написала файл
  // секции ровно так, и сторож отверг его как «без якоря».
  return /\{\{-?\s*(?:[A-Za-z_][A-Za-z0-9_]*\s*\.\s*)?anchor\s*-?\}\}/.test(template);
}

/**
 * Форматы из `data.json`. Битая запись (без имени, не объект) пропускается,
 * повтор имени — тоже: побеждает первый. Пути — строки как есть; есть ли файл,
 * узнаётся при чтении шаблона, и отказ там — словами с путём (Р4).
 */
export function readFormats(raw: unknown): NoteFormat[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const formats: NoteFormat[] = [];
  for (const entry of raw) {
    const object = asObject(entry);
    const name = string(object?.["name"])?.trim();
    if (object === undefined || name === undefined || name === "" || seen.has(name)) continue;
    seen.add(name);
    const path = (key: string): string | undefined => {
      const value = string(object[key])?.trim();
      return value === undefined || value === "" ? undefined : value;
    };
    formats.push({
      name,
      noteTemplate: path("noteTemplate"),
      blockTemplate: path("blockTemplate"),
      pathPattern: path("pathPattern"),
    });
  }
  return formats;
}

/** Формат по имени — так его ищет заметка по своему свойству `beresta-format`. */
export function formatNamed(settings: BerestaSettings, name: string | undefined): NoteFormat | undefined {
  if (name === undefined) return undefined;
  return settings.formats.find((format) => format.name === name.trim());
}

// MARK: - Внутреннее

const OUR_KEYS = [
  "version",
  "settings",
  "watch",
  "known",
  "sections",
  "dataStamp",
  "appliedDeviceId",
  "appliedGeneratedAt",
  "health",
  "lookedAt",
];

function leftovers(document: Record<string, unknown>): Record<string, unknown> {
  const rest: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(document)) {
    if (!OUR_KEYS.includes(key)) rest[key] = value;
  }
  return rest;
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function string(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function whole(value: unknown, least: number, most: number): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  if (value < least || value > most) return undefined;
  return Math.round(value);
}

function fraction(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  if (value <= 0 || value > 1) return undefined;
  return value;
}

function health(value: unknown): SnapshotHealth {
  const known: SnapshotHealth[] = ["неизвестно", "нет", "целый", "наполовину", "не-читается"];
  const text = string(value);
  return known.find((one) => one === text) ?? "неизвестно";
}

// MARK: - Поля страницы настроек

/**
 * Что стало с тем, что человек напечатал в поле.
 *
 * **Отдельно от `readState` нарочно, и разница между ними — по делу.**
 * `readState` разбирает ЧУЖОЙ `data.json`: там негодное значение молча
 * заменяется своим, потому что плагин, который не включается из-за испорченного
 * вспомогательного файла, перестаёт обновлять заметки. Здесь разбирается то,
 * что человек напечатал ПРЯМО СЕЙЧАС, глядя в поле, — и молча заменить это
 * своим значит соврать ему в лицо.
 *
 * Прогон глазами 20260818, находка 7: в «Часовой пояс выписок» вписано
 * `Караганда`, поле показывает `Караганда`, в `data.json` по-прежнему `300`.
 * Ни рамки, ни сообщения. Экран и файл разошлись, и узнать об этом нельзя
 * ничем, кроме как открыть `data.json` руками.
 *
 * `typing` — не отказ и не согласие: поле пустое или в нём один знак минуса,
 * то есть человек ещё печатает. Ругаться на недопечатанное число значит мигать
 * красным на каждой второй букве.
 */
export type FieldVerdict =
  | { readonly kind: "ok"; readonly value: number }
  | { readonly kind: "typing" }
  | { readonly kind: "refused"; readonly said: string };

/**
 * Числовое поле страницы настроек: границы. Слова — имя, единица, примеры,
 * пояснение — живут в словаре панелей (`ui/words.ts`) под ключом поля, по
 * языку интерфейса; отказ поля собирается из них же.
 */
export interface NumberField {
  readonly key: keyof SettingsWords["fields"];
  readonly least: number;
  readonly most: number;
}

/**
 * Границы полей — те же, по которым `readState` разбирает `data.json`.
 *
 * Держать их в двух местах значит однажды получить значение, которое страница
 * приняла, а разбор файла выбросил, — и человек увидит, как настройка
 * «сама вернулась» после перезапуска.
 */
export const OFFSET_FIELD: NumberField = { key: "offset", least: -14 * 60, most: 14 * 60 };
export const INTERVAL_FIELD: NumberField = { key: "interval", least: 1, most: 3_600 };
export const KEEP_BACKUPS_FIELD: NumberField = { key: "keepBackups", least: 1, most: 100 };
export const REMOVAL_COUNT_FIELD: NumberField = { key: "removalCount", least: 1, most: 100_000 };

/**
 * Разбирает напечатанное в числовом поле.
 *
 * Отказ называет три вещи: ЧТО отвергнуто (дословно, в кавычках — человек
 * должен узнать свою строку), ПОЧЕМУ и ЧТО ОСТАЛОСЬ. Без третьего сообщение
 * бесполезно: «неверное значение» не отвечает на единственный вопрос, который
 * у человека есть, — что теперь лежит в настройке.
 */
export function readNumberField(
  field: NumberField,
  typed: string,
  words: SettingsWords = panelWords(interfaceLanguage()).settings,
): FieldVerdict {
  const text = typed.trim();
  if (text === "" || text === "-" || text === "+") return { kind: "typing" };
  const said = words.fields[field.key];
  const value = Number(text);
  if (!Number.isFinite(value)) {
    return {
      kind: "refused",
      said: fill(words.notANumber, { typed, units: said.units, examples: said.examples }),
    };
  }
  const whole = Math.round(value);
  if (whole < field.least || whole > field.most) {
    return {
      kind: "refused",
      said: fill(words.outOfRange, {
        whole,
        least: field.least,
        most: field.most,
        examples: said.examples,
      }),
    };
  }
  return { kind: "ok", value: whole };
}

/** Что стало с напечатанным в поле папки. */
export type FolderVerdict =
  | { readonly kind: "ok"; readonly value: string; readonly said?: string }
  | { readonly kind: "typing" }
  | { readonly kind: "refused"; readonly said: string };

/** Что сказать про напечатанный шаблон. */
export type TemplateVerdict =
  | { readonly kind: "ok"; readonly value: string | undefined; readonly said?: string }
  | { readonly kind: "refused"; readonly said: string };

/**
 * Разбирает напечатанный шаблон секции выписок.
 *
 * **Пусто — это не отказ, а «как у всех».** Человек, стерший поле, просит
 * стандартный шаблон, а не пустую секцию. Разница видна не сразу: пустой шаблон
 * подстановщик рисует БЕЗ жалоб, секция выходит без якорей, а слияние читает
 * такую секцию как «все прежние блоки убраны» — проверено прогоном 20260822.
 *
 * **Отсутствие `{{anchor}}` — настоящий отказ.** Якорь `^hl-…` и есть связь
 * блока с выпиской: без него правки человека невозможно узнать при следующем
 * проходе, а весь прежний текст выглядит удалённым. Подстановщик этого не
 * ловит: он проверяет разметку, а не смысл.
 *
 * Ошибки разметки (незакрытый кусок, неизвестное поле, кириллица в имени)
 * остаются подстановщику: он говорит о них подробнее, чем смогли бы мы, и
 * называет доступные значения поимённо.
 */
export function readTemplateField(
  typed: string,
  words: SettingsWords = panelWords(interfaceLanguage()).settings,
): TemplateVerdict {
  if (typed.trim() === "") {
    return { kind: "ok", value: undefined, said: words.templateEmpty };
  }
  if (!hasAnchor(typed)) {
    return { kind: "refused", said: words.templateNoAnchor };
  }
  return { kind: "ok", value: typed };
}

/**
 * Разбирает напечатанное в поле папки для новых заметок.
 *
 * **Несуществующая папка — не отказ.** Beresta заводит её сама при первой
 * новой заметке (`noteStore.create` в точке входа), и запрещать человеку
 * назвать папку, которой ещё нет, значило бы запретить ему завести её этим же
 * действием. Но и молчать нельзя: прогон глазами 20260818 вписал сюда
 * `Нет такой папки`, и опечатка разложила бы заметки туда, где он их не ищет.
 * Поэтому папка, которой нет, принимается — и об этом говорится вслух.
 *
 * Отказ здесь один и настоящий: имя, которого файловая система не примет.
 */
export function readFolderField(
  typed: string,
  folderExists: (path: string) => boolean,
  words: SettingsWords = panelWords(interfaceLanguage()).settings,
): FolderVerdict {
  const text = typed.trim().replace(/^\/+/, "").replace(/\/+$/, "");
  if (text === "") return { kind: "typing" };
  const bad = /[\\:*?"<>|]/.exec(text);
  if (bad !== null) {
    return { kind: "refused", said: fill(words.badFolderChar, { char: bad[0] }) };
  }
  if (!folderExists(text)) {
    return { kind: "ok", value: text, said: fill(words.folderMissing, { folder: text }) };
  }
  return { kind: "ok", value: text };
}
