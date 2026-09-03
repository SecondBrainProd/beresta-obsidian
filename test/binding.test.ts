import { describe, expect, test } from "vitest";

import {
  bookQuery,
  candidates,
  identify,
  type Candidate,
  type VaultNote,
} from "../src/binding/candidates";
import {
  DEFAULT_LIBRARY_FOLDER,
  applyChoices,
  bindingNoticeWords,
  bookSubtitle,
  chosenCountWords,
  describePlan,
  groupCandidates,
  moreCandidatesWords,
  newNoteAction,
  newNotePath,
  nothingFoundWords,
  planBinding,
  readBindings,
  screenIntro,
  type BindingRow,
} from "../src/binding/binding-view";
import { readBookIds } from "../src/merge/frontmatter";
import { renderBookBody, wrapSection } from "../src/render/section";
import type { Snapshot, SnapshotBook } from "../src/snapshot/model";

/**
 * Привязка книг к существующим заметкам.
 *
 * **Это самое опасное место замысла, и опасность у него не техническая.**
 * Слияние (задача 11) отвечает за то, чтобы не испортить заметку, в которую
 * пишет. Привязка отвечает за то, в КАКУЮ заметку писать, — и ошибка здесь не
 * ломает ни одного байта: 47 цитат аккуратно, без единого конфликта лягут не
 * туда. В `Библиотека/Readwise/` лежат 45 машинных заметок в ТОЙ ЖЕ разметке
 * `> [!quote]+`, и у «Building a Second Brain» кандидатов четыре: конспект
 * владельца, два экспорта Readwise и русский перевод той же книги под другим
 * названием. «Сильный кандидат» здесь означает «четыре способа ошибиться».
 *
 * **Названия в образцах — настоящие**, снятые с `Base/Библиотека/` владельца
 * и из его библиотеки Beresta (замер 20260815). Только названия, заголовки и
 * служебные поля Readwise: ни одной строки его прозы и ни одной цитаты здесь
 * нет — они в шве задачи 13, который работает на КОПИИ живой папки.
 *
 * **Почему проверка живёт в обычных тестах.** Подбор кандидатов — чистая
 * функция от списка заметок к списку кандидатов: ни `vault`, ни файловой
 * системы, ни Obsidian. Что нельзя проверить так — ляжет ли выбор владельца в
 * НАСТОЯЩИЕ заметки — меряется швом задачи 13.
 */

/** Первый кандидат списка — тот, что окажется наверху экрана. */
function top(list: readonly Candidate[]): string | undefined {
  return list[0]?.path;
}

/** Пути всех кандидатов, в том порядке, в каком их увидит владелец. */
function paths(list: readonly Candidate[]): string[] {
  return list.map((item) => item.path);
}

// MARK: - Хранилище владельца: настоящие имена, без его прозы

const LIB = DEFAULT_LIBRARY_FOLDER;

/**
 * Заметка по его собственному шаблону книги.
 *
 * Форма снята с `Джедайские техники.md` (20221025): `tags: 📖` скаляром,
 * пустой `aliases:`, `name:` и `date: YYYYMMDD HHMM` без кавычек, а в теле —
 * `**Название**:` с ПОЛНЫМ названием книги и `**Автор**:`. Полное название в
 * теле — не украшение: именно оно, а не имя файла, совпадает с тем, что стоит
 * в базе Beresta, у «Цель как проект» и «12 недель в году» — дословно.
 */
function ownNote(
  file: string,
  fields: { name: string; fullTitle?: string; author?: string; tags?: string },
): VaultNote {
  return {
    path: `${LIB}/${file}.md`,
    text: [
      "---",
      `tags: ${fields.tags ?? ""}`,
      "aliases:",
      `name: ${fields.name}`,
      "date: 20221025 1047",
      "---",
      `## ${fields.name}`,
      "",
      "**Оценка**:  🔟 из 🔟",
      `**Название**: ${fields.fullTitle ?? ""}`,
      `**Автор**:  ${fields.author === undefined ? "" : `[[${fields.author}]]`}`,
      "**Темы**:  [[Продуктивность]]",
      "",
      "---",
      "## Главная идея книги",
      "",
    ].join("\n"),
  };
}

/**
 * Заметка машинного экспорта Readwise.
 *
 * Форма снята с `Readwise/Building a Second Brain. Tiago Forte.md` дословно:
 * заголовок `## `, обложка `![rw-book-cover]`, блок `### Metadata` со своими
 * полями. Заголовки Readwise записаны С Заглавной Каждое Слово — ровно то,
 * из-за чего наивное сравнение без учёта регистра попадает именно в них.
 */
function readwiseNote(fields: {
  file: string;
  fullTitle: string;
  author: string;
  category: "books" | "articles";
  frontmatter?: boolean;
}): VaultNote {
  const head = fields.frontmatter === true ? ["---", "modified: 20240621  22:52", "---"] : [];
  return {
    path: `${LIB}/Readwise/${fields.file}.md`,
    text: [
      ...head,
      `## ${fields.file}`,
      "",
      "![rw-book-cover](https://readwise-assets.s3.amazonaws.com/static/images/article2.74d541386bbf.png)",
      "",
      "### Metadata",
      `- Author: [[${fields.author}]]`,
      `- Full Title: ${fields.fullTitle}`,
      `- Category: #${fields.category}`,
      "",
      "### Цитаты и заметки",
      "",
    ].join("\n"),
  };
}

const BASB_FULL =
  "Building a Second Brain. A Proven Method to Organize Your Digital Life and Unlock Your Creative Potential";

