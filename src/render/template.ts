/**
 * Крошечный подстановщик для шаблона секции.
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
 * **Что этот подстановщик УМЕЕТ — ровно три вещи.** Подставить значение
 * (`{{имя}}`), повторить кусок по списку (`{{#annotations}}…{{/annotations}}`)
 * и показать кусок, если значение непусто (`{{#comment}}…{{/comment}}`).
 * Выражений, вызовов, арифметики и условий «если не» здесь нет и не будет:
 * шаблон правит человек в поле настроек, и каждая добавленная возможность —
 * это ещё один способ уронить отрисовку заметки.
 *
 * **Чего он не делает молча — вообще ничего.** Незнакомое имя, незакрытый
 * кусок, лишняя закрывающая скобка, `{{` без пары — всё это ОШИБКА СЛОВАМИ, а
 * не пустая строка на месте значения. Причина прямая: тихая пустота в шаблоне
 * означает тихо испорченную секцию в заметке человека, и заметит он это через
 * месяц. Отрисовка, которая не смогла, обязана не отрисовать ничего — тогда
 * задача 11 не получит текста, и записи не произойдёт.
 *
 * **Значение наследует отступ своей строки.** Цитата из книги бывает в
 * несколько абзацев, а живёт она внутри коллаута, где каждая строка обязана
 * начинаться с `>`. Поэтому вторая и следующие строки подставленного значения
 * получают тот же начальный отступ из `>` и пробелов, что и строка, в которую
 * значение подставляют. Без этого правила первая же двухабзацная цитата
 * разваливала бы коллаут пополам, и половина машинного блока оказывалась бы в
 * зоне человека.
 */

/** Шаблон не разобрался или просит того, чего нет. */
export class TemplateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TemplateError";
  }
}

/**
 * Данные одного уровня шаблона: простые значения и списки повторяемых кусков.
 *
 * Значения — только строки. Ни чисел, ни `null`, ни `undefined`: подстановщик
 * не должен решать, как выглядит отсутствующее число, — это решает тот, кто
 * собирает данные, и решает один раз явно.
 */
export interface TemplateScope {
  readonly fields: Readonly<Record<string, string>>;
  readonly lists: Readonly<Record<string, readonly TemplateScope[]>>;
}

type Node =
  | { kind: "text"; value: string }
  | { kind: "field"; name: string }
  | { kind: "block"; name: string; body: Node[] };

type Token =
  | { kind: "text"; value: string }
  | { kind: "field"; name: string }
  | { kind: "open"; name: string }
  | { kind: "close"; name: string };

