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

export class SuggestModal<T> extends Modal {
  setPlaceholder(_text: string): void {}
  getSuggestions(_query: string): T[] {
    return [];
  }
}

export class FuzzySuggestModal<T> extends SuggestModal<T> {}

export class AbstractInputSuggest<T> {
  limit = 100;
  constructor(_app?: unknown, _inputEl?: unknown) {}
  onSelect(_callback: (value: T) => unknown): this {
    return this;
  }
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

/// Язык интерфейса — как у настоящего Obsidian 1.8+: проверки задают его тем же
/// ключом `language` в `localStorage`, что и раньше, и ответ обязан совпадать.
export function getLanguage(): string {
  try {
    return globalThis.localStorage?.getItem("language") || "en";
  } catch {
    return "en";
  }
}

export function normalizePath(path: string): string {
  return path;
}
