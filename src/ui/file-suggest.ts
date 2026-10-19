/**
 * Подсказка файла шаблона в поле настроек (заказ владельца 20261019: «начинаю
 * набирать Bere, и чтобы плагин показывал, какие заметки есть с такими
 * символами в названии»). Как у Templater и Zotero Integration: список под
 * полем по мере набора, выбор кладёт в поле полный путь.
 *
 * Правило подбора — отдельной чистой функцией: его проверяют без Obsidian, а
 * сама подсказка лишь отдаёт ему пути хранилища и рисует ответ.
 */
import { AbstractInputSuggest, type App } from "obsidian";

/** Сколько путей показывать разом: дальше человек уточнит набором. */
export const SUGGEST_LIMIT = 50;

/**
 * Пути, подходящие к набранному, — лучшие первыми.
 *
 * Подходит путь, в котором (без учёта регистра) встречается каждое слово
 * набранного: «tem bere» найдёт `Templates/Beresta Book.md`. Порядок — сперва
 * имена файлов, НАЧИНАЮЩИЕСЯ с набранного, потом имена, его содержащие, потом
 * совпавшие только папкой; внутри — по алфавиту. Пустой набор — все пути по
 * алфавиту: человек видит, из чего выбирать, ещё не зная имени.
 */
export function suggestTemplatePaths(
  paths: readonly string[],
  query: string,
  limit: number = SUGGEST_LIMIT,
): string[] {
  const wanted = query.trim().toLowerCase();
  const words = wanted.split(/\s+/).filter((word) => word !== "");
  const ranked: { path: string; rank: number }[] = [];
  for (const path of paths) {
    const lower = path.toLowerCase();
    if (!words.every((word) => lower.includes(word))) continue;
    const name = lower.slice(lower.lastIndexOf("/") + 1);
    const rank = wanted === "" ? 0 : name.startsWith(wanted) ? 0 : name.includes(wanted) ? 1 : 2;
    ranked.push({ path, rank });
  }
  ranked.sort((a, b) => a.rank - b.rank || a.path.localeCompare(b.path));
  return ranked.slice(0, limit).map((one) => one.path);
}

/** Подсказка путей заметок хранилища под текстовым полем. */
export class TemplateFileSuggest extends AbstractInputSuggest<string> {
  constructor(
    app: App,
    inputEl: HTMLInputElement,
    private readonly paths: () => readonly string[],
  ) {
    super(app, inputEl);
    this.limit = SUGGEST_LIMIT;
  }

  protected getSuggestions(query: string): string[] {
    return suggestTemplatePaths(this.paths(), query);
  }

  renderSuggestion(path: string, el: HTMLElement): void {
    el.setText(path);
  }
}
