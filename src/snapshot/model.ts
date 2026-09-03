/**
 * Модель снимка на стороне плагина: то, во что превращается прочитанное с
 * диска, и то, из чего задачи 10–14 собирают заметку.
 *
 * **Главное свойство модели — она ничего не выбрасывает.** Формат объявлен
 * открытым, версия его растёт только при поломке совместимости, а значит
 * завтрашняя Beresta допишет свои ключи и оставит `formatVersion: 1`. Плагин
 * такой снимок обязан прочитать — и незнакомое сохранить, а не потерять:
 * `unknown` есть у указателя, у книги, у собрания и у выписки, а незнакомый
 * селектор доезжает дословно, как он и лежал в файле.
 *
 * **Времени файла в модели нет ни одного поля, и это нарочно.** Время
 * изменения файла — только подсказка «стоит заглянуть»: поверх хранилища
 * лежит чужая синхронизация (iCloud, Obsidian Sync, Dropbox, git), которая
 * двигает время по своим причинам и в свою сторону. Истина здесь одна —
 * отпечаток байтов из указателя. Поле, которого нет, нельзя случайно принять
 * за истину.
 */

/** Разобранное значение JSON — всё, что может прийти из файла. */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

/** Ключи, которых мы не знаем, — как они лежали в файле. */
export type UnknownKeys = Record<string, JsonValue>;

/** Имя формата и версия — то же, что объявлено в `ExportManifest` на Swift. */
export const SNAPSHOT_FORMAT = "beresta-archive";

/**
 * Версия формата, которую эта сборка плагина умеет читать.
 *
 * Число одно на обе стороны шва: `ExportManifest.formatVersion` в Swift.
 * Совпадение сверяется тестом чтением исходника — держать его памятью нельзя.
 */
export const SNAPSHOT_FORMAT_VERSION = 1;

/** Селектор мишени: чем именно выписка привязана к месту в книге. */
export type SnapshotSelector =
  | {
      kind: "fragment";
      /** Для EPUB — строка CFI. */
      value: string;
      conformsTo?: string;
      raw: UnknownKeys;
    }
  | {
      kind: "quote";
      prefix: string;
      exact: string;
      suffix: string;
      raw: UnknownKeys;
    }
  /**
   * Незнакомый вид привязки от стороннего писателя. Дословно и целиком: формат
   * открытый, и чужой инструмент вправе дописать свой селектор. Выбросить его
   * значило бы молча обеднить архив человека.
   */
  | { kind: "unknown"; raw: UnknownKeys };

/** Одна выписка. */
export interface SnapshotAnnotation {
  /** Адрес выписки как он лежит в файле: `urn:uuid:…`. */
  id: string;
  /** Он же без приставки — то, что уезжает в `beresta://open/<uuid>`. */
  uuid: string | undefined;
  /** `uuid` книги, в осколке которой лежит выписка. Пусто — осколок сирот. */
  bookUUID: string | undefined;
  /** Мотив по словарю W3C: `highlighting` или `commenting`. */
  motivation: string;
  /** Вид пометки: `highlight`, `underline`, `note`, `ink`, … */
  markKind: string | undefined;
  created: string;
  modified: string;
  /** Своя мысль. Пусто — ключа `body` с назначением `commenting` не было. */
  comment: string | undefined;
  /** Разметка своей мысли, обычно `text/markdown`. */
  commentFormat: string | undefined;
  /** Метки — тела с назначением `tagging`, в том порядке, что в файле. */
  tags: string[];
  selectors: SnapshotSelector[];
  /**
   * Цитата: `exact` первого же `TextQuoteSelector`, а если якоря-цитаты нет —
   * `beresta:text`. Одно поле на два источника нарочно: рисующему секцию
   * (задача 10) нужна цитата, а не история того, каким путём она доехала.
   */
  quote: string | undefined;
  /**
   * `beresta:text` — цитата, не попавшая ни в один селектор. Отдельно от
   * `quote`, потому что это РАЗНЫЕ утверждения: «в книге стоит ровно это»
   * против «у выписки есть такой текст, но за место в книге он не отвечает».
   */
  strandedText: string | undefined;
  /** Точный указатель, если он есть: строка CFI из `FragmentSelector`. */
  cfi: string | undefined;
  color: string | undefined;
  colorHex: string | undefined;
  sortIndex: string | undefined;
  pageLabel: string | undefined;
  /** Путь по оглавлению. Пустой — норма: у выписки его может не быть. */
  chapterPath: string[];
  intent: string | undefined;
  processed: string | undefined;
  topic: string | undefined;
  /** Привязка дословно, если селекторами её выразить было нечем (росчерк, PDF). */
  position: string | undefined;
  unknown: UnknownKeys;
}

