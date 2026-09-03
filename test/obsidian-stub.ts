// Двойник пакета `obsidian` на время прогона — и ничего сверх того.
//
// В npm-пакете `obsidian` лежат только описания типов; исполняемый код даёт
// само приложение. Здесь ровно столько, чтобы импорт в тесте разрешился:
// пустые базовые классы и пустые заглушки.
//
// **Дописывать сюда поведение нельзя.** Двойник, который «умеет» читать
// хранилище, — это второе приложение Obsidian, написанное нами и всегда
// согласное с нашими ожиданиями; проверка на нём доказывает только то, что мы
// сами же и запрограммировали. Всё, что требует настоящего Obsidian —
// `vault.process` на открытом файле, `processFrontMatter`, события скрытой
// папки, — меряется швом на живом приложении (задача 13) и уже измерено
// щупом задачи 2 (`docs/plans/notes/20260812-замер-obsidian.md`).
//
// **Почему имён стало больше (задача 14).** Точка входа теперь заводит окна,
// панель и страницу настроек, а `class X extends Modal` требует, чтобы `Modal`
// существовал уже в момент разбора модуля. Ни одно из этих имён ничего не
// делает: они нужны, чтобы `import` разрешился, и ни один тест их не зовёт.
// Проверка типов при этом идёт по НАСТОЯЩЕМУ `obsidian.d.ts` из
// `node_modules` — расхождение с API поймает `tsc`, а не двойник.

export class Plugin {
  async onload(): Promise<void> {}
  onunload(): void {}
}

export class Modal {
  constructor(_app?: unknown) {}
  open(): void {}
  close(): void {}
}

export class ItemView {
  constructor(_leaf?: unknown) {}
}

export class PluginSettingTab {
  constructor(_app?: unknown, _plugin?: unknown) {}
}

export class Setting {
  constructor(_containerEl?: unknown) {}
}

export class Notice {
  constructor(_message?: string, _duration?: number) {}
}

export class MarkdownView {}

export class TFile {}

export class TFolder {}

export function normalizePath(path: string): string {
  return path;
}
