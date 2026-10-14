/**
 * Подстановщик второй версии (план `20261008-шаблоны-плагина-план.md`, задача 2).
 *
 * Конструкции — ровно те, что владелец пишет в шаблонах Zotero Integration
 * (`Base/Templates/Zotero Book.md`): пути через точку, фильтры `format`,
 * `replace`, `capitalize`, условия с `not`/`and`/`or`, циклы с `loop.last`,
 * обрезка `{%-`/`-%}`. Прежний синтаксис сторожит `render.test.ts`.
 *
 * **Резы, каждый в одиночку:**
 * 1. `loop.last` всегда `false` (в `render`, ветка `for`) — краснеет «коллекции
 *    через запятую без хвоста»;
 * 2. `atLine` теряет номер строки — краснеет «ошибка называет строку»;
 * 3. обрезка `-%}` не срезает перевод строки — краснеет «обрезка справа -%}
 *    съедает и перевод строки» (первой редакцией рез оставался зелёным).
 */
import { describe, expect, test } from "vitest";
import { TemplateError, renderTemplate, type TemplateScope } from "../src/render/template";
import { panelWords } from "../src/ui/words";

const RU = panelWords("ru").pass;

function scope(values: TemplateScope["values"], fields: Record<string, string> = {}): TemplateScope {
  return { fields, lists: {}, values };
}

describe("подстановщик второй версии", () => {
  test("пути через точку и длина списка", () => {
    const data = scope({ book: { title: "Атлант", tags: ["a", "b", "c"] } });
    expect(renderTemplate("{{ book.title }} — {{ book.tags.length }}", data, RU)).toBe("Атлант — 3");
  });

  test("неизвестный путь ВНУТРИ значения — пусто, как у Nunjucks", () => {
    const data = scope({ c: { name: "" } });
    expect(renderTemplate("[{{ c.name or c.data?.name }}]", data, RU)).toBe("[]");
  });

  test("фильтры: format, replace, capitalize, upper, join, default", () => {
    const data = scope({
      published: "1998-04-12",
      kind: "book",
      tag: "личная эффективность",
      tags: ["x", "y"],
      empty: "",
    });
    const out = renderTemplate(
      [
        '{{ published | format("YYYY") }}',
        '{{ published | format("DD.MM.YYYY") }}',
        "{{ kind | capitalize }}",
        '{{ tag | replace(" ", "_") }}',
        "{{ tag | upper }}",
        '{{ tags | join(" · ") }}',
        '{{ empty | default("—") }}',
      ].join("\n"),
      data,
      RU,
    );
    expect(out).toBe(["1998", "12.04.1998", "Book", "личная_эффективность", "ЛИЧНАЯ ЭФФЕКТИВНОСТЬ", "x · y", "—"].join("\n"));
  });

  // Приёмка 20261012, Н8: перенос строки в аргументе `replace` писался в файл
  // живым переносом; теперь строковый литерал знает `\n`, `\t`, `\"`, `\\`.
  test("экранирование в строковых литералах — как у Nunjucks", () => {
    const data = scope({ name: "Иван\nПетров", quoted: 'a"b' });
    expect(renderTemplate('{{ name | replace("\\n", " ") }}', data, RU)).toBe("Иван Петров");
    expect(renderTemplate("{{ quoted | replace(\"\\\"\", \"'\") }}", data, RU)).toBe("a'b");
    expect(renderTemplate('{{ name | replace("\\\\", "/") }}', data, RU)).toBe("Иван\nПетров");
  });

  test("год строкой остаётся годом", () => {
    expect(renderTemplate('{{ y | format("YYYY") }}', scope({ y: "1998" }), RU)).toBe("1998");
    expect(renderTemplate('{{ y | format("YYYY") }}', scope({ y: "весна" }), RU)).toBe("весна");
  });

  test("if / elif / else с not, and, ==", () => {
    const t = '{% if not tags %}нет{% elif kind == "article" and url %}статья{% else %}книга{% endif %}';
    expect(renderTemplate(t, scope({ tags: [], kind: "book", url: "" }), RU)).toBe("нет");
    expect(renderTemplate(t, scope({ tags: ["a"], kind: "article", url: "https://x" }), RU)).toBe("статья");
    expect(renderTemplate(t, scope({ tags: ["a"], kind: "book", url: "" }), RU)).toBe("книга");
  });

  test("коллекции через запятую без хвоста — loop.last", () => {
    const t = "{% for c in collections -%}[[{{ c }}]]{% if not loop.last %}, {% endif %}{%- endfor %}";
    expect(renderTemplate(t, scope({ collections: ["Ремесло", "Фокус", "Чтение"] }), RU)).toBe(
      "[[Ремесло]], [[Фокус]], [[Чтение]]",
    );
  });

  test("loop.index и loop.first", () => {
    const t = "{% for x in xs %}{% if loop.first %}^{% endif %}{{ loop.index }}{{ x }} {% endfor %}";
    expect(renderTemplate(t, scope({ xs: ["a", "b"] }), RU)).toBe("^1a 2b");
  });

  test("обрезка как у Nunjucks: метки свойств шаблона Zotero", () => {
    // Отрезок шаблона «Zotero Book» владельца: метки по одной на строке.
    const t = ["tags:", "{%- for t in tags %}", "  - {{ t | replace(\" \", \"_\") }}", "{%- endfor %}", "after"].join("\n");
    expect(renderTemplate(t, scope({ tags: ["чтение", "личная эффективность"] }), RU)).toBe(
      ["tags:", "  - чтение", "  - личная_эффективность", "after"].join("\n"),
    );
  });

  // Рез 3 первой редакции (обрезка `-%}` только пробелов) остался зелёным: в
  // примерах выше после `-%}` не было перевода строки. Здесь он есть.
  test("обрезка справа -%} съедает и перевод строки", () => {
    const t = "{% for x in xs -%}\n  {{ x }}\n{%- endfor %}";
    expect(renderTemplate(t, scope({ xs: ["a", "b"] }), RU)).toBe("ab");
  });

  test("прежний синтаксис и новый — в одном шаблоне", () => {
    const data: TemplateScope = {
      fields: { title: "Книга" },
      lists: { annotations: [{ fields: { text: "цитата" }, lists: {} }] },
      values: { year: "2021" },
    };
    expect(renderTemplate("{{title}} ({{ year }})\n{{#annotations}}> {{text}}\n{{/annotations}}", data, RU)).toBe(
      "Книга (2021)\n> цитата\n",
    );
  });

  test("ошибка называет строку: незакрытый if", () => {
    expect(() => renderTemplate("a\nb\n{% if x %}\nc", scope({ x: "1" }), RU)).toThrow(/строка 3/);
  });

  test("ошибка называет строку: неизвестный фильтр", () => {
    expect(() => renderTemplate("a\n{{ x | шифр }}", scope({ x: "1" }), RU)).toThrow(TemplateError);
    expect(() => renderTemplate("a\n{{ x | encrypt }}", scope({ x: "1" }), RU)).toThrow(/строка 2.*encrypt/);
  });

  test("лишний endfor и неизвестное имя — ошибка, а не пустота", () => {
    expect(() => renderTemplate("{% endfor %}", scope({}), RU)).toThrow(TemplateError);
    expect(() => renderTemplate("{{ nope }}", scope({ x: "1" }), RU)).toThrow(/nope/);
  });
});
