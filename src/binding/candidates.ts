/**
 * Подбор кандидатов: какие заметки хранилища ПОХОЖИ на заметку этой книги.
 *
 * **Здесь не привязывается ничего.** Этот модуль только показывает и
 * ранжирует; привязку делает владелец нажатием (`binding-view.ts`). Разделение
 * не стилистическое: ошибка подбора не ломает ни одного байта — 47 цитат
 * аккуратно, без единого конфликта лягут не в ту заметку, и заметить это можно
 * будет только глазами. Поэтому у подбора нет права решать, а у решения нет
 * автоматики.
 *
 * **Что измерено и почему правила такие (замер 20260815).** В
 * `Base/Библиотека/` владельца 61 собственная заметка, в
 * `Библиотека/Readwise/` — 45 машинных экспортов чужого инструмента в ТОЙ ЖЕ
 * разметке `> [!quote]+`. У «Building a Second Brain» кандидатов четыре:
 * конспект владельца, `Building a Second Brain. Tiago Forte`,
 * `Building a Second Brain. vanadium23` и `Создай Свой «второй Мозг»!… Тьяго
 * Форте` — русский перевод той же книги под другим названием. Заголовки
 * Readwise записаны С Заглавной Каждое Слово, поэтому сравнение без учёта
 * регистра попадает ИМЕННО в них: одного приведения регистра мало, нужен и
 * признак «машинная заметка».
 *
 * **Три сигнала, и каждый куплен замером:**
 *
 * 1. **Название.** У владельца полное название книги лежит не в имени файла, а
 *    в теле, строкой `**Название**:` — и у «Цель как проект» и «12 недель в
 *    году» оно совпадает с базой Beresta ДОСЛОВНО. Имя файла у него короче
 *    («Цель как проект.md»), длиннее («Путь джедая. Поиск собственной методики
 *    продуктивности.md») или отличается знаком (`:` → `.`). Поэтому у заметки
 *    собирается НЕСКОЛЬКО названий — имя файла, `name:`, `aliases:`,
 *    заголовок, `**Название**:`, `- Full Title:` Readwise — и совпадение
 *    ищется по лучшему из них.
 *
 * 2. **Автор.** Русский перевод не разделяет с английским оригиналом ни одного
 *    слова названия: «Создай Свой «второй Мозг»!…» против «Building a Second
 *    Brain…». Связывает их только автор — `Тьяго  Форте` против `Tiago Forte`,
 *    то есть через транслитерацию. Сравниваем фамилию и первую букву имени
 *    после приведения к латинице: `форте`→`forte` совпадает с `forte`, `т`
 *    совпадает с `t`.
 *
 * 3. **Род работы.** Автор в одиночку — сигнал слишком широкий: у владельца в
 *    `Readwise/` лежат ещё две СТАТЬИ того же Тьяго Форте («Don’t Stop Here»,
 *    «My Favorite Productivity Move»). Статья того же автора — не издание этой
 *    книги, и `- Category: #articles` говорит это прямо. Поэтому автор без
 *    совпадения по названию приводит кандидата только тогда, когда заметка не
 *    объявила себя статьёй. Ровно этот гейт и оставляет у BASB четырёх
 *    кандидатов вместо шести.
 *
 * **Чего здесь нет нарочно.** Поиска по телу заметки: «second brain»
 * встречается в 19 файлах библиотеки, из них половина — чужие статьи о
 * предмете. Автор берётся только из ОБЪЯВЛЕННОГО поля (`author:`,
 * `**Автор**:`, `- Author:`), а не из текста: в `Беседы/Беседа с Тьяго
 * Форте.md` имя стоит в строке «Собеседник:», и заметка о беседе — не заметка
 * о книге.
 */

import { readBookIds } from "../merge/frontmatter";
import type { SnapshotBook } from "../snapshot/model";

/** Заметка хранилища в том виде, в каком её видит подбор. */
export interface VaultNote {
  /** Путь от корня хранилища: `Base/Библиотека/Джедайские техники.md`. */
  readonly path: string;
  readonly text: string;
}

/** Род работы, если заметка о нём объявила. */
export type WorkKind = "book" | "article" | "unknown";

