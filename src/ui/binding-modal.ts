/**
 * Окно привязки книг к заметкам — оболочка над экраном задачи 12.
 *
 * **Ни одного решения здесь нет и быть не должно.** Что за книги, какие у них
 * кандидаты, в каком порядке кандидаты стоят, какие из них помечены машинными,
 * что показать сразу и что спрятать под кнопку, какими словами объяснить экран
 * и куда ляжет новая заметка — всё это посчитал `binding-view`, и всё это
 * проверяется обычными тестами (`test/binding.test.ts`, шов 2 на живом
 * хранилище). Здесь только показ и сбор нажатий.
 *
 * **По умолчанию не выбрано ничего.** Ни «лучший кандидат», ни «создать новую»
 * — книга без нажатия остаётся непривязанной. Порог «если кандидат один и
 * совпадение точное — привязываем сами» кажется безобидным ровно до встречи с
 * живыми данными: у «Джедайских техник» машинный экспорт Readwise совпадает с
 * названием ТОЧНЕЕ собственного конспекта владельца.
 *
 * **Что чинил прогон глазами 20260818** (`docs/plans/notes/20260818-путь-глазами.md`):
 *
 * - кнопки налезали друг на друга, а текст вылезал за кнопку — потому что
 *   кнопке Obsidian задаёт высоту 30 px, а трёхстрочному пути её мало;
 * - пояснение «совпал только автор» стояло отдельным столбцом справа и глазом
 *   со своей строкой не связывалось — теперь оно внутри своей кнопки;
 * - «Привязать выбранные» уезжала на отметку 1447 px при высоте окна 800 —
 *   теперь список прокручивается внутри себя, а полоса с кнопкой не уезжает;
 * - выбор не был виден на кнопке — теперь выбранная кнопка помечена галочкой,
 *   а полоса внизу считает выбранное;
 * - «N выписок» стояло при любом числе — склонение считает `bookSubtitle`.
 */

import { Modal, type App } from "obsidian";

import {
  bookSubtitle,
  chosenCountWords,
  groupCandidates,
  moreCandidatesWords,
  newNoteAction,
  nothingFoundWords,
  screenIntro,
  whyCandidate,
  type BindingPlan,
  type BindingRow,
  type Candidate,
  type Choice,
} from "../binding/binding-view";

export class BindingModal extends Modal {
  private readonly choices = new Map<string, Choice>();
  /** Кнопки одной книги: нажатие одной снимает пометку с остальных. */
  private readonly options = new Map<string, HTMLElement[]>();
  private counter: HTMLElement | undefined;
  private submit: HTMLButtonElement | undefined;
  /** Отложенная передача фокуса списку. Снимается при закрытии окна. */
  private focusing: number | undefined;

  constructor(
    app: App,
    private readonly plan: BindingPlan,
    private readonly apply: (choices: ReadonlyMap<string, Choice>) => void,
  ) {
    super(app);
  }

  override onOpen(): void {
    const { contentEl, titleEl } = this;
    titleEl.setText("Привязка книг к заметкам");
    contentEl.empty();
    contentEl.addClass("beresta-binding");

    if (this.plan.awaitingUser.length === 0) {
      contentEl.createEl("p", {
        text:
          this.plan.alreadyBound.length === 0
            ? "В выгрузке Beresta нет книг с выписками."
            : "Все книги выгрузки уже привязаны к заметкам.",
      });
      return;
    }

    // Что это за экран и что будет дальше — до того, как человек начнёт жать.
    const intro = contentEl.createDiv({ cls: "beresta-binding-intro" });
    for (const line of screenIntro(this.plan)) intro.createEl("p", { text: line });

    // Список прокручивается внутри себя: иначе нижняя полоса уезжает за край
    // окна вместе с десятью книгами, и человек её не находит.
    const list = contentEl.createDiv({ cls: "beresta-binding-list" });
    for (const row of this.plan.awaitingUser) this.rowElement(list, row);

    const footer = contentEl.createDiv({ cls: "beresta-binding-footer" });
    this.counter = footer.createDiv({ cls: "beresta-muted beresta-binding-counter" });
    const buttons = footer.createDiv({ cls: "beresta-binding-footer-buttons" });
    const cancel = buttons.createEl("button", { text: "Отмена" });
    cancel.addEventListener("click", () => {
      this.close();
    });
    this.submit = buttons.createEl("button", { text: "Привязать выбранные", cls: "mod-cta" });
    this.submit.addEventListener("click", () => {
      this.apply(this.choices);
      this.close();
    });
    this.countChosen();

    // Фокус забирает список, а не первая кнопка первой книги.
    //
    // Замер 20260818: сразу после открытия окна фокус стоял на кнопке
    // `Библиотека/Ремесло внимания.md`, и на одном экране оказывались рамка на
    // кандидате и надпись «Пока не выбрано ничего» внизу. Крупное утверждение
    // при этом было неверным. Хуже того, случайный пробел или Enter привязал бы
    // первую книгу к первому кандидату — привязка без единого решения человека,
    // ровно то, чего этот экран не делает нигде больше.
    //
    // Список — правильный держатель фокуса: с него читают, его же листают
    // стрелками, и нажать на нём нечего.
    //
    // Через `setTimeout`, а не сразу: Obsidian ставит фокус на первую кнопку
    // окна САМ и делает это после `onOpen`. Замер: без отсрочки фокус
    // возвращался на кандидата, с отсрочкой остаётся на списке.
    list.tabIndex = -1;
    this.focusing = window.setTimeout(() => {
      list.focus();
    }, 0);
  }

