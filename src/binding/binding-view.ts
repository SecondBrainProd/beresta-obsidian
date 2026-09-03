/**
 * Экран привязки: что показать владельцу и что сделать с его нажатием.
 *
 * **Главное свойство модуля — он не привязывает ничего сам.** `planBinding`
 * собирает список книг и кандидатов и кладёт КАЖДУЮ книгу в `awaitingUser`;
 * поле `automatic` есть, всегда пусто и существует затем, чтобы «ни одной
 * автоматической привязки» было утверждением, которое можно проверить, а не
 * обещанием в комментарии. Привязка появляется только из `applyChoices`, и
 * только для тех книг, по которым владелец нажал.
 *
 * **Почему запрет такой резкий.** Порог «привязываем, если кандидат один и
 * совпадение точное» кажется безобидным ровно до встречи с живыми данными: у
 * «Building a Second Brain» четыре сильных кандидата, и «сильный» здесь
 * означает «четыре способа ошибиться»; у «Джедайских техник» машинный экспорт
 * Readwise совпадает с названием книги ТОЧНЕЕ, чем собственный конспект
 * владельца, — потому что в экспорте лежит `- Full Title: Джедайские Техники`,
 * а конспект назван по имени файла. Любая автоматика здесь выбирает чужой
 * машинный экспорт и делает это молча.
 *
 * **Связь книги и заметки держится на `beresta-book-id`, а не на имени
 * файла.** Заметку можно переименовать и переложить в другую папку — привязка
 * переживёт: `readBindings` читает идентификаторы из frontmatter, где бы файл
 * ни лежал. Ключ — всегда список: в библиотеке 1555 книг с историей импорта и
 * слияний изданий, две записи одной книги не гипотеза, и владелец вправе
 * привязать обе к одной заметке (секция при этом остаётся одна — задача 10).
 */

import { readBookIds } from "../merge/frontmatter";
import type { Snapshot, SnapshotBook } from "../snapshot/model";
import { bookQuery, candidates, identify, type Candidate, type VaultNote } from "./candidates";

/**
 * Папка для заметок, которых ещё нет.
 *
 * Значение по умолчанию, а не константа поведения: настройка задачи 14 отдаёт
 * его наружу. Здесь оно названо так, как сложилось у владельца.
 */
export const DEFAULT_LIBRARY_FOLDER = "Base/Библиотека";

/** Одна строка экрана: книга и всё, что о ней надо знать для выбора. */
export interface BindingRow {
  readonly bookUUID: string;
  /** Название так, как оно стоит в базе Beresta. */
  readonly title: string;
  readonly authors: readonly string[];
  /** Живых выписок у книги — столько уедет в заметку. */
  readonly annotationCount: number;
  /** Кандидаты от сильного к слабому; машинные — в конце. */
  readonly candidates: readonly Candidate[];
  /** Куда ляжет «создать новую». ПРЕДЛОЖЕНИЕ, а не действие. */
  readonly proposedPath: string;
  /**
   * По этому адресу заметка уже лежит.
   *
   * Замер 20260818 на тестовом хранилище: у трёх книг из десяти «Создать
   * новую» предлагала путь заметки, которая уже есть и стоит первым
   * кандидатом, — у «Learn Less, Retain More» две кнопки подряд показывали
   * один и тот же адрес. Разрушения не было (проход дописывал в
   * существующий файл), но подпись врала ровно тому человеку, который жмёт
   * её затем, чтобы свой конспект НЕ трогать.
   */
  readonly proposedExists: boolean;
  /**
   * Выбор владельца. В плане всегда `undefined` — план не выбирает.
   */
  readonly chosen: string | undefined;
}

/** Заметка, уже несущая привязку. */
export interface BoundNote {
  readonly path: string;
  readonly bookIds: readonly string[];
}

export interface BindingPlan {
  /**
   * Всегда пусто. Поле не заглушка: пока оно есть и пусто, «никакой
   * автоматической привязки» — проверяемое утверждение.
   */
  readonly automatic: readonly BindingRow[];
  readonly awaitingUser: readonly BindingRow[];
  readonly alreadyBound: readonly BoundNote[];
}