/**
 * Откуда взято название — и почему это не всё равно.
 *
 * **Замер на живом хранилище владельца 20260818.** У книги «Цель как проект»
 * экран показал ПЯТНАДЦАТЬ кандидатов: собственный конспект и четырнадцать
 * посторонних заметок — планы, дизайн-документы, техническое задание и
 * «Мое резюме.md». Связывало их одно: в каждой стоит раздел `## Цель`. Разбор
 * складывал заголовки разделов в тот же мешок, что имя файла, и «Цель»
 * совпадала с «Цель как проект» по началу.
 *
 * Заголовок внутри тела — имя РАЗДЕЛА, а не имя заметки: «Цель», «Задачи»,
 * «Итог» стоят в сотнях заметок, которые ни к одной книге отношения не имеют.
 *
 * **Но выбрасывать такие совпадения нельзя, и это тоже замер.** В тестовом
 * хранилище лежит конспект вебинара `20260702 Ремесло внимания — конспект
 * вебинара.md`, и книгу «Ремесло внимания. Как не расплескать день» в нём
 * называет ровно заголовок раздела `## Ремесло внимания`. Отличить его от
 * `## Номер 1` в разборе конкурентов по данным заметки нечем: оба — два слова,
 * оба — начало названия книги. Поэтому источник хранится вместе со значением,
 * и неполное совпадение по заголовку не отбрасывается, а становится СЛАБОЙ
 * связью (`Candidate.headingOnly`): такой кандидат не лезет на глаза, но
 * человек может его открыть и выбрать.
 */
export type TitleSource =
  /** Имя файла. */
  | "filename"
  /** Заметка объявила название полем: `name:`, `aliases:`, `**Название**:`, `- Full Title:`. */
  | "declared"
  /** Заголовок `#…###` внутри тела. */
  | "heading";

/** Название заметки вместе с тем, откуда оно взято. */
export interface NoteTitle {
  readonly value: string;
  readonly source: TitleSource;
}

/** Почему заметка попала в кандидаты. */
export type MatchReason = "title-exact" | "title-prefix" | "title-contains" | "author";

/** Всё, по чему заметку можно узнать. */
export interface NoteIdentity {
  readonly path: string;
  /** Названия из всех мест сразу, без повторов, с указанием источника. */
  readonly titles: readonly NoteTitle[];
  readonly authors: readonly string[];
  readonly workKind: WorkKind;
  /** Заметка несёт следы другого инструмента. */
  readonly machineGenerated: boolean;
  /** Какие именно следы найдены — чтобы экран мог сказать это словами. */
  readonly machineMarks: readonly string[];
  /** Уже привязанные книги: `beresta-book-id` — всегда список. */
  readonly bookIds: readonly string[];
}

/** Книга, для которой ищем заметку. */
export interface BookQuery {
  readonly title: string;
  readonly authors: readonly string[];
}

/** Заметка-кандидат вместе с тем, чем она заслужила это место. */
export interface Candidate {
  readonly path: string;
  readonly score: number;
  readonly reasons: readonly MatchReason[];
  readonly machineGenerated: boolean;
  readonly machineMarks: readonly string[];
  /** Совпал только автор — самая слабая связь, для снятия неоднозначности. */
  readonly authorOnly: boolean;
  /**
   * Название совпало только с заголовком РАЗДЕЛА внутри заметки, и совпало не
   * целиком, — связь слабая (почему именно так, см. `TitleSource`).
   */
  readonly headingOnly: boolean;
}

/** Книга снимка как запрос подбора. */
export function bookQuery(book: SnapshotBook): BookQuery {
  return { title: book.title ?? "", authors: book.authors };
}

/**
 * Кандидаты для книги — от сильного к слабому.
 *
 * **Машинные заметки опускаются в конец безусловно**, а не штрафом к баллу.
 * Штраф — это «на сколько-то хуже», и он проигрывает, стоит машинному экспорту
 * совпасть названием точнее. У Readwise название совпадает точнее РЕГУЛЯРНО:
 * `- Full Title: Джедайские Техники` — это ровно название книги, а конспект
 * владельца называется по имени файла. Поэтому порядок здесь двухступенчатый:
 * сначала «своё против машинного», и только потом баллы.
 */