/** Настоящие имена файлов из `Base/Библиотека/` — те, что нас касаются. */
const VAULT: VaultNote[] = [
  // Собственные конспекты владельца.
  ownNote("Джедайские техники", {
    name: "Джедайские техники",
    fullTitle: "Джедайские техники. Как воспитать свою обезьяну, опустошить инбокс и сберечь мыслетопливо",
    author: "Максим Дорофеев",
    tags: "📖",
  }),
  ownNote("Путь джедая. Поиск собственной методики продуктивности", {
    name: "Путь джедая. Поиск собственной методики продуктивности",
    author: "Максим Дорофеев",
    tags: "📖",
  }),
  ownNote("Цель как проект", {
    name: "Цель как проект",
    fullTitle: "Цель как проект: Как успешно решать любые задачи с помощью проектного подхода ",
    author: "Антонио Ньето-Родригес",
    tags: "📖 проработать",
  }),
  ownNote("12 недель в году", {
    name: "12 недель в году",
    fullTitle: "12 недель в году. Как за 12 недель сделать больше, чем другие успевают за 12 месяцев",
    author: "Брайан Моран, Майкл Леннингтон",
  }),
  ownNote("Номер 1. Как стать лучшим в том, что ты делаешь", {
    name: "Номер 1. Как стать лучшим в том, что ты делаешь",
    fullTitle: "Номер 1. Как стать лучшим в том, что ты делаешь",
    author: "Игорь Манн",
    tags: "📖",
  }),
  ownNote("Learn More, Study Less!", {
    name: "Learn More, Study Less!",
    author: "Scott Young",
  }),
  ownNote(BASB_FULL, { name: BASB_FULL, author: "Tiago Forte" }),

  // Машинные экспорты Readwise — та же разметка цитат, чужой инструмент.
  readwiseNote({
    file: "Building a Second Brain. Tiago Forte",
    fullTitle: "Building a Second Brain",
    author: "Tiago Forte",
    category: "books",
  }),
  readwiseNote({
    file: "Building a Second Brain. vanadium23",
    fullTitle: "Building a Second Brain",
    author: "vanadium23",
    category: "articles",
  }),
  readwiseNote({
    file: "Создай Свой «второй Мозг»! Как Построить Систему Поиска И Организации Информации, Чтобы Раскрыть Ваш Креативный Потенциал. Тьяго  Форте",
    fullTitle:
      "Создай Свой «второй Мозг»! Как Построить Систему Поиска И Организации Информации, Чтобы Раскрыть Ваш Креативный Потенциал",
    author: "Тьяго  Форте",
    category: "books",
    frontmatter: true,
  }),
  // Ловушки: тот же автор, но это СТАТЬИ, а не издания той же книги.
  readwiseNote({
    file: "Don’t Stop Here. Tiago Forte",
    fullTitle: "Don’t Stop Here",
    author: "Tiago Forte",
    category: "articles",
  }),
  readwiseNote({
    file: "My Favorite Productivity Move [Second Brain Quickstart]. Tiago Forte",
    fullTitle: "My Favorite Productivity Move [Second Brain Quickstart]",
    author: "Tiago Forte",
    category: "articles",
  }),
  readwiseNote({
    file: "Джедайские Техники. Максим Дорофеев",
    fullTitle: "Джедайские Техники",
    author: "Максим Дорофеев",
    category: "books",
  }),
  // Соседи, которых подбор трогать не должен вовсе.
  readwiseNote({
    file: "Как Научиться Учиться С Помощью Второго Мозга. 4 Инструмента, 3 Апгрейда И 3 Ошибки. Сенин Николай",
    fullTitle: "Как Научиться Учиться С Помощью Второго Мозга. 4 Инструмента, 3 Апгрейда И 3 Ошибки",
    author: "Сенин Николай",
    category: "articles",
  }),
  {
    path: `${LIB}/Статьи/How People Manage Knowledge in their Second Brains (Ferreira et al., 2025).md`,
    text: ["---", "tags:", "  - PKM", "  - aiassist", "created: 20260721", "---", "## Second Brains: обзор", ""].join("\n"),
  },
];

// MARK: - Книги Beresta: настоящие названия и авторы (замер 20260815)

function book(uuid: string, title: string, authors: string[], total: number): SnapshotBook {
  return {
    uuid,
    title,
    authors,
    source: undefined,
    shard: `books/${uuid}.jsonld`,
    total,
    removedTotal: 0,
    updatedAt: "2026-08-06T16:52:40Z",
    sha256: "0".repeat(64),
    annotations: [],
    tombstones: [],
    unknown: {},
  };
}

const BASB = book(
  "D464F49F-A071-5D6A-856E-AA2B0DE92D86",
  "Building a Second Brain: A Proven Method to Organize Your Digital Life and Unlock Your Creative Potential",
  ["Tiago Forte"],
  47,
);

const JEDI = book("F72960D4-16D5-51ED-B82F-2E6FC534C7E8", "Джедайские техники", ["Максим Дорофеев"], 81);

const BOOKS: SnapshotBook[] = [
  JEDI,
  book("A105F29D-A380-5226-8353-3A23B26FE4E6", "Номер 1. Как стать лучшим в том, что ты делаешь", ["Игорь Манн"], 75),
  BASB,
  book(
    "92379205-2E3E-55E1-A056-DED26A3666D7",
    "Человек покупающий и продающий. Как законы эволюции влияют на психологию потребителя и при чем здесь Люк Скайуокер",
    ["Николай Викторович Молчанов"],
    40,
  ),
  book(
    "FB245DC0-A0CD-5A58-8965-01EDEAB37266",
    "Цель как проект: Как успешно решать любые задачи с помощью проектного подхода",
    ["Антонио Ньето-Родригес"],
    30,
  ),
  book("C6EFCC22-28A1-59BE-B4B4-0398727CFF0D", "Путь джедая", ["Максим Дорофеев"], 9),
  book("CB507444-F7DF-5F5E-807C-0BC68BC703F5", "The Earned Life: Lose Regret, Choose Fulfillment", ["Marshall Goldsmith", "Mark Reiter"], 4),
  book("31677F46-A2FE-5D66-B708-F2E4A2B2C251", "7 вопросов человечеству @bookinier", ["Денис Владимирович Семенихин"], 2),
  book(
    "14D633D1-1755-560F-BCDB-F0D145FC5404",
    "12 недель в году. Как за 12 недель сделать больше, чем другие успевают за 12 месяцев",
    ["Брайан Моран, Майкл Леннингтон"],
    1,
  ),
  book("674AEB07-6D34-5C2D-9BB1-CFD52CC42BD4", "Learn More, Study Less!", ["Scott Young"], 1),
];

const SNAPSHOT: Snapshot = {
  kind: "present",
  header: {
    format: "beresta-archive",
    formatVersion: 1,
    schemaVersion: "34",
    schemaMigrations: [],
    application: "Beresta",
    applicationVersion: "1.0",
    deviceId: "F1D2C3",
    generatedAt: "2026-08-15T05:06:00Z",
    unknown: {},
  },
  books: BOOKS,
  annotations: [],
  problems: [],
};

// MARK: - Подбор кандидатов

