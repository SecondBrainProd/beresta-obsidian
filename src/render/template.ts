/**
 * Свой подстановщик для шаблонов заметок и секций.
 *
 * **Почему свой, а не Nunjucks, как обещала §12 спеки.** Замер задачи 8:
 * браузерная сборка Nunjucks приносит в пакет сборку функции из строки
 * исходника и загрузчик шаблонов ПО СЕТИ поверх браузерного объекта запросов —
 * внутрь плагина, который отдельным разделом README обещает не обращаться в
 * сеть ни разу. Тряской дерева это не убирается: браузерная сборка — готовый
 * ком UMD. Вес (+253 559 байт, в 94 раза) там второстепенен; первично то, что
 * проверяющий каталога, нашедший в нашем `main.js` то и другое, будет прав.
 * Оба имени выписаны поимённо в `docs/plans/notes/20260812-замер-obsidian.md`
 * и в отчёте задачи 8, а здесь названы словами нарочно: `test/bundle.test.ts`
 * обыскивает `src/` по именам этих вызовов, и упоминание их в пояснении
 * красило бы проверку в красный на пустом месте.
 *
 * **Что он умеет — два синтаксиса в одном разборе.**
 *
 * - Прежний, первой версии: подставить значение (`{{имя}}`), повторить кусок
 *   по списку (`{{#annotations}}…{{/annotations}}`), показать кусок, если
 *   значение непусто (`{{#comment}}…{{/comment}}`). Стандартный шаблон и
 *   шаблоны людей, написанные до второй версии, рисуются байт в байт как
 *   раньше — это условие плана, а не пожелание.
 * - Второй версии (план `20261008-шаблоны-плагина-план.md`, задача 2) — в
 *   объёме, который владелец реально пишет в шаблонах Zotero Integration:
 *   пути через точку (`book.title`, `loop.last`, `tags.length`), фильтры
 *   (`format("YYYY")`, `capitalize`, `upper`, `lower`, `replace("a", "b")`,
 *   `join(", ")`, `default("…")`, `trim`, `length`, `yaml` — значение для
 *   свойств заметки в кавычках, без переводов строк), условия
 *   `{% if %}…{% elif %}…{% else %}…{% endif %}` с `not`, `and`, `or`, `==`,
 *   `!=`, циклы `{% for x in список %}…{% endfor %}` с `loop.index`,
 *   `loop.first`, `loop.last`, и обрезка пробелов `{%-`/`-%}`, `{{-`/`-}}` —
 *   по правилам Nunjucks, чтобы шаблон из Zotero давал тот же текст.
 *
 * Выражений сверх этого — вызовов, арифметики, присваиваний — нет и не будет:
 * шаблон правит человек, и каждая добавленная возможность — ещё один способ
 * уронить отрисовку заметки.
 *
 * **Чего он не делает молча — вообще ничего.** Незнакомое имя верхнего уровня,
 * незнакомый фильтр, незакрытый `if`, лишний `endfor`, `{{` без пары — всё это
 * ОШИБКА СЛОВАМИ с номером строки, а не пустая строка на месте значения. Тихая
 * пустота в шаблоне означает тихо испорченную заметку, и заметит человек это
 * через месяц. Отрисовка, которая не смогла, обязана не отрисовать ничего.
 * Исключение одно и намеренное: путь ВНУТРИ известного значения
 * (`c.data.name`, когда `data` нет) даёт пустоту, как у Nunjucks, — шаблоны
 * Zotero этим пользуются (`c.name or c.data?.name`).
 *
 * **Значение наследует отступ своей строки.** Цитата из книги бывает в
 * несколько абзацев, а живёт она внутри коллаута, где каждая строка обязана
 * начинаться с `>`. Поэтому вторая и следующие строки подставленного значения
 * получают тот же начальный отступ из `>` и пробелов, что и строка, в которую
 * значение подставляют.
 */

import { fill, panelWords, type PassWords } from "../ui/words";
import { interfaceLanguage } from "./defaults";

