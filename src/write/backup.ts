/**
 * Запасная копия заметки — перед КАЖДОЙ записью в файл, который создали не мы.
 *
 * **Не «перед первой», и это разница по делу.** Слова «перед первой записью»
 * стояли и в заголовке этого модуля, и на странице настроек, и в окне версий —
 * а `rememberBefore` снимает копию перед любой записью, у которой текст на
 * диске отличается от последней копии. Прогон глазами 20260818 (находка 13)
 * поймал расхождение на живом хранилище: за один заход у `Тихая инженерия`
 * накопились ДВЕ копии. Иначе и настройка «сколько версий хранить: 5» не имела
 * бы смысла — при одной копии на заметку круг из пяти вытеснять нечего.
 *
 * Отсюда же второе правило: копия не снимается, если текст совпал с последней.
 * Два прохода подряд по одной заметке — норма, а вторая копия того же
 * содержимого вытеснила бы из круга настоящую прежнюю версию.
 *
 * **Зачем она есть, если слияние проверено тестами.** Довод
 * `20260806-integrations.md` §6 — «худший исход это испорченная заметка, а она
 * порождается заново из базы» — для заметок владельца **неверен**: в них
 * `## Главная идея книги`, оценки, «Мысль номер N», вики-ссылки на авторов,
 * четыре года работы, и из базы это не порождается ничем. Значит цена ошибки
 * несимметрична, и копия стоит дешевле любой уверенности.
 *
 * **Почему копия ложится в папку плагина, а не в хранилище.** В хранилище она
 * станет мусором: попадёт в поиск, в граф, в панель недавних файлов и поедет по
 * чужой синхронизации (iCloud, Obsidian Sync, Dropbox) вместе с заметками.
 * Папка плагина — `.obsidian/plugins/…` — не заметки: ни поиска, ни графа, ни
 * переходов по ссылкам. Уйти совсем за пределы хранилища нельзя по другой
 * причине, и она названа в плане: раздел «Accessing files outside of Obsidian
 * vaults» политики каталога Obsidian. Мы обещали ноль раскрытий из этого
 * раздела — значит и пишем только внутрь хранилища.
 *
 * **Ни файловой системы, ни часов внутри.** Складом распоряжается вызывающий
 * (`BackupStore` — три действия поверх `vault.adapter`), время приходит
 * строкой. Поэтому весь разбор — обычные тесты, а не живой Obsidian.
 */

/** Папка копий внутри папки плагина. */
export const BACKUP_FOLDER = "backups";

/** Указатель копий: что, откуда и когда. */
export const BACKUP_INDEX = `${BACKUP_FOLDER}/index.json`;

/** Сколько версий одной заметки держим. */
export const DEFAULT_KEEP = 5;

/** Склад копий — три действия поверх `vault.adapter` папки плагина. */
export interface BackupStore {
  read(path: string): Promise<string | undefined>;
  write(path: string, text: string): Promise<void>;
  remove(path: string): Promise<void>;
}

/** Одна копия. */
export interface BackupRecord {
  /** Имя файла копии внутри папки копий. */
  readonly id: string;
  /** Путь заметки в хранилище — куда возвращать. */
  readonly path: string;
  /** Когда снята, в привычном формате `YYYYMMDD HHMM`. */
  readonly savedAt: string;
  /** Длина текста в знаках — чтобы человек узнал версию, не открывая её. */
  readonly length: number;
}

/** Что снять и когда. Время приходит снаружи — внутри часов нет. */
export interface BackupRequest {
  readonly path: string;
  readonly text: string;
  /** Отметка времени: `YYYYMMDD HHMM`. */
  readonly savedAt: string;
  /** Метка для имени файла: `YYYYMMDD-HHMMSS`. */
  readonly stamp: string;
  /** Сколько версий держать. По умолчанию пять. */
  readonly keep?: number;
}

/**
 * Кладёт копию заметки, если такой ещё нет.
 *
 * Возвращает запись о копии — или `undefined`, если копия не нужна: текст
 * совпадает с последней снятой. Совпадение проверяется по тексту, а не по
 * времени: два прохода подряд по одной заметке — норма, а вторая копия того же
 * содержимого вытеснила бы из круга настоящую прежнюю версию.
 */
