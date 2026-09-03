import { indexPath, shardFileName, shardPath } from "./paths";
import {
  ForeignSnapshotFormat,
  SNAPSHOT_FORMAT,
  SNAPSHOT_FORMAT_VERSION,
  SnapshotTooNew,
  SnapshotUnreadable,
  type Snapshot,
  type SnapshotAnnotation,
  type SnapshotBook,
  type SnapshotHeader,
  type SnapshotProblem,
} from "./model";
import { sha256Hex } from "./sha256";
import {
  asArray,
  asObject,
  leftovers,
  optionalNumber,
  optionalString,
  parseJSON,
  parseShard,
  requireString,
} from "./shard";

export * from "./model";
export * from "./paths";
export { parseShard } from "./shard";
export { sha256Hex } from "./sha256";

/**
 * Откуда плагин берёт файлы снимка.
 *
 * **Порт узкий нарочно.** Настоящая реализация — `vault.adapter` самого
 * Obsidian, и у неё есть ещё десяток способов: писать, удалять, обходить
 * папку, спрашивать время изменения. Здесь их нет. Порт, в котором нет записи,
 * не может записать; порт, в котором нет времени файла, не может принять время
 * файла за истину — а оно ею не является ни при каких условиях, потому что
 * поверх хранилища работает чужая синхронизация и двигает время по своим
 * причинам. Правило, выраженное формой типа, не забывается.
 *
 * `readBinary`, а не `read`: указатель обещает отпечаток БАЙТОВ файла, и
 * сверять его надо с байтами. Чтение строкой прогнало бы файл через
 * раскодирование UTF-8 и обратно — на правильном файле это то же самое, а на
 * испорченном (обрыв синхронизации посреди записи) разница ровно та, ради
 * которой отпечаток и заведён.
 */
export interface SnapshotSource {
  exists(path: string): Promise<boolean>;
  readBinary(path: string): Promise<ArrayBuffer>;
}

/** Ключи указателя, которые мы знаем; всё прочее уезжает в `unknown`. */
const INDEX_KEYS = [
  "format",
  "formatVersion",
  "schemaVersion",
  "schemaMigrations",
  "application",
  "applicationVersion",
  "deviceId",
  "generatedAt",
  "books",
];

const ENTRY_KEYS = [
  "bookUUID",
  "file",
  "sha256",
  "total",
  "removedTotal",
  "updatedAt",
];

/**
 * Читает снимок из хранилища целиком.
 *
 * Порядок действий здесь — сам по себе решение, и вот его причины.
 *
 * 1. **Нет указателя — «снимка нет», и на этом всё.** Не пустой снимок, не
 *    ноль книг: разница между «стереть секцию в заметке» и «не трогать заметку
 *    вовсе». Осколки при этом не ищутся и папка не обходится: единственный
 *    момент, в который снимок становится новым, — переписанный указатель.
 * 2. **Чужой формат и версия новее нашей — отказ целиком.** Не «прочитаем, что
 *    поймём»: половина данных в заметке хуже, чем ничего, потому что выглядит
 *    как целое.
 * 3. **Беда одного осколка — не беда снимка.** Хранилище синхронизируется
 *    чужими средствами, и застать его посреди переноса — обычное дело:
 *    указатель уже новый, один осколок ещё не доехал. Тогда девять книг
 *    приезжают, десятая приходит `problems`, и решает вызывающий. Отказ
 *    целиком означал бы, что одна недосинхронизированная книга останавливает
 *    работу со всеми остальными.
 */