/** Шаблон не разобрался или просит того, чего нет. */
export class TemplateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TemplateError";
  }
}

/**
 * Значение второй версии: строка, число, признак, список или запись.
 * `undefined` — «нет значения» (пусто в выводе, ложь в условии).
 */
export type TemplateValue =
  | string
  | number
  | boolean
  | undefined
  | readonly TemplateValue[]
  | { readonly [key: string]: TemplateValue };

/**
 * Данные одного уровня шаблона.
 *
 * `fields` и `lists` — первая версия: строки и списки повторяемых кусков.
 * `values` — вторая: значения любой формы (метки списком, сведения записи,
 * даты строками ISO). Имя, заданное в нескольких местах, берётся из `fields`,
 * потом `lists`, потом `values`.
 */
export interface TemplateScope {
  readonly fields: Readonly<Record<string, string>>;
  readonly lists: Readonly<Record<string, readonly TemplateScope[]>>;
  readonly values?: Readonly<Record<string, TemplateValue>>;
}

// MARK: - Дерево

type Expr =
  | { kind: "path"; root: string; rest: string[] }
  | { kind: "literal"; value: TemplateValue }
  | { kind: "not"; operand: Expr }
  | { kind: "and" | "or"; left: Expr; right: Expr }
  | { kind: "compare"; op: "==" | "!="; left: Expr; right: Expr }
  | { kind: "filter"; operand: Expr; name: string; args: Expr[] };

type Node =
  | { kind: "text"; value: string }
  | { kind: "output"; expr: Expr; tag: string; line: number }
  | { kind: "legacy"; name: string; body: Node[]; line: number }
  | { kind: "if"; branches: { cond: Expr | undefined; body: Node[] }[]; line: number }
  | { kind: "for"; item: string; list: Expr; body: Node[]; tag: string; line: number };

type Token =
  | { kind: "text"; value: string; at: number }
  | { kind: "output"; source: string; tag: string; at: number; trimLeft: boolean; trimRight: boolean }
  | { kind: "open"; name: string; tag: string; at: number }
  | { kind: "close"; name: string; tag: string; at: number }
  | { kind: "statement"; source: string; tag: string; at: number; trimLeft: boolean; trimRight: boolean };

/** Начальный отступ строки: только `>` и пробелы, только с начала строки. */
const INDENT = /^[>\t ]*/;

/** Метки: `{{…}}` (в т. ч. `{{#имя}}`, `{{/имя}}`) и `{%…%}`. */
const TAG = /\{\{(-?)([\s\S]*?)(-?)\}\}|\{%(-?)([\s\S]*?)(-?)%\}/g;

/** Прежняя метка куска: `{{#имя}}` / `{{/имя}}`. */
const LEGACY = /^\s*([#/])\s*([A-Za-z][A-Za-z0-9]*)\s*$/;

/** Строковый литерал выражения: `\n`, `\t`, `\"`, `\'`, `\\` — как у Nunjucks; прочее как есть. */
function unescape(raw: string): string {
  return raw.replace(/\\(.)/g, (_, char: string) =>
    char === "n" ? "\n" : char === "t" ? "\t" : char,
  );
}

/**
 * Подставляет данные в шаблон.
 *
 * Каждая строка вывода обрезается справа. Это не косметика: невидимый пробел в
 * конце строки — это, во-первых, жёсткий перенос Markdown (два пробела), а
 * во-вторых, байт, который отличает две одинаковые с виду секции и потому
 * ломает сравнение «получившееся равно прежнему» в задаче 11.
 */
export function renderTemplate(
  template: string,
  scope: TemplateScope,
  say: PassWords = panelWords(interfaceLanguage()).pass,
): string {
  const lines = lineStarts(template);
  const out: string[] = [];
  const nodes = parse(template, say, lines);
  render(nodes, [scopeFrame(scope)], out, say);
  return out
    .join("")
    .split("\n")
    .map((line) => line.replace(/[\t ]+$/, ""))
    .join("\n");
}

// MARK: - Строки и ошибки

function lineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") starts.push(i + 1);
  return starts;
}

function lineOf(starts: readonly number[], at: number): number {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (starts[mid] <= at) low = mid;
    else high = mid - 1;
  }
  return low + 1;
}

