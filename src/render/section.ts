import type { SnapshotAnnotation, SnapshotBook } from "../snapshot/model";
import { sha256Hex } from "../snapshot/sha256";
import { DEFAULT_TEMPLATE } from "./defaults";
import { bookOpenLink } from "./link";
import { renderTemplate, TemplateError, type TemplateScope } from "./template";

/**
 * Отрисовка управляемой секции — место, где машина сочиняет байты для заметки
 * человека. Всё, что попадает в заметку помимо этого, сочиняет слияние, и
 * там этого ровно две вещи: свёрнутое предупреждение о расхождении и служебная
 * строка с отпечатком блока (`merge/fuse.ts`).
 *
 * **Здесь ничего не пишется и записать отсюда нечего.** `renderSection` —
 * чистая функция от данных к строке: ни файловой системы, ни `vault`, ни
 * `adapter` в этом модуле нет даже в импортах. Так и задумано: слияние с
 * заметкой (задача 11) и запись (задача 14) — отдельные шаги, и разделение
 * значит, что испорченный шаблон не может испортить заметку в принципе.
 * Отрисовка либо вернула строку, либо бросила `TemplateError`; во втором
 * случае вызывающему нечего писать, и молчаливой полусекции не существует.
 *
 * **Секция ограничена маркерами, и это её определение.** Внутри маркеров —
 * зона машины: переписываем по хешам. Снаружи — зона человека, четыре года
 * его конспектов, и туда не заглядывают даже ради данных. Отсюда правило,
 * проверяемое здесь же: отрисованная секция обязана содержать РОВНО ОДНУ пару
 * маркеров. Цитата из книги, в которой окажется строка `%% beresta:end %%`,
 * разрезала бы секцию пополам и выпустила бы половину машинного текста в зону
 * человека — поэтому такая отрисовка не возвращается, а отвергается словами.
 */

/** Открывающий маркер управляемой секции. */
export const SECTION_BEGIN = "%% beresta:begin %%";

/** Закрывающий маркер управляемой секции. */
export const SECTION_END = "%% beresta:end %%";

/**
 * Приставка якоря блока.
 *
 * `hl` — от highlight, и менять её нельзя никогда: якорь связывает блок в
 * заметке с выпиской в базе, и смена приставки означала бы, что все прежние
 * блоки стали ничьими, а рядом с ними появились дубли.
 */
export const ANCHOR_PREFIX = "hl-";

/** Строка, целиком состоящая из маркера, — с любыми пробелами по краям. */
const MARKER_LINE = new RegExp(
  `^[\t ]*(${escapeRegExp(SECTION_BEGIN)}|${escapeRegExp(SECTION_END)})[\t ]*$`,
);

/** Что подкрутить в отрисовке снаружи. Всё остальное — не настройка. */
export interface RenderOptions {
  /**
   * Сдвиг от UTC в минутах, в котором показывается дата выделения.
   *
   * **Почему это вход, а не `new Date().getTimezoneOffset()` внутри.** Время
   * выделения хранится в UTC (`2026-08-06T07:06:40Z`), а человек ждёт увидеть
   * то же время, что показало приложение, — местное. Возьми отрисовка сдвиг у
   * машины сама, и она перестала бы быть чистой функцией: те же данные дали бы
   * разные байты на другой машине или после перелёта, а разные байты в задаче
   * 11 означают «человек правил блок» — то есть заморозку блоков на ровном
   * месте. Сдвиг приходит снаружи, и значит его можно закрепить настройкой
   * (задача 14) и проверить тестом.
   */
  readonly timeZoneOffsetMinutes?: number;
}

/**
 * Отрисовывает управляемую секцию для одной книги — с маркерами.
 *
 * Бросает `TemplateError`, если шаблон негоден или получившаяся секция
 * нарушает своё же устройство.
 */
export function renderSection(
  book: SnapshotBook,
  annotations: readonly SnapshotAnnotation[],
  template: string = DEFAULT_TEMPLATE,
  options: RenderOptions = {},
): string {
  return wrapSection([renderBookBody(book, annotations, template, options)]);
}

