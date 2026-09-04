import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Где лежит плагин: внутри монорепозитория Beresta или в своём публичном
 * репозитории (github.com/SecondBrainProd/beresta-obsidian).
 *
 * Плагин открыт, приложение — нет (D-BRS-008). Публичный репозиторий — копия
 * `packages/obsidian-plugin` плюс `docs/` открытого формата; Swift-стороны в
 * нём нет и не будет. Проверки, которые сверяют плагин с приложением — адрес
 * снимка, имя и версия формата, узел ссылки, текст про настройки, документ
 * формата против сериализатора, — там гоняться не могут: им нечего читать.
 * Они пропускаются по этому признаку, и пропуск виден в отчёте vitest как
 * «skipped», а не как зелёное.
 *
 * Признак — не «есть ли нужный Swift-файл»: пропажа файла в монорепозитории
 * — красное с именем файла, а не пропуск. Признак — есть ли пакет ядра вовсе.
 *
 * Найдено 20260904: копия выложена 20260903, и `npm test` в ней был красным с
 * первого дня — пять файлов проверок читали то, чего в копии нет.
 */
export const MONOREPO_ROOT = new URL("../../../", import.meta.url);

export const IN_MONOREPO = existsSync(
  fileURLToPath(new URL("packages/beresta-core/Package.swift", MONOREPO_ROOT)),
);

/**
 * Корень документов открытого формата: в монорепозитории — `docs/` дерева,
 * в публичной копии — её собственный `docs/`.
 */
export const DOCS_ROOT = IN_MONOREPO ? MONOREPO_ROOT : new URL("../", import.meta.url);