function atLine(say: PassWords, line: number, message: string): TemplateError {
  return new TemplateError(fill(say.templateAtLine, { line: String(line), message }));
}

// MARK: - Разбор

function tokenize(template: string, say: PassWords, lines: readonly number[]): Token[] {
  const tokens: Token[] = [];
  let at = 0;
  TAG.lastIndex = 0;
  let match = TAG.exec(template);
  while (match !== null) {
    if (match.index > at) pushText(template.slice(at, match.index), at);
    const tag = match[0];
    if (match[2] !== undefined && match[5] === undefined) {
      const legacy = LEGACY.exec(match[2]);
      if (legacy !== null && match[1] === "" && match[3] === "") {
        tokens.push(
          legacy[1] === "#"
            ? { kind: "open", name: legacy[2], tag, at: match.index }
            : { kind: "close", name: legacy[2], tag, at: match.index },
        );
      } else {
        tokens.push({
          kind: "output",
          source: match[2],
          tag,
          at: match.index,
          trimLeft: match[1] === "-",
          trimRight: match[3] === "-",
        });
      }
    } else {
      tokens.push({
        kind: "statement",
        source: match[5] ?? "",
        tag,
        at: match.index,
        trimLeft: match[4] === "-",
        trimRight: match[6] === "-",
      });
    }
    at = match.index + tag.length;
    match = TAG.exec(template);
  }
  if (at < template.length) pushText(template.slice(at), at);
  return tokens;

  function pushText(value: string, start: number): void {
    // Обломок скобок в обычном тексте — почти всегда опечатка в имени
    // (`{{ comment }`). Пропустить её значило бы оставить человеку строку
    // «{{ comment }» прямо в заметке и ни слова о том, почему.
    const broken = /\{\{|\}\}|\{%|%\}/.exec(value);
    if (broken !== null) {
      throw atLine(
        say,
        lineOf(lines, start + broken.index),
        fill(say.templateBrokenBraces, { broken: broken[0] }),
      );
    }
    tokens.push({ kind: "text", value, at: start });
  }
}

/**
 * Метка прежнего куска, стоящая на строке одна, съедает свою строку целиком.
 *
 * Без этого правила `{{#comment}}` на отдельной строке оставляла бы после себя
 * пустую строку — а пустая строка внутри коллаута его закрывает. Правило то же,
 * что у Mustache. Метки `{% %}` ему НЕ подчиняются: у них правила Nunjucks
 * (обрезка только по `-`), иначе шаблон из Zotero дал бы другой текст.
 */
function standalone(tokens: Token[]): Token[] {
  const result = tokens.map((token) => ({ ...token }));
  for (const [at, token] of result.entries()) {
    if (token.kind !== "open" && token.kind !== "close") continue;
    const before = result[at - 1];
    const after = result[at + 1];
    const startsLine =
      at === 0 ||
      (before !== undefined && before.kind === "text" && /(^|\n)[\t ]*$/.test(before.value));
    const endsLine =
      after !== undefined && after.kind === "text" && /^[\t ]*\n/.test(after.value);
    if (!startsLine || !endsLine) continue;
    if (before !== undefined && before.kind === "text") {
      before.value = before.value.replace(/[\t ]*$/, "");
    }
    if (after.kind === "text") after.value = after.value.replace(/^[\t ]*\n/, "");
  }
  return result;
}

/** Обрезка пробелов по `-` у меток второй версии — как у Nunjucks. */
function trimmed(tokens: Token[]): Token[] {
  const result = tokens.map((token) => ({ ...token }));
  for (const [at, token] of result.entries()) {
    if (token.kind !== "output" && token.kind !== "statement") continue;
    const before = result[at - 1];
    const after = result[at + 1];
    if (token.trimLeft && before !== undefined && before.kind === "text") {
      before.value = before.value.replace(/\s+$/, "");
    }
    if (token.trimRight && after !== undefined && after.kind === "text") {
      after.value = after.value.replace(/^\s+/, "");
    }
  }
  return result;
}