/** Что владелец нажал по этой книге. */
export type Choice =
  | { readonly kind: "bind"; readonly path: string }
  | { readonly kind: "create" }
  | { readonly kind: "skip" };

/** Заметка, которую предстоит завести. */
export interface Creation {
  readonly bookUUID: string;
  readonly path: string;
  readonly title: string;
}

export interface BindingOutcome {
  /** Путь заметки → идентификаторы книг, которые в ней окажутся. */
  readonly bindings: ReadonlyMap<string, readonly string[]>;
  readonly creations: readonly Creation[];
  /** Книги, по которым владелец не нажал ничего. */
  readonly untouched: readonly string[];
}

/** Привязки, лежащие в хранилище: путь заметки → книги. */
export function readBindings(vault: readonly VaultNote[]): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const note of vault) {
    const ids = readBookIds(note.text);
    if (ids.length > 0) found.set(note.path, ids);
  }
  return found;
}

/**
 * Собирает экран привязки.
 *
 * Книги, уже привязанные где-то в хранилище, в список не возвращаются: выбор
 * сделан однажды и переспрашивать его на каждый синк — это и есть способ
 * добиться, чтобы владелец перестал читать и начал нажимать не глядя.
 */
export function planBinding(
  snapshot: Snapshot,
  vault: readonly VaultNote[],
  folder: string = DEFAULT_LIBRARY_FOLDER,
): BindingPlan {
  if (snapshot.kind === "absent") {
    return { automatic: [], awaitingUser: [], alreadyBound: [] };
  }

  const bound = readBindings(vault);
  const boundUUIDs = new Set<string>();
  for (const ids of bound.values()) for (const id of ids) boundUUIDs.add(id);

  const owners = notesOwnedByBooks(snapshot.books, vault);
  const existing = new Set(vault.map((note) => note.path));

  const rows: BindingRow[] = [];
  for (const book of snapshot.books) {
    if (boundUUIDs.has(book.uuid)) continue;
    const proposedPath = newNotePath(book.title ?? book.uuid, folder);
    rows.push({
      bookUUID: book.uuid,
      title: book.title ?? "",
      authors: book.authors,
      annotationCount: book.total,
      candidates: disambiguate(candidates(bookQuery(book), vault), book.uuid, owners),
      proposedPath,
      proposedExists: existing.has(proposedPath),
      chosen: undefined,
    });
  }

  return {
    // Здесь и нигде: ни одна книга не уезжает в `automatic`.
    automatic: [],
    awaitingUser: rows,
    alreadyBound: [...bound].map(([path, bookIds]) => ({ path, bookIds })),
  };
}

/**
 * Превращает нажатия владельца в привязки.
 *
 * **Книга без выбора не привязывается ничем.** Это единственное место, где
 * привязка вообще возникает, и отсутствие выбора здесь — не «взять лучшего
 * кандидата», а «не трогать». Убери эту проверку — и плагин начнёт привязывать
 * сам, ровно то, что запрещено замыслом.
 *
 * `existing` — привязки, уже лежащие в заметках: нужны, чтобы повторный выбор
 * той же книги не удвоил её в списке `beresta-book-id`.
 */
export function applyChoices(
  plan: BindingPlan,
  choices: ReadonlyMap<string, Choice>,
  existing: ReadonlyMap<string, readonly string[]> = new Map(),
): BindingOutcome {
  const bindings = new Map<string, string[]>();
  const creations: Creation[] = [];
  const untouched: string[] = [];

  for (const row of plan.awaitingUser) {
    const choice = choices.get(row.bookUUID);
    if (choice === undefined || choice.kind === "skip") {
      untouched.push(row.bookUUID);
      continue;
    }

    if (choice.kind === "create") {
      creations.push({ bookUUID: row.bookUUID, path: row.proposedPath, title: row.title });
      continue;
    }

    const already = bindings.get(choice.path) ?? [...(existing.get(choice.path) ?? [])];
    if (!already.includes(row.bookUUID)) already.push(row.bookUUID);
    bindings.set(choice.path, already);
  }

  return { bindings, creations, untouched };
}

/**
 * Путь новой заметки.
 *
 * `:` становится `.` по сложившейся привычке владельца — его собственный файл
 * называется `Building a Second Brain. A Proven Method…`, а в базе Beresta та
 * же книга записана через двоеточие. Остальные знаки заменяются потому, что
 * файловая система и Obsidian их не примут, и потому, что заметка с именем,
 * которое пришлось чинить молча, потом не находится поиском.
 */