describe("подбор кандидатов", () => {
  test("три расхождения имени владельца находятся", () => {
    expect(top(candidates(bookQuery(BOOKS[4]!), VAULT))).toBe(`${LIB}/Цель как проект.md`);
    expect(top(candidates(bookQuery(BOOKS[5]!), VAULT))).toBe(
      `${LIB}/Путь джедая. Поиск собственной методики продуктивности.md`,
    );
    expect(top(candidates(bookQuery(BASB), VAULT))).toBe(`${LIB}/${BASB_FULL}.md`);
  });

  // Вырежьте признак машинной заметки — тест обязан упасть.
  test("все четыре кандидата BASB предложены, машинные — ниже", () => {
    const list = candidates(bookQuery(BASB), VAULT);
    expect(list).toHaveLength(4);
    expect(list.filter((c) => c.machineGenerated)).toHaveLength(3);
    expect(list[0]!.machineGenerated).toBe(false);
    // Поимённо, а не по количеству: три машинных, перепутанных между собой,
    // прошли бы сверку по числу и разошлись бы с жизнью молча.
    expect(paths(list)).toEqual([
      `${LIB}/${BASB_FULL}.md`,
      `${LIB}/Readwise/Building a Second Brain. Tiago Forte.md`,
      `${LIB}/Readwise/Building a Second Brain. vanadium23.md`,
      `${LIB}/Readwise/Создай Свой «второй Мозг»! Как Построить Систему Поиска И Организации Информации, Чтобы Раскрыть Ваш Креативный Потенциал. Тьяго  Форте.md`,
    ]);
  });

  // Вырежьте транслитерацию автора — тест обязан упасть.
  test("русский перевод доезжает автором через латиницу", () => {
    // «Создай Свой «второй Мозг»!…» не делит с «Building a Second Brain» ни
    // одного слова названия. Связывает их только `Тьяго  Форте` ↔ `Tiago
    // Forte`, то есть фамилия и первая буква имени после приведения к латинице.
    const list = paths(candidates(bookQuery(BASB), VAULT));
    expect(list).toContain(
      `${LIB}/Readwise/Создай Свой «второй Мозг»! Как Построить Систему Поиска И Организации Информации, Чтобы Раскрыть Ваш Креативный Потенциал. Тьяго  Форте.md`,
    );
  });

  // Вырежьте гейт рода работы — тест обязан упасть.
  test("статьи того же автора кандидатами не становятся", () => {
    // У Тьяго Форте в `Readwise/` лежат ещё две СТАТЬИ. Автор совпадает, но
    // `- Category: #articles` говорит прямо: это не издание этой книги.
    const list = paths(candidates(bookQuery(BASB), VAULT));
    expect(list).not.toContain(`${LIB}/Readwise/Don’t Stop Here. Tiago Forte.md`);
    expect(list).not.toContain(
      `${LIB}/Readwise/My Favorite Productivity Move [Second Brain Quickstart]. Tiago Forte.md`,
    );
  });

  // Вырежьте приведение регистра — тест обязан упасть.
  test("заголовок Readwise С Заглавной Каждое Слово совпадает названием дословно", () => {
    const list = candidates(bookQuery(JEDI), VAULT);
    const machine = list.find((c) => c.path.includes("/Readwise/Джедайские Техники"))!;
    // `- Full Title: Джедайские Техники` — ровно название книги, другой
    // регистр. Проверять здесь надо ПРИЧИНУ совпадения, а не факт присутствия
    // в списке: без приведения регистра эта же заметка всё равно доедет —
    // подсказкой по автору, — и проверка «она в списке и она машинная» пройдёт
    // вхолостую, ничего не сказав о регистре.
    expect(machine.reasons).toContain("title-exact");
    expect(machine.machineGenerated).toBe(true);
    // И при дословном совпадении наверх встаёт конспект, а не экспорт.
    expect(top(list)).toBe(`${LIB}/Джедайские техники.md`);
  });

  // Вырежьте источник «**Название**:» — тест обязан упасть.
  test("полное название из тела заметки даёт дословное совпадение", () => {
    // Имя файла у владельца короче названия книги («Цель как проект.md»), а
    // полное название лежит в теле строкой `**Название**:` — и совпадает с
    // базой Beresta дословно. Без этого источника осталось бы совпадение «по
    // началу»: кандидат тот же, но уверенность ниже, а на уверенности стоит
    // порядок списка.
    expect(candidates(bookQuery(BOOKS[4]!), VAULT)[0]!.reasons).toContain("title-exact");
    expect(candidates(bookQuery(BOOKS[8]!), VAULT)[0]!.reasons).toContain("title-exact");
  });

  // Вырежьте отсев служебных заголовков — тест обязан упасть.
  test("служебные заголовки Readwise названием заметки не считаются", () => {
    const russian = VAULT.find((n) => n.path.includes("Создай Свой"))!;
    const titles = identify(russian).titles.map((one) => one.value);
    expect(titles).not.toContain("Metadata");
    expect(titles).not.toContain("Цитаты и заметки");
    expect(titles).toContain(
      "Создай Свой «второй Мозг»! Как Построить Систему Поиска И Организации Информации, Чтобы Раскрыть Ваш Креативный Потенциал",
    );
  });

  test("книга без единого следа в хранилище не получает кандидатов", () => {
    expect(candidates(bookQuery(BOOKS[3]!), VAULT)).toHaveLength(0);
    expect(candidates(bookQuery(BOOKS[6]!), VAULT)).toHaveLength(0);
  });

  test("соседи по теме кандидатами не становятся", () => {
    const list = paths(candidates(bookQuery(BASB), VAULT));
    expect(list).not.toContain(
      `${LIB}/Статьи/How People Manage Knowledge in their Second Brains (Ferreira et al., 2025).md`,
    );
    expect(
      list.some((path) => path.includes("Как Научиться Учиться С Помощью Второго Мозга")),
    ).toBe(false);
  });
});

// MARK: - Признак машинной заметки

describe("признак машинной заметки", () => {
  test("каждый из трёх следов узнаётся сам по себе", () => {
    const cover = identify({
      path: "x.md",
      text: "## Заметка\n\n![rw-book-cover](https://readwise-assets.s3.amazonaws.com/a.png)\n",
    });
    expect(cover.machineGenerated).toBe(true);
    expect(cover.machineMarks).toContain("rw-book-cover");

    const metadata = identify({
      path: "x.md",
      text: "## Заметка\n\n### Metadata\n- Author: [[Кто-то]]\n- Full Title: Что-то\n",
    });
    expect(metadata.machineGenerated).toBe(true);
    expect(metadata.machineMarks).toContain("readwise-metadata");

    const foreign = identify({
      path: "x.md",
      text: "## Заметка\n\n%% Begin Waypoint %%\n- [[Раз]]\n%% End Waypoint %%\n",
    });
    expect(foreign.machineGenerated).toBe(true);
    expect(foreign.machineMarks).toContain("foreign-markers");
  });

  test("конспекты владельца машинными не считаются", () => {
    for (const note of VAULT.filter((n) => !n.path.includes("/Readwise/"))) {
      expect(identify(note).machineGenerated).toBe(false);
    }
  });

  test("наша собственная пара маркеров чужой не считается", () => {
    const ours = identify({
      path: "x.md",
      text: `## Заметка\n\n${wrapSection(["> [!quote]+ Цитата\n> Раз"])}\n`,
    });
    expect(ours.machineGenerated).toBe(false);
    expect(ours.machineMarks).toEqual([]);
  });
});

// MARK: - Запрет автоматической привязки