function parse(template: string, say: PassWords, lines: readonly number[]): Node[] {
  const tokens = trimmed(standalone(tokenize(template, say, lines)));
  let index = 0;

  type Frame =
    | { kind: "root" }
    | { kind: "legacy"; name: string; tag: string; at: number }
    | { kind: "if"; tag: string; at: number }
    | { kind: "for"; tag: string; at: number };

  const root = parseBody({ kind: "root" });
  return root.nodes;

  /** Разбирает тело до закрывающей метки своей рамки. */
  function parseBody(frame: Frame): { nodes: Node[]; stop?: { word: string; source: string; tag: string; at: number } } {
    const nodes: Node[] = [];
    while (index < tokens.length) {
      const token = tokens[index++];
      const line = lineOf(lines, token.at);
      if (token.kind === "text") {
        nodes.push({ kind: "text", value: token.value });
      } else if (token.kind === "output") {
        nodes.push({ kind: "output", expr: parseExpr(token.source, token.tag, line), tag: token.tag, line });
      } else if (token.kind === "open") {
        const inner = parseBody({ kind: "legacy", name: token.name, tag: token.tag, at: token.at });
        nodes.push({ kind: "legacy", name: token.name, body: inner.nodes, line });
      } else if (token.kind === "close") {
        if (frame.kind !== "legacy") {
          throw atLine(
            say,
            line,
            fill(say.templateUnopened, { closing: `{{/${token.name}}}`, opening: `{{#${token.name}}}` }),
          );
        }
        if (frame.name !== token.name) {
          throw atLine(
            say,
            line,
            fill(say.templateMisclosed, { opening: `{{#${frame.name}}}`, closing: `{{/${token.name}}}` }),
          );
        }
        return { nodes };
      } else {
        const source = token.source.trim();
        const word = /^[a-z]+/.exec(source)?.[0] ?? "";
        if (word === "if") {
          nodes.push(parseIf(source.slice(2), token.tag, token.at, line));
        } else if (word === "for") {
          nodes.push(parseFor(source.slice(3), token.tag, token.at, line));
        } else if (word === "elif" || word === "else" || word === "endif" || word === "endfor") {
          const expects =
            (frame.kind === "if" && word !== "endfor") || (frame.kind === "for" && word === "endfor");
          if (!expects) throw atLine(say, line, fill(say.templateUnexpectedTag, { tag: token.tag }));
          return { nodes, stop: { word, source: source.slice(word.length), tag: token.tag, at: token.at } };
        } else {
          throw atLine(say, line, fill(say.templateBadTag, { tag: token.tag }));
        }
      }
    }
    if (frame.kind === "legacy") {
      throw atLine(say, lineOf(lines, frame.at), fill(say.templateUnclosed, { opening: frame.tag }));
    }
    if (frame.kind === "if" || frame.kind === "for") {
      throw atLine(
        say,
        lineOf(lines, frame.at),
        fill(say.templateUnclosedStatement, {
          tag: frame.tag,
          closing: frame.kind === "if" ? "{% endif %}" : "{% endfor %}",
        }),
      );
    }
    return { nodes };
  }

  function parseIf(condSource: string, tag: string, at: number, line: number): Node {
    const branches: { cond: Expr | undefined; body: Node[] }[] = [];
    let cond: Expr | undefined = parseExpr(condSource, tag, line);
    for (;;) {
      const part = parseBody({ kind: "if", tag, at });
      branches.push({ cond, body: part.nodes });
      const stop = part.stop!;
      if (stop.word === "endif") break;
      const stopLine = lineOf(lines, stop.at);
      if (stop.word === "elif") {
        cond = parseExpr(stop.source, stop.tag, stopLine);
      } else {
        if (branches.some((branch) => branch.cond === undefined)) {
          throw atLine(say, stopLine, fill(say.templateUnexpectedTag, { tag: stop.tag }));
        }
        cond = undefined;
      }
    }
    return { kind: "if", branches, line };
  }

  function parseFor(rest: string, tag: string, at: number, line: number): Node {
    const shape = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s+in\s+([\s\S]+)$/.exec(rest);
    if (shape === null) throw atLine(say, line, fill(say.templateBadTag, { tag }));
    const list = parseExpr(shape[2], tag, line);
    const part = parseBody({ kind: "for", tag, at });
    return { kind: "for", item: shape[1], list, body: part.nodes, tag, line };
  }

  // MARK: - Выражения

  function parseExpr(source: string, tag: string, line: number): Expr {
    const lexemes = lex(source, tag, line);
    let at = 0;
    const expr = orExpr();
    if (at < lexemes.length) fail(`«${lexemes.slice(at).join(" ")}»`);
    return expr;

    function fail(reason: string): never {
      throw atLine(say, line, fill(say.templateBadExpression, { tag, reason }));
    }
    function peek(): string | undefined {
      return lexemes[at];
    }
    function take(expected?: string): string {
      const lexeme = lexemes[at];
      if (lexeme === undefined) fail("…");
      if (expected !== undefined && lexeme !== expected) fail(`«${lexeme}» → «${expected}»`);
      at++;
      return lexeme;
    }
    function orExpr(): Expr {
      let left = andExpr();
      while (peek() === "or") {
        take();
        left = { kind: "or", left, right: andExpr() };
      }
      return left;
    }
    function andExpr(): Expr {
      let left = notExpr();
      while (peek() === "and") {
        take();
        left = { kind: "and", left, right: notExpr() };
      }
      return left;
    }
    function notExpr(): Expr {
      if (peek() === "not") {
        take();
        return { kind: "not", operand: notExpr() };
      }
      return compare();
    }
    function compare(): Expr {
      const left = filtered();
      const op = peek();
      if (op === "==" || op === "!=") {
        take();
        return { kind: "compare", op, left, right: filtered() };
      }
      return left;
    }
    function filtered(): Expr {
      let operand = primary();
      while (peek() === "|") {
        take();
        const name = take();
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) fail(`«${name}»`);
        const args: Expr[] = [];
        if (peek() === "(") {
          take();
          if (peek() !== ")") {
            args.push(orExpr());
            while (peek() === ",") {
              take();
              args.push(orExpr());
            }
          }
          take(")");
        }
        operand = { kind: "filter", operand, name, args };
      }
      return operand;
    }
    function primary(): Expr {
      const lexeme = take();
      if (lexeme === "(") {
        const inner = orExpr();
        take(")");
        return inner;
      }
      if (lexeme.startsWith('"') || lexeme.startsWith("'")) {
        // Экранирование как у Nunjucks: `\n`, `\t`, `\"`, `\'`, `\\`. Без него
        // перевод строки в аргументе `replace` писался бы в шаблон живым
        // переносом, и человек, открыв файл, видел бы оборванную строку
        // (приёмка 20261012, Н8).
        return { kind: "literal", value: unescape(lexeme.slice(1, -1)) };
      }
      if (/^\d+(\.\d+)?$/.test(lexeme)) return { kind: "literal", value: Number(lexeme) };
      if (lexeme === "true" || lexeme === "false") return { kind: "literal", value: lexeme === "true" };
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(lexeme)) fail(`«${lexeme}»`);
      const rest: string[] = [];
      while (peek() === "." || peek() === "?.") {
        take();
        const name = take();
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) fail(`«${name}»`);
        rest.push(name);
      }
      return { kind: "path", root: lexeme, rest };
    }
  }

  function lex(source: string, tag: string, line: number): string[] {
    const result: string[] = [];
    const pattern = /\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\?\.|==|!=|[A-Za-z_][A-Za-z0-9_]*|\d+(?:\.\d+)?|[.|(),])/y;
    let at = 0;
    while (at < source.length) {
      if (/^\s*$/.test(source.slice(at))) break;
      pattern.lastIndex = at;
      const match = pattern.exec(source);
      if (match === null) {
        throw atLine(
          say,
          line,
          fill(say.templateBadExpression, { tag, reason: `«${source.slice(at).trim()}»` }),
        );
      }
      result.push(match[1]);
      at = pattern.lastIndex;
    }
    if (result.length === 0) {
      throw atLine(say, line, fill(say.templateBadExpression, { tag, reason: "∅" }));
    }
    return result;
  }
}