/**
 * Тело секции по одной книге — без маркеров.
 *
 * Отдельно от `renderSection`, потому что `beresta-book-id` в заметке — СПИСОК.
 * В библиотеке 1555 книг с историей импорта и слияний изданий, две записи одной
 * книги не гипотеза, и человек вправе привязать обе к одной заметке (задача
 * 12). Секция в заметке при этом остаётся одна: два тела, одна пара маркеров.
 */
export function renderBookBody(
  book: SnapshotBook,
  annotations: readonly SnapshotAnnotation[],
  template: string = DEFAULT_TEMPLATE,
  options: RenderOptions = {},
): string {
  const offset = options.timeZoneOffsetMinutes ?? 0;
  const ordered = [...annotations].sort(compareAnnotations);
  const scope: TemplateScope = {
    fields: {
      title: book.title ?? "",
      authors: book.authors.join(", "),
      // Адрес первоисточника — у статей. У книги поле пустое, и `{{#source}}`
      // в шаблоне свою строку не покажет: пустая строка «Источник:» хуже, чем
      // её отсутствие.
      source: book.source ?? "",
      count: String(ordered.length),
      uuid: book.uuid,
    },
    lists: {
      annotations: ordered.map((annotation) => itemScope(book, annotation, offset)),
    },
  };
  return renderTemplate(template, scope);
}

/**
 * Заворачивает готовые тела в одну пару маркеров.
 *
 * Проверка на выходе — не перестраховка. Текст цитаты попадает в заметку
 * дословно (мы не экранируем книгу: `\[\[` вместо `[[` сделало бы цитату
 * неверной, а задача 16 требует, чтобы заметка читалась и без Beresta). Значит
 * теоретически возможна книга, в которой строка маркера встречается сама по
 * себе, и в этот день секция обязана не отрисоваться, а не разъехаться.
 */
export function wrapSection(bodies: readonly string[]): string {
  const body = bodies
    .map((part) => part.replace(/\n+$/, ""))
    .filter((part) => part !== "")
    .join("\n\n");
  const section = body === "" ? `${SECTION_BEGIN}\n${SECTION_END}` : `${SECTION_BEGIN}\n${body}\n${SECTION_END}`;

  const markers = section.split("\n").filter((line) => MARKER_LINE.test(line));
  if (markers.length !== 2) {
    throw new TemplateError(
      `в отрисованной секции ${markers.length} строк-маркеров вместо двух. Так бывает, ` +
        "если строка маркера встретилась в тексте выписки или её дописали в шаблон: " +
        "секция разъехалась бы, и часть машинного текста оказалась бы в вашей части " +
        "заметки. Beresta ничего не записала.",
    );
  }

  const anchors = [...section.matchAll(/^\^(\S+)$/gm)].map((match) => match[1]!);
  if (new Set(anchors).size !== anchors.length) {
    throw new TemplateError(
      "в отрисованной секции два блока получили один якорь. Такой блок в заметке " +
        "перестал бы быть адресом одной выписки. Beresta ничего не записала.",
    );
  }
  return section;
}

/**
 * Якорь блока по выписке.
 *
 * **Якорь зависит ТОЛЬКО от самой выписки — и это главное свойство.** Считай
 * его от соседей (порядковый номер, разрешение столкновений приписыванием
 * «-2»), и удаление одной выписки переименовало бы якоря половине остальных:
 * задача 11 увидела бы, что все прежние блоки исчезли, а рядом появились
 * новые, и человек получил бы дубликаты вместо синхронизации.
 *
 * **`uuid` берётся целиком, все 32 знака.** Соблазн урезать до восьми велик —
 * якорь короче и читается глазами. Но столкновение двух урезанных якорей
 * означает, что два блока стали одним адресом; в этот день выписка человека
 * тихо пропадает из заметки. Полный `uuid` столкнуться не может по устройству,
 * а не по вероятности, и якорь остаётся сверяемым глазами с идентификатором в
 * приложении.
 */
