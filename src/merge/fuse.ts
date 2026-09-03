/**
 * Зона машины: блоки `^hl-…` и правило «по хешам, без разбора смысла».
 *
 * **Единица владения — блок с якорем.** Плагин помнит хеш текста, который он
 * **последним записал** для каждого якоря. Совпал — блок наш, перерисовываем.
 * Не совпал — это правка человека: блок замораживается навсегда, а если в
 * приложении текст тоже изменился, сверху появляется свёрнутое предупреждение
 * с новой версией. Никакого разбора смысла, только сравнение хешей — разбор
 * смысла и есть то самое угадывание, ради отказа от которого обмен сделан
 * односторонним.
 *
 * **Отпечаток лежит в самой заметке; `data.json` — второй эшелон.** Служебная
 * строка `%% beresta:hash hl-… 1a2b… %%` стоит первой строкой блока и несёт
 * отпечаток того, что мы записали последним. До 20260901 этот отпечаток жил
 * только в `data.json`, и жил он там по ПУТИ заметки — то есть умирал от
 * переименования заметки, от переустановки плагина и от второго Мака. Дальше
 * заметка попадала в ветку `unknown-origin` и замерзала НАВСЕГДА: восстановить
 * владение было нечем. Два других адреса — привязка книги во frontmatter и
 * якорь блока — лежат в файле и переживают всё; отпечаток был третьим и
 * единственным, кто этого не умел.
 *
 * **Почему `%%`, а не `<!--…-->`.** Это собственный комментарий Obsidian: в
 * режиме чтения он не показывается вовсе, а человек уже знает эту форму по
 * маркерам зоны (`%% beresta:begin %%`) — то есть видит машинное как машинное
 * и не стирает его между делом. Сосед по цеху решает ту же задачу иначе —
 * spaced-repetition дописывает `<!--SR:!2021-08-20,13,290-->` в КОНЕЦ строки
 * карточки, — и оба его хода нам не годятся: HTML-комментарий Obsidian прячет
 * не всюду, а приписка в конец строки меняет ту самую строку, которую человек
 * читает, и попадает в цитату при встраивании `![[Заметка#^hl-…]]`.
 *
 * **Отпечаток не отпечатывает сам себя.** Сверяется текст блока БЕЗ служебной
 * строки и без нашего предупреждения — иначе первая же запись меняла бы то,
 * что она только что посчитала, и «три прохода подряд не меняют ни байта»
 * стало бы неверным по устройству.
 *
 * **Своя строка перед блоком, а не приписка к якорю.** Якорь `^hl-…` обязан
 * стоять на строке один: замер задачи 2 показал, что так он указывает на
 * коллаут целиком, а `![[Заметка#^hl-…]]` встраивает цитату. Допиши к нему
 * что угодно — и адресом станет сама эта строка, то есть пустое место.
 *
 * **Заморозка навсегда — это устройство, а не решение случая.** Память о
 * замороженном блоке не обновляется: хеш в `data.json` остаётся прежним,
 * поэтому следующий проход снова видит расхождение и снова не трогает блок.
 * Обратный ход тоже есть и тоже бесплатный: вернул человек текст к нашему
 * последнему — хеши сошлись, блок снова наш.
 *
 * **Неизвестное происхождение = заморозка.** Якорь в заметке есть, ни
 * служебной строки при нём, ни записи в памяти (заметку писала сборка плагина
 * до 20260901, а память с тех пор потерялась) — блок не трогается. Обратное
 * правило («не помню — значит мой») означало бы, что потеря `data.json` даёт
 * право переписать текст человека. Случай этот теперь редкий и лечится сам:
 * первая же запись в заметку ставит служебные строки всем блокам, которые мы
 * ещё узнаём по памяти.
 *
 * **Заголовок секции.** Всё, что стоит внутри маркеров до первого блока, —
 * заголовок; он тоже машинный и живёт по тому же правилу хеша. Граница
 * «заголовок / первый блок» — первая пустая строка перед первым якорем: в
 * отрисовке задачи 10 заголовок ровно один строкой, за ним пустая, за ней
 * коллаут. Написал человек внутри заголовка абзац через пустую строку — хвост
 * абзаца уедет в первый блок и заморозит его. Это громко и ничего не портит, а
 * вот угадывать границу иначе — значит либо задвоить заголовок, либо съесть
 * первую цитату.
 *
 * **Известное ограничение: у заголовка служебной строки нет.** Его отпечаток
 * по-прежнему живёт только в `data.json`, поэтому переименование заметки
 * замораживает одну строку — ту, где написано «## Выписки из Beresta». Цена
 * этому — заголовок, который перестал обновляться; цена служебной строки перед
 * ним — она встала бы первой строкой секции, у всех на виду, ради строки,
 * которая не менялась ни разу с задачи 10.
 *
 * **Известное ограничение: две книги в одной секции.** Задача 12 разрешает
 * привязать к заметке две книги, и тогда внутри одной пары маркеров стоят два
 * тела с двумя заголовками. Второй заголовок границей не признаётся (он не
 * перед ПЕРВЫМ якорем) и уезжает в текст следующего блока. Пока порядок
 * выписок во второй книге не меняется, это ничего не значит; появление
 * выписки, встающей во второй книге первой, задвоит её заголовок. Задвоенный
 * заголовок виден глазом и ничего не портит, но лечится это не здесь, а в
 * задаче 14 — своей парой маркеров на книгу либо телом без заголовка.
 */

