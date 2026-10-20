/**
 * Два готовых формата — «Книга» и «Статья» (план `20261008-шаблоны-плагина-план.md`,
 * задача 6; слово владельца R08 «Два готовых формата»).
 *
 * Образец — шаблоны владельца из Zotero Integration (`Base/Templates/Zotero
 * Book.md`, `Zotero Articles.md`): свойства, пустые разделы своих мыслей,
 * выписки в конце. Отличия от образца — по данным Бересты: метки — строки, а не
 * записи (`t`, а не `t.tag`); вместо «Краткого описания» издателя — мысль
 * человека о книге (описания издателя в снимке нет намеренно); выписки встают
 * местом `{{ annotations }}`, машинной секцией.
 *
 * ⚠️ Значения в шапке — ТОЛЬКО через фильтр `yaml` (проверка безопасности
 * 20261008): название статьи приходит с чужого сайта и без кавычек могло бы
 * дописать в свойства заметки свои ключи. Автор — СПИСКОМ, каждый через
 * `wikilink | yaml`; ссылка на источник в теле — `mdtext` и `mdurl` (проверка
 * безопасности 0.3.0, 20261014: обратная косая в имени автора ломала шапку,
 * название со скобками дописывало Markdown в заметку; прежняя строка
 * `"[[А]]", "[[Б]]"` у книги с соавторами законным YAML не была вовсе). Номер
 * серии — число по разбору снимка (`optionalNumber`), фильтр ему не нужен.
 *
 * Кнопка в настройках кладёт эти тексты файлами в `Templates/` хранилища и
 * заводит два формата. Существующий файл не перезаписывается никогда.
 *
 * Находки приёмки вслепую 20261012, закрытые здесь:
 * - Н1: `Серия: "…" (12)` — текст после закрывающей кавычки ломал YAML целиком,
 *   Obsidian не видел ни одного свойства, а плагин переставал узнавать
 *   привязку. Номер серии — своей строкой.
 * - Н6: над местом выписок стоял свой «### Хайлайты», а секция приносит
 *   собственный заголовок — два заголовка подряд разными словами.
 * - Н8: перенос строки в аргументе `replace` писался в файл живым переносом.
 * - Н9: у книги без адреса «Статья» давала `URL: ""` и пустую ссылку.
 * - Н2: шаблон секции формата — отдельный ФАЙЛ с циклом по выпискам, как
 *   стандартный; кнопка кладёт и его (`defaultSectionFile`), чтобы человек
 *   правил живой образец, а не писал секцию с нуля по подсказке.
 */
import type { NoteFormat } from "../settings";
import { defaultTemplate } from "./defaults";

export interface DefaultFormat {
  readonly name: string;
  readonly file: string;
  readonly folder: string;
  readonly text: string;
}

const BOOK_RU = `---
Название: {{ title | yaml }}
Автор:
{%- for a in authors %}
  - {{ a | wikilink | yaml }}
{%- endfor %}
Год издания: {{ date | format("YYYY") }}
Издательство: {{ publisher | yaml }}
{% if series %}Серия: {{ series | yaml }}
{% endif %}{% if seriesIndex %}Номер в серии: {{ seriesIndex }}
{% endif %}tags:
{%- for t in tags %}
  - {{ t | replace(" ", "_") | yaml }}
{%- endfor %}
  - source/beresta
Полки: {{ collections | join(", ") | yaml }}
---
{% if ownThought %}
> [!abstract]+ Мысль о книге
> {{ ownThought | replace("\\n", "\\n> ") }}
{% endif %}
### Книга в трёх предложениях


### Что из прочитанного я могу применить на практике


### Ключевые выводы


### Впечатления


### Как эта книга меня изменила


### Топ 3 цитат из книги


{{ annotations }}
`;

const ARTICLE_RU = `---
Название: {{ title | yaml }}
Автор: {{ authors | join(", ") | yaml }}
{% if url %}URL: {{ url | yaml }}
{% endif %}Сохранено: {{ addedAt | format("YYYY-MM-DD") }}
tags:
{%- for t in tags %}
  - {{ t | replace(" ", "_") | yaml }}
{%- endfor %}
  - source/beresta
---

{% if url %}> [!link] Источник
> [{{ title | mdtext }}]({{ url | mdurl }})

{% endif %}### О чём статья


### Что взять в работу


{{ annotations }}
`;

