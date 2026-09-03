/**
 * Панель расхождений: где ваша правка и приложение разошлись.
 *
 * **Расхождение — обычное дело, а не авария.** Человек правит свои заметки,
 * приложение правит свои выписки, иногда они трогают одно место. Ничего при
 * этом не ломается и ничего не теряется: правленый блок замерзает и остаётся
 * человеческим, новая версия из приложения приезжает свёрнутым предупреждением
 * над ним. Панель существует не затем, чтобы звать на помощь, а затем, чтобы
 * человек **знал**, какие блоки перестали обновляться, — иначе он узнает об
 * этом через полгода, когда заметит, что цитата отстала.
 *
 * Отсюда и слова: «ваши правки», «ждёт сохранения», «книга ещё едет». Ни
 * «ошибки», ни «конфликта», ни «внимания», ни значка с восклицательным знаком.
 *
 * **Отдельно от окна нарочно** — как экран привязки в задаче 12. То, ЧТО
 * написано в панели, проверяется обычным тестом; `ItemView` поверх этих строк
 * живёт в `src/ui/conflicts-panel.ts` и не содержит ни одного решения.
 */

import type { SyncReport } from "./sync/pass";

export type BoardKind =
  /** Блок правили вы: он заморожен и остаётся вашим. */
  | "ваша-правка"
  /** Блок правили вы, и в приложении текст тоже изменился. */
  | "правка-и-новая-версия"
  /** Блока в приложении больше нет, но в заметке он ваш. */
  | "нет-в-приложении"
  /** Заголовок секции переписан вами. */
  | "ваш-заголовок"
  /** Плагин не помнит, чей это блок. */
  | "не-помню"
  /** Заметка открыта с несохранённым — запись отложена. */
  | "ждёт-сохранения"
  /** Проход отказался от файла и сказал почему. */
  | "отказ"
  /** Привязанной заметки нет на месте. */
  | "заметки-нет"
  /** Заметка привязана к книге, которой в снимке нет. */
  | "книги-нет";

export interface BoardEntry {
  readonly path: string;
  /** Якорь блока, если расхождение про блок. */
  readonly anchor: string | undefined;
  readonly kind: BoardKind;
  readonly words: string;
  /** На какой момент были данные, когда это увидели. */
  readonly at: string;
}

/**
 * Что накопилось к этому часу.
 *
 * **Записи заметки заменяются целиком при каждом проходе, который её видел.**
 * Иначе панель превращается в журнал: человек сохранил заметку, отложенная
 * запись состоялась, а строка «ждёт сохранения» осталась висеть навсегда.
 * Заметки, которых проход не касался (сверялась одна книга — задача 14 умеет и
 * так), сохраняют прежние записи: про них ничего нового не узнали.
 */
export class ConflictBoard {
  private readonly byPath = new Map<string, BoardEntry[]>();

  accept(report: SyncReport): void {
    for (const path of report.visited) this.byPath.delete(path);

    for (const [path, conflicts] of Object.entries(report.conflicts)) {
      for (const conflict of conflicts) {
        this.add({
          path,
          anchor: conflict.anchor === "" ? undefined : conflict.anchor,
          kind: kindOf(conflict.kind),
          words: conflict.message,
          at: report.stamp,
        });
      }
    }
    for (const path of report.deferred) {
      this.add({
        path,
        anchor: undefined,
        kind: "ждёт-сохранения",
        words:
          "Заметка открыта, и в ней есть несохранённые правки. Выписки приедут " +
          "следующим проходом, как только вы сохраните её.",
        at: report.stamp,
      });
    }
    for (const refusal of report.refusals) {
      this.add({
        path: refusal.path,
        anchor: undefined,
        kind: "отказ",
        words: refusal.message,
        at: report.stamp,
      });
    }
    for (const path of report.missing) {
      this.add({
        path,
        anchor: undefined,
        kind: "заметки-нет",
        words:
          "Заметка привязана к книге, а файла на месте нет. Beresta не заводит его " +
          "заново: вернуть одной секцией заметку, которую вы удалили, хуже, чем не " +
          "вернуть. Если она нужна — привяжите книгу заново.",
        at: report.stamp,
      });
    }
    for (const [path, ids] of Object.entries(report.unknownBooks)) {
      this.add({
        path,
        anchor: undefined,
        kind: "книги-нет",
        words:
          `В выгрузке нет ${ids.length === 1 ? "книги" : "книг"} ${ids.join(", ")}. ` +
          "Так бывает, когда книгу удалили из Beresta или выгрузка приехала с другой " +
          "машины. Блоки этой книги в заметке не трогаются.",
        at: report.stamp,
      });
    }
  }