export function newNotePath(title: string, folder: string): string {
  const name = title
    .replace(/[/\\]/g, "-")
    .replace(/:/g, ".")
    .replace(/"/g, "'")
    .replace(/[|*]/g, "-")
    .replace(/</g, "(")
    .replace(/>/g, ")")
    .replace(/[?#^[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\.+$/, "");
  const base = folder.replace(/\/+$/, "");
  return base === "" ? `${name}.md` : `${base}/${name}.md`;
}

/**
 * Экран словами.
 *
 * Отдельно от самого окна нарочно: то, ЧТО написано на экране, — это решение,
 * от которого зависит верный выбор, и его надо уметь проверить тестом. Окно
 * Obsidian (`Modal`) поверх этих строк собирается в задаче 14 вместе с
 * командами; здесь оно было бы вторым Obsidian, написанным нами и всегда с
 * нами согласным.
 */
export function describePlan(plan: BindingPlan): string[] {
  const lines: string[] = [...screenIntro(plan)];
  for (const row of plan.awaitingUser) {
    lines.push(`«${row.title}» — ${bookSubtitle(row)}`);

    const said = nothingFoundWords(row);
    if (said !== undefined) lines.push(`    ${said}`);

    const { likely, weak } = groupCandidates(row.candidates);
    let number = 0;
    for (const candidate of likely) {
      number += 1;
      lines.push(`    ${number}. ${candidate.path}${whyTail(candidate)}`);
    }
    if (weak.length > 0) {
      lines.push(`    ▸ ${moreCandidatesWords(weak)}`);
      for (const candidate of weak) {
        number += 1;
        lines.push(`      ${number}. ${candidate.path}${whyTail(candidate)}`);
      }
    }

    const action = newNoteAction(row);
    if (action.kind === "create") lines.push(`    + создать новую: ${action.path}`);
    if (action.kind === "bind") lines.push(`    + дописать в существующую: ${action.path}`);
    lines.push("    + пропустить");
  }
  return lines;
}

/**
 * Почему заметка вообще в списке — словами, и в той же строке.
 *
 * Совпадение по одному автору на живом хранилище приводит ДРУГИЕ книги того же
 * автора: у «Номер 1» это три соседа (Игорь Манн написал ещё «Почему Вы»,
 * «Читай» и «Гроуинг»), у «Building a Second Brain» — русский перевод той же
 * книги. Отличить перевод от соседней книги по данным хранилища нечем: ни в
 * заметках, ни в базе Beresta не записано, что это одно произведение. Поэтому
 * подсказка не выбрасывается и не выдаётся за совпадение названия — она
 * называет себя тем, что она есть.
 */
export function whyCandidate(candidate: Candidate): string[] {
  const notes: string[] = [];
  if (candidate.authorOnly) notes.push("совпал только автор — возможно, другая книга");
  if (candidate.headingOnly) {
    notes.push("название книги стоит только заголовком раздела внутри заметки");
  }
  if (candidate.machineGenerated) notes.push("похоже на машинный экспорт");
  return notes;
}

function whyTail(candidate: Candidate): string {
  const notes = whyCandidate(candidate);
  return notes.length === 0 ? "" : `  — ${notes.join("; ")}`;
}

/**
 * Кандидаты, разложенные по тому, показывать ли их сразу.
 *
 * **Зачем делить, если список и так отсортирован.** Замер 20260818 на живом
 * хранилище владельца: у «Цель как проект» экран показал 15 кандидатов, из
 * которых 14 были посторонними заметками. Корень выкорчеван в подборе
 * (`compareTitles`), но остаётся вторая половина шума, которая законна и
 * никуда не денется: «совпал только автор» приводит ДРУГИЕ книги того же
 * автора — у «Номер 1» это три соседа. Их нельзя выбросить (среди них бывает
 * русский перевод той же книги, и владелец обязан иметь возможность его
 * выбрать) и нельзя показывать вперемешку с настоящими: четыре строки шума
 * над одной строкой сигнала — это список, который перестают читать.
 *
 * Поэтому: совпавшее названием видно сразу, совпавшее одним автором — под
 * кнопкой, и кнопка называет, что под ней лежит. Спрятано — не выброшено.
 */
export interface CandidateGroups {
  /** Совпало название — показываем сразу. Машинные внутри группы всё так же в конце. */
  readonly likely: readonly Candidate[];
  /** Совпал только автор — под кнопкой «показать ещё». */
  readonly weak: readonly Candidate[];
}

export function groupCandidates(list: readonly Candidate[]): CandidateGroups {
  const weak = (one: Candidate): boolean => one.authorOnly || one.headingOnly;
  return { likely: list.filter((one) => !weak(one)), weak: list.filter(weak) };
}

/**
 * Что делать кнопке «создать новую» у этой книги.
 *
 * Три исхода, и все три встречались на живых данных:
 *
 * - `create` — файла по предложенному адресу нет, заводим;
 * - `bind` — файл есть, но в кандидатах его не оказалось: тогда это не
 *   «создать», а «дописать в существующую», и кнопка обязана сказать это
 *   словами;
 * - `none` — файл есть и уже стоит кандидатом выше. Второй кнопки с тем же
 *   адресом на экране быть не должно: у «Learn Less, Retain More» они стояли
 *   подряд и выглядели ошибкой отрисовки.
 */
export type NewNoteAction =
  | { readonly kind: "create"; readonly path: string }
  | { readonly kind: "bind"; readonly path: string }
  | { readonly kind: "none" };

export function newNoteAction(row: BindingRow): NewNoteAction {
  if (!row.proposedExists) return { kind: "create", path: row.proposedPath };
  if (row.candidates.some((one) => one.path === row.proposedPath)) return { kind: "none" };
  return { kind: "bind", path: row.proposedPath };
}

/** Подпись под названием книги: автор и число выписок — со склонением. */
export function bookSubtitle(row: BindingRow): string {
  return [row.authors.join(", "), `${row.annotationCount} ${plural(row.annotationCount)}`]
    .filter((part) => part !== "")
    .join(" · ");
}

/**
 * Почему у этой книги ничего не показано.
 *
 * Пустой список и список, спрятанный под кнопку, выглядят одинаково — молча.
 * «Подходящей заметки не нашлось» и «мы не искали» человек различить не может,
 * поэтому экран говорит, что именно случилось. `undefined` — сказать нечего,
 * кандидаты на виду.
 */
export function nothingFoundWords(row: BindingRow): string | undefined {
  const { likely, weak } = groupCandidates(row.candidates);
  if (likely.length > 0) return undefined;
  if (weak.length > 0) {
    return "Заметки с таким названием не нашлось — есть только слабые совпадения.";
  }
  return "Ни одной заметки с этим названием или автором в хранилище не нашлось.";
}

/** Подпись кнопки, за которой спрятаны слабые кандидаты. */
export function moreCandidatesWords(weak: readonly Candidate[]): string {
  const word = wordFor(weak.length, "заметку", "заметки", "заметок");
  return `Показать ещё ${weak.length} ${word} со слабым совпадением`;
}

/**
 * Две строки вверху экрана: что это за экран и что будет после нажатия.
 *
 * Прогон глазами 20260818: «непонятно, что делать — нет ни одного слова о том,
 * зачем этот экран и что произойдёт после». Отсюда требования к этим строкам:
 * назвать число книг (человек должен понимать, сколько ему решать), назвать
 * действие целиком (куда лягут выписки и что станет с его собственным
 * текстом) и назвать цену бездействия (книга без выбора не меняет ничего).
 */
export function screenIntro(plan: BindingPlan): string[] {
  const count = plan.awaitingUser.length;
  const books = wordFor(count, "книга", "книги", "книг");
  const waiting = wordFor(count, "ждёт", "ждут", "ждут");
  return [
    `${count} ${books} с выписками ${waiting} заметки: Beresta не знает, куда их класть, ` +
      "и сама не решает.",
    "Выберите заметку каждой книге — выписки лягут в неё отдельной секцией, ваш " +
      "собственный текст останется нетронутым. Книга без выбора не изменит ничего.",
  ];
}

/** Счётчик выбранного в нижней полосе. */
export function chosenCountWords(chosen: number, total: number): string {
  if (chosen === 0) return "Пока не выбрано ничего";
  return `Выбрано ${chosen} ${wordFor(chosen, "книга", "книги", "книг")} из ${total}`;
}

/** Заметка, в которую проход записал, и сколько выписок в ней теперь. */
export interface WrittenNote {
  readonly path: string;
  /** Сколько выписок Beresta держит в этой заметке после записи. */
  readonly quotes: number;
}

export interface BindingAftermath {
  /** Книг, которым человек выбрал заметку. «Пропустить» сюда не входит. */
  readonly chosen: number;
  /** Заметки, в которые проход записал. */
  readonly written: readonly WrittenNote[];
  /**
   * Выбранные заметки, открытые с несохранёнными правками.
   *
   * Такая заметка не получает НИЧЕГО — ни выписок, ни ключа `beresta-book-id`:
   * проход откладывает файл целиком. Значит выбор пропал, и человеку надо
   * сказать не «подождите», а «сохраните и выберите снова».
   */
  readonly deferred: readonly string[];
  /** Выбранные заметки, от которых проход отказался или не нашёл их. */
  readonly failed: readonly string[];
}

/** Уведомление после привязки: заголовок, строки-заметки и что осталось. */
export interface BindingNoticeWords {
  readonly head: string;
  /** Путь — ссылка, хвост — сколько там выписок. */
  readonly notes: readonly { readonly path: string; readonly tail: string }[];
  /** Про то, что не легло. Пусто — всё легло. */
  readonly rest: readonly string[];
}

/**
 * Что сказать человеку после нажатия «Привязать выбранные».
 *
 * **Это ответ на главную непонятность прогона глазами 20260818.** Владелец
 * выбрал книгу, нажал кнопку — окно закрылось, и на экране не изменилось
 * ничего: ни уведомления, ни счётчика, ни предложения открыть заметку. На
 * диске в это время в заметку легли 40 цитат, и она выросла с 1 310 до 16 559
 * знаков. Человек, не заглянувший в файл, читает это как «кнопка не работает»
 * — и жмёт её ещё раз.
 *
 * **Числа стоят в самом ответе, а не в строке состояния.** Строка в углу
 * говорит про снимок выгрузки («данные на 20260818 1047») и после привязки не
 * меняется вовсе. Ответ на нажатие — это сколько книг привязано, сколько
 * выписок легло и КУДА; путь заметки здесь не украшение, он и есть дорога
 * туда, где результат.
 *
 * **Молчание не заменяется бодростью.** Не легло ничего — сказано, почему
 * именно, и что теперь делать: «готово» там, где ничего не произошло, хуже
 * тишины, потому что это неправда.
 */
export function bindingNoticeWords(after: BindingAftermath): BindingNoticeWords {
  const quotes = after.written.reduce((sum, one) => sum + one.quotes, 0);
  const notes = after.written.map((one) => ({
    path: one.path,
    tail: `— ${one.quotes} ${plural(one.quotes)}`,
  }));

  if (after.written.length === 0) {
    return { head: `Beresta: ${nothingLanded(after)}`, notes: [], rest: [] };
  }

  const head =
    `Beresta: ${boundBooks(after.chosen)}, ${quotes} ${plural(quotes)} ` +
    `${wordFor(quotes, "легла", "легли", "легли")} ${intoNotes(after.written.length)}:`;
  return { head, notes, rest: leftBehind(after) };
}

// MARK: - Внутреннее

/** Правильная форма слова «выписка» при числе. */
function plural(count: number): string {
  return wordFor(count, "выписка", "выписки", "выписок");
}

/** «привязана 1 книга» / «привязано 3 книги» — начало ответа на нажатие. */
function boundBooks(count: number): string {
  if (count === 1) return "привязана 1 книга";
  return `привязано ${count} ${wordFor(count, "книга", "книги", "книг")}`;
}

/** Куда легли: «в заметку» при одной, «в 3 заметки» при нескольких. */
function intoNotes(count: number): string {
  if (count === 1) return "в заметку";
  return `в ${count} ${wordFor(count, "заметку", "заметки", "заметок")}`;
}

/**
 * Не легло ничего — почему.
 *
 * Каждый случай называет и причину, и что теперь делать. «Ничего не
 * произошло» без причины — ровно то, на что жаловался прогон глазами; сказать
 * это вслух и не сказать почему значит поменять молчание на бессмысленный
 * шум.
 */
function nothingLanded(after: BindingAftermath): string {
  if (after.deferred.length > 0) {
    const open =
      after.deferred.length === 1
        ? "заметка открыта с несохранёнными правками"
        : "заметки открыты с несохранёнными правками";
    return `выписки не легли — ${open}. Сохраните и выберите заново: привязка тоже не записалась.`;
  }
  if (after.failed.length > 0) {
    const count = after.failed.length;
    const word = wordFor(count, "заметки", "заметок", "заметок");
    return `выписки не легли — проход отказался от ${count} ${word}. Причина — отдельным сообщением.`;
  }
  return "выбор принят, но ни одна заметка не изменилась: эти выписки в них уже стоят.";
}

/** Что осталось не записанным, когда часть заметок всё же записана. */
function leftBehind(after: BindingAftermath): string[] {
  const lines: string[] = [];
  if (after.deferred.length > 0) {
    const count = after.deferred.length;
    const noun = wordFor(count, "заметка", "заметки", "заметок");
    const open = count === 1 ? "открыта" : "открыты";
    const on = count === 1 ? "ней" : "ним";
    lines.push(
      `Ещё ${count} ${noun} ${open} с несохранёнными правками — привязка по ${on} не ` +
        "записана: сохраните и выберите заново.",
    );
  }
  if (after.failed.length > 0) {
    const count = after.failed.length;
    const noun = wordFor(count, "заметки", "заметок", "заметок");
    lines.push(`Ещё от ${count} ${noun} проход отказался — причина отдельным сообщением.`);
  }
  return lines;
}

/** Правильная форма слова при числе: 1 книга, 2 книги, 5 книг. */
function wordFor(count: number, one: string, few: string, many: string): string {
  const tail = count % 100;
  if (tail >= 11 && tail <= 14) return many;
  const last = count % 10;
  if (last === 1) return one;
  if (last >= 2 && last <= 4) return few;
  return many;
}

/**
 * Заметки, которые однозначно принадлежат конкретной книге снимка.
 *
 * Совпадение по названию — дословное или по началу — говорит, чья это заметка,
 * без всякой двусмысленности. Нужно это ровно для одного: убрать подсказку по
 * автору там, где она заведомо не о том. У «Джедайских техник» и «Пути
 * джедая» автор один, и без этой прополки «Путь джедая. Поиск собственной
 * методики продуктивности.md» встал бы третьим кандидатом к «Джедайским
 * техникам» — при том, что он сам стоит отдельной строкой того же экрана.
 *
 * Русского перевода BASB это не касается и не должно: «Создай Свой «второй
 * Мозг»!…» не совпадает по названию НИ С ОДНОЙ книгой снимка, поэтому
 * подсказка по автору у него остаётся — а вместе с ней остаётся и четвёртый
 * кандидат, которого владелец обязан увидеть.
 */
function notesOwnedByBooks(
  books: readonly SnapshotBook[],
  vault: readonly VaultNote[],
): Map<string, Set<string>> {
  const owners = new Map<string, Set<string>>();
  for (const book of books) {
    for (const candidate of candidates(bookQuery(book), vault)) {
      if (candidate.authorOnly) continue;
      const known = owners.get(candidate.path) ?? new Set<string>();
      known.add(book.uuid);
      owners.set(candidate.path, known);
    }
  }
  return owners;
}

function disambiguate(
  list: readonly Candidate[],
  bookUUID: string,
  owners: ReadonlyMap<string, Set<string>>,
): Candidate[] {
  return list.filter((candidate) => {
    if (!candidate.authorOnly) return true;
    const known = owners.get(candidate.path);
    return known === undefined || known.has(bookUUID) || known.size === 0;
  });
}

/**
 * Перевыставлено, чтобы у экрана привязки был один вход.
 *
 * Задачам 13, 14 и 16 нужны и разбор заметки, и подбор: держать их импорты
 * врозь значило бы, что потребитель обязан знать, какая половина где лежит.
 */
export { identify, candidates, bookQuery };
export type { Candidate, VaultNote };
