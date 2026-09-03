/**
 * Хранилище в памяти — стенд для опроса, прохода и панели.
 *
 * **Чем это НЕ является.** Не двойником Obsidian. Двойник Obsidian, написанный
 * нами, всегда согласен с нашими ожиданиями, и проверка на нём доказывает
 * только то, что мы сами же и запрограммировали (об этом же — шапка
 * `test/obsidian-stub.ts`). Здесь подделана **файловая система**, а не
 * приложение: карта «путь → текст», время изменения и счётчики того, что у
 * стенда спрашивали. Всё, что требует настоящего Obsidian — `vault.process`,
 * события открытия заметки, скрытая папка, — меряется швом на живом хранилище
 * (задача 13) и щупом задачи 2, а не здесь.
 *
 * **Зачем счётчики.** Главное свойство опроса — он НЕ делает лишнего: не
 * читает указатель, когда подсказка не двигалась; не разбирает осколки, когда
 * указатель тот же; не трогает заметки, когда данные прежние. «Не делает» —
 * утверждение, которое нечем проверить по содержимому файлов: файлы в обоих
 * случаях одинаковы. Поэтому стенд ведёт журнал обращений, и проверки смотрят
 * в него.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import type { NoteStore } from "../../src/sync/pass";
import type { FileHint, WatchSource } from "../../src/poller";
import type { BackupStore } from "../../src/write/backup";

const FIXTURES = fileURLToPath(new URL("../fixtures", import.meta.url));

/** Папка плагина внутри хранилища — там же, где она у настоящего Obsidian. */
export const PLUGIN_FOLDER = ".obsidian/plugins/beresta";

export class FakeVault implements WatchSource, NoteStore {
  private readonly files = new Map<string, string>();
  private readonly times = new Map<string, number>();
  private readonly editors = new Map<string, string>();

  /** Журнал: что у стенда прочитали, по порядку. */
  readonly reads: string[] = [];
  /** Журнал: во что записали. */
  readonly writes: string[] = [];
  /** Сколько раз спрашивали время изменения. */
  statCalls = 0;
  /** Часы стенда: время изменения новых записей. */
  clock = 1_000_000;

  // MARK: Наполнение

  /** Кладёт снимок из образца `test/fixtures/<world>` в `.beresta/`. */
  putSnapshot(world: string): void {
    const root = join(FIXTURES, world);
    for (const path of walk(root)) {
      this.put(path, readFileSync(join(root, path), "utf8"));
    }
  }

  put(path: string, text: string): void {
    this.files.set(path, text);
    this.clock += 1000;
    this.times.set(path, this.clock);
  }

  drop(path: string): void {
    this.files.delete(path);
    this.times.delete(path);
  }

  /** Тронуть файл, не меняя ни байта: чужая синхронизация делает так часто. */
  touch(path: string, mtime: number): void {
    this.times.set(path, mtime);
  }

  /** Заметка открыта, и в ней есть несохранённое. */
  openEditor(path: string, text: string): void {
    this.editors.set(path, text);
  }

  closeEditor(path: string): void {
    this.editors.delete(path);
  }

  forget(): void {
    this.reads.length = 0;
    this.writes.length = 0;
    this.statCalls = 0;
  }

  /** Что лежит в хранилище прямо сейчас — мимо журнала. */
  peek(path: string): string | undefined {
    return this.files.get(path);
  }

  paths(): string[] {
    return [...this.files.keys()].sort();
  }

  // MARK: Источник снимка

  async exists(path: string): Promise<boolean> {
    return this.files.has(path);
  }

  async readBinary(path: string): Promise<ArrayBuffer> {
    this.reads.push(path);
    const text = this.files.get(path);
    if (text === undefined) throw new Error(`нет файла: ${path}`);
    const bytes = new TextEncoder().encode(text);
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  }

  async stat(path: string): Promise<FileHint | undefined> {
    this.statCalls += 1;
    const text = this.files.get(path);
    if (text === undefined) return undefined;
    return { mtime: this.times.get(path) ?? 0, size: new TextEncoder().encode(text).length };
  }

  // MARK: Заметки

  async read(path: string): Promise<string> {
    this.reads.push(path);
    const text = this.files.get(path);
    if (text === undefined) throw new Error(`нет заметки: ${path}`);
    return text;
  }

  async create(path: string, text: string): Promise<void> {
    this.writes.push(path);
    this.put(path, text);
  }

  /**
   * Правка под замком — как `vault.process` у Obsidian: обработчику даётся
   * текст С ДИСКА, его ответ уходит на диск.
   *
   * Ответ, равный входу, здесь тоже считается записью и попадает в журнал:
   * настоящий `vault.process` в этом случае всё равно трогает файл, и делать
   * вид, что не трогает, значило бы спрятать от проверок ровно ту побудку
   * чужой синхронизации, которой мы стараемся не устраивать.
   */
  async process(path: string, revise: (onDisk: string) => string): Promise<void> {
    const before = this.files.get(path);
    if (before === undefined) throw new Error(`нет заметки: ${path}`);
    this.writes.push(path);
    this.put(path, revise(before));
  }

  editorText(path: string): string | undefined {
    return this.editors.get(path);
  }

  // MARK: Склад запасных копий

  backups(): BackupStore {
    return {
      read: async (path) => this.files.get(`${PLUGIN_FOLDER}/${path}`),
      write: async (path, text) => {
        this.put(`${PLUGIN_FOLDER}/${path}`, text);
      },
      remove: async (path) => {
        this.drop(`${PLUGIN_FOLDER}/${path}`);
      },
    };
  }
}

/** Все файлы под корнем, путями от корня и через косую черту. */
function walk(root: string): string[] {
  const found: string[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const at = stack.pop()!;
    for (const name of readdirSync(at)) {
      const full = join(at, name);
      if (statSync(full).isDirectory()) stack.push(full);
      else found.push(relative(root, full).split(sep).join("/"));
    }
  }
  return found.sort();
}