import { sha256Hex } from "../snapshot/sha256";
import { ANCHOR_LINE } from "./zones";

/** Начало нашего предупреждения о расхождении. По нему же оно и опознаётся. */
export const WARNING_HEAD = "> [!warning]- Beresta: в приложении текст изменился";

const WARNING_LINE = /^>[\t ]*\[!warning\]-[\t ]*Beresta/;
const BLANK_LINE = /^[\t \r]*$/;

/**
 * Служебная строка с отпечатком блока: `%% beresta:hash hl-… 1a2b… %%`.
 *
 * Отступ и лишние пробелы внутри разрешены — комментарий правят руками, а
 * чужая разметка переносит строки как ей удобно; строгость здесь означала бы
 * потерянное владение из-за пробела.
 */
const PRINT_LINE = /^[\t ]*%%[\t ]*beresta:hash[\t ]+(hl-\S+)[\t ]+([0-9a-f]+)[\t ]*%%[\t \r]*$/;

/**
 * Сколько знаков отпечатка уезжает в заметку.
 *
 * Не все 64: строка стоит в файле человека, а вопрос, на который она отвечает,
 * один — «этот ли текст мы записали последним». Столкновение шестнадцати
 * шестнадцатеричных знаков (64 бита) на двух вариантах ОДНОГО блока — это не
 * риск модели, а её отсутствие; в `data.json` при этом лежит полный хеш, и
 * второй эшелон ничего не теряет.
 */
const PRINT_LENGTH = 16;

/** Блок с якорем: строки от предыдущего якоря до своего, якорь последней. */
export interface Block {
  readonly anchor: string;
  readonly lines: readonly string[];
}

/** Середина секции, разобранная на части. */
export interface InnerSplit {
  readonly head: readonly string[];
  readonly blocks: readonly Block[];
  readonly tail: readonly string[];
}

/**
 * Что плагин записал последним — память между проходами.
 *
 * **Второй эшелон, а не единственный.** Первым спрашивается сама заметка: у
 * блока, при котором стоит служебная строка `%% beresta:hash … %%`, ответ уже
 * есть, и сюда слияние не заглядывает. Эта память отвечает за блоки, записанные
 * сборками до 20260901, и за них же перестаёт отвечать, как только заметку
 * запишут заново.
 */
export interface KnownSection {
  /** Якорь → отпечаток текста блока, который мы записали последним. */
  readonly blocks: Readonly<Record<string, string>>;
  /** Отпечаток заголовка секции. Пусто — заголовок писали не мы. */
  readonly head?: string | undefined;
}

/** Расхождение, о котором обязан узнать человек. */
export interface MergeConflict {
  /** Якорь блока; для заголовка секции — пусто. */
  readonly anchor: string;
  readonly kind: "edited" | "edited-and-changed" | "unknown-origin" | "gone-in-app" | "head";
  readonly message: string;
}

export interface FuseInput {
  readonly previous: InnerSplit;
  readonly rendered: InnerSplit;
  readonly known: KnownSection;
  /** Якоря, найденные в зоне человека: цитату оттуда не возвращаем. */
  readonly outside: ReadonlySet<string>;
}

export interface FuseResult {
  readonly inner: string[];
  readonly conflicts: MergeConflict[];
  /** Якоря, убранные этим проходом: в приложении их больше нет. */
  readonly removed: string[];
  /** Якоря, которые человек унёс из секции в свой текст. */
  readonly withdrawn: string[];
  /** Якоря, которые человек удалил и которые мы не воскрешаем. */
  readonly deleted: string[];
  /** Сколько блоков было в заметке до прохода — знаменатель предохранителя. */
  readonly previousCount: number;
  /** Что запомнить, если запись состоится. */
  readonly known: KnownSection;
}