export function anchorFor(annotation: SnapshotAnnotation): string {
  const uuid = annotation.uuid;
  if (uuid !== undefined && /^[0-9A-Fa-f-]+$/.test(uuid)) {
    return ANCHOR_PREFIX + uuid.replace(/-/g, "").toLowerCase();
  }
  // Адрес выписки не обязан быть `urn:uuid:` — формат открытый, и сторонний
  // писатель вправе дать свой. Отпечаток от полного адреса даёт якорь той же
  // длины и того же набора знаков, и он тоже зависит только от самой выписки.
  return ANCHOR_PREFIX + sha256Hex(new TextEncoder().encode(annotation.id)).slice(0, 32);
}

// MARK: - Поля одной выписки

function itemScope(
  book: SnapshotBook,
  annotation: SnapshotAnnotation,
  offset: number,
): TemplateScope {
  const date = formatDate(annotation.created, offset);
  const link = bookOpenLink(book.uuid, annotation.cfi);
  const signature = sourceLink(date, link);
  // Жест называется словом только у блока с цитатой: у блока без неё имя
  // пометки — это его первая строка, и в подписи оно повторялось бы.
  const gesture = anchoredQuote(annotation) === undefined ? "" : gestureOf(annotation.markKind);
  return {
    fields: {
      heading: heading(book, annotation),
      callout: calloutHead(annotation),
      text: markBody(annotation),
      caption: caption(gesture, signature),
      gesture,
      quote: annotation.quote ?? "",
      comment: annotation.comment ?? "",
      tags: formatTags(annotation.tags),
      date,
      link,
      sourceLink: signature,
      anchor: anchorFor(annotation),
      page: annotation.pageLabel ?? "",
      color: annotation.color ?? "",
      kind: annotation.markKind ?? "",
      chapter: annotation.chapterPath[annotation.chapterPath.length - 1] ?? "",
      uuid: annotation.uuid ?? "",
      title: book.title ?? "",
      authors: book.authors.join(", "),
      source: book.source ?? "",
    },
    lists: {},
  };
}

/**
 * Заголовок коллаута: путь по оглавлению, а если его нет — название книги.
 *
 * **Вырождение здесь обязательно.** У владельца путь по оглавлению сегодня не
 * заполнен ни у одной из 287 выписок — колонок `chapterPath` в его файле базы
 * физически нет, они появятся только при первом запуске новой сборки и
 * повторном импорте. Заголовок, вырождающийся в пустоту, дал бы 287 коллаутов
 * с болтающимся пробелом после `[!quote]+`, а вырождающийся в `undefined` —
 * 287 раз слово «undefined» в конспекте, который человек вёл четыре года.
 */
function heading(book: SnapshotBook, annotation: SnapshotAnnotation): string {
  const path = annotation.chapterPath.map((part) => part.trim()).filter((part) => part !== "");
  if (path.length > 0) return path.join(" → ");
  return book.title ?? "";
}

/**
 * Цитата, за которую отвечает якорь, — или её нет вовсе.
 *
 * **Это главное различение всей отрисовки, и оно не косметическое.** Поле
 * `quote` в модели собрано из ДВУХ источников: `exact` первого
 * `TextQuoteSelector` — и, если якоря-цитаты у выписки нет, `beresta:text`.
 * Для рисующего это два разных утверждения, а не одно:
 *
 * - селектор говорит «в книге, вот в этом месте, стоит ровно этот текст»;
 * - `beresta:text` говорит «у выписки есть такой текст, но за место в книге
 *   он не отвечает» — так уезжают росчерк, PDF и расхождение после того, как
 *   файл книги подменили (`docs/vault-export.md`, ключ `beresta:text`).
 *
 * До прогона глазами 20260818 разницы здесь не делалось, и в заметке владельца
 * стоял коллаут `[!quote]` со словами «Обведено от руки на полях: …» — то есть
 * ЕГО СОБСТВЕННАЯ пометка о росчерке была выдана за прямую речь автора книги
 * (находка 10). Через полгода такую строку не отличить от цитаты ничем.
 *
 * Различаются два источника сравнением с `strandedText` — ровно тем ходом,
 * которым разборщик их и сливал (`parseItem` в `snapshot/shard.ts`): совпали —
 * значит цитата приехала из `beresta:text` и якоря под ней нет. Смотреть в
 * `selectors` напрямую здесь нельзя: список селекторов заполняет только
 * разборщик снимка, а `renderBookBody` зовут и с выпиской, собранной руками.
 */