const BOOK_EN = `---
Title: {{ title | yaml }}
Author:
{%- for a in authors %}
  - {{ a | wikilink | yaml }}
{%- endfor %}
Year: {{ date | format("YYYY") }}
Publisher: {{ publisher | yaml }}
{% if series %}Series: {{ series | yaml }}
{% endif %}{% if seriesIndex %}Series number: {{ seriesIndex }}
{% endif %}tags:
{%- for t in tags %}
  - {{ t | replace(" ", "_") | yaml }}
{%- endfor %}
  - source/beresta
Shelves: {{ collections | join(", ") | yaml }}
---
{% if ownThought %}
> [!abstract]+ My thought on the book
> {{ ownThought | replace("\\n", "\\n> ") }}
{% endif %}
### The book in three sentences


### What I can put into practice


### Key takeaways


### Impressions


### How this book changed me


### Top 3 quotes


{{ annotations }}
`;

const ARTICLE_EN = `---
Title: {{ title | yaml }}
Author: {{ authors | join(", ") | yaml }}
{% if url %}URL: {{ url | yaml }}
{% endif %}Saved: {{ addedAt | format("YYYY-MM-DD") }}
tags:
{%- for t in tags %}
  - {{ t | replace(" ", "_") | yaml }}
{%- endfor %}
  - source/beresta
---

{% if url %}> [!link] Source
> [{{ title | mdtext }}]({{ url | mdurl }})

{% endif %}### What it is about


### What to act on


{{ annotations }}
`;

/** Готовые форматы на языке интерфейса. */
export function defaultFormats(language: string): readonly DefaultFormat[] {
  const russian = language.toLowerCase().startsWith("ru");
  return russian
    ? [
        { name: "Книга", file: "Templates/Береста Книга.md", folder: "Библиотека", text: BOOK_RU },
        { name: "Статья", file: "Templates/Береста Статья.md", folder: "Библиотека/Статьи", text: ARTICLE_RU },
      ]
    : [
        { name: "Book", file: "Templates/Beresta Book.md", folder: "Library", text: BOOK_EN },
        { name: "Article", file: "Templates/Beresta Article.md", folder: "Library/Articles", text: ARTICLE_EN },
      ];
}

/**
 * Готовый файл шаблона СЕКЦИИ выписок на языке интерфейса — стандартная секция
 * как есть: заголовок, мысль о книге, цикл по выпискам с `{{anchor}}`.
 *
 * Кладётся той же кнопкой и назначается обоим готовым форматам: шаблон блока у
 * формата — это шаблон всей секции (с циклом), и без живого образца человек
 * писал его по подсказке про «блок одной выписки» и четыре раза получал отказ
 * (приёмка 20261012, Н2).
 */
export function defaultSectionFile(language: string): { readonly file: string; readonly text: string } {
  const russian = language.toLowerCase().startsWith("ru");
  return {
    file: russian ? "Templates/Береста Секция.md" : "Templates/Beresta Section.md",
    text: defaultTemplate(russian ? "ru" : "en"),
  };
}

/** Итог установки готовых форматов: новые форматы и что с файлами шаблонов. */
export interface DefaultsInstalled {
  readonly formats: NoteFormat[];
  readonly created: string[];
  readonly kept: string[];
}

/**
 * Поставить готовые «Книга» и «Статья» — одним правилом для кнопки настроек и
 * для команды «Хайлайты книги…» (Р5 постановки 20261019).
 *
 * Файлы шаблонов кладутся, только если их нет (`createFile` отвечает, создал
 * ли): человек мог уже править свой «Книга». Формат с таким именем не
 * заводится второй раз; у существующего без шаблона секции он появляется —
 * живой образец цикла с {{anchor}} вместо подсказки (Н2 приёмки 20261012).
 */
export async function installDefaultFormats(
  current: readonly NoteFormat[],
  language: string,
  createFile: (path: string, text: string) => Promise<boolean>,
): Promise<DefaultsInstalled> {
  const created: string[] = [];
  const kept: string[] = [];
  let formats = [...current];
  const section = defaultSectionFile(language);
  ((await createFile(section.file, section.text)) ? created : kept).push(section.file);
  for (const ready of defaultFormats(language)) {
    ((await createFile(ready.file, ready.text)) ? created : kept).push(ready.file);
    if (!formats.some((one) => one.name === ready.name)) {
      formats.push({
        name: ready.name,
        noteTemplate: ready.file,
        blockTemplate: section.file,
        pathPattern: `${ready.folder}/{{title}}.md`,
      });
    } else {
      formats = formats.map((one) =>
        one.name === ready.name && one.blockTemplate === undefined ? { ...one, blockTemplate: section.file } : one,
      );
    }
  }
  return { formats, created, kept };
}