// MARK: - Подстановка

/** Рамка имён: прежние поля и списки плюс значения второй версии. */
interface Frame {
  readonly scope?: TemplateScope;
  readonly names: Readonly<Record<string, TemplateValue>>;
}

function scopeFrame(scope: TemplateScope): Frame {
  return { scope, names: { ...(scope.values ?? {}) } };
}

/** Прежний кусок-список в значениях второй версии — список записей. */
function scopeAsValue(scope: TemplateScope): TemplateValue {
  const record: Record<string, TemplateValue> = { ...(scope.values ?? {}) };
  for (const [name, list] of Object.entries(scope.lists)) record[name] = list.map(scopeAsValue);
  for (const [name, value] of Object.entries(scope.fields)) record[name] = value;
  return record;
}

const MISSING = Symbol("missing");

function lookupRoot(name: string, frames: readonly Frame[]): TemplateValue | typeof MISSING {
  for (let i = frames.length - 1; i >= 0; i--) {
    const frame = frames[i];
    if (frame.scope !== undefined) {
      if (name in frame.scope.fields) return frame.scope.fields[name];
      if (name in frame.scope.lists) return frame.scope.lists[name].map(scopeAsValue);
    }
    if (name in frame.names) return frame.names[name];
  }
  return MISSING;
}

