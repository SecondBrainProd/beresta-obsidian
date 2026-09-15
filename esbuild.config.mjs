// Сборка плагина: весь TypeScript из `src/` в один `main.js`.
//
// **Один файл — требование каталога, а не удобство.** Релиз плагина Obsidian
// состоит ровно из трёх файлов: `main.js`, `manifest.json`, `styles.css`.
// Никаких подгрузок во время работы: ни `import()` по сети, ни `require` со
// стороны — всё, что плагин исполняет, лежит в этом одном файле и читаемо.
//
// **Не минифицируем нарочно.** Политика каталога запрещает обфускацию, а
// граница между «сжато» и «нечитаемо» проходит не там, где хотелось бы: сжатый
// файл проверяющему приходится принимать на слово. Мы обещаем в README, что
// плагин не ходит в сеть, — и оставляем файл таким, чтобы это можно было
// проверить поиском по строке, а не поверить.
//
// Модуль умеет две вещи: собрать себя (`node esbuild.config.mjs`) и отдать
// настройки сборки тому, кто хочет собрать в другое место, — этим пользуется
// `test/bundle.test.ts`, который строит настоящий пакет и обыскивает его.

import { build, context } from "esbuild";

/** Единственный вход. Всё остальное подтягивается импортами. */
const ENTRY = "src/main.ts";

/**
 * Что не кладём в пакет.
 *
 * `obsidian` даёт само приложение во время работы. `electron` и модули
 * редактора (`@codemirror/*`, `@lezer/*`) — тоже его, класть их копию в пакет
 * значит получить второй экземпляр редактора внутри чужого.
 *
 * **Встроенных модулей Node в этом списке нет, и это решение.** Их принято
 * писать в `external`, чтобы сборка не спотыкалась; но тогда `require("fs")`
 * из случайной зависимости тихо доезжает до пакета и падает уже у человека на
 * мобильном Obsidian. Без них в списке сборка ломается **у нас**, с именем
 * модуля и файлом, который его затащил.
 */
const EXTERNAL = ["obsidian", "electron", "@codemirror/*", "@lezer/*"];

/**
 * Настройки сборки. `overrides` позволяет собрать в другое место, не трогая
 * ничего остального: проверка обязана собирать ровно то же, что и релиз.
 *
 * @param {Partial<import("esbuild").BuildOptions>} overrides
 * @returns {import("esbuild").BuildOptions}
 */
export function buildOptions(overrides = {}) {
  return {
    entryPoints: [ENTRY],
    outfile: "main.js",
    bundle: true,
    // Obsidian загружает плагин как модуль CommonJS и ждёт `module.exports`.
    format: "cjs",
    target: "es2018",
    // `browser`, а не `node`: платформа решает, какие условия экспорта пакетов
    // считать своими. При `node` сборщик предпочёл бы ветки для Node у любой
    // зависимости — ровно то, чего в плагине быть не должно.
    platform: "browser",
    external: EXTERNAL,
    treeShaking: true,
    minify: false,
    sourcemap: false,
    logLevel: "info",
    banner: {
      js:
        "/*\n" +
        " * Beresta — плагин Obsidian. Собран из исходников esbuild, не минифицирован.\n" +
        " * Лицензия MIT, © 2026 Dmitriy Laukhin (Second Brain Production). Исходники открыты.\n" +
        " * Плагин не обращается в сеть и не читает ничего за пределами хранилища.\n" +
        " */",
    },
    ...overrides,
  };
}

const isEntryPoint = process.argv[1]?.endsWith("esbuild.config.mjs") ?? false;

if (isEntryPoint) {
  const watch = process.argv.includes("--watch");
  if (watch) {
    const ctx = await context(buildOptions({ sourcemap: "inline" }));
    await ctx.watch();
  } else {
    await build(buildOptions());
  }
}
