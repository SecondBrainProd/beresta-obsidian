/**
 * Указатель привязок «заметка → книги» — строится один раз и живёт событиями.
 *
 * До 20261017 `bindings()` перечисляло ВСЕ заметки хранилища
 * (`vault.getMarkdownFiles()`) на каждый такт опроса (раз в пять секунд) и на
 * каждый список книг без заметки. Чтения файлов там не было — только
 * `metadataCache`, — но каталог Obsidian в проверке 0.3.3 справедливо назвал
 * это перечислением хранилища (Vault Enumeration): у человека с десятью
 * тысячами заметок это десять тысяч обращений к кэшу каждые пять секунд ради
 * ответа, который меняется раз в день.
 *
 * Теперь перечисление одно — при загрузке плагина; дальше указатель правят
 * события Obsidian: `metadataCache.changed` (файл разобран или изменён —
 * сюда же приходят заметки, которых при старте кэш ещё не разобрал),
 * `vault.delete`, `vault.rename`. Сузить до папки выгрузки нельзя: привязка
 * живёт во frontmatter, и человек вправе привязать книгу к заметке в любой
 * папке — экран привязки это прямо предлагает.
 *
 * Класс не знает Obsidian: ему дают, как перечислить файлы и как прочесть
 * идентификаторы у одного файла, — поэтому он проверяется без приложения.
 */
export interface BindingIndexPorts<File extends { readonly path: string }> {
  /** Все заметки хранилища — зовётся ровно один раз, в `rebuild`. */
  readonly files: () => Iterable<File>;
  /** Идентификаторы книг из frontmatter файла; пусто — заметка не привязана. */
  readonly idsOf: (file: File) => readonly string[];
}

export class BindingIndex<File extends { readonly path: string }> {
  private readonly bound = new Map<string, readonly string[]>();
  /** Сколько раз перечисляли хранилище целиком — проверке видно, что ровно один. */
  private enumerations = 0;

  constructor(private readonly ports: BindingIndexPorts<File>) {}

  /** Единственное полное перечисление. */
  rebuild(): void {
    this.enumerations += 1;
    this.bound.clear();
    for (const file of this.ports.files()) this.refresh(file);
  }

  /** Файл разобран, изменён или появился: перечитать его привязки. */
  refresh(file: File): void {
    const ids = this.ports.idsOf(file);
    if (ids.length > 0) this.bound.set(file.path, ids);
    else this.bound.delete(file.path);
  }

  /** Файл удалён или переименован (старый путь). */
  forget(path: string): void {
    this.bound.delete(path);
  }

  /** Переименование: старый путь забыть, новый прочесть. */
  rename(file: File, oldPath: string): void {
    this.forget(oldPath);
    this.refresh(file);
  }

  /** Снимок «путь → идентификаторы книг»; копия, чтобы потребитель не правил указатель. */
  snapshot(): Map<string, readonly string[]> {
    return new Map(this.bound);
  }

  get enumerationCount(): number {
    return this.enumerations;
  }
}