describe("привязка только по нажатию", () => {
  // Вырежьте запрет автопривязки — тест обязан упасть.
  test("ни одна книга не привязывается без нажатия", () => {
    const plan = planBinding(SNAPSHOT, VAULT);
    expect(plan.automatic).toHaveLength(0);
    expect(plan.awaitingUser).toHaveLength(BOOKS.length);
    for (const row of plan.awaitingUser) {
      expect(row.chosen).toBeUndefined();
    }
  });

  test("книга с единственным точным кандидатом всё равно ждёт нажатия", () => {
    const plan = planBinding(SNAPSHOT, VAULT);
    const row = plan.awaitingUser.find((r) => r.bookUUID === BOOKS[4]!.uuid);
    expect(row?.candidates).toHaveLength(1);
    expect(row?.candidates[0]?.reasons).toContain("title-exact");
    expect(row?.chosen).toBeUndefined();
    // И даже так — без выбора наружу не выходит ничего.
    expect(applyChoices(plan, new Map()).bindings.size).toBe(0);
  });

  // Вырежьте снятие неоднозначности — тест обязан упасть.
  test("заметка другой книги снимка подсказкой по автору не всплывает", () => {
    // «Джедайские техники» и «Путь джедая» — один автор. Без прополки
    // «Путь джедая…md» встал бы третьим кандидатом к «Джедайским техникам»,
    // хотя он сам стоит отдельной строкой того же экрана.
    const plan = planBinding(SNAPSHOT, VAULT);
    const jedi = plan.awaitingUser.find((r) => r.bookUUID === JEDI.uuid)!;
    expect(paths([...jedi.candidates])).not.toContain(
      `${LIB}/Путь джедая. Поиск собственной методики продуктивности.md`,
    );
    expect(jedi.candidates).toHaveLength(2);

    const path = plan.awaitingUser.find((r) => r.bookUUID === BOOKS[5]!.uuid)!;
    expect(paths([...path.candidates])).toEqual([
      `${LIB}/Путь джедая. Поиск собственной методики продуктивности.md`,
    ]);

    // А русского перевода BASB прополка не касается: он не совпадает
    // названием НИ С ОДНОЙ книгой снимка, и четвёртым кандидатом остаётся.
    const basb = plan.awaitingUser.find((r) => r.bookUUID === BASB.uuid)!;
    expect(basb.candidates).toHaveLength(4);
  });

  test("книга без кандидата не создаёт файл до подтверждения", () => {
    const plan = planBinding(SNAPSHOT, VAULT);
    const row = plan.awaitingUser.find((r) => r.bookUUID === BOOKS[3]!.uuid);
    expect(row?.candidates).toHaveLength(0);
    // Путь предложен, но это ПРЕДЛОЖЕНИЕ, а не действие.
    expect(row?.proposedPath).toBe(
      `${LIB}/Человек покупающий и продающий. Как законы эволюции влияют на психологию потребителя и при чем здесь Люк Скайуокер.md`,
    );
    expect(applyChoices(plan, new Map()).creations).toHaveLength(0);
  });

  test("выбор владельца — и только он — доходит до привязки", () => {
    const plan = planBinding(SNAPSHOT, VAULT);
    const outcome = applyChoices(
      plan,
      new Map([
        [BASB.uuid, { kind: "bind", path: `${LIB}/${BASB_FULL}.md` } as const],
        [BOOKS[3]!.uuid, { kind: "create" } as const],
      ]),
    );
    expect([...outcome.bindings.keys()]).toEqual([`${LIB}/${BASB_FULL}.md`]);
    expect(outcome.bindings.get(`${LIB}/${BASB_FULL}.md`)).toEqual([BASB.uuid]);
    expect(outcome.creations.map((c) => c.path)).toEqual([
      `${LIB}/Человек покупающий и продающий. Как законы эволюции влияют на психологию потребителя и при чем здесь Люк Скайуокер.md`,
    ]);
    // Остальные восемь книг не тронуты ничем.
    expect(outcome.untouched).toHaveLength(BOOKS.length - 2);
  });

  test("владелец вправе выбрать машинную заметку — но только сам", () => {
    const machine = `${LIB}/Readwise/Building a Second Brain. Tiago Forte.md`;
    const plan = planBinding(SNAPSHOT, VAULT);
    const outcome = applyChoices(plan, new Map([[BASB.uuid, { kind: "bind", path: machine } as const]]));
    expect(outcome.bindings.get(machine)).toEqual([BASB.uuid]);
  });
});

// MARK: - Две записи одной книги на одну заметку

describe("beresta-book-id — список", () => {
  // Вырежьте список (оставьте строку) — тест обязан упасть.
  test("две книги на одну заметку дают список из двух и одну секцию", () => {
    const plan = planBinding(SNAPSHOT, VAULT);
    const note = `${LIB}/Джедайские техники.md`;
    const outcome = applyChoices(
      plan,
      new Map([
        [JEDI.uuid, { kind: "bind", path: note } as const],
        [BOOKS[5]!.uuid, { kind: "bind", path: note } as const],
      ]),
    );
    expect(outcome.bindings.get(note)).toEqual([JEDI.uuid, BOOKS[5]!.uuid]);

    // Одна секция: два тела, одна пара маркеров (устройство задачи 10).
    const section = wrapSection([renderBookBody(JEDI, []), renderBookBody(BOOKS[5]!, [])]);
    expect(section.split("%% beresta:begin %%")).toHaveLength(2);
    expect(section.split("%% beresta:end %%")).toHaveLength(2);
  });

  test("повторная привязка той же книги дублей не плодит", () => {
    const plan = planBinding(SNAPSHOT, VAULT);
    const note = `${LIB}/Джедайские техники.md`;
    const outcome = applyChoices(
      plan,
      new Map([[JEDI.uuid, { kind: "bind", path: note } as const]]),
      // Заметка уже несёт эту книгу — второй записи в списке быть не должно.
      new Map([[note, [JEDI.uuid]]]),
    );
    expect(outcome.bindings.get(note)).toEqual([JEDI.uuid]);
  });

  test("уже привязанное из frontmatter прочитано списком", () => {
    const bound: VaultNote = {
      path: `${LIB}/Джедайские техники.md`,
      text: [
        "---",
        "tags: 📖",
        "name: Джедайские техники",
        "beresta-book-id:",
        `  - ${JEDI.uuid}`,
        `  - ${BOOKS[5]!.uuid}`,
        "---",
        "## Джедайские техники",
        "",
      ].join("\n"),
    };
    expect(readBookIds(bound.text)).toEqual([JEDI.uuid, BOOKS[5]!.uuid]);
    expect(readBindings([bound]).get(bound.path)).toEqual([JEDI.uuid, BOOKS[5]!.uuid]);
  });
});

// MARK: - Связь держится на идентификаторе