/** Мягко удалённая выписка: строку в заметке пора убрать. */
export interface SnapshotTombstone {
  id: string;
  uuid: string | undefined;
  deletedAt: string | undefined;
  unknown: UnknownKeys;
}

/** Книга снимка: запись указателя вместе с разобранным осколком. */
export interface SnapshotBook {
  /** `uuid` книги. Пусто — осколок выписок, у которых книги нет вовсе. */
  uuid: string;
  title: string | undefined;
  authors: string[];
  /** Адрес первоисточника — у статей. У книги его нет. */
  source: string | undefined;
  /** Имя осколка внутри `books/`. */
  shard: string;
  /** Живых выписок по указателю. Сверяется с разобранным осколком. */
  total: number;
  removedTotal: number;
  /** Момент данных осколка по указателю. Не время файла — см. заголовок. */
  updatedAt: string;
  sha256: string;
  annotations: SnapshotAnnotation[];
  tombstones: SnapshotTombstone[];
  /** Незнакомые ключи записи указателя и самого собрания, вместе. */
  unknown: UnknownKeys;
}

/** Заголовок снимка. */
export interface SnapshotHeader {
  format: string;
  formatVersion: number;
  schemaVersion: string | undefined;
  schemaMigrations: string[];
  application: string | undefined;
  applicationVersion: string | undefined;
  /**
   * Устройство, собравшее снимок. Хранилище синхронизируется чужими
   * средствами, и снимок с двух Маков попадёт в одну папку — плагин обязан
   * уметь сказать, чей это снимок, а не молча смешать два.
   */
  deviceId: string | undefined;
  generatedAt: string | undefined;
  unknown: UnknownKeys;
}

/** Что в снимке не сошлось. Беда книги — не беда снимка. */
export type SnapshotProblem =
  | {
      kind: "foreign-file";
      file: string;
      message: string;
    }
  | { kind: "shard-missing"; file: string; message: string }
  | {
      kind: "shard-checksum";
      file: string;
      expected: string;
      actual: string;
      message: string;
    }
  | { kind: "shard-unreadable"; file: string; message: string };

/**
 * Снимок целиком.
 *
 * **`absent` и пустой снимок — разные вещи, и это не педантизм.** «Файла нет»
 * значит, что приложение сюда ещё ни разу не писало: трогать заметки нельзя
 * вовсе. «Книг ноль» значит, что приложение писало и книг с выписками у него
 * нет: секцию в заметке положено стереть. Одно и то же поведение на оба случая
 * — либо стёртые заметки у человека, который ещё не выбрал хранилище, либо
 * вечно висящие цитаты удалённых книг.
 */
export type Snapshot =
  | { kind: "absent" }
  | {
      kind: "present";
      header: SnapshotHeader;
      books: SnapshotBook[];
      /**
       * Все выписки всех книг одним списком — те же самые объекты, что лежат в
       * `books[].annotations`, не копии.
       */
      annotations: SnapshotAnnotation[];
      problems: SnapshotProblem[];
    };

/** Снимок собран версией формата, которой мы не знаем. */
export class SnapshotTooNew extends Error {
  readonly formatVersion: number;
  readonly supported: number;

  constructor(formatVersion: number) {
    super(
      `Снимок Beresta собран форматом версии ${formatVersion}, а этот плагин ` +
        `понимает ${SNAPSHOT_FORMAT_VERSION}. Обновите плагин — читать снимок ` +
        "наугад нельзя: заметки заполнились бы половиной данных.",
    );
    this.name = "SnapshotTooNew";
    this.formatVersion = formatVersion;
    this.supported = SNAPSHOT_FORMAT_VERSION;
  }
}

/** Под именем `index.json` лежит чужой формат. */
export class ForeignSnapshotFormat extends Error {
  readonly format: string;

  constructor(format: string) {
    super(
      `Файл .beresta/index.json называет себя форматом «${format}», а не ` +
        `«${SNAPSHOT_FORMAT}». Это чужой файл: плагин его не трогает.`,
    );
    this.name = "ForeignSnapshotFormat";
    this.format = format;
  }
}

/** Указатель есть, но прочитать его нечем. */
export class SnapshotUnreadable extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SnapshotUnreadable";
  }
}