export async function readSnapshot(source: SnapshotSource): Promise<Snapshot> {
  const path = indexPath();
  if (!(await source.exists(path))) return { kind: "absent" };

  const raw = decodeUTF8(await source.readBinary(path), path);
  const document = asObject(parseJSON(raw, path), `${path}: указатель`);

  const format = requireString(document["format"], `${path}: format`);
  if (format !== SNAPSHOT_FORMAT) throw new ForeignSnapshotFormat(format);

  const formatVersion = optionalNumber(document["formatVersion"]);
  if (formatVersion === undefined) {
    // Отсутствие версии — отказ, а не «наверное, первая». Догадка превратила
    // бы отсутствие договора в молчаливое утверждение, что договор соблюдён.
    throw new SnapshotUnreadable(
      `${path}: в указателе нет formatVersion — прочитать снимок нечем`,
    );
  }
  if (formatVersion > SNAPSHOT_FORMAT_VERSION) throw new SnapshotTooNew(formatVersion);

  const header: SnapshotHeader = {
    format,
    formatVersion,
    schemaVersion: optionalString(document["schemaVersion"]),
    schemaMigrations: asArray(document["schemaMigrations"] ?? [], `${path}: schemaMigrations`)
      .map((value) => optionalString(value))
      .filter((value): value is string => value !== undefined),
    application: optionalString(document["application"]),
    applicationVersion: optionalString(document["applicationVersion"]),
    deviceId: optionalString(document["deviceId"]),
    generatedAt: optionalString(document["generatedAt"]),
    unknown: leftovers(document, INDEX_KEYS),
  };

  const entries = asArray(document["books"] ?? [], `${path}: books`);
  const books: SnapshotBook[] = [];
  const annotations: SnapshotAnnotation[] = [];
  const problems: SnapshotProblem[] = [];

  for (const [at, value] of entries.entries()) {
    const entry = asObject(value, `${path}: книга ${at}`);
    const file = requireString(entry["file"], `${path}: книга ${at}: file`);
    const name = shardFileName(file);
    if (name === undefined) {
      // Строку, которая не похожа на наш осколок, мы не читаем — как и Swift
      // её не удаляет. Указатель лежит в хранилище человека открытым текстом,
      // и по строке `books/../../.obsidian/plugins/чужой/data.json` плагин
      // полез бы читать чужой файл, обещав в README не делать этого.
      problems.push({
        kind: "foreign-file",
        file,
        message:
          `Указатель снимка называет файл «${file}», который не похож на осколок ` +
          "Beresta. Плагин его не читает: за пределы .beresta/books он не выходит.",
      });
      continue;
    }

    const shardAt = shardPath(file);
    if (!(await source.exists(shardAt))) {
      problems.push({
        kind: "shard-missing",
        file,
        message:
          `Указатель снимка называет осколок «${file}», а файла нет. Обычно так ` +
          "выглядит хранилище посреди синхронизации: подождите и повторите.",
      });
      continue;
    }

    const bytes = new Uint8Array(await source.readBinary(shardAt));
    const expected = requireString(entry["sha256"], `${path}: книга ${at}: sha256`);
    const actual = sha256Hex(bytes);
    if (actual !== expected) {
      // Осколок, не сошедшийся с указателем, — это не «немного другие данные»,
      // а данные неизвестного возраста: половина старой книги и половина
      // новой. Класть такое в заметку человека нельзя, а сказать ему — нужно.
      problems.push({
        kind: "shard-checksum",
        file,
        expected,
        actual,
        message:
          `Осколок «${file}» не сходится с отпечатком в указателе. Файл дописан не ` +
          "до конца или изменён мимо Beresta — заметки по нему не обновляются.",
      });
      continue;
    }

    let parsed;
    try {
      parsed = parseShard(decodeUTF8(bytes.buffer, shardAt), file);
    } catch (error) {
      problems.push({
        kind: "shard-unreadable",
        file,
        message: `Осколок «${file}» не разбирается: ${(error as Error).message}`,
      });
      continue;
    }

    const book: SnapshotBook = {
      // `bookUUID` берётся из указателя, а не из осколка: пустая строка там —
      // признак осколка сирот, и она значащая. В самом осколке на её месте
      // стоит детерминированная заглушка «книга неизвестна», по которой сирот
      // от книги не отличить, не сравнив идентификаторы, — а правило,
      // держащееся на сравнении идентификаторов, сломается ровно в тот день,
      // когда они совпадут.
      uuid: optionalString(entry["bookUUID"]) ?? "",
      title: parsed.title,
      authors: parsed.authors,
      source: parsed.source,
      shard: name,
      total: optionalNumber(entry["total"]) ?? parsed.annotations.length,
      removedTotal: optionalNumber(entry["removedTotal"]) ?? parsed.tombstones.length,
      updatedAt: optionalString(entry["updatedAt"]) ?? "",
      sha256: expected,
      annotations: parsed.annotations,
      tombstones: parsed.tombstones,
      unknown: { ...leftovers(entry, ENTRY_KEYS), ...parsed.unknown },
    };
    books.push(book);
    annotations.push(...parsed.annotations);
  }

  return { kind: "present", header, books, annotations, problems };
}

/**
 * Байты файла в строку.
 *
 * `fatal: true` — не педантизм: испорченный кусок UTF-8 без него молча
 * превращается в «U+FFFD», то есть в текст, который выглядит прочитанным. Файл
 * снимка либо целый, либо не наш.
 */
function decodeUTF8(bytes: ArrayBuffer, where: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new SnapshotUnreadable(`${where}: файл не в UTF-8 — прочитать его нечем`);
  }
}