describe("имя файла после привязки не значит ничего", () => {
  test("переименованная и переложенная заметка остаётся привязанной", () => {
    const renamed: VaultNote = {
      path: "Base/Архив/2026/Дорофеев — заметки.md",
      text: ["---", "beresta-book-id:", `  - ${JEDI.uuid}`, "---", "## Что угодно", ""].join("\n"),
    };
    expect(readBindings([renamed]).get("Base/Архив/2026/Дорофеев — заметки.md")).toEqual([JEDI.uuid]);
  });

  test("уже привязанная книга в план на привязку не возвращается", () => {
    const bound: VaultNote = {
      path: "Base/Архив/2026/Дорофеев — заметки.md",
      text: ["---", "beresta-book-id:", `  - ${JEDI.uuid}`, "---", "## Что угодно", ""].join("\n"),
    };
    const plan = planBinding(SNAPSHOT, [...VAULT, bound]);
    expect(plan.awaitingUser.some((r) => r.bookUUID === JEDI.uuid)).toBe(false);
    expect(plan.alreadyBound.map((b) => b.path)).toContain("Base/Архив/2026/Дорофеев — заметки.md");
  });
});

// MARK: - Новая заметка

describe("заметка для книги без кандидата", () => {
  test("двоеточие в имени заменяется точкой, папка — по умолчанию", () => {
    expect(newNotePath(BASB.title!, DEFAULT_LIBRARY_FOLDER)).toBe(`${LIB}/${BASB_FULL}.md`);
  });

  test("знаки, запрещённые в имени файла, не уезжают в путь", () => {
    expect(newNotePath('Раз/Два: три"четыре', "Base/Библиотека")).toBe(
      "Base/Библиотека/Раз-Два. три'четыре.md",
    );
  });

  test("папка берётся из настройки, а не из константы", () => {
    expect(newNotePath("Путь джедая", "Книги/Прочитанное")).toBe("Книги/Прочитанное/Путь джедая.md");
  });
});

// MARK: - Экран привязки

describe("экран привязки", () => {
  test("показывает название, число выписок, машинных помечает, «создать новую» предлагает", () => {
    const plan = planBinding(SNAPSHOT, VAULT);
    const screen = describePlan(plan).join("\n");
    expect(screen).toContain("Building a Second Brain: A Proven Method");
    expect(screen).toContain("47 выписок");
    expect(screen).toContain("похоже на машинный экспорт");
    expect(screen).toContain("создать новую");
    // Экран не смеет утверждать, что что-то уже привязано.
    expect(screen).not.toContain("привязано автоматически");
  });

  test("у BASB на экране четыре кандидата и три пометки", () => {
    const plan = planBinding(SNAPSHOT, VAULT);
    const row = plan.awaitingUser.find((r) => r.bookUUID === BASB.uuid)!;
    const lines = describePlan({ ...plan, awaitingUser: [row], alreadyBound: [] });
    expect(lines.filter((line) => line.includes("похоже на машинный экспорт"))).toHaveLength(3);
  });

  test("подсказка по одному автору называет себя подсказкой", () => {
    const plan = planBinding(SNAPSHOT, VAULT);
    const row = plan.awaitingUser.find((r) => r.bookUUID === BASB.uuid)!;
    const lines = describePlan({ ...plan, awaitingUser: [row], alreadyBound: [] });
    const translation = lines.find((line) => line.includes("Создай Свой"))!;
    expect(translation).toContain("совпал только автор — возможно, другая книга");
    // А совпавшие названием себя подсказками не называют.
    expect(lines.find((line) => line.includes(BASB_FULL))).not.toContain("совпал только автор");
  });

  test("число выписок склоняется, а не приписывается", () => {
    const plan = planBinding(SNAPSHOT, VAULT);
    const screen = describePlan(plan).join("\n");
    expect(screen).toContain("81 выписка");
    expect(screen).toContain("47 выписок");
    expect(screen).toContain("2 выписки");
    expect(screen).toContain("1 выписка");
  });
});

// MARK: - Порядок кандидатов

describe("порядок кандидатов", () => {
  /**
   * Порядок здесь двумерный, и старшая мера — СИЛА СВЯЗИ, а не чей файл.
   *
   * До 20260818 старшей была «машинное вниз», и на живом хранилище это дало
   * ровно тот исход, ради предотвращения которого подбор и написан: у
   * «Ремесла внимания» выше настоящего экспорта книги встала
   * `_Inbox/20260708 Заявка на консультацию — Пётр Одинцов.md`, попавшая в
   * список одним автором. Теперь совпавшее названием стоит выше совпавшего
   * одним автором ВСЕГДА, а «машинное вниз» разбирает соседей внутри своей
   * ступени — там, где оно и заведено: два кандидата, совпавших одинаково.
   */
  test("внутри своей группы совпавший названием выше совпавшего одним автором", () => {
    const query = { title: "Заметки о продуктивности", authors: ["Максим Дорофеев"] };
    const byTitle: VaultNote = {
      path: `${LIB}/Мои заметки о продуктивности 2024.md`,
      text: "## Мои заметки о продуктивности 2024\n",
    };
    const byAuthor: VaultNote = {
      path: `${LIB}/Совсем другая книга.md`,
      text: "## Совсем другая книга\n\n**Автор**: [[Максим Дорофеев]]\n",
    };
    const list = candidates(query, [byAuthor, byTitle]);
    expect(paths(list)).toEqual([byTitle.path, byAuthor.path]);
    // Именно тот случай, ради которого ступень заведена: подсказка по автору
    // набрала БОЛЬШЕ баллов, но встала ниже.
    expect(list[1]!.score).toBeGreaterThan(list[0]!.score);
    expect(list[0]!.reasons).toContain("title-contains");
    expect(list[1]!.authorOnly).toBe(true);
  });

  test("машинное опущено ниже своих — среди совпавших названием", () => {
    const list = candidates(bookQuery(JEDI), VAULT).filter((one) => !one.authorOnly);
    const own = list.filter((c) => !c.machineGenerated).map((c) => c.path);
    const machine = list.filter((c) => c.machineGenerated).map((c) => c.path);
    expect(paths(list)).toEqual([...own, ...machine]);
    expect(machine).toContain(`${LIB}/Readwise/Джедайские Техники. Максим Дорофеев.md`);
  });

  /**
   * Находка 12 прогона глазами 20260818, дословно.
   *
   * У «Ремесла внимания» третьей строкой стояла заявка на консультацию, а
   * четвёртой — настоящий экспорт книги. Обе заметки про Петра Одинцова; про
   * КНИГУ — только вторая. Вырежьте `linkRank` из `compareCandidates` — тест
   * обязан упасть.
   */
  test("заметка, совпавшая одним автором, стоит ниже экспорта книги", () => {
    const query = { title: "Ремесло внимания", authors: ["Пётр Одинцов"] };
    const request: VaultNote = {
      path: "_Inbox/20260708 Заявка на консультацию — Пётр Одинцов.md",
      text: "# Заявка на консультацию\n\n**Автор**: [[Пётр Одинцов]]\n",
    };
    const export_: VaultNote = readwiseNote({
      file: "Ремесло Внимания. Пётр Одинцов",
      fullTitle: "Ремесло внимания",
      author: "Пётр Одинцов",
      category: "books",
    });
    const list = candidates(query, [request, export_]);
    expect(paths(list)).toEqual([export_.path, request.path]);
    expect(list[0]!.machineGenerated).toBe(true);
    expect(list[1]!.authorOnly).toBe(true);
    // И на экране: экспорт на виду, заявка — под кнопкой «показать ещё».
    const { likely, weak } = groupCandidates(list);
    expect(paths(likely)).toEqual([export_.path]);
    expect(paths(weak)).toEqual([request.path]);
  });

  /**
   * Второй случай той же находки: «Дневник как инструмент».
   *
   * Первым предложением для книги шла заметка про СОВСЕМ ДРУГУЮ книгу («Как
   * читать медленно»), приведённая одним автором, — а настоящий экспорт этой
   * книги стоял под ней.
   */
  test("заметка о другой книге того же автора не встаёт первой", () => {
    const query = { title: "Дневник как инструмент", authors: ["Ольга Ремез"] };
    const another = ownNote("Как читать медленно", {
      name: "Как читать медленно",
      author: "Ольга Ремез",
    });
    const export_ = readwiseNote({
      file: "Дневник Как Инструмент. Ольга Ремез",
      fullTitle: "Дневник как инструмент",
      author: "Ольга Ремез",
      category: "books",
    });
    expect(top(candidates(query, [another, export_]))).toBe(export_.path);
  });

  test("при равном балле своя заметка выше машинной", () => {
    const list = candidates(bookQuery(JEDI), VAULT);
    const own = list.find((c) => c.path === `${LIB}/Джедайские техники.md`)!;
    const machine = list.find((c) => c.path.includes("Readwise/Джедайские Техники"))!;
    // Замер на живом хранилище: оба совпали с названием ДОСЛОВНО и набрали
    // поровну. Порядок здесь держится не баллом, а тем, что машинное опущено
    // безусловно — иначе исход зависел бы от порядка файлов в папке.
    expect(machine.score).toBe(own.score);
    expect(list.indexOf(own)).toBeLessThan(list.indexOf(machine));
  });
});