export async function rememberBefore(
  store: BackupStore,
  request: BackupRequest,
): Promise<BackupRecord | undefined> {
  const all = await listBackups(store);
  const mine = all.filter((item) => item.path === request.path);
  const newest = mine[mine.length - 1];
  if (newest !== undefined && newest.length === request.text.length) {
    const previous = await store.read(`${BACKUP_FOLDER}/${newest.id}`);
    if (previous === request.text) return undefined;
  }

  const id = uniqueId(request, all);
  await store.write(`${BACKUP_FOLDER}/${id}`, request.text);
  const record: BackupRecord = {
    id,
    path: request.path,
    savedAt: request.savedAt,
    length: request.text.length,
  };

  const keep = request.keep ?? DEFAULT_KEEP;
  const kept = [...mine, record];
  const extra = kept.slice(0, Math.max(0, kept.length - keep));
  for (const old of extra) await store.remove(`${BACKUP_FOLDER}/${old.id}`);

  const dropped = new Set(extra.map((item) => item.id));
  const next = [...all.filter((item) => !dropped.has(item.id)), record];
  await store.write(BACKUP_INDEX, JSON.stringify({ version: 1, backups: next }, null, 1));
  return record;
}

/**
 * Что лежит в копиях, от старых к новым.
 *
 * Указатель, который не читается или называет себя чужим форматом, — это
 * «копий не видно», а не падение: запись заметки не имеет права сорваться
 * из-за испорченного вспомогательного файла. Файлы копий при этом не трогаются:
 * человек найдёт их в папке плагина глазами.
 */
export async function listBackups(store: BackupStore, path?: string): Promise<BackupRecord[]> {
  const raw = await store.read(BACKUP_INDEX);
  if (raw === undefined) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (typeof parsed !== "object" || parsed === null) return [];
  const backups = (parsed as { backups?: unknown }).backups;
  if (!Array.isArray(backups)) return [];
  const records = backups.filter(isRecord);
  return path === undefined ? records : records.filter((item) => item.path === path);
}

/** Достаёт копию: куда возвращать и что возвращать. */
export async function restoreBackup(
  store: BackupStore,
  id: string,
): Promise<{ path: string; text: string } | undefined> {
  const records = await listBackups(store);
  const record = records.find((item) => item.id === id);
  if (record === undefined) return undefined;
  const text = await store.read(`${BACKUP_FOLDER}/${record.id}`);
  if (text === undefined) return undefined;
  return { path: record.path, text };
}

// MARK: - Внутреннее

/**
 * Имя файла копии: отметка времени и отпечаток пути.
 *
 * Путь заметки в имя не кладётся: `Base/Библиотека/Building a Second Brain. A
 * Proven Method….md` содержит косые черты, двоеточия и точки, и любое
 * escape-правило для них — ещё один способ ошибиться. Куда возвращать копию,
 * записано в указателе дословно, а имя файла отвечает только за
 * неповторимость.
 */
function uniqueId(request: BackupRequest, all: readonly BackupRecord[]): string {
  const taken = new Set(all.map((item) => item.id));
  const base = `${request.stamp}-${fingerprint(request.path)}`;
  let id = `${base}.md`;
  let counter = 2;
  while (taken.has(id)) {
    id = `${base}-${counter}.md`;
    counter += 1;
  }
  return id;
}

/** Короткий отпечаток пути — только чтобы имена не совпадали. */
function fingerprint(path: string): string {
  let value = 0x811c9dc5;
  for (let index = 0; index < path.length; index += 1) {
    value ^= path.charCodeAt(index);
    value = Math.imul(value, 0x01000193) >>> 0;
  }
  return value.toString(16).padStart(8, "0");
}

function isRecord(value: unknown): value is BackupRecord {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Partial<BackupRecord>;
  return (
    typeof item.id === "string" &&
    typeof item.path === "string" &&
    typeof item.savedAt === "string" &&
    typeof item.length === "number"
  );
}