/**
 * Разбирает середину секции на заголовок, блоки и хвост.
 *
 * Сборка обратно (`assembleInner`) обязана дать ту же середину, что нарисовала
 * задача 10, — иначе первый же проход переписал бы файл на ровном месте, а
 * второй переписал бы обратно.
 */
export function splitInner(lines: readonly string[]): InnerSplit {
  const anchors: number[] = [];
  lines.forEach((line, index) => {
    if (ANCHOR_LINE.test(line)) anchors.push(index);
  });
  if (anchors.length === 0) {
    return { head: trimBlank(lines), blocks: [], tail: [] };
  }

  const first = anchors[0]!;
  let headEnd = -1;
  for (let index = 0; index < first; index += 1) {
    if (BLANK_LINE.test(lines[index] ?? "")) {
      headEnd = index;
      break;
    }
  }
  const head = headEnd < 0 ? [] : trimBlank(lines.slice(0, headEnd));
  let start = headEnd < 0 ? 0 : headEnd + 1;

  const blocks: Block[] = [];
  for (const at of anchors) {
    const body = trimBlank(lines.slice(start, at + 1));
    const anchor = ANCHOR_LINE.exec(lines[at] ?? "")![1]!;
    blocks.push({ anchor, lines: body });
    start = at + 1;
  }
  return { head, blocks, tail: trimBlank(lines.slice(start)) };
}

/** Собирает середину обратно: части через одну пустую строку. */
export function assembleInner(split: InnerSplit): string[] {
  const parts = [split.head, ...split.blocks.map((block) => block.lines), split.tail].filter(
    (part) => part.length > 0,
  );
  const lines: string[] = [];
  parts.forEach((part, index) => {
    if (index > 0) lines.push("");
    lines.push(...part);
  });
  return lines;
}

/** Отпечаток строк — та же SHA-256, что сверяет осколки снимка. */
export function hashLines(lines: readonly string[]): string {
  return sha256Hex(new TextEncoder().encode(lines.join("\n")));
}

/**
 * Служебная строка блока — то, чем заметка сама помнит, что этот блок наш.
 *
 * Ставится перед текстом блока, а не после: якорь `^hl-…` обязан остаться
 * последней строкой и стоять на ней один.
 */
export function printLineFor(anchor: string, lines: readonly string[]): string {
  return `%% beresta:hash ${anchor} ${hashLines(lines).slice(0, PRINT_LENGTH)} %%`;
}

/** Блок заметки, разобранный на служебное и человеческое. */
interface Marked {
  /** Отпечаток из служебной строки. Пусто — её при блоке нет. */
  readonly print: string | undefined;
  /** Сама строка — чтобы вернуть её на место, не сочиняя заново. */
  readonly printLine: string | undefined;
  /** Текст блока без служебной строки и без нашего предупреждения. */
  readonly body: readonly string[];
}

/**
 * Отделяет служебное от человеческого.
 *
 * Служебная строка признаётся своей, только если она называет ЭТОТ якорь.
 * Чужая (человек перетащил кусок из соседнего блока) остаётся текстом: тогда
 * отпечаток по ней не сойдётся, и блок замёрзнет — то есть ошибка разбора
 * стоит замороженного блока, а не переписанного.
 */
function markOf(anchor: string, lines: readonly string[]): Marked {
  const match = PRINT_LINE.exec(lines[0] ?? "");
  if (match === null || match[1] !== anchor) {
    return { print: undefined, printLine: undefined, body: stripWarning(lines) };
  }
  return {
    print: match[2]!,
    printLine: lines[0]!,
    body: stripWarning(trimBlank(lines.slice(1))),
  };
}

/** Строки блока для записи: своя служебная строка возвращается на место. */
function withPrint(marked: Marked, lines: readonly string[]): string[] {
  return marked.printLine === undefined ? [...lines] : [marked.printLine, "", ...lines];
}

/**
 * Чей блок: наш, правленый человеком или неизвестного происхождения.
 *
 * Заметка спрашивается ПЕРВОЙ. Отпечаток при блоке значит, что мы его писали, и
 * значит это независимо от того, помнит ли `data.json` хоть что-нибудь: ровно
 * поэтому переименование заметки, переустановка плагина и второй Мак перестают
 * замораживать заметку навсегда.
 */
type Origin = "наш" | "правлен" | "неизвестен";

function originOf(marked: Marked, remembered: string | undefined): Origin {
  if (marked.print !== undefined) {
    return marked.print === hashLines(marked.body).slice(0, PRINT_LENGTH) ? "наш" : "правлен";
  }
  if (remembered === undefined) return "неизвестен";
  return remembered === hashLines(marked.body) ? "наш" : "правлен";
}