// MARK: - Шум в кандидатах: замер на живом хранилище владельца 20260818

/**
 * **Откуда взялся этот набор.** 20260818 владелец открыл экран на своём
 * хранилище (4460 заметок, 11 книг в выгрузке) и увидел у «Цель как проект»
 * ПЯТНАДЦАТЬ кандидатов: собственный конспект и четырнадцать посторонних
 * заметок — планы, дизайн-документы, техническое задание, «Мое резюме.md».
 * Прогон подбора по его хранилищу (только чтение) показал причину: у всех
 * четырнадцати внутри стоит раздел `## Цель`, а разбор складывал заголовки
 * разделов в тот же мешок, что имя файла.
 *
 * Здесь та же ловушка в трёх строках: имена файлов и форма заметок его, текста
 * его нет. После починки на живом хранилище у этой книги остался один
 * кандидат, а у остальных десяти книг списки не изменились ни на строку
 * (32 кандидата по всем книгам стало 18 — ушёл ровно шум).
 */
describe("посторонние заметки не лезут в кандидаты", () => {
  /** Дизайн-документ или план: своё имя, а внутри — раздел «Цель». */
  function planNote(file: string): VaultNote {
    return {
      path: `_Inbox/${file}.md`,
      text: [
        "---",
        "tags: aiassist",
        "---",
        `# ${file}`,
        "",
        "## Цель",
        "",
        "Свести все выписки в одно место.",
        "",
        "## Задачи",
        "",
      ].join("\n"),
    };
  }

  const NOISE: VaultNote[] = [
    planNote("20260604 План финальной миграции LMS"),
    planNote("20260603 daily-digest — дизайн"),
    planNote("Мое резюме"),
    { path: "Цель.md", text: "Про постановку целей вообще.\n" },
  ];
  const NOISY = [...VAULT, ...NOISE];
  const GOAL = BOOKS[4]!;

  // Вырежьте в `compareTitles` строку `if (source === "heading") return undefined`
  // — тест обязан упасть.
  test("раздел «Цель» в плане не делает план кандидатом книги «Цель как проект»", () => {
    expect(paths(candidates(bookQuery(GOAL), NOISY))).toEqual([`${LIB}/Цель как проект.md`]);
  });

  // Вырежьте в `compareTitles` условие `shorter.length >= 2` — тест обязан упасть.
  test("одно общее слово названием не считается: «Цель.md» — не «Цель как проект»", () => {
    const alone: VaultNote = { path: "Цель.md", text: "Про постановку целей вообще.\n" };
    expect(candidates(bookQuery(GOAL), [alone])).toHaveLength(0);
  });

  /**
   * Заголовок из двух слов: связь слабая, но не выброшенная.
   *
   * «Цель» отсекается ещё и порогом в два слова, поэтому одного того теста
   * мало: вырежьте правило о заголовках — и он останется зелёным (проверено
   * вырезанием 20260818). Здесь ловушка длиннее одного слова: в разборе
   * конкурентов разделы называются «## Номер 1», «## Номер 2».
   *
   * Выбросить такое совпадение нельзя — в соседнем тесте им держится
   * настоящий конспект вебинара, — поэтому проверяется не отсутствие, а
   * ВЕС: на глаза такой кандидат не лезет.
   */
  // Вырежьте в `candidates` расчёт `bestByHeading` (или пометку `headingOnly`)
  // — тест обязан упасть.
  test("раздел «Номер 1» в разборе конкурентов на глаза не лезет", () => {
    const review: VaultNote = {
      path: "_Inbox/20260702 Разбор конкурентов.md",
      text: ["# Разбор конкурентов", "", "## Номер 1", "", "Первый по выручке.", ""].join("\n"),
    };
    const list = candidates(bookQuery(BOOKS[1]!), [review]);
    expect(list.map((one) => one.headingOnly)).toEqual([true]);
    expect(groupCandidates(list).likely).toHaveLength(0);
  });

  /**
   * Обратная сторона: слабое — не выброшенное.
   *
   * Конспект вебинара из тестового хранилища называет книгу только заголовком
   * раздела `## Ремесло внимания`. Начни отбрасывать такие совпадения — и
   * заметка, которую владелец вправе выбрать, пропадёт с экрана насовсем.
   */
  test("конспект вебинара не пропадает — он под кнопкой", () => {
    const webinar: VaultNote = {
      path: "_Inbox/20260702 Джедайские техники — конспект вебинара.md",
      text: [
        "---",
        "tags: [конспект, вебинар]",
        "---",
        "# Джедайские техники — конспект вебинара",
        "",
        "## Джедайские техники",
        "",
        "Вебинар автора по мотивам книги.",
        "",
      ].join("\n"),
    };
    const list = candidates({ title: "Джедайские техники. Как воспитать свою обезьяну", authors: [] }, [webinar]);
    expect(paths(list)).toEqual([webinar.path]);
    const { likely, weak } = groupCandidates(list);
    expect(likely).toHaveLength(0);
    expect(paths(weak)).toEqual([webinar.path]);
  });

  /**
   * Балл слабого совпадения бывает выше балла сильного — и не решает.
   *
   * У заметки, названной по-человечески, имя файла совпадает с названием
   * книги ВХОЖДЕНИЕМ (65 баллов), а заголовок раздела внутри — НАЧАЛОМ
   * (80 баллов). Если брать просто больший балл, заметка объявится слабой из-за
   * собственного заголовка и уедет под кнопку — при том, что название книги
   * стоит у неё прямо в имени файла.
   */
  // Вырежьте в `candidates` условие `(bestByHeading && !weak)` — тест обязан упасть.
  test("совпадение по имени файла сильнее заголовка, даже когда балл ниже", () => {
    const note: VaultNote = {
      path: "_Inbox/20260607 Джедайские техники. Как воспитать свою обезьяну — конспект.md",
      text: ["# Конспект", "", "## Джедайские техники", "", "По главам.", ""].join("\n"),
    };
    const list = candidates(
      { title: "Джедайские техники. Как воспитать свою обезьяну", authors: [] },
      [note],
    );
    expect(list.map((one) => one.headingOnly)).toEqual([false]);
    expect(paths(groupCandidates(list).likely)).toEqual([note.path]);
  });

  /**
   * Обратная сторона того же условия: два слова — уже название.
   *
   * Это не украшение теста, а граница правила. «Путь джедая» ⊂ «Путь джедая.
   * Поиск собственной методики продуктивности» — совпадение по началу из двух
   * слов, и на живом хранилище оно приводит ЕДИНСТВЕННУЮ правильную заметку.
   * Подними порог до трёх — и эта книга останется без кандидата.
   */
  test("совпадение по началу из двух слов остаётся", () => {
    const jedi = BOOKS[5]!;
    expect(top(candidates(bookQuery(jedi), NOISY))).toBe(
      `${LIB}/Путь джедая. Поиск собственной методики продуктивности.md`,
    );
  });

  /**
   * Заголовок не выброшен — ему оставлено дословное совпадение.
   *
   * У владельца собственный конспект книги начинается заголовком с её
   * названием, и бывает, что кроме заголовка названия в заметке нет вовсе.
   * Такую заметку подбор обязан находить по-прежнему.
   */
  test("заголовок, совпавший с названием дословно, кандидатом делает", () => {
    const note: VaultNote = {
      path: "_Inbox/20260607 разбор.md",
      text: ["# Джедайские техники", "", "Конспект по главам.", ""].join("\n"),
    };
    expect(paths(candidates(bookQuery(JEDI), [note]))).toEqual(["_Inbox/20260607 разбор.md"]);
  });
});