function knownNames(frames: readonly Frame[]): string {
  const names = new Set<string>();
  for (const frame of frames) {
    if (frame.scope !== undefined) {
      Object.keys(frame.scope.fields).forEach((name) => names.add(name));
      Object.keys(frame.scope.lists).forEach((name) => names.add(name));
    }
    Object.keys(frame.names).forEach((name) => names.add(name));
  }
  return [...names].sort().join(", ");
}

function render(nodes: readonly Node[], frames: readonly Frame[], out: string[], say: PassWords): void {
  for (const node of nodes) {
    switch (node.kind) {
      case "text":
        out.push(node.value);
        break;
      case "output":
        out.push(indented(text(evaluate(node.expr, frames, say, node.line, node.tag)), out));
        break;
      case "legacy":
        renderLegacy(node, frames, out, say);
        break;
      case "if": {
        const branch = node.branches.find(
          (candidate) =>
            candidate.cond === undefined || truthy(evaluate(candidate.cond, frames, say, node.line, "{% if %}")),
        );
        if (branch !== undefined) render(branch.body, frames, out, say);
        break;
      }
      case "for": {
        const value = evaluate(node.list, frames, say, node.line, node.tag);
        const items = Array.isArray(value) ? (value as readonly TemplateValue[]) : value === undefined ? [] : [value];
        items.forEach((item, index) => {
          const loop: TemplateValue = {
            index: index + 1,
            index0: index,
            first: index === 0,
            last: index === items.length - 1,
            length: items.length,
          };
          render(node.body, [...frames, { names: { [node.item]: item, loop } }], out, say);
        });
        break;
      }
    }
  }
}