/** Одна метка шаблона: `{{имя}}`, `{{#имя}}`, `{{/имя}}`. */
const TAG = /\{\{\s*([#/]?)\s*([A-Za-z][A-Za-z0-9]*)\s*\}\}/g;

/** Начальный отступ строки: только `>` и пробелы, только с начала строки. */
const INDENT = /^[>\t ]*/;

/**
 * Подставляет данные в шаблон.
 *
 * Каждая строка вывода обрезается справа. Это не косметика: невидимый пробел в
 * конце строки — это, во-первых, жёсткий перенос Markdown (два пробела), а
 * во-вторых, байт, который отличает две одинаковые с виду секции и потому
 * ломает сравнение «получившееся равно прежнему» в задаче 11. Строка `>` с
 * пробелом на конце и строка `>` — один и тот же коллаут и разные байты.
 */
export function renderTemplate(template: string, scope: TemplateScope): string {
  const out: string[] = [];
  render(parse(template), scope, out);
  return out
    .join("")
    .split("\n")
    .map((line) => line.replace(/[\t ]+$/, ""))
    .join("\n");
}

// MARK: - Разбор

function parse(template: string): Node[] {
  const tokens = standalone(tokenize(template));
  const root: Node[] = [];
  const stack: { name: string; body: Node[] }[] = [];
  let current = root;

  for (const token of tokens) {
    if (token.kind === "text") {
      current.push({ kind: "text", value: token.value });
    } else if (token.kind === "field") {
      current.push({ kind: "field", name: token.name });
    } else if (token.kind === "open") {
      const body: Node[] = [];
      current.push({ kind: "block", name: token.name, body });
      stack.push({ name: token.name, body });
      current = body;
    } else {
      const open = stack.pop();
      if (open === undefined) {
        throw new TemplateError(
          `в шаблоне есть «{{/${token.name}}}», а открывающего «{{#${token.name}}}» нет`,
        );
      }
      if (open.name !== token.name) {
        throw new TemplateError(
          `в шаблоне «{{#${open.name}}}» закрыт как «{{/${token.name}}}» — ` +
            "куски должны закрываться в том же порядке, в каком открыты",
        );
      }
      current = stack.length === 0 ? root : stack[stack.length - 1].body;
    }
  }

  if (stack.length > 0) {
    throw new TemplateError(
      `в шаблоне не закрыт кусок «{{#${stack[stack.length - 1].name}}}»`,
    );
  }
  return root;
}

function tokenize(template: string): Token[] {
  const tokens: Token[] = [];
  let at = 0;
  TAG.lastIndex = 0;
  let match = TAG.exec(template);
  while (match !== null) {
    if (match.index > at) push(template.slice(at, match.index));
    const sigil = match[1];
    const name = match[2];
    tokens.push(
      sigil === "#"
        ? { kind: "open", name }
        : sigil === "/"
          ? { kind: "close", name }
          : { kind: "field", name },
    );
    at = match.index + match[0].length;
    match = TAG.exec(template);
  }
  if (at < template.length) push(template.slice(at));
  return tokens;

  function push(value: string): void {
    // Обломок скобок в обычном тексте — почти всегда опечатка в имени
    // (`{{ comment }`, `{{чужое-имя}}`). Пропустить её значило бы оставить
    // человеку строку «{{ comment }» прямо в заметке и ни слова о том, почему.
    const broken = value.match(/\{\{|\}\}/);
    if (broken !== null) {
      throw new TemplateError(
        `в шаблоне есть «${broken[0]}» без пары — метка пишется «{{имя}}», ` +
          "«{{#имя}}» или «{{/имя}}», имя из латинских букв и цифр",
      );
    }
    tokens.push({ kind: "text", value });
  }
}

/**
 * Метка куска, стоящая на строке одна, съедает свою строку целиком.
 *
 * Без этого правила `{{#comment}}` на отдельной строке оставляла бы после себя
 * пустую строку — а пустая строка внутри коллаута его закрывает. То есть
 * шаблон, выглядящий опрятно, разваливал бы вёрстку, и понять почему было бы
 * нечем. Правило то же, что у Mustache, и по той же причине.
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
    if (after.kind === "text") {
      after.value = after.value.replace(/^[\t ]*\n/, "");
    }
  }
  return result;
}

// MARK: - Подстановка

function render(nodes: readonly Node[], scope: TemplateScope, out: string[]): void {
  for (const node of nodes) {
    if (node.kind === "text") {
      out.push(node.value);
      continue;
    }
    if (node.kind === "field") {
      out.push(indented(lookupField(node.name, scope), out));
      continue;
    }

    const list = scope.lists[node.name];
    if (list !== undefined) {
      for (const item of list) render(node.body, item, out);
      continue;
    }
    const value = scope.fields[node.name];
    if (value === undefined) {
      throw new TemplateError(unknownName(node.name, scope, `{{#${node.name}}}`));
    }
    // Пустое значение — кусок не рисуется целиком. Вот здесь и живёт
    // вырождение шаблона: у одной выписки из двенадцати есть своя мысль, и
    // одиннадцать заметок не должны получить ни подзаголовка, ни разделителя,
    // ни пустой строки под цитатой.
    if (value !== "") render(node.body, scope, out);
  }
}

function lookupField(name: string, scope: TemplateScope): string {
  const value = scope.fields[name];
  if (value === undefined) throw new TemplateError(unknownName(name, scope, `{{${name}}}`));
  return value;
}

function unknownName(name: string, scope: TemplateScope, where: string): string {
  const known = [...Object.keys(scope.fields), ...Object.keys(scope.lists)].sort();
  return (
    `шаблон просит «${name}» (${where}), а такого значения здесь нет. ` +
    `Доступны: ${known.join(", ")}`
  );
}

/** Многострочное значение получает отступ той строки, куда его ставят. */
function indented(value: string, out: string[]): string {
  if (!value.includes("\n")) return value;
  const written = out.join("");
  const lineStart = written.lastIndexOf("\n") + 1;
  const indent = INDENT.exec(written.slice(lineStart))![0];
  return value.split("\n").join(`\n${indent}`);
}