function anchoredQuote(annotation: SnapshotAnnotation): string | undefined {
  const quote = annotation.quote?.trim();
  if (quote === undefined || quote === "") return undefined;
  const stranded = annotation.strandedText?.trim();
  if (stranded !== undefined && stranded === quote) return undefined;
  return quote;
}

/**
 * Голова коллаута: чем блок объявляет себя — и каким цветом он помечен.
 *
 * **`quote` только там, где есть цитата с якорем.** `> [!quote]` в конспекте
 * значит «дальше слова книги»; блок без якоря-цитаты этого сказать не вправе и
 * получает `> [!note]` — коллаут с карандашом, то есть «пометка», а не речь
 * автора. Это единственная правка, которая убирает выдуманную цитату из
 * заметки: приписка словами внутри блока рядом с текстом её бы не убрала, а
 * добавила бы к ней пояснение.
 *
 * **Цвет едет меткой коллаута (`[!quote|beresta blue]`), а не словом в
 * тексте.** Обоснование целиком — в `defaults.ts`, у шаблона; здесь только его
 * короткая часть: метка не занимает ни знака в строке, которую человек читает,
 * лежит в исходнике заметки открытым словом и ищется обычным поиском.
 *
 * **Слово `beresta` в метке стоит первым и не для красоты.** Метку коллаута
 * человек пишет и сам — `[!note|left]` для картинки, `[!tip|yellow]` для
 * своего. Без своего слова наш `styles.css` красил бы и ЕГО коллауты: плагин
 * влезал бы в вид заметки там, где его не звали. Со словом правило стиля
 * читается буквально — «коллаут, который нарисовала Beresta», — и ни одного
 * чужого блока не задевает.
 *
 * **Имя цвета не выдумывается и не переводится.** В метку уезжает ровно то,
 * что лежит в `beresta:color`, — наши восемь имён, чужое имя стороннего
 * писателя или литеральный `#rrggbb` (схема разрешает все три, см.
 * `docs/schema/schema.md`, «`annotation.color` и `annotation.colorHex`»).
 * Отвергается только то, чем голову коллаута можно разломать: `]`, `|`,
 * перевод строки и пробел внутри имени. Такой цвет остаётся в архиве
 * `.beresta/` — а заметка не получает разъехавшегося блока.
 */