/** Прежний кусок `{{#имя}}…{{/имя}}`: повтор по списку или показ, если непусто. */
function renderLegacy(
  node: Extract<Node, { kind: "legacy" }>,
  frames: readonly Frame[],
  out: string[],
  say: PassWords,
): void {
  for (let i = frames.length - 1; i >= 0; i--) {
    const scope = frames[i].scope;
    if (scope === undefined) continue;
    const list = scope.lists[node.name];
    if (list !== undefined) {
      for (const item of list) render(node.body, [...frames, scopeFrame(item)], out, say);
      return;
    }
    const value = scope.fields[node.name];
    if (value !== undefined) {
      // Пустое значение — кусок не рисуется целиком. У одной выписки из
      // двенадцати есть своя мысль, и одиннадцать заметок не должны получить
      // ни подзаголовка, ни разделителя, ни пустой строки под цитатой.
      if (value !== "") render(node.body, frames, out, say);
      return;
    }
  }
  const value = lookupRoot(node.name, frames);
  if (value === MISSING) {
    throw atLine(
      say,
      node.line,
      fill(say.templateUnknownName, { name: node.name, where: `{{#${node.name}}}`, known: knownNames(frames) }),
    );
  }
  if (Array.isArray(value)) {
    for (const item of value as readonly TemplateValue[]) {
      render(node.body, [...frames, { names: isRecord(item) ? item : { value: item } }], out, say);
    }
  } else if (truthy(value)) {
    render(node.body, frames, out, say);
  }
}

function evaluate(expr: Expr, frames: readonly Frame[], say: PassWords, line: number, tag: string): TemplateValue {
  switch (expr.kind) {
    case "literal":
      return expr.value;
    case "path": {
      if (expr.root === "loop" && lookupRoot("loop", frames) === MISSING) {
        throw atLine(say, line, fill(say.templateUnknownName, { name: "loop", where: tag, known: knownNames(frames) }));
      }
      const root = lookupRoot(expr.root, frames);
      if (root === MISSING) {
        throw atLine(say, line, fill(say.templateUnknownName, { name: expr.root, where: tag, known: knownNames(frames) }));
      }
      let value: TemplateValue = root;
      for (const name of expr.rest) value = member(value, name);
      return value;
    }
    case "not":
      return !truthy(evaluate(expr.operand, frames, say, line, tag));
    case "and": {
      const left = evaluate(expr.left, frames, say, line, tag);
      return truthy(left) ? evaluate(expr.right, frames, say, line, tag) : left;
    }
    case "or": {
      const left = evaluate(expr.left, frames, say, line, tag);
      return truthy(left) ? left : evaluate(expr.right, frames, say, line, tag);
    }
    case "compare": {
      const same =
        text(evaluate(expr.left, frames, say, line, tag)) === text(evaluate(expr.right, frames, say, line, tag));
      return expr.op === "==" ? same : !same;
    }
    case "filter": {
      const operand = evaluate(expr.operand, frames, say, line, tag);
      const args = expr.args.map((arg) => evaluate(arg, frames, say, line, tag));
      const apply = FILTERS[expr.name];
      if (apply === undefined) {
        throw atLine(
          say,
          line,
          fill(say.templateUnknownFilter, { name: expr.name, known: Object.keys(FILTERS).sort().join(", ") }),
        );
      }
      return apply(operand, args);
    }
  }
}