  /** Все записи, по заметкам и в порядке появления. */
  get entries(): readonly BoardEntry[] {
    return [...this.byPath.values()].flat();
  }

  get count(): number {
    return this.entries.length;
  }

  /** Сколько записей про правки человека — это число идёт в строку состояния. */
  get ownEdits(): number {
    return this.entries.filter((entry) => isOwnEdit(entry.kind)).length;
  }

  forget(path: string): void {
    this.byPath.delete(path);
  }

  clear(): void {
    this.byPath.clear();
  }

  private add(entry: BoardEntry): void {
    const list = this.byPath.get(entry.path) ?? [];
    list.push(entry);
    this.byPath.set(entry.path, list);
  }
}

/**
 * Панель словами.
 *
 * Первая строка — не заголовок, а ответ на вопрос, который человек задаст,
 * увидев панель впервые: что это и надо ли что-то делать.
 */
export function describeBoard(entries: readonly BoardEntry[]): string[] {
  if (entries.length === 0) {
    return [
      "Расхождений нет.",
      "",
      "Здесь появятся места, где ваша правка и приложение разошлись: вы поправили " +
        "цитату в заметке, а в Beresta её текст изменился. Такие блоки Beresta " +
        "перестаёт перерисовывать — они остаются вашими.",
    ];
  }

  const lines = [
    "Здесь места, где ваша правка и приложение разошлись.",
    "",
    "Делать ничего не нужно: ваш текст остаётся вашим, эти блоки Beresta больше не " +
      "перерисовывает. Свежую версию из приложения она кладёт свёрнутым " +
      "предупреждением над вашим текстом.",
    "",
  ];

  const byPath = new Map<string, BoardEntry[]>();
  for (const entry of entries) {
    byPath.set(entry.path, [...(byPath.get(entry.path) ?? []), entry]);
  }
  for (const [path, list] of byPath) {
    lines.push(`${path} — ${list.length} ${plural(list.length)}`);
    for (const entry of list) {
      const anchor = entry.anchor === undefined ? "" : ` (${entry.anchor})`;
      lines.push(`    ${entry.words}${anchor}`);
      lines.push(`    данные на ${entry.at}`);
    }
    lines.push("");
  }
  return lines;
}

// MARK: - Внутреннее

function kindOf(conflict: "edited" | "edited-and-changed" | "unknown-origin" | "gone-in-app" | "head"): BoardKind {
  switch (conflict) {
    case "edited":
      return "ваша-правка";
    case "edited-and-changed":
      return "правка-и-новая-версия";
    case "unknown-origin":
      return "не-помню";
    case "gone-in-app":
      return "нет-в-приложении";
    case "head":
      return "ваш-заголовок";
  }
}

function isOwnEdit(kind: BoardKind): boolean {
  return (
    kind === "ваша-правка" ||
    kind === "правка-и-новая-версия" ||
    kind === "ваш-заголовок" ||
    kind === "нет-в-приложении"
  );
}

function plural(count: number): string {
  const tens = count % 100;
  if (tens >= 11 && tens <= 14) return "записей";
  const ones = count % 10;
  if (ones === 1) return "запись";
  if (ones >= 2 && ones <= 4) return "записи";
  return "записей";
}