/** Те ли это байты, что мы записали последними, — тем же порядком эшелонов. */
function asWritten(
  marked: Marked,
  remembered: string | undefined,
  lines: readonly string[],
): boolean {
  if (marked.print !== undefined) {
    return marked.print === hashLines(lines).slice(0, PRINT_LENGTH);
  }
  return remembered === hashLines(lines);
}

/**
 * Наш блок для записи: служебная строка, пустая строка, отрисованный текст.
 *
 * **Пустая строка — не отступ для красоты, а замер шва 4 (20260901).** Без неё
 * `pandoc` — то самое стороннее средство, которым шов доказывает «заметка
 * читается без Obsidian и без Beresta», — приклеивает нашу строку к цитате:
 * в его разметке коллаут `> …` не начинает нового блока сразу за абзацем, и
 * весь блок вырождается в один абзац, где путь по оглавлению переносится
 * посреди слова. Obsidian в этом месте покладистее, но полагаться на разницу
 * разборщиков там, где спор снимается пустой строкой, незачем.
 */
function printed(block: Block): Block {
  return {
    anchor: block.anchor,
    lines: [printLineFor(block.anchor, block.lines), "", ...block.lines],
  };
}

/**
 * Сплавляет прежнюю середину секции с отрисованной.
 *
 * Порядок задаёт отрисовка: блоки выдаются в её порядке, а блоки, которых в
 * ней уже нет, — на своих прежних местах между ними. Так новая выписка встаёт
 * туда, где она стоит в книге, а не в конец списка.
 */
export function fuse(input: FuseInput): FuseResult {
  const { previous, rendered, known, outside } = input;

  const conflicts: MergeConflict[] = [];
  const removed: string[] = [];
  const withdrawn: string[] = [];
  const deleted: string[] = [];
  const out: Block[] = [];
  const nextBlocks: Record<string, string> = { ...known.blocks };

  // Заголовок секции — по тому же правилу хеша, что и блоки.
  let head: readonly string[];
  let nextHead: string | undefined;
  if (previous.head.length === 0) {
    head = rendered.head;
    nextHead = hashLines(rendered.head);
  } else if (known.head === undefined) {
    // Заголовок писали не мы (или память потеряна) — не трогаем и не
    // присваиваем: «не помню — значит мой» здесь означало бы переписать чужое.
    head = previous.head;
    nextHead = undefined;
  } else if (known.head === hashLines(previous.head)) {
    head = rendered.head;
    nextHead = hashLines(rendered.head);
  } else {
    head = previous.head;
    nextHead = known.head;
    conflicts.push({
      anchor: "",
      kind: "head",
      message:
        "Заголовок секции Beresta переписан вами — он остаётся вашим и больше не " +
        "обновляется. Цитаты под ним приезжают по-прежнему.",
    });
  }

  const renderedAnchors = new Set(rendered.blocks.map((block) => block.anchor));
  const previousIndex = new Map<string, number>();
  previous.blocks.forEach((block, index) => {
    if (!previousIndex.has(block.anchor)) previousIndex.set(block.anchor, index);
  });
  const paired = new Set<string>();
  const done = new Set<number>();
  let flushed = 0;

  const flushOrphansBefore = (limit: number): void => {
    for (; flushed < limit; flushed += 1) {
      if (done.has(flushed)) continue;
      const block = previous.blocks[flushed]!;
      if (renderedAnchors.has(block.anchor) && !paired.has(block.anchor)) continue;
      done.add(flushed);
      const marked = markOf(block.anchor, block.lines);
      if (originOf(marked, known.blocks[block.anchor]) === "наш") {
        // Наш блок, в приложении выписки больше нет: убираем и забываем — если
        // выписку вернут, она приедет заново.
        removed.push(block.anchor);
        delete nextBlocks[block.anchor];
        continue;
      }
      out.push({ anchor: block.anchor, lines: withPrint(marked, marked.body) });
      conflicts.push({
        anchor: block.anchor,
        kind: "gone-in-app",
        message:
          "В приложении этой выписки больше нет, но в заметке она ваша — правленая. " +
          "Блок остаётся на месте.",
      });
    }
  };

  for (const next of rendered.blocks) {
    const at = previousIndex.get(next.anchor);
    if (at === undefined) {
      if (outside.has(next.anchor)) {
        // Человек унёс цитату в свой текст. Возвращать её в секцию значит
        // сделать дубликат — самый раздражающий из отказов.
        withdrawn.push(next.anchor);
        continue;
      }
      if (known.blocks[next.anchor] !== undefined) {
        // Мы этот блок писали, а в заметке его нет: человек удалил. Остаётся
        // удалённым, и память об этом переживает проход.
        deleted.push(next.anchor);
        continue;
      }
      out.push(printed(next));
      nextBlocks[next.anchor] = hashLines(next.lines);
      continue;
    }

    flushOrphansBefore(at);
    paired.add(next.anchor);
    if (!done.has(at)) {
      done.add(at);
      fusePair(previous.blocks[at]!, next, known, nextBlocks, out, conflicts);
    }
    if (at >= flushed) flushed = at + 1;
  }
  flushOrphansBefore(previous.blocks.length);

  const tail = previous.tail.length > 0 ? previous.tail : rendered.tail;
  const inner = assembleInner({ head, blocks: out, tail });

  return {
    inner,
    conflicts,
    removed,
    withdrawn,
    deleted,
    previousCount: previous.blocks.length,
    known: { blocks: nextBlocks, head: nextHead },
  };
}