// MARK: - Экран: что видно сразу, что под кнопкой, что сказано словами

describe("экран привязки: сигнал отдельно от шума", () => {
  const plan = planBinding(SNAPSHOT, VAULT);
  const rowOf = (uuid: string): BindingRow => plan.awaitingUser.find((r) => r.bookUUID === uuid)!;

  // Вырежьте `groupCandidates` (или верните всех в `likely`) — тест обязан упасть.
  test("совпавшее названием видно сразу, совпавшее одним автором — под кнопкой", () => {
    const { likely, weak } = groupCandidates(rowOf(BASB.uuid).candidates);
    expect(likely.map((one) => one.path)).toEqual([
      `${LIB}/${BASB_FULL}.md`,
      `${LIB}/Readwise/Building a Second Brain. Tiago Forte.md`,
      `${LIB}/Readwise/Building a Second Brain. vanadium23.md`,
    ]);
    // Русский перевод той же книги — связь по одному автору, и она слабая.
    expect(weak.map((one) => one.path)).toEqual([
      `${LIB}/Readwise/Создай Свой «второй Мозг»! Как Построить Систему Поиска И Организации Информации, Чтобы Раскрыть Ваш Креативный Потенциал. Тьяго  Форте.md`,
    ]);
  });

  /**
   * Спрятано — не выброшено, и это условие, а не пожелание.
   *
   * Русский перевод BASB не разделяет с оригиналом ни одного слова названия:
   * связывает их только автор. Выбросить его нельзя — владелец обязан иметь
   * возможность привязать книгу к нему; показывать вперемешку с настоящими
   * тоже нельзя. Поэтому он лежит под кнопкой, и сумма групп — весь список.
   */
  test("под кнопкой лежит ровно то, что не показано, и ничего не пропадает", () => {
    for (const row of plan.awaitingUser) {
      const { likely, weak } = groupCandidates(row.candidates);
      expect([...likely, ...weak].map((one) => one.path).sort()).toEqual(
        row.candidates.map((one) => one.path).sort(),
      );
    }
  });

  test("кнопка называет, сколько заметок под ней и почему они там", () => {
    const { weak } = groupCandidates(rowOf(BASB.uuid).candidates);
    expect(moreCandidatesWords(weak)).toBe("Показать ещё 1 заметку со слабым совпадением");
    expect(moreCandidatesWords([...weak, ...weak, ...weak])).toBe(
      "Показать ещё 3 заметки со слабым совпадением",
    );
  });

  // Вырежьте `nothingFoundWords` из окна — человек снова не различит
  // «не нашлось» и «не искали».
  test("пустота объясняет себя, а не молчит", () => {
    const empty = rowOf(BOOKS[3]!.uuid);
    expect(nothingFoundWords(empty)).toBe(
      "Ни одной заметки с этим названием или автором в хранилище не нашлось.",
    );
    expect(nothingFoundWords(rowOf(BASB.uuid))).toBeUndefined();

    const onlyAuthor: BindingRow = {
      ...empty,
      candidates: candidates({ title: "Другая книга", authors: ["Максим Дорофеев"] }, VAULT),
    };
    expect(nothingFoundWords(onlyAuthor)).toBe(
      "Заметки с таким названием не нашлось — есть только слабые совпадения.",
    );
  });

  // Вырежьте `proposedExists` (или ветку `none` в `newNoteAction`) — тест
  // обязан упасть.
  test("«создать новую» не предлагает адрес заметки, которая уже есть", () => {
    // У BASB предложенный адрес — это адрес собственного конспекта владельца,
    // и он стоит первым кандидатом. Второй кнопки с тем же путём быть не
    // должно: у «Learn Less, Retain More» на тестовом хранилище они стояли
    // подряд и выглядели ошибкой отрисовки.
    const basb = rowOf(BASB.uuid);
    expect(basb.proposedExists).toBe(true);
    expect(newNoteAction(basb)).toEqual({ kind: "none" });

    const jedi = rowOf(BOOKS[5]!.uuid);
    expect(jedi.proposedExists).toBe(false);
    expect(newNoteAction(jedi)).toEqual({ kind: "create", path: `${LIB}/Путь джедая.md` });
  });

  /**
   * Редкий третий исход: файл по адресу есть, а кандидатом не стал.
   *
   * На живых данных так почти не бывает — имя файла совпало бы с названием и
   * привело бы заметку в кандидаты само. «Почти» здесь и оставлено: если это
   * всё же случится, кнопка обязана сказать «дописать», а не «создать».
   */
  test("если файл есть, но кандидатом не стал, кнопка говорит «дописать»", () => {
    const odd: BindingRow = { ...rowOf(BASB.uuid), candidates: [], proposedExists: true };
    expect(newNoteAction(odd)).toEqual({ kind: "bind", path: odd.proposedPath });
  });

  // Вырежьте склонение из `bookSubtitle` — тест обязан упасть.
  test("число выписок склоняется в самом окне, а не только в описании", () => {
    expect(bookSubtitle(rowOf(JEDI.uuid))).toBe("Максим Дорофеев · 81 выписка");
    expect(bookSubtitle(rowOf(BASB.uuid))).toBe("Tiago Forte · 47 выписок");
    expect(bookSubtitle(rowOf(BOOKS[6]!.uuid))).toBe("Marshall Goldsmith, Mark Reiter · 4 выписки");
    expect(bookSubtitle(rowOf(BOOKS[8]!.uuid))).toBe("Брайан Моран, Майкл Леннингтон · 1 выписка");
  });

  // Вырежьте `screenIntro` из окна — экран снова не скажет, зачем он.
  test("вверху сказано, что это за экран и что будет после нажатия", () => {
    const intro = screenIntro(plan).join(" ");
    expect(intro).toContain("10 книг");
    expect(intro).toContain("Beresta не знает, куда их класть");
    expect(intro).toContain("ваш собственный текст останется нетронутым");
    expect(intro).toContain("Книга без выбора не изменит ничего");
    // Обещания привязать что-то самостоятельно экран не даёт.
    expect(intro).not.toContain("автоматически");
  });

  test("счётчик внизу считает выбранное, а не обещает", () => {
    expect(chosenCountWords(0, 10)).toBe("Пока не выбрано ничего");
    expect(chosenCountWords(1, 10)).toBe("Выбрано 1 книга из 10");
    expect(chosenCountWords(2, 10)).toBe("Выбрано 2 книги из 10");
    expect(chosenCountWords(5, 10)).toBe("Выбрано 5 книг из 10");
  });
});