function isRecord(value: TemplateValue): value is { readonly [key: string]: TemplateValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function member(value: TemplateValue, name: string): TemplateValue {
  if (name === "length" && (typeof value === "string" || Array.isArray(value))) return value.length;
  if (isRecord(value)) return value[name];
  return undefined;
}

function truthy(value: TemplateValue): boolean {
  if (value === undefined || value === false || value === "" || value === 0) return false;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

/** Значение — в текст: список через запятую, запись — по имени, если оно есть. */
function text(value: TemplateValue): string {
  if (value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return (value as readonly TemplateValue[]).map(text).join(", ");
  const record = value as { readonly [key: string]: TemplateValue };
  return record.name !== undefined ? text(record.name) : "";
}

// MARK: - Фильтры

type Filter = (value: TemplateValue, args: readonly TemplateValue[]) => TemplateValue;

const FILTERS: Readonly<Record<string, Filter>> = {
  capitalize: (value) => {
    const s = text(value);
    return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
  },
  upper: (value) => text(value).toUpperCase(),
  lower: (value) => text(value).toLowerCase(),
  trim: (value) => text(value).trim(),
  length: (value) => (Array.isArray(value) ? value.length : text(value).length),
  replace: (value, args) => text(value).split(text(args[0])).join(text(args[1])),
  join: (value, args) =>
    Array.isArray(value)
      ? (value as readonly TemplateValue[]).map(text).join(args.length > 0 ? text(args[0]) : ", ")
      : text(value),
  default: (value, args) => (truthy(value) ? value : args[0]),
  format: (value, args) => formatDate(text(value), args.length > 0 ? text(args[0]) : "YYYY-MM-DD"),
  // Значение для YAML-шапки заметки: строка в двойных кавычках, переводы строк
  // — пробелом. Без него название статьи с чужого сайта («…\nberesta-book-id:
  // …») дописало бы в свойства заметки свои ключи (проверка безопасности
  // 20261008). Кавычки JSON — законная строка YAML.
  yaml: (value) => JSON.stringify(text(value).replace(/[\r\n\u2028\u2029]+/g, " ")),
  // Ссылка Obsidian `[[имя]]` из ЧУЖОГО имени (автор, пришедший со страницы):
  // без символов, которые закрывают или переадресуют ссылку. Ставится ПЕРЕД
  // `yaml` — тот уже даёт законную строку в кавычках (проверка безопасности
  // 20261014: автор с обратной косой на конце ломал шапку целиком).
  wikilink: (value) => `[[${text(value).replace(/[[\]|#^\\\r\n\u2028\u2029]+/g, " ").trim()}]]`,
  // Текст ссылки Markdown `[…](…)`: ВСЯ пунктуация ASCII экранирована обратной
  // косой (CommonMark это позволяет для любой), переводы строк — пробелом. Без
  // него название статьи с чужого сайта закрывало ссылку и дописывало в
  // заметку свой Markdown, а `<img …>` или `<iframe>` — свой HTML, который
  // Obsidian рисует (проверка безопасности 20261014, дважды: первая редакция
  // экранировала только скобки).
  mdtext: (value) =>
    text(value)
      .replace(/[\r\n\u2028\u2029]+/g, " ")
      .replace(/[!-/:-@[-`{-~]/g, "\\$&"),
  // Адрес ссылки Markdown: только http, https, mailto — прочее пусто; пробелы,
  // скобки, угловые скобки и переводы строк закодированы, чтобы адрес не
  // закрывал ссылку.
  mdurl: (value) => {
    const raw = text(value).replace(/[\r\n\u2028\u2029\t]+/g, "").trim();
    if (!/^(https?|mailto):/i.test(raw)) return "";
    return raw.replace(/[ ()<>]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  },
};

/**
 * Дата по образцу `YYYY`, `YY`, `MM`, `M`, `DD`, `D`, `HH`, `mm`.
 *
 * Разбирает ISO (`2026-10-08`, `2026-10-08T12:30:00Z`) и `ГГГГММДД`. Не
 * разобралась — значение как есть: год, записанный в карточке строкой «1998»,
 * должен остаться «1998», а не пропасть.
 */
function formatDate(value: string, pattern: string): string {
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(value);
  const compact = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
  const yearOnly = /^(\d{4})$/.exec(value);
  const parts = iso ?? compact;
  if (parts === null && yearOnly === null) return value;
  const year = parts?.[1] ?? yearOnly![1];
  const month = parts?.[2] ?? "01";
  const day = parts?.[3] ?? "01";
  const hour = iso?.[4] ?? "00";
  const minute = iso?.[5] ?? "00";
  return pattern.replace(/YYYY|YY|MM|M|DD|D|HH|mm/g, (token) => {
    switch (token) {
      case "YYYY":
        return year;
      case "YY":
        return year.slice(2);
      case "MM":
        return month;
      case "M":
        return String(Number(month));
      case "DD":
        return day;
      case "D":
        return String(Number(day));
      case "HH":
        return hour;
      default:
        return minute;
    }
  });
}

/** Многострочное значение получает отступ той строки, куда его ставят. */
function indented(value: string, out: string[]): string {
  if (!value.includes("\n")) return value;
  const written = out.join("");
  const lineStart = written.lastIndexOf("\n") + 1;
  const indent = INDENT.exec(written.slice(lineStart))![0];
  return value.split("\n").join(`\n${indent}`);
}