export function candidates(book: BookQuery, vault: readonly VaultNote[]): Candidate[] {
  const queryTitle = tokens(book.title);
  const queryAuthors = splitAuthors(book.authors);

  const found: Candidate[] = [];
  for (const note of vault) {
    const identity = identify(note);

    let best = 0;
    let bestReason: MatchReason | undefined;
    let bestByHeading = false;
    for (const title of identity.titles) {
      const level = compareTitles(queryTitle, tokens(title.value));
      if (level === undefined) continue;
      // Заголовок раздела совпал не целиком — связь слабая (см. `TitleSource`).
      const weak = title.source === "heading" && level.reason !== "title-exact";
      // Сильное совпадение важнее слабого независимо от балла: у заголовка
      // раздела балл бывает выше, чем у настоящего совпадения по имени файла.
      const better =
        bestReason === undefined || (bestByHeading && !weak) || (bestByHeading === weak && level.score > best);
      if (!better) continue;
      best = level.score;
      bestReason = level.reason;
      bestByHeading = weak;
    }

    const authorHit = queryAuthors.length > 0 && identity.authors.some((one) => queryAuthors.some((two) => sameAuthor(one, two)));

    // Автор без названия приводит кандидата только если заметка не объявила
    // себя статьёй: статья того же автора — не издание этой книги.
    const admitted = bestReason !== undefined || (authorHit && identity.workKind !== "article");
    if (!admitted) continue;

    const reasons: MatchReason[] = [];
    if (bestReason !== undefined) reasons.push(bestReason);
    if (authorHit) reasons.push("author");

    found.push({
      path: note.path,
      score: (bestReason === undefined ? AUTHOR_ONLY_SCORE : best) + (authorHit ? AUTHOR_BONUS : 0),
      reasons,
      machineGenerated: identity.machineGenerated,
      machineMarks: identity.machineMarks,
      authorOnly: bestReason === undefined,
      headingOnly: bestReason !== undefined && bestByHeading,
    });
  }

  return found.sort(compareCandidates);
}

/**
 * Разбирает заметку: названия, авторы, род работы, следы чужого инструмента.
 *
 * Разбор построчный и дешёвый — ни одного обращения наружу. Хранилище
 * владельца это 120 файлов, но у другого человека их бывают тысячи, и подбор
 * обязан оставаться тем, что можно позвать на каждую книгу.
 */
export function identify(note: VaultNote): NoteIdentity {
  const lines = note.text.split("\n");
  const titles = new TitleBag();
  const authors: string[] = [];
  let workKind: WorkKind = "unknown";

  const base = basename(note.path);
  if (base !== "") titles.add(base, "filename");

  const block = frontmatterBlock(lines);
  for (const value of yamlValues(block, "name")) titles.add(value, "declared");
  for (const value of yamlValues(block, "aliases")) titles.add(value, "declared");
  for (const value of yamlValues(block, "author")) pushAuthors(authors, value);

  for (const raw of lines) {
    const line = raw.trim();

    const heading = /^#{1,3}\s+(.+?)\s*$/.exec(line);
    if (heading !== null && !isServiceHeading(heading[1])) titles.add(heading[1], "heading");

    // Шаблон книги владельца: `**Название**: …`, `**Автор**:  [[Кто-то]]`.
    const ownTitle = /^\*\*Название\*\*:\s*(.*)$/.exec(line);
    if (ownTitle !== null && ownTitle[1].trim() !== "") titles.add(ownTitle[1].trim(), "declared");
    const ownAuthor = /^\*\*Автор\*\*:\s*(.*)$/.exec(line);
    if (ownAuthor !== null) pushAuthors(authors, ownAuthor[1]);

    // Блок `### Metadata` Readwise.
    const fullTitle = /^-\s*Full Title:\s*(.*)$/.exec(line);
    if (fullTitle !== null && fullTitle[1].trim() !== "") titles.add(fullTitle[1].trim(), "declared");
    const rwAuthor = /^-\s*Author:\s*(.*)$/.exec(line);
    if (rwAuthor !== null) pushAuthors(authors, rwAuthor[1]);
    const category = /^-\s*Category:\s*#([\w-]+)\s*$/.exec(line);
    if (category !== null) workKind = kindOfCategory(category[1]);
  }

  const machineMarks = marksOfForeignTool(note.text);
  return {
    path: note.path,
    titles: titles.list(),
    authors,
    workKind,
    machineGenerated: machineMarks.length > 0,
    machineMarks,
    bookIds: readBookIds(note.text),
  };
}

/**
 * Следы чужого инструмента в заметке.
 *
 * Плагин Readwise у владельца сегодня не установлен и файлы с 20240908 не
 * менялись — второго живого писателя в хранилище нет. Признак нужен не для
 * защиты от гонки, а для того, чтобы 47 цитат Beresta не легли в машинный
 * экспорт чужого инструмента вместо конспекта, ради которого всё делалось.
 */
