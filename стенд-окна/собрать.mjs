/*
 * Стенд вида: страница с настоящим окном привязки, снятая с настоящих данных.
 *
 * **Зачем.** 20260818 владелец открыл экран привязки и увидел то, чего не
 * видел ни один тест: кнопки внахлёст, обрезанный текст, пояснения отдельным
 * столбцом. Тесты были зелёными и были правы — они проверяют данные, а это
 * вид. Прогон глазами в самом Obsidian остаётся главной проверкой, но он
 * требует открытого окна и свободных рук владельца; стенд повторяем одной
 * командой и годится, чтобы поймать вёрстку до того, как её увидит человек.
 *
 * **Что здесь настоящее:** код окна (`src/ui/binding-modal.ts`), код экрана
 * (`src/binding/*`), собственный `styles.css` плагина и данные — снимок и
 * заметки тестового хранилища читаются настоящим `readSnapshot`/`planBinding`.
 * **Что подставлено:** приложение Obsidian (`обсидиан.mjs`) и переменные его
 * темы (`тема.css`). Поэтому стенд не доказывает ничего о поведении — только
 * вёрстку.
 *
 *   node стенд-окна/собрать.mjs --корень . --хранилище ~/Documents/Claude/beresta-test-vault \
 *        --выход /tmp/окно.html [--тёмная]
 */

import { build } from "esbuild";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ЗДЕСЬ = fileURLToPath(new URL(".", import.meta.url));

function ключ(имя, поумолчанию) {
  const index = process.argv.indexOf(имя);
  return index === -1 ? поумолчанию : process.argv[index + 1];
}

const корень = resolve(ключ("--корень", resolve(ЗДЕСЬ, "..")));
const хранилище = resolve(ключ("--хранилище", join(process.env.HOME, "Documents/Claude/beresta-test-vault")));
const выход = resolve(ключ("--выход", join(tmpdir(), "окно.html")));
const тёмная = process.argv.includes("--тёмная");

// MARK: - План: настоящий разбор снимка и заметок хранилища

const времянка = mkdtempSync(join(tmpdir(), "beresta-стенд-"));

async function собратьДляУзла(вход, имя) {
  const файл = join(времянка, имя);
  await build({ entryPoints: [вход], bundle: true, format: "esm", platform: "node", outfile: файл, logLevel: "silent" });
  return import(файл);
}

const { readSnapshot } = await собратьДляУзла(join(корень, "src/snapshot/index.ts"), "снимок.mjs");
const { planBinding } = await собратьДляУзла(join(корень, "src/binding/binding-view.ts"), "экран.mjs");

const источник = {
  async exists(путь) { return existsSync(join(хранилище, путь)); },
  async readBinary(путь) {
    const buffer = readFileSync(join(хранилище, путь));
    return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  },
};

const заметки = [];
(function обойти(папка) {
  for (const имя of readdirSync(папка)) {
    if (имя === ".obsidian" || имя === ".trash" || имя === ".beresta") continue;
    const полный = join(папка, имя);
    if (statSync(полный).isDirectory()) обойти(полный);
    else if (имя.endsWith(".md")) заметки.push({ path: relative(хранилище, полный), text: readFileSync(полный, "utf8") });
  }
})(хранилище);

const настройки = JSON.parse(readFileSync(join(хранилище, ".obsidian/plugins/beresta/data.json"), "utf8"));
const снимок = await readSnapshot(источник);
const план = planBinding(снимок, заметки, настройки.libraryFolder ?? "Библиотека");
if (план.awaitingUser.length === 0) throw new Error("в хранилище нет книг, ждущих выбора, — стенду нечего показывать");

// MARK: - Страница: настоящее окно поверх подставного Obsidian

const вход = join(времянка, "вход.mjs");
writeFileSync(
  вход,
  [
    `import { installDomHelpers } from ${JSON.stringify(join(ЗДЕСЬ, "обсидиан.mjs"))};`,
    `import { BindingModal } from ${JSON.stringify(join(корень, "src/ui/binding-modal.ts"))};`,
    "installDomHelpers(window);",
    "window.__окно = (план) => new BindingModal({}, план, () => {}).open();",
  ].join("\n"),
);

const собранное = await build({
  entryPoints: [вход],
  bundle: true,
  format: "iife",
  platform: "browser",
  alias: { obsidian: join(ЗДЕСЬ, "обсидиан.mjs") },
  write: false,
  logLevel: "silent",
});

const страница = `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><title>Окно привязки — стенд вида</title>
<style>${readFileSync(join(ЗДЕСЬ, "тема.css"), "utf8")}</style>
<style>${readFileSync(join(корень, "styles.css"), "utf8")}</style>
</head><body class="${тёмная ? "тёмная" : "светлая"}">
<script>${собранное.outputFiles[0].text}</script>
<script>window.__окно(${JSON.stringify(план)});</script>
</body></html>`;

writeFileSync(выход, страница);
console.log(`страница: ${выход}\nкниг на экране: ${план.awaitingUser.length}, заметок в хранилище: ${заметки.length}`);
