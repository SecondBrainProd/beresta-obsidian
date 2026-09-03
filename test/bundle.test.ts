import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { buildOptions } from "../esbuild.config.mjs";

// Что попадает в собранный плагин — проверкой, а не обещанием.
//
// **Зачем это отдельным тестом.** README говорит человеку и проверяющему
// каталога две вещи: плагин не обращается в сеть ни разу и не тащит Node.
// Обещание в README — текст, который никто не перечитывает после первой
// правки кода. Здесь тот же самый пакет, который уедет в релиз, собирается
// заново и обыскивается — тест краснеет в тот же день, а не при подаче в
// каталог через три месяца.
//
// **Проверка сама создаёт то, что мерит.** Она не читает `main.js`, лежащий
// рядом (его могло не быть, он мог остаться с прошлой недели или быть собран
// другими настройками) — она зовёт `buildOptions()` из настоящего файла
// сборки и строит пакет во временный каталог. Зелёный результат означает
// «собралось и чисто», а не «файла не нашлось, придраться не к чему».
//
// **Обыска пакета одного мало, и это выяснилось задачей 9.** В пакет попадает
// только то, до чего дотянулись импорты от точки входа: разбор снимка написан,
// но точка входа его не зовёт до задачи 14 — значит в собранном `main.js` его
// нет, и обыск его не видит. Обещание «сети нет» при этом дано про ПЛАГИН, а
// не про «ту его часть, что уже подключена». Поэтому обыск двойной: собранный
// пакет и, отдельно, все исходники `src/` до сборки.

const packageRoot = fileURLToPath(new URL("..", import.meta.url));

let outDir = "";
let bundle = "";

beforeAll(async () => {
  outDir = mkdtempSync(join(tmpdir(), "beresta-bundle-"));
  const outfile = join(outDir, "main.js");
  await build(
    buildOptions({
      absWorkingDir: packageRoot,
      outfile,
      logLevel: "silent",
    }),
  );
  bundle = readFileSync(outfile, "utf8");
}, 60_000);

afterAll(() => {
  if (outDir) rmSync(outDir, { recursive: true, force: true });
});

describe("собранный плагин", () => {
  test("собирается в один файл и ничего рядом не кладёт", () => {
    expect(readdirSync(outDir)).toEqual(["main.js"]);
    expect(bundle.length).toBeGreaterThan(0);
  });

  // Каталог требует объявлять сетевые обращения отдельным разделом README.
  // Наш ответ — «их нет», и он держится этим списком. Обращение на
  // `127.0.0.1` тоже сетевое: местный адрес не делает запрос не запросом.
  test("не обращается в сеть ни одним из известных способов", () => {
    const network = [
      "fetch(",
      "XMLHttpRequest",
      "WebSocket",
      "EventSource",
      "sendBeacon",
      "requestUrl",
      "navigator.connection",
      "http://",
      "https://",
      "ws://",
      "127.0.0.1",
      "localhost",
    ];
    const found = network.filter((needle) => bundle.includes(needle));
    expect(found, `сетевое в собранном плагине: ${found.join(", ")}`).toEqual([]);
  });

  // Node в плагине нет — ни модулем, ни глобальной переменной. Иначе плагин
  // работает на настольном Obsidian и падает на мобильном, а мы обещали не
  // объявлять себя настольным (`isDesktopOnly` в манифесте отсутствует).
  test("не тащит Node: ни встроенных модулей, ни его глобальных имён", () => {
    const node = [
      'require("fs")',
      'require("path")',
      'require("os")',
      'require("child_process")',
      'require("node:',
      "process.env",
      "__dirname",
      "__filename",
      "Buffer.from",
    ];
    const found = node.filter((needle) => bundle.includes(needle));
    expect(found, `Node в собранном плагине: ${found.join(", ")}`).toEqual([]);
  });

  // Политика каталога: обфускация и подгрузка кода со стороны запрещены
  // безусловно. `eval` и `new Function` — то, чем и то, и другое делается.
  test("не исполняет кода, которого нет в самом файле", () => {
    for (const needle of ["eval(", "new Function(", "import(", "importScripts"]) {
      expect(bundle, `динамическое исполнение: ${needle}`).not.toContain(needle);
    }
  });

  // Телеметрия запрещена политикой каталога безусловно. Отдельной строкой,
  // потому что запрет касается и «безобидного» счётчика запусков.
  test("не ведёт счёта за человеком", () => {
    for (const needle of ["analytics", "telemetry", "posthog", "sentry", "gtag"]) {
      expect(bundle.toLowerCase(), `телеметрия: ${needle}`).not.toContain(needle);
    }
  });

  // У каталога кроме политики есть и простая механика: Obsidian забирает
  // `module.exports` пакета и зовёт `onload` у полученного класса. Пакет без
  // экспорта включается без единой ошибки и не делает ничего.
  test("отдаёт Obsidian класс плагина", () => {
    expect(bundle).toContain("module.exports");
    expect(bundle).toContain("BerestaPlugin");
  });

  // Заимствованный движок читалки и прочее в плагин не едет: у него один
  // вход и одна зависимость — само приложение Obsidian.
  test("единственная внешняя зависимость — сам Obsidian", () => {
    const required = [...bundle.matchAll(/require\("([^"]+)"\)/g)].map((m) => m[1]);
    expect([...new Set(required)]).toEqual(["obsidian"]);
  });

  // Модули, до которых точка входа ещё не дотянулась, в пакет не попадают —
  // а обещание про сеть дано про весь плагин. Ищем по ИМЕНАМ вызовов, а не по
  // «http://»: адрес в пояснении — это текст, а не обращение, и запрещать
  // писать адреса в комментариях значило бы получить проверку, которую обходят
  // переписыванием комментария.
  test("ни один модуль src/ не зовёт сеть, даже пока не попал в пакет", async () => {
    const network = [
      "fetch(",
      "XMLHttpRequest",
      "WebSocket",
      "EventSource",
      "sendBeacon",
      "requestUrl",
      "navigator.connection",
      "eval(",
      "new Function(",
    ];
    const found: string[] = [];
    const files = await sourceFiles(join(packageRoot, "src"));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      for (const needle of network) {
        if (text.includes(needle)) found.push(`${file}: ${needle}`);
      }
    }
    expect(found, `сетевое в исходниках: ${found.join(", ")}`).toEqual([]);
  });
});

/** Все `.ts` под папкой, на любой глубине. */
async function sourceFiles(folder: string): Promise<string[]> {
  const found: string[] = [];
  for (const name of await readdir(folder)) {
    const path = join(folder, name);
    if (statSync(path).isDirectory()) {
      found.push(...(await sourceFiles(path)));
    } else if (name.endsWith(".ts")) {
      found.push(path);
    }
  }
  return found;
}