/**
 * Что человек слышит в ответ на своё нажатие.
 *
 * Прогон глазами 20260818: выбрал книгу, нажал «Привязать выбранные» — окно
 * закрылось, и на экране не изменилось ничего. На диске в это время в заметку
 * легли 40 цитат, и заметка выросла с 1 310 до 16 559 знаков. Отсюда все
 * проверки ниже: у ответа обязаны быть ЧИСЛА (сколько книг, сколько выписок),
 * АДРЕС (в какую заметку) и правда про то, что не легло.
 */
describe("ответ на «Привязать выбранные»", () => {
  // Вырежьте вызов `bindingNoticeWords` из `applyBinding` — и человек снова
  // нажмёт кнопку, увидит пустой экран и решит, что она не работает.
  test("одна книга: сказано и сколько выписок, и в какую заметку", () => {
    const words = bindingNoticeWords({
      chosen: 1,
      written: [{ path: "Библиотека/Attention Capital. How Focus Compounds.md", quotes: 40 }],
      deferred: [],
      failed: [],
    });
    expect(words.head).toBe("Beresta: привязана 1 книга, 40 выписок легли в заметку:");
    expect(words.notes).toEqual([
      {
        path: "Библиотека/Attention Capital. How Focus Compounds.md",
        tail: "— 40 выписок",
      },
    ]);
    expect(words.rest).toEqual([]);
  });

  test("несколько книг: числа складываются, каждая заметка названа своим числом", () => {
    const words = bindingNoticeWords({
      chosen: 3,
      written: [
        { path: "Библиотека/Ремесло внимания.md", quotes: 81 },
        { path: "Библиотека/Картотека. Инструмент мышления.md", quotes: 47 },
        { path: "Библиотека/Порт и причал.md", quotes: 1 },
      ],
      deferred: [],
      failed: [],
    });
    expect(words.head).toBe("Beresta: привязано 3 книги, 129 выписок легли в 3 заметки:");
    expect(words.notes.map((one) => one.tail)).toEqual([
      "— 81 выписка",
      "— 47 выписок",
      "— 1 выписка",
    ]);
  });

  /**
   * Отложенная заметка — не «подождите», а «выберите заново».
   *
   * Заметка, открытая с несохранёнными правками, не получает НИЧЕГО: ни
   * выписок, ни ключа `beresta-book-id`. Значит выбор человека пропал целиком,
   * и сказать ему «выписки приедут» было бы обещанием, которого никто не
   * выполнит.
   */
  test("ничего не легло из-за несохранённой заметки — сказано, что выбор пропал", () => {
    const words = bindingNoticeWords({
      chosen: 1,
      written: [],
      deferred: ["Библиотека/Ремесло внимания.md"],
      failed: [],
    });
    expect(words.head).toContain("выписки не легли");
    expect(words.head).toContain("несохранёнными правками");
    expect(words.head).toContain("выберите заново");
    expect(words.notes).toEqual([]);
  });

  test("часть легла, часть нет — про остаток сказано отдельной строкой", () => {
    const words = bindingNoticeWords({
      chosen: 3,
      written: [{ path: "Библиотека/Ремесло внимания.md", quotes: 81 }],
      deferred: ["Библиотека/Тихая инженерия.md"],
      failed: ["Библиотека/Порт и причал.md"],
    });
    expect(words.head).toBe("Beresta: привязано 3 книги, 81 выписка легла в заметку:");
    expect(words.rest[0]).toContain("Ещё 1 заметка открыта с несохранёнными правками");
    expect(words.rest[1]).toContain("Ещё от 1 заметки проход отказался");
  });

  test("отказ прохода назван отказом, а не тишиной", () => {
    const words = bindingNoticeWords({
      chosen: 2,
      written: [],
      deferred: [],
      failed: ["Библиотека/Порт и причал.md", "Библиотека/Заработанный час.md"],
    });
    expect(words.head).toContain("проход отказался от 2 заметок");
    expect(words.head).toContain("Причина — отдельным сообщением");
  });

  test("выбор принят, но менять было нечего — сказано и это", () => {
    const words = bindingNoticeWords({ chosen: 1, written: [], deferred: [], failed: [] });
    expect(words.head).toBe(
      "Beresta: выбор принят, но ни одна заметка не изменилась: эти выписки в них уже стоят.",
    );
  });
});