function calloutHead(annotation: SnapshotAnnotation): string {
  const type = anchoredQuote(annotation) === undefined ? "note" : "quote";
  const color = annotation.color?.trim() ?? "";
  if (color === "" || !/^[\p{L}\p{N}#_-]+$/u.test(color)) return `${type}|beresta`;
  return `${type}|beresta ${color}`;
}

/**
 * Тело блока: цитата книги — или пометка, названная своим именем.
 *
 * Росчерк по странице PDF цитаты не имеет вовсе: там нет текста, там линия.
 * Подчёркивание без якоря-цитаты — тоже. Пустая строка на их месте дала бы
 * коллаут из одного заголовка, по которому не понять, ошибка это или так и
 * задумано. Слова курсивом — чтобы человек не принял их за текст книги.
 *
 * **Текст без якоря идёт следом за именем пометки, а не вместо него.** Он
 * доезжает целиком (данные человека не выбрасываются ни в каком случае), но
 * стоит уже ПОД словом «Росчерк» и внутри коллаута, который цитатой себя не
 * называет. Ни кавычек, ни курсива ему не добавляется: чьи это слова — автора
 * другой редакции, распознавателя PDF или самого человека, — не знает никто, и
 * выдумывать здесь нечего.
 */
function markBody(annotation: SnapshotAnnotation): string {
  const quote = anchoredQuote(annotation);
  if (quote !== undefined) return quote;

  const page = annotation.pageLabel?.trim();
  const name = kindNoun(annotation.markKind);
  const head = page === undefined || page === "" ? `_${name}_` : `_${name}, стр. ${page}_`;
  const stranded = annotation.strandedText?.trim();
  return stranded === undefined || stranded === "" ? head : `${head}\n${stranded}`;
}

/**
 * Имя пометки существительным — для блока, у которого цитаты нет.
 *
 * Незнакомый вид не проглатывается словом «Пометка»: формат открытый, и
 * `beresta:type` завтрашней сборки или чужого писателя — это не ошибка
 * (`docs/vault-export.md`, п. 3 «Незнакомое значение знакомого поля»). Имя
 * едет в кавычках как есть, и человек видит, чего мы не поняли.
 */
function kindNoun(kind: string | undefined): string {
  const value = kind?.trim() ?? "";
  if (value === "") return "Пометка";
  return KIND_NOUNS[value] ?? `Пометка «${value}»`;
}

const KIND_NOUNS: Readonly<Record<string, string>> = {
  ink: "Росчерк",
  underline: "Подчёркивание",
  note: "Заметка",
  highlight: "Выделение",
  text: "Надпись",
  area: "Область",
};

/**
 * Жест — одним словом в подписи блока, и только когда он не «выделение».
 *
 * **Подчёркивание и выделение — разные действия, и человек различал их, когда
 * делал.** До прогона глазами 20260818 они рисовались одним и тем же коллаутом
 * без единого признака (находка 10): в заметке от различия не оставалось следа.
 *
 * **Почему у выделения слова нет.** `> [!quote]` с ссылкой на место в книге
 * УЖЕ говорит «этот кусок книги вы пометили» — ровно то, что значит
 * `highlight`. Слово «Выделено» на каждом блоке ничего к этому не прибавляло
 * бы и повторялось бы 291 раз на 291 выписке владельца: строка, которая
 * никогда не меняется, не несёт ничего. Названо то, что от обычного
 * отличается, — и потому название заметно.
 *
 * Молчание здесь — не догадка о привычках человека, а свойство самого вида:
 * `highlight` это то, что получается, когда просто ведёшь по тексту, а
 * `underline`, `ink`, `area` выбирают отдельно. Тем же правилом цвет НЕ
 * молчит ни на одном блоке — там «обычного» нет (см. `defaults.ts`).
 */
function gestureOf(kind: string | undefined): string {
  const value = kind?.trim() ?? "";
  if (value === "" || value === "highlight") return "";
  return KIND_GESTURES[value] ?? `Пометка «${value}»`;
}

const KIND_GESTURES: Readonly<Record<string, string>> = {
  underline: "Подчёркнуто",
  ink: "Росчерк",
  area: "Обведена область",
  note: "Заметка",
  text: "Надпись",
};

/**
 * Подпись блока целиком: чем помечено и когда.
 *
 * Жест стоит ПЕРЕД датой, а не после: подпись читают слева направо, и «чем
 * помечено» — это про сам блок, а «когда» — про его историю.
 */
function caption(gesture: string, signature: string): string {
  if (gesture === "") return signature;
  if (signature === "") return gesture;
  return `${gesture} · ${signature}`;
}

/**
 * Метки выписки строкой.
 *
 * Метка становится настоящей меткой Obsidian только если она годится ею быть:
 * в панели меток хранилища живут метки со всего хранилища, и метка с пробелом
 * внутри там не метка, а половина метки плюс потерянный хвост. Негодные
 * выводятся текстом — данные человека не выбрасываются ни в каком случае.
 */
function formatTags(tags: readonly string[]): string {
  return tags
    .map((tag) => tag.trim())
    .filter((tag) => tag !== "")
    .map((tag) => (/^[\p{L}\p{N}_/-]+$/u.test(tag) && !/^\d+$/.test(tag) ? `#${tag}` : tag))
    .join(" ");
}

/**
 * Подпись под цитатой: дата, ведущая в то самое место той самой книги.
 *
 * Оба куска умеют отсутствовать по отдельности. Ссылки нет у выписки из
 * осколка сирот — книги у неё нет, открывать нечего. Даты нет, если время
 * выделения не разбирается: писать «Invalid Date» в заметку человека нельзя.
 */
function sourceLink(date: string, link: string): string {
  if (link === "") return date;
  if (date === "") return `[Открыть в Beresta](${link})`;
  return `[${date}](${link})`;
}

/**
 * Дата выделения в сквозном формате владельца: `20260806 1206`.
 *
 * **Один плагин не имеет права писать в одну заметку две разные даты.** Прогон
 * глазами 20260818 нашёл ровно это: во frontmatter `beresta-last-sync: 20260818
 * 1047`, а десятью строками ниже, в подписи блока, — `19.08.2023 12:30`. Обе
 * строки написала Beresta, обе стоят в одном файле, и человек не может понять,
 * какая из них его собственная привычка, а какая наша выдумка.
 *
 * Верх взял `YYYYMMDD HHMM`, а не `дд.мм.гггг`, потому что это формат
 * владельца везде: `date: 20221025 1047` в его frontmatter, имена файлов,
 * `beresta-last-sync`, отметки запасных копий и вся строка состояния
 * (`stampOf` в `status.ts` печатает ровно это). Точки в дате были снятой с
 * `calibre://`-ссылок привычкой ОДНОГО места; сквозной формат сильнее.
 *
 * Тем же самым `stampOf` эта функция не заменяется нарочно: у неё другой ответ
 * на негодное время. `stampOf` обязан всегда дать отметку и на мусоре печатает
 * начало эпохи; в заметке человека `19700101 0500` было бы ложью о времени
 * выделения, поэтому здесь негодное время — пустая строка и подпись без даты.
 *
 * **Смена формата перерисует блоки один раз** — тем же ходом, что и смена
 * сдвига пояса: блок, который человек не трогал, узнан по хешу, переписан и
 * запомнен заново; блок, который он правил, заморожен и остаётся его.
 *
 * Сдвиг приходит снаружи — см. `RenderOptions`.
 */
function formatDate(iso: string, offsetMinutes: number): string {
  const milliseconds = Date.parse(iso);
  if (Number.isNaN(milliseconds)) return "";
  const shifted = new Date(milliseconds + offsetMinutes * 60_000);
  const pad = (value: number): string => String(value).padStart(2, "0");
  return (
    `${shifted.getUTCFullYear()}${pad(shifted.getUTCMonth() + 1)}${pad(shifted.getUTCDate())} ` +
    `${pad(shifted.getUTCHours())}${pad(shifted.getUTCMinutes())}`
  );
}

/**
 * Порядок выписок в секции — порядок чтения, и он полный.
 *
 * `sortIndex` — то, чем приложение выстраивает выписки в книге; ширина у него
 * постоянная, поэтому сравнение строк даёт тот же порядок, что и разбор.
 * Дальше время создания и адрес: порядок обязан быть ПОЛНЫМ, иначе две
 * отрисовки одних данных разойдутся байтами, а разошедшиеся байты в задаче 11
 * значат «человек правил блок».
 */
function compareAnnotations(left: SnapshotAnnotation, right: SnapshotAnnotation): number {
  const keys: [string, string][] = [
    [left.sortIndex ?? "", right.sortIndex ?? ""],
    [left.created, right.created],
    [left.id, right.id],
  ];
  for (const [a, b] of keys) {
    if (a !== b) return a < b ? -1 : 1;
  }
  return 0;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