  override onClose(): void {
    if (this.focusing !== undefined) window.clearTimeout(this.focusing);
    this.contentEl.empty();
  }

  private rowElement(parent: HTMLElement, row: BindingRow): void {
    const box = parent.createDiv({ cls: "beresta-binding-book" });
    // **`div`, а не `h4` и не `Setting.setHeading()`.** Правило каталога
    // Obsidian — «не `<h1>`/`<h2>`, а `setHeading`» — написано про единообразие
    // вида, и заголовок в модальном окне под него формально подпадает. Но
    // `setHeading` — это строка настроек со своими `settingEl`/`nameEl`, своей
    // рамкой и своими отступами: внутри карточки книги, у которой свои
    // `padding` и `border-bottom`, она встала бы чужеродной полосой, а
    // `setName` не принимает класса — и перенос длинного названия
    // (`overflow-wrap: anywhere`, решение с замером) отвалился бы.
    //
    // Простой `div` с нашим классом выполняет букву правила (заголовочного
    // тега в интерфейсе не остаётся) и не отдаёт вид чужому классу. Вес шрифта
    // задан в `styles.css` там же, где перенос.
    box.createDiv({ text: row.title, cls: "beresta-binding-title" });
    box.createEl("div", { text: bookSubtitle(row), cls: "beresta-muted" });

    const said = nothingFoundWords(row);
    if (said !== undefined) box.createEl("div", { text: said, cls: "beresta-muted" });

    const options = box.createDiv({ cls: "beresta-binding-options" });
    this.options.set(row.bookUUID, []);

    const { likely, weak } = groupCandidates(row.candidates);
    for (const candidate of likely) this.candidateButton(options, row, candidate);

    // Слабые кандидаты спрятаны, но не выброшены: среди них бывает русский
    // перевод той же книги, и выбрать его должно быть можно. Кнопка называет,
    // что под ней лежит, — иначе прятать нельзя.
    if (weak.length > 0) {
      const rest = box.createDiv({ cls: "beresta-binding-options beresta-binding-rest" });
      rest.hide();
      const more = box.createEl("button", {
        text: moreCandidatesWords(weak),
        cls: "beresta-binding-more",
      });
      more.addEventListener("click", () => {
        rest.show();
        more.hide();
      });
      for (const candidate of weak) this.candidateButton(rest, row, candidate);
      // Порядок в разметке: кнопка «показать ещё» стоит перед своим списком.
      box.insertBefore(more, rest);
    }

    const action = newNoteAction(row);
    if (action.kind === "create") {
      this.optionButton(box, row, `Создать новую заметку: ${action.path}`, [], {
        kind: "create",
      });
    }
    if (action.kind === "bind") {
      // Файл по этому адресу уже есть, а кандидатом не стал. «Создать» здесь
      // было бы неправдой: выписки допишутся в существующую заметку.
      this.optionButton(
        box,
        row,
        `Дописать в существующую заметку: ${action.path}`,
        ["заметка по этому адресу уже есть — её текст останется на месте"],
        { kind: "bind", path: action.path },
      );
    }

    const skipRow = box.createDiv({ cls: "beresta-binding-skip" });
    this.optionButton(skipRow, row, "Пропустить эту книгу", [], { kind: "skip" });
  }

  private candidateButton(parent: HTMLElement, row: BindingRow, candidate: Candidate): void {
    this.optionButton(parent, row, candidate.path, whyCandidate(candidate), {
      kind: "bind",
      path: candidate.path,
    });
  }

  /**
   * Одна кнопка выбора: путь, под ним — почему он здесь, слева — место под
   * галочку.
   *
   * Пояснение живёт ВНУТРИ кнопки нарочно. Отдельным столбцом справа оно
   * стояло раньше — и глаз не связывал его со своей строкой, тем более что
   * длинный путь переносился и столбцы разъезжались.
   */
  private optionButton(
    parent: HTMLElement,
    row: BindingRow,
    label: string,
    why: readonly string[],
    choice: Choice,
  ): void {
    const button = parent.createEl("button", { cls: "beresta-binding-option" });
    button.createSpan({ cls: "beresta-binding-mark", text: "✓" });
    const body = button.createDiv({ cls: "beresta-binding-body" });
    body.createDiv({ cls: "beresta-binding-label", text: label });
    if (why.length > 0) {
      body.createDiv({ cls: "beresta-binding-why", text: why.join("; ") });
    }

    const siblings = this.options.get(row.bookUUID);
    siblings?.push(button);
    button.addEventListener("click", () => {
      this.choices.set(row.bookUUID, choice);
      for (const other of siblings ?? []) other.removeClass("is-chosen");
      button.addClass("is-chosen");
      this.countChosen();
    });
  }

  /** Сколько книг выбрано — и можно ли уже нажимать. */
  private countChosen(): void {
    const chosen = [...this.choices.values()].filter((one) => one.kind !== "skip").length;
    this.counter?.setText(chosenCountWords(chosen, this.plan.awaitingUser.length));
    if (this.submit !== undefined) this.submit.disabled = chosen === 0;
  }
}