export function marksOfForeignTool(text: string): string[] {
  const marks: string[] = [];

  if (/!\[rw-book-cover\]/.test(text)) marks.push("rw-book-cover");

  // `### Metadata` с полями Readwise под ним. Одного заголовка мало: слово
  // «Metadata» человек вправе написать и сам.
  if (/^#{1,4}\s*Metadata\s*$/m.test(text) && /^-\s*(Author|Full Title|Category|URL):/m.test(text)) {
    marks.push("readwise-metadata");
  }

  if (/readwise\.io\//.test(text)) marks.push("readwise-links");

  // Управляемые блоки других плагинов: `%% Begin Waypoint %%`,
  // `%% dataview-serializer: begin %%`, `<!-- readwise-sync start -->`.
  //
  // **Свою пару маркеров исключаем явно, и это не перестраховка.** Наши
  // маркеры — `%% beresta:begin %%` — той же породы и попадают под тот же
  // образец. Без изъятия заметка, в которую этот плагин УЖЕ написал секцию,
  // на следующем синке объявлялась бы машинной и опускалась бы в конец
  // собственного списка: один раз привязал — и с тех пор твоя заметка помечена
  // как чужой машинный экспорт.
  const foreign = [
    ...text.matchAll(/^%%\s*[\w:. -]*\b(?:begin|end)\b[\w:. -]*%%\s*$/gim),
    ...text.matchAll(/<!--\s*[\w-]+[- ](?:start|begin|end)\s*-->/gi),
  ].filter((match) => !/beresta/i.test(match[0]));
  if (foreign.length > 0) marks.push("foreign-markers");

  return marks;
}

// MARK: - Внутреннее

/** Балл кандидата, приведённого одним автором, без совпадения по названию. */
const AUTHOR_ONLY_SCORE = 30;

/** Прибавка за совпавшего автора поверх совпадения по названию. */
const AUTHOR_BONUS = 40;

interface TitleLevel {
  readonly score: number;
  readonly reason: MatchReason;
}

/**
 * Насколько два названия одно и то же.
 *
 * Уровня три, и все три нужны живым данным: дословное совпадение («Цель как
 * проект: Как успешно решать…» в `**Название**:`), начало («Building a Second
 * Brain» ⊂ «Building a Second Brain: A Proven Method…», «Путь джедая» ⊂ «Путь
 * джедая. Поиск собственной методики продуктивности») и вхождение подряд.
 * Совпадения «по общим словам» здесь нет нарочно: оно приводит соседей по теме
 * — «How People Manage Knowledge in their Second Brains» и «Как Научиться
 * Учиться С Помощью Второго Мозга» — то есть ровно тот шум, из-за которого
 * человек перестанет читать список.
 *
 * **Порог в два слова куплен замером 20260818 на живом хранилище владельца**,
 * где у «Цель как проект» оказалось 15 кандидатов вместо одного. «Цель» ⊄
 * «Цель как проект», сколько бы раз это слово ни стояло в заметке: одно общее
 * слово — это не название. С двух слов совпадение уже настоящее: «Путь
 * джедая» ⊂ «Путь джедая. Поиск собственной методики продуктивности» на том же
 * хранилище приводит правильную заметку, и она приводится по-прежнему.
 */
function compareTitles(query: readonly string[], note: readonly string[]): TitleLevel | undefined {
  if (query.length === 0 || note.length === 0) return undefined;

  if (query.join(" ") === note.join(" ")) return { score: 100, reason: "title-exact" };

  const [shorter, longer] = query.length <= note.length ? [query, note] : [note, query];
  if (shorter.length >= 2 && shorter.every((word, index) => longer[index] === word)) {
    return { score: 80, reason: "title-prefix" };
  }
  if (shorter.length >= 3 && containsRun(longer, shorter)) {
    return { score: 65, reason: "title-contains" };
  }
  return undefined;
}

/**
 * Копилка названий: одно значение — один источник, самый сильный из
 * встреченных.
 *
 * Порядок важен: у собственного конспекта владельца название стоит и в имени
 * файла, и заголовком первой строки. Считать такое название «заголовком»
 * значило бы отобрать у заметки право на совпадение по началу — а имя файла
 * это право имеет.
 */
class TitleBag {
  private readonly found = new Map<string, TitleSource>();

  add(value: string, source: TitleSource): void {
    const known = this.found.get(value);
    if (known !== undefined && rankOfSource(known) <= rankOfSource(source)) return;
    this.found.set(value, source);
  }

  list(): NoteTitle[] {
    return [...this.found].map(([value, source]) => ({ value, source }));
  }
}

function rankOfSource(source: TitleSource): number {
  return source === "filename" ? 0 : source === "declared" ? 1 : 2;
}

function containsRun(haystack: readonly string[], needle: readonly string[]): boolean {
  for (let start = 0; start + needle.length <= haystack.length; start += 1) {
    if (needle.every((word, index) => haystack[start + index] === word)) return true;
  }
  return false;
}

/**
 * Порядок кандидатов на экране — три ступени, и каждая куплена замером.
 *
 * **Первая: сила связи. Чем заметка совпала — важнее того, кто её написал.**
 * Ступеней три: совпало название, совпал только заголовок раздела внутри
 * заметки, совпал только автор.
 *
 * Ступень стоит первой с 20260818, и до этого дня первой стояла вторая
 * («машинное вниз»). Так это выглядело на живом хранилище владельца: у
 * «Ремесла внимания» первыми тремя шли его конспекты, а ЧЕТВЁРТЫМ —
 * `Библиотека/Readwise/Ремесло Внимания. Пётр Одинцов.md`, настоящий экспорт
 * этой самой книги; третьим же местом, ВЫШЕ него, стояла
 * `_Inbox/20260708 Заявка на консультацию — Пётр Одинцов.md` — заявка на
 * консультацию, попавшая в список только потому, что автор книги и человек из
 * заявки один. У «Дневника как инструмента» тем же ходом первой строкой встала
 * заметка про ДРУГУЮ книгу. «Машинное вниз» опускало машинный экспорт ниже
 * всего своего — включая то своё, что этой книгой не является вовсе.
 *
 * Совпадение по одному автору — не про эту книгу, а про этого человека: у
 * «Номер 1» оно приводит трёх соседей по полке. Ставить такую подсказку выше
 * заметки, у которой сошлось НАЗВАНИЕ, значит менять сигнал на шум ради того,
 * чей это файл.
 *
 * **Вторая: машинное вниз, безусловно — но внутри своей ступени.** Не штрафом
 * к баллу. У «Джедайских техник» на живом хранилище конспект владельца и
 * машинный экспорт Readwise набирают РОВНО поровну — 140 и 140, оба совпали с
 * названием книги дословно (в экспорте лежит `- Full Title: Джедайские
 * Техники`). Любой штраф, который можно перевесить баллом, здесь однажды
 * перевесят: разница между «своя» и «чужая» не количественная. Эта ступень
 * жива и решает ровно то, ради чего заведена, — спор двух заметок, совпавших
 * ОДИНАКОВО.
 *
 * **Третья: балл, а при равенстве — путь.** Чтобы порядок был один и тот же от
 * прогона к прогону: список, который перетасовывается сам по себе, владелец
 * перестанет читать глазами и начнёт нажимать по памяти.
 */
function compareCandidates(one: Candidate, two: Candidate): number {
  const link = linkRank(one) - linkRank(two);
  if (link !== 0) return link;
  if (one.machineGenerated !== two.machineGenerated) return one.machineGenerated ? 1 : -1;
  if (one.score !== two.score) return two.score - one.score;
  return one.path < two.path ? -1 : one.path > two.path ? 1 : 0;
}

/**
 * Сила связи: 0 — совпало название, 1 — только заголовок раздела, 2 — только
 * автор.
 *
 * Заголовок раздела посередине не для симметрии: «книга названа заголовком
 * внутри чужой заметки» — это всё-таки НАЗВАНИЕ, а не однофамилец, но и не имя
 * файла. Показывается он всё равно под кнопкой (`groupCandidates`), и ступень
 * решает только его место среди таких же спрятанных.
 */
function linkRank(candidate: Candidate): number {
  if (candidate.authorOnly) return 2;
  if (candidate.headingOnly) return 1;
  return 0;
}

/**
 * Приведение строки к сравнимому виду.
 *
 * NFKC — потому что хранилище пишут разными раскладками и разными
 * приложениями; нижний регистр — потому что заголовки Readwise записаны С
 * Заглавной Каждое Слово; `ё` → `е` — потому что в живых заметках встречается и
 * так и так. Знаки препинания становятся границами слов: `:` в базе Beresta и
 * `.` в имени файла владельца — это одно и то же название.
 */
function fold(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function tokens(value: string): string[] {
  const folded = fold(value);
  return folded === "" ? [] : folded.split(" ");
}

function basename(path: string): string {
  const tail = path.slice(path.lastIndexOf("/") + 1);
  return tail.endsWith(".md") ? tail.slice(0, -3) : tail;
}

/** Заголовки служебных блоков названием заметки не являются. */
function isServiceHeading(heading: string): boolean {
  return /^(Metadata|Цитаты( и заметки)?|Highlights|New highlights added\b.*)$/i.test(heading.trim());
}

function kindOfCategory(category: string): WorkKind {
  return category.toLowerCase() === "books" ? "book" : "article";
}

/** Строки блока frontmatter, если он есть. */
function frontmatterBlock(lines: readonly string[]): string[] {
  if (lines.length === 0 || !/^---[\t \r]*$/.test(lines[0] ?? "")) return [];
  for (let index = 1; index < lines.length; index += 1) {
    if (/^---[\t \r]*$/.test(lines[index] ?? "")) return lines.slice(0, index + 1);
  }
  return [];
}

/** Значения ключа верхнего уровня: скаляр, `[a, b]` или блочный список. */
function yamlValues(block: readonly string[], key: string): string[] {
  const values: string[] = [];
  for (let index = 1; index < block.length - 1; index += 1) {
    const match = new RegExp(`^${key}:(.*)$`).exec(block[index] ?? "");
    if (match === null) continue;
    const inline = match[1].trim();
    if (inline.startsWith("[")) {
      for (const item of inline.replace(/^\[/, "").replace(/\]$/, "").split(",")) {
        const clean = unquote(item.trim());
        if (clean !== "") values.push(clean);
      }
    } else if (inline !== "") {
      values.push(unquote(inline));
    } else {
      for (let next = index + 1; next < block.length - 1; next += 1) {
        const item = (block[next] ?? "").trim();
        if (!item.startsWith("- ")) break;
        const clean = unquote(item.slice(2).trim());
        if (clean !== "") values.push(clean);
      }
    }
    break;
  }
  return values;
}

function unquote(value: string): string {
  if (value.length >= 2 && (value.startsWith('"') || value.startsWith("'"))) {
    const quote = value[0];
    if (value.endsWith(quote)) return value.slice(1, -1);
  }
  return value;
}

/**
 * Разбирает поле автора на отдельные имена.
 *
 * `[[Максим Дорофеев]]`, `[[Tiago Forte|Тьяго Форте]]`, «Брайан Моран, Майкл
 * Леннингтон» — все три формы живут в хранилище и в базе Beresta. Из ссылки с
 * чертой берутся ОБЕ стороны: у владельца встречается и запись через настоящее
 * имя, и через показываемое.
 */
function pushAuthors(into: string[], raw: string): void {
  const links = [...raw.matchAll(/\[\[([^\]]+)\]\]/g)].map((match) => match[1]);
  const parts = links.length > 0 ? links : [raw];
  for (const part of parts) {
    for (const side of part.split("|")) {
      for (const name of side.split(/[,;]|\sи\s/)) {
        const clean = name.replace(/[[\]]/g, "").trim();
        if (clean !== "") into.push(clean);
      }
    }
  }
}

function splitAuthors(authors: readonly string[]): string[] {
  const out: string[] = [];
  for (const author of authors) pushAuthors(out, author);
  return out;
}

/**
 * Один ли это человек.
 *
 * Сначала дословно, после приведения. Если нет — через латиницу по фамилии и
 * первой букве имени: `Тьяго  Форте` и `Tiago Forte` — один автор, и связывает
 * русский перевод с английским оригиналом только это. Фамилии в одиночку мало
 * (однофамильцы), поэтому первая буква имени обязана совпасть тоже.
 */
function sameAuthor(one: string, two: string): boolean {
  const a = tokens(one);
  const b = tokens(two);
  if (a.length === 0 || b.length === 0) return false;
  if (a.join(" ") === b.join(" ")) return true;

  const at = a.map(latin);
  const bt = b.map(latin);
  if (at.join(" ") === bt.join(" ")) return true;

  const surnameA = at[at.length - 1];
  const surnameB = bt[bt.length - 1];
  if (surnameA !== surnameB || surnameA.length < 3) return false;
  if (at.length < 2 || bt.length < 2) return false;
  return at[0][0] === bt[0][0];
}

const CYRILLIC: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ж: "zh", з: "z", и: "i",
  й: "i", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s",
  т: "t", у: "u", ф: "f", х: "h", ц: "c", ч: "ch", ш: "sh", щ: "sch",
  ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
};

function latin(value: string): string {
  let out = "";
  for (const letter of value) out += CYRILLIC[letter] ?? letter;
  return out;
}