// MARK: - Внутреннее

function fusePair(
  previous: Block,
  next: Block,
  known: KnownSection,
  nextBlocks: Record<string, string>,
  out: Block[],
  conflicts: MergeConflict[],
): void {
  const marked = markOf(previous.anchor, previous.lines);
  const remembered = known.blocks[previous.anchor];
  const origin = originOf(marked, remembered);

  if (origin === "наш") {
    out.push(printed(next));
    nextBlocks[next.anchor] = hashLines(next.lines);
    return;
  }

  if (origin === "неизвестен") {
    out.push({ anchor: previous.anchor, lines: [...marked.body] });
    conflicts.push({
      anchor: previous.anchor,
      kind: "unknown-origin",
      message:
        "Этот блок Beresta не помнит: ни своей пометки при нём, ни записи в памяти " +
        "(его писала сборка плагина до 20260901, а память с тех пор потерялась). Пока " +
        "не помнит — не трогает.",
    });
    return;
  }

  const changedInApp = !asWritten(marked, remembered, next.lines);
  const lines = changedInApp
    ? withPrint(marked, [...warningFor(next), "", ...marked.body])
    : withPrint(marked, marked.body);
  out.push({ anchor: previous.anchor, lines });
  conflicts.push({
    anchor: previous.anchor,
    kind: changedInApp ? "edited-and-changed" : "edited",
    message: changedInApp
      ? "Блок правили вы, и в приложении текст тоже изменился. Ваш текст остаётся, " +
        "новая версия — в свёрнутом предупреждении над ним."
      : "Блок правили вы — он остаётся вашим и больше не перерисовывается.",
  });
}

/**
 * Предупреждение о расхождении — над текстом человека, а не под ним.
 *
 * План говорит «под ним», и это отступление названо здесь. Блок кончается
 * строкой якоря `^hl-…`, а якорь по замеру задачи 2 указывает на **предыдущий**
 * кусок разметки. Поставь предупреждение между цитатой и якорем — и
 * `![[Заметка#^hl-…]]` начнёт встраивать предупреждение вместо цитаты, а
 * переход по ссылке подсвечивать его же. Поставь после якоря — оно уедет в
 * следующий блок при разборе. Сверху обе беды отпадают, а свёрнутый коллаут
 * `[!warning]-` виден одной строкой и разворачивается по нажатию.
 */
function warningFor(next: Block): string[] {
  const body = trimBlank(next.lines.slice(0, -1));
  return [WARNING_HEAD, ...body.map((line) => (BLANK_LINE.test(line) ? ">" : `> ${line}`))];
}

/**
 * Снимает наше прежнее предупреждение — чтобы оно не накапливалось.
 *
 * «Один раз» из плана держится этим: предупреждение не дописывается к тексту,
 * а порождается заново каждый проход из текущей отрисовки. Вернулось
 * приложение к прежнему тексту — предупреждение исчезло само.
 */
export function stripWarning(lines: readonly string[]): readonly string[] {
  let from = 0;
  while (from < lines.length && BLANK_LINE.test(lines[from] ?? "")) from += 1;
  if (from >= lines.length || !WARNING_LINE.test(lines[from] ?? "")) return lines;
  let to = from;
  while (to < lines.length && (lines[to] ?? "").startsWith(">")) to += 1;
  while (to < lines.length && BLANK_LINE.test(lines[to] ?? "")) to += 1;
  return [...lines.slice(0, from), ...lines.slice(to)];
}

function trimBlank(lines: readonly string[]): string[] {
  let from = 0;
  let to = lines.length;
  while (from < to && BLANK_LINE.test(lines[from] ?? "")) from += 1;
  while (to > from && BLANK_LINE.test(lines[to - 1] ?? "")) to -= 1;
  return lines.slice(from, to);
}
