/**
 * Команды: всё, чем человек управляет плагином.
 *
 * **Список команд — это и есть договор о том, что плагин делает сам, а что
 * только по просьбе.** Сам он делает ровно одно: раскладывает выписки по
 * заметкам, которые человек привязал. Всё остальное — привязка книг, возврат
 * стёртой секции, снятие предохранителя, откат заметки к прежней версии —
 * происходит потому, что человек нажал. Это не осторожность ради осторожности:
 * каждое из этих действий меняет то, чего плагин не порождает и восстановить не
 * может (задача 11, довод про запасную копию).
 *
 * **Значка на ленте нет.** Каталог Obsidian просит вычищать из шаблона плагина
 * значок, пример модального окна и вывод в консоль; заводить их, чтобы потом
 * вычищать, незачем. Команда открывается общим окном команд (⌘P) и получает
 * имя плагина приставкой сама — поэтому в именах ниже слова «Beresta» нет.
 *
 * **Ни одного обращения к Obsidian.** Здесь только список: имя, признак «нужна
 * открытая заметка» и что позвать. Регистрация живёт в точке входа, а `id` и
 * слова проверяются обычным тестом.
 */

/** Что умеет плагин по просьбе человека. */
export interface CommandActions {
  /** Посмотреть на выгрузку прямо сейчас и разложить, если есть новое. */
  syncNow(): Promise<void> | void;
  /** Экран привязки книг к заметкам. */
  bindBooks(): Promise<void> | void;
  /** Панель расхождений. */
  showConflicts(): Promise<void> | void;
  /** Вернуть секцию в заметку, из которой её стёрли. */
  returnSection(path: string): Promise<void> | void;
  /** Снять предохранитель по этой заметке: да, убрать эти блоки. */
  confirmRemovals(path: string): Promise<void> | void;
  /** Откатить заметку к одной из запасных копий. */
  restoreVersion(path: string): Promise<void> | void;
}

export interface CommandSpec {
  /** Имя команды внутри плагина. Obsidian сам припишет `beresta:`. */
  readonly id: string;
  /** Что человек прочитает в списке команд. */
  readonly name: string;
  /**
   * Нужна ли открытая заметка.
   *
   * Команда, которой нужна заметка, при её отсутствии не показывается вовсе, а
   * не показывается и молчит при нажатии: команда, которая иногда «не
   * работает», учит человека не доверять всему списку.
   */
  readonly needsNote: boolean;
  readonly run: (path: string) => Promise<void> | void;
}

export function commandSpecs(actions: CommandActions): CommandSpec[] {
  return [
    {
      id: "sync-now",
      name: "Разложить выписки сейчас",
      needsNote: false,
      run: () => actions.syncNow(),
    },
    {
      id: "bind-books",
      name: "Привязать книги к заметкам",
      needsNote: false,
      run: () => actions.bindBooks(),
    },
    {
      id: "show-conflicts",
      name: "Показать расхождения",
      needsNote: false,
      run: () => actions.showConflicts(),
    },
    {
      id: "return-section",
      name: "Вернуть секцию Beresta в эту заметку",
      needsNote: true,
      run: (path) => actions.returnSection(path),
    },
    {
      id: "confirm-removals",
      name: "Подтвердить удаление блоков в этой заметке",
      needsNote: true,
      run: (path) => actions.confirmRemovals(path),
    },
    {
      id: "restore-version",
      name: "Восстановить прежнюю версию этой заметки",
      needsNote: true,
      run: (path) => actions.restoreVersion(path),
    },
  ];
}
