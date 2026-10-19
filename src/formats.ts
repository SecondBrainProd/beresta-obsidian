/**
 * Форматы заметок в работе: файлы шаблонов, шаблон блока по заметке, путь
 * новой заметки (план `20261008-шаблоны-плагина-план.md`, задачи 3–5).
 *
 * Здесь нет Obsidian: файлы читает `read`, свойства заметки отдаёт
 * `formatOf`. Так правила проверяются без хранилища, а `main.ts` лишь
 * подставляет руки.
 */
import { newNotePath } from "./binding/binding-view";
import { noteValues } from "./render/note";
import { renderTemplate, type TemplateValue } from "./render/template";
import { formatNamed, hasAnchor, type BerestaSettings, type NoteFormat } from "./settings";
import type { SnapshotBook } from "./snapshot/model";
import { fill, type PanelWords } from "./ui/words";

/** Шаблон блока не годится к работе — слова для человека уже внутри. */
export class FormatTemplateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FormatTemplateError";
  }
}

export interface FormatPorts {
  /** Текст файла хранилища; нет файла — бросок. */
  read(path: string): Promise<string>;
  /** Имя формата из свойства `beresta-format` заметки; нет свойства — `undefined`. */
  formatOf(notePath: string): string | undefined;
}

/**
 * Загруженные шаблоны блоков всех форматов.
 *
 * Читается заранее и целиком (`reload`): проход — чистая функция и ждать файлов
 * посреди отрисовки не может. Перечитывается при сохранении настроек и при
 * правке любого из файлов шаблонов (`main.ts`).
 */
export class FormatTemplates {
  private blocks = new Map<string, string | FormatTemplateError>();
  /** Заметки, помнящие формат, которого в настройках больше нет: имя → пути. */
  private gone = new Map<string, Set<string>>();

  /**
   * Забрать (и забыть) заметки с исчезнувшим форматом, накопленные с прошлого
   * вызова. Проход рисует их стандартным шаблоном, но молчать об этом нельзя:
   * приёмка 20261012 (Н4) удалила формат и не услышала ни слова, хотя заметка
   * так и осталась с `beresta-format: Опыт`.
   */
  takeGone(): ReadonlyMap<string, ReadonlySet<string>> {
    const taken = this.gone;
    this.gone = new Map();
    return taken;
  }

  constructor(
    private readonly ports: FormatPorts,
    private readonly settings: () => BerestaSettings,
    private readonly words: () => PanelWords,
  ) {}

  /** Заметки, которые заводятся прямо сейчас: путь → имя формата. */
  private creating = new Map<string, string>();

  /**
   * На время создания заметок — их формат по пути (владелец 20261019: заметка
   * «@Книга» получила секцию СТАНДАРТНЫМ шаблоном). Секцию новой заметки
   * рисует тот же проход, что её заводит, а `formatOf` читает свойство из кэша
   * Obsidian — у файла, которого ещё нет, там пусто. Формат при этом известен:
   * его только что вписали в первый текст заметки. Вернувшаяся функция
   * забывает эти пути — звать её, когда проход кончился.
   */
  expectCreating(formats: ReadonlyMap<string, string>): () => void {
    for (const [path, name] of formats) this.creating.set(path, name);
    return () => {
      for (const path of formats.keys()) this.creating.delete(path);
    };
  }

  /** Пути всех файлов шаблонов — чтобы знать, чья правка требует перечитать. */
  paths(): Set<string> {
    const paths = new Set<string>();
    for (const format of this.settings().formats) {
      if (format.blockTemplate !== undefined) paths.add(format.blockTemplate);
      if (format.noteTemplate !== undefined) paths.add(format.noteTemplate);
    }
    return paths;
  }

  async reload(): Promise<void> {
    const next = new Map<string, string | FormatTemplateError>();
    for (const format of this.settings().formats) {
      if (format.blockTemplate === undefined) continue;
      next.set(format.name, await this.loadBlock(format));
    }
    this.blocks = next;
  }

  private async loadBlock(format: NoteFormat): Promise<string | FormatTemplateError> {
    const path = format.blockTemplate!;
    let text: string;
    try {
      text = await this.ports.read(path);
    } catch {
      return new FormatTemplateError(fill(this.words().formats.templateMissing, { path, format: format.name }));
    }
    if (!hasAnchor(text)) {
      return new FormatTemplateError(fill(this.words().formats.blockNoAnchor, { path }));
    }
    return text;
  }

  /**
   * Шаблон блока для заметки. `undefined` — у заметки нет формата, у формата
   * нет своего блока или формата с таким именем больше нет: тогда стандартный.
   *
   * Негодный файл — БРОСОК со словами (Р4): проход ловит его как «секция не
   * отрисовалась» и говорит путь, а не рисует молча стандартным.
   */
  templateFor(notePath: string): string | undefined {
    const name = this.creating.get(notePath) ?? this.ports.formatOf(notePath);
    const format = formatNamed(this.settings(), name);
    if (name !== undefined && format === undefined) {
      const paths = this.gone.get(name) ?? new Set<string>();
      paths.add(notePath);
      this.gone.set(name, paths);
    }
    if (format === undefined || format.blockTemplate === undefined) return undefined;
    const loaded = this.blocks.get(format.name);
    if (loaded === undefined) return undefined;
    if (loaded instanceof FormatTemplateError) throw loaded;
    return loaded;
  }

  /** Текст шаблона ЗАМЕТКИ формата; пусто у формата — `undefined`. */
  async noteTemplate(format: NoteFormat): Promise<string | undefined> {
    if (format.noteTemplate === undefined) return undefined;
    try {
      return await this.ports.read(format.noteTemplate);
    } catch {
      throw new FormatTemplateError(
        fill(this.words().formats.templateMissing, { path: format.noteTemplate, format: format.name }),
      );
    }
  }
}

/** Значения образца пути без косых черт: папки задаёт образец, а не книга. */
function withoutSlashes(values: Record<string, TemplateValue>): Record<string, TemplateValue> {
  const clean = (value: TemplateValue): TemplateValue =>
    typeof value === "string"
      ? value.replace(/[/\\]/g, "-")
      : Array.isArray(value)
        ? (value as readonly TemplateValue[]).map(clean)
        : value;
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, clean(value)]));
}

/**
 * Путь новой заметки формата для книги.
 *
 * Образец пути — шаблон второй версии (`Библиотека/Статьи/{{title}}.md`), значения
 * те же, что у шаблона заметки. Последняя часть пути чистится тем же правилом,
 * что и всегда (`newNotePath`: `:` → `.`, запрещённые знаки — заменой). Нет
 * образца — папка из настроек и название, как прежде.
 */
export function notePathFor(format: NoteFormat | undefined, book: SnapshotBook, libraryFolder: string): string {
  const title = book.title ?? book.uuid;
  if (format?.pathPattern === undefined) return newNotePath(title, libraryFolder);
  // ⚠️ Значения — БЕЗ косых черт, путь — без `.` и `..` (проверка безопасности
  // 20261008): название «../../x» иначе вывело бы заметку за папку формата, а
  // то и за хранилище. Папки задаёт ОБРАЗЕЦ, а не книга.
  const rendered = renderTemplate(format.pathPattern, {
    fields: {},
    lists: {},
    values: withoutSlashes(noteValues(book)),
  }).trim();
  const segments = rendered
    .replace(/\\/g, "/")
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment !== "" && segment !== "." && segment !== "..");
  const last = (segments.pop() ?? "").replace(/\.md$/i, "");
  return newNotePath(last === "" ? title : last, segments.join("/"));
}
