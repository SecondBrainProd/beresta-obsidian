import { MarkdownView, Notice, Plugin, TFile, normalizePath, type WorkspaceLeaf } from "obsidian";

import {
  applyChoices,
  bindingNoticeWords,
  planBinding,
  readBindings,
  type BindingAftermath,
  type Choice,
  type VaultNote,
} from "./binding/binding-view";
import { commandSpecs, type CommandActions } from "./commands";
import { BOOK_ID_KEY } from "./merge/frontmatter";
import { PollSchedule } from "./poller";
import { readState, stateToJSON, type BerestaSettings } from "./settings";
import { statusHint, statusLine, syncNowWords } from "./status";
import type { NoteStore } from "./sync/pass";
import { SyncRunner, type RunOutcome, type RunnerPorts, type TickOptions } from "./sync/runner";
import { BackupModal } from "./ui/backup-modal";
import { BindingModal } from "./ui/binding-modal";
import { CONFLICTS_VIEW_TYPE, ConflictsPanel } from "./ui/conflicts-panel";
import { BerestaSettingTab } from "./ui/settings-tab";
import { listBackups, restoreBackup, type BackupStore } from "./write/backup";
import { indexPath } from "./snapshot/paths";

/**
 * Точка входа плагина.
 *
 * **Как устроен обмен.** Приложение Beresta пишет машиночитаемый снимок своих
 * выписок в одну скрытую папку внутри хранилища — `<хранилище>/.beresta/`.
 * Плагин этот снимок читает и раскладывает выписки по заметкам о книгах. В
 * заметки не пишет никто, кроме плагина; приложение о заметках не знает вовсе.
 *
 * **Чего здесь нет и не появится.** Ни одного обращения в сеть — ни на
 * удалённый узел, ни на `127.0.0.1`. Ни одного модуля Node: описаний Node нет
 * даже в проверке типов (`tsconfig.json`, пустой `types`), поэтому `require`
 * и `fs` тут не имена, а ошибки сборки. Ни телеметрии, ни самообновления —
 * оба запрещены политикой каталога безусловно, и оба запрещены нам замыслом.
 * Читаем и пишем только внутри хранилища, средствами самого Obsidian.
 *
 * **Здесь только проводка.** Ни одного решения: что считать изменением снимка
 * — `poller.ts`, что и в каком порядке делать с заметкой — `sync/pass.ts`,
 * когда и по каким правилам это затевать — `sync/runner.ts`, какими словами
 * говорить — `status.ts` и `conflicts-view.ts`. Всё это проверяется обычными
 * тестами без Obsidian; здесь остаётся то, что тестом не проверяется в
 * принципе, — обращения к самому приложению, и их немного нарочно.
 */
export default class BerestaPlugin extends Plugin {
  private runner!: SyncRunner;
  private schedule = new PollSchedule();
  private statusEl: HTMLElement | undefined;
  private focused = true;
  /** Проход идёт: второй в это же время затевать нечего. */
  private busy = false;

  override async onload(): Promise<void> {
    // Сдвиг часового пояса спрашивается у машины ЗДЕСЬ и только при первом
    // запуске: `readState` подставит его лишь тогда, когда в `data.json` своего
    // нет. Дальше он живёт настройкой — иначе перелёт владельца или второй Мак
    // в другом поясе перерисовали бы все блоки, а перерисованный блок задача 11
    // читает как правку человека.
    const state = readState(await this.loadData(), -new Date().getTimezoneOffset());
    this.runner = new SyncRunner(this.ports(), state);
    this.applySchedule(state.settings);
    this.focused = document.hasFocus();

    this.statusEl = this.addStatusBarItem();
    this.paint();

    for (const spec of commandSpecs(this.actions())) {
      if (!spec.needsNote) {
        this.addCommand({ id: spec.id, name: spec.name, callback: () => void spec.run("") });
        continue;
      }
      this.addCommand({
        id: spec.id,
        name: spec.name,
        checkCallback: (checking: boolean) => {
          const path = this.app.workspace.getActiveFile()?.path;
          if (path === undefined) return false;
          if (!checking) void spec.run(path);
          return true;
        },
      });
    }

    // Страница настроек читает настройки КАЖДЫЙ раз, когда её открывают, а не
    // тот их снимок, что был при загрузке плагина: иначе поправленное значение
    // возвращается на прежнее при следующем открытии страницы, и человек
    // решает, что настройка не сохраняется.
    const plugin = this;
    this.addSettingTab(
      new BerestaSettingTab(this.app, this, {
        get settings(): BerestaSettings {
          return plugin.runner.state.settings;
        },
        save: async (next) => {
          await this.saveSettings(next);
        },
      }),
    );

    this.registerView(CONFLICTS_VIEW_TYPE, (leaf: WorkspaceLeaf) => {
      const panel = new ConflictsPanel(leaf);
      panel.listenTo(() => this.runner.board.entries);
      return panel;
    });

    // Фокус окна — единственное, что решает частоту опроса. Спрашивать его у
    // `document.hasFocus()` в каждом такте нельзя: в Electron он врёт при
    // открытом окне настроек, а события приходят точно.
    this.registerDomEvent(window, "focus", () => {
      this.focused = true;
    });
    this.registerDomEvent(window, "blur", () => {
      this.focused = false;
    });

    // Открыли заметку с привязкой — сверяем ЕЁ книгу, и только её. Это самый
    // частый случай, когда человек хочет видеть свежее: он пришёл читать
    // конкретный конспект.
    this.registerEvent(
      this.app.workspace.on("file-open", (file) => {
        if (file === null) return;
        if (this.bookIdsOf(file).length === 0) return;
        void this.run("заметка", { only: new Set([file.path]) });
      }),
    );

    // Один таймер на плагин, снимается Obsidian при выключении. Такт частый и
    // дешёвый: он только спрашивает расписание, смотреть или нет.
    this.registerInterval(window.setInterval(() => void this.poll(), 1000));

    this.app.workspace.onLayoutReady(() => {
      void this.run("загрузка");
    });
  }

  // MARK: - Заходы

  private async poll(): Promise<void> {
    if (!this.schedule.due(Date.now(), this.focused)) return;
    await this.run("опрос");
  }

  private async run(
    reason: "загрузка" | "опрос" | "команда" | "заметка",
    options: TickOptions = {},
  ): Promise<RunOutcome | undefined> {
    if (this.busy) return undefined;
    this.busy = true;
    try {
      return await this.runner.tick(reason, options);
    } catch (error) {
      // Проход, упавший непредвиденно, обязан сказать это вслух: плагин,
      // который молча перестал работать, выглядит как плагин, которому нечего
      // показать.
      new Notice(`Beresta: проход не удался — ${(error as Error).message}`, 15_000);
      return undefined;
    } finally {
      this.busy = false;
      this.paint();
      this.redrawPanel();
    }
  }

  /**
   * Проход по выбору человека — тот, который нельзя пропустить.
   *
   * Обычный заход при занятом проходе молча уходит, и для опроса это верно:
   * те же байты разложит следующий такт. Для нажатия «Привязать выбранные»
   * это тихая потеря: привязки нет ещё нигде — ни во frontmatter, ни в памяти,
   * — она живёт только в аргументах ЭТОГО захода. Пропустить его значит
   * выбросить выбор человека и не сказать ни слова, то есть ровно то, на что
   * жаловался прогон глазами 20260818.
   *
   * Поэтому здесь ждём чужой проход (он короткий: секунды на всё хранилище), а
   * если он почему-то затянулся — говорим вслух, а не молчим.
   */
  private async runChoice(options: TickOptions): Promise<RunOutcome | undefined> {
    const until = Date.now() + 10_000;
    while (this.busy && Date.now() < until) {
      await new Promise((wake) => window.setTimeout(wake, 100));
    }
    if (this.busy) {
      new Notice(
        "Beresta: выбор не применён — предыдущий проход ещё идёт. Повторите " +
          "команду «Привязать книги к заметкам».",
        12_000,
      );
      return undefined;
    }
    return await this.run("команда", options);
  }

  // MARK: - Что показываем

  private paint(): void {
    if (this.statusEl === undefined) return;
    const status = this.runner.status;
    this.statusEl.setText(statusLine(status));
    this.statusEl.setAttr(
      "aria-label",
      statusHint(status, Date.now(), this.runner.state.settings.timeZoneOffsetMinutes).join("\n"),
    );
  }

  private redrawPanel(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(CONFLICTS_VIEW_TYPE)) {
      const view = leaf.view;
      if (view instanceof ConflictsPanel) view.draw();
    }
  }

  // MARK: - Команды

  private actions(): CommandActions {
    return {
      syncNow: async () => {
        // Команда — это «посмотри как следует»: память об указателе забывается,
        // и снимок раскладывается заново, даже если байты те же. Человек нажал
        // ровно потому, что не верит тому, что видит.
        this.runner.forgetSnapshot();
        await this.run("команда");
        // Ответ — числами, а не копией строки состояния. Прогон глазами
        // 20260818 (находка 4): команда отвечала той же фразой, которая уже
        // написана в углу окна, — то есть человеку, не поверившему строке,
        // показывали её же. Слова считает `syncNowWords` и проверяет обычный
        // тест; строк в ответе бывает до пяти, поэтому и время подлиннее.
        new Notice(syncNowWords(this.runner.status), 15_000);
      },
      bindBooks: async () => {
        await this.bindBooks();
      },
      showConflicts: async () => {
        await this.showConflicts();
      },
      returnSection: async (path) => {
        // Память об указателе забывается ПЕРЕД проходом — как в `bindBooks`.
        // Без этого команда на живом хранилище почти всегда не делала ничего и
        // не говорила ни слова: байты снимка те же, проход считает, что смотреть
        // не на что, и уходит молча. А зовут её ровно тогда, когда человек уже
        // потерял секцию и волнуется (находка третьего прогона глазами,
        // 20260819: «молчит и не работает» — хуже, чем «работает и молчит»).
        this.runner.forgetSnapshot();
        const before = await this.app.vault.adapter.read(path).catch(() => undefined);
        await this.run("команда", {
          only: new Set([path]),
          mayCreateSection: new Set([path]),
        });
        const after = await this.app.vault.adapter.read(path).catch(() => undefined);
        // Ответ обязателен и в удаче, и в отказе: молчание здесь читается как
        // «плагин сломан», а не как «возвращать нечего».
        if (after !== undefined && after !== before) {
          new Notice("Beresta: секция вернулась в заметку.", 6_000);
        } else if (after === undefined) {
          new Notice("Beresta: заметку не прочитать — секция не возвращена.", 8_000);
        } else {
          new Notice(
            "Beresta: секция не вернулась. Похоже, эта заметка не привязана ни к одной " +
              "книге — привяжите её командой «Привязать книги к заметкам».",
            10_000,
          );
        }
      },
      confirmRemovals: async (path) => {
        await this.run("команда", { only: new Set([path]), allowRemovals: new Set([path]) });
      },
      restoreVersion: async (path) => {
        await this.restoreVersion(path);
      },
    };
  }

  private async bindBooks(): Promise<void> {
    this.runner.forgetSnapshot();
    await this.run("команда");
    const snapshot = this.runner.lastSnapshot;
    if (snapshot === undefined || snapshot.kind !== "present") {
      new Notice(
        `Beresta: выгрузки в этом хранилище нет (${indexPath()}). Сделайте выгрузку в ` +
          "приложении — и книги появятся здесь.",
        10_000,
      );
      return;
    }

    const notes = await this.allNotes();
    const plan = planBinding(snapshot, notes, this.runner.state.settings.libraryFolder);
    new BindingModal(this.app, plan, (choices) => {
      void this.applyBinding(plan, choices, notes);
    }).open();
  }

  private async applyBinding(
    plan: ReturnType<typeof planBinding>,
    choices: ReadonlyMap<string, Choice>,
    notes: readonly VaultNote[],
  ): Promise<void> {
    const outcome = applyChoices(plan, choices, readBindings(notes));
    const bindings = new Map<string, readonly string[]>(outcome.bindings);
    for (const creation of outcome.creations) bindings.set(creation.path, [creation.bookUUID]);
    if (bindings.size === 0) return;

    // Привязки ещё нет во frontmatter — её впишет этот же проход. Поэтому они
    // передаются заходу отдельно: иначе первый проход не увидел бы ни одной.
    this.runner.forgetSnapshot();
    const run = await this.runChoice({
      alsoBind: bindings,
      creating: new Set(outcome.creations.map((one) => one.path)),
      only: new Set(bindings.keys()),
    });
    // Прохода не было или он упал — про это уже сказано вслух своими словами.
    // Второе сообщение здесь только повторило бы то же самое другими.
    if (run === undefined) return;
    if (run.report === undefined) {
      // Проход состоялся, а раскладывать оказалось нечего: выгрузка исчезла
      // или перестала читаться между открытием окна и нажатием. Молчать здесь
      // нельзя — человек только что нажал.
      new Notice(
        "Beresta: выписки не легли — выгрузки Beresta сейчас не видно. Привязка " +
          "не записана: выберите заново, когда выгрузка появится.",
        12_000,
      );
      return;
    }

    const report = run.report;
    const mine = (path: string): boolean => bindings.has(path);
    const chosen = [...choices.values()].filter((one) => one.kind !== "skip").length;
    this.tellBinding({
      chosen,
      written: report.written
        .filter(mine)
        .map((path) => ({ path, quotes: report.quotes[path] ?? 0 })),
      deferred: report.deferred.filter(mine),
      failed: [...report.missing, ...report.refusals.map((one) => one.path)].filter(mine),
    });
  }

  /**
   * Ответ на нажатие «Привязать выбранные»: числа и ссылка на заметку.
   *
   * **Единственное место плагина, где путь заметки — ссылка, а не текст.**
   * Прогон глазами 20260818: человек нажал кнопку, окно закрылось, и на
   * экране не изменилось ничего — при том, что в заметку легли 40 цитат.
   * Строка состояния тут не помощник: она говорит про снимок выгрузки и после
   * привязки остаётся прежней. Поэтому ответ — уведомление, и в нём сразу
   * дорога туда, где результат: нажатие на путь открывает заметку.
   *
   * Слова считает `bindingNoticeWords` и проверяет обычный тест; здесь только
   * сборка узлов и обращение к Obsidian.
   */
  private tellBinding(after: BindingAftermath): void {
    const words = bindingNoticeWords(after);
    let notice: Notice | undefined;
    const message = createFragment((box) => {
      box.createDiv({ text: words.head });
      for (const one of words.notes) {
        const line = box.createDiv({ cls: "beresta-notice-note" });
        const link = line.createEl("a", { text: one.path, cls: "beresta-notice-link" });
        link.addEventListener("click", (event) => {
          event.preventDefault();
          notice?.hide();
          void this.app.workspace.openLinkText(one.path, "", false);
        });
        line.createSpan({ text: ` ${one.tail}` });
      }
      for (const line of words.rest) box.createDiv({ text: line, cls: "beresta-notice-rest" });
    });
    // Дольше обычных двенадцати секунд: это уведомление не только читают, по
    // нему ещё и нажимают, а путь заметки успеть прочитать надо целиком.
    notice = new Notice(message, 20_000);
  }

  private async restoreVersion(path: string): Promise<void> {
    const store = this.backupStore();
    const records = await listBackups(store, path);
    new BackupModal(this.app, path, records, (id) => {
      void (async () => {
        const restored = await restoreBackup(store, id);
        if (restored === undefined) return;
        const file = this.app.vault.getAbstractFileByPath(restored.path);
        if (!(file instanceof TFile)) return;
        await this.app.vault.process(file, () => restored.text);
        // Память о заметке забывается вместе с возвратом: блоки в
        // восстановленном тексте написаны нами, но НЕ в том виде, в каком мы
        // помним, — и выдать их за свои значило бы перерисовать поверх того,
        // ради чего человек и откатывался. Незнакомые блоки Beresta не трогает
        // (`unknown-origin`), новые выписки приезжают по-прежнему.
        this.runner.forgetNote(restored.path);
        new Notice(
          `Beresta: заметка возвращена к версии от ${
            records.find((one) => one.id === id)?.savedAt ?? "прежней"
          }. Блоки в ней Beresta теперь не помнит и потому не трогает; новые выписки ` +
            "будут приезжать по-прежнему.",
          12_000,
        );
      })();
    }).open();
  }

  private async showConflicts(): Promise<void> {
    const open = this.app.workspace.getLeavesOfType(CONFLICTS_VIEW_TYPE);
    const leaf = open[0] ?? this.app.workspace.getRightLeaf(false);
    if (leaf === null) return;
    if (open.length === 0) await leaf.setViewState({ type: CONFLICTS_VIEW_TYPE, active: true });
    await this.app.workspace.revealLeaf(leaf);
    this.redrawPanel();
  }

  // MARK: - Настройки

  private async saveSettings(next: BerestaSettings): Promise<void> {
    this.runner.applySettings(next);
    this.applySchedule(next);
    await this.saveData(stateToJSON(this.runner.state));
    // Сдвиг пояса меняет БАЙТЫ блоков, значит снимок надо разложить заново.
    this.runner.forgetSnapshot();
    await this.run("команда");
  }

  private applySchedule(settings: BerestaSettings): void {
    this.schedule = new PollSchedule(settings.focusedIntervalMs, settings.unfocusedIntervalMs);
  }

  // MARK: - Порты к Obsidian

  private ports(): RunnerPorts {
    const adapter = this.app.vault.adapter;
    return {
      source: {
        exists: (path) => adapter.exists(path),
        readBinary: (path) => adapter.readBinary(path),
        stat: async (path) => {
          const found = await adapter.stat(path);
          if (found === null || found.type !== "file") return undefined;
          return { mtime: found.mtime, size: found.size };
        },
      },
      notes: this.noteStore(),
      backups: this.backupStore(),
      bindings: async () => this.bindings(),
      persist: async (state) => {
        await this.saveData(stateToJSON(state));
      },
      now: () => Date.now(),
      announce: (line) => {
        new Notice(line, 12_000);
      },
    };
  }

  private noteStore(): NoteStore {
    const vault = this.app.vault;
    return {
      exists: async (path) => vault.getAbstractFileByPath(path) instanceof TFile,
      read: async (path) => await vault.read(this.fileAt(path)),
      create: async (path, text) => {
        const at = path.lastIndexOf("/");
        if (at > 0) {
          const folder = normalizePath(path.slice(0, at));
          if (vault.getAbstractFileByPath(folder) === null) await vault.createFolder(folder);
        }
        await vault.create(path, text);
      },
      process: async (path, revise) => {
        await vault.process(this.fileAt(path), revise);
      },
      editorText: (path) => {
        for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
          const view = leaf.view;
          if (view instanceof MarkdownView && view.file?.path === path) {
            return view.editor.getValue();
          }
        }
        return undefined;
      },
    };
  }

  private backupStore(): BackupStore {
    const adapter = this.app.vault.adapter;
    const home = this.manifest.dir ?? `${this.app.vault.configDir}/plugins/${this.manifest.id}`;
    const at = (path: string): string => normalizePath(`${home}/${path}`);
    return {
      read: async (path) => {
        const file = at(path);
        return (await adapter.exists(file)) ? await adapter.read(file) : undefined;
      },
      write: async (path, text) => {
        const file = at(path);
        const folder = file.slice(0, file.lastIndexOf("/"));
        if (!(await adapter.exists(folder))) await adapter.mkdir(folder);
        await adapter.write(file, text);
      },
      remove: async (path) => {
        const file = at(path);
        if (await adapter.exists(file)) await adapter.remove(file);
      },
    };
  }

  /**
   * Кто с какой книгой связан — по frontmatter, а не по имени файла.
   *
   * Читается из `metadataCache`, а не чтением ста двадцати файлов: опрос ходит
   * сюда раз в пять секунд, и разбор всего хранилища на каждый такт был бы
   * платой за то, что Obsidian уже посчитал.
   */
  private async bindings(): Promise<Map<string, readonly string[]>> {
    const found = new Map<string, readonly string[]>();
    for (const file of this.app.vault.getMarkdownFiles()) {
      const ids = this.bookIdsOf(file);
      if (ids.length > 0) found.set(file.path, ids);
    }
    return found;
  }

  private bookIdsOf(file: TFile): string[] {
    const raw = this.app.metadataCache.getFileCache(file)?.frontmatter?.[BOOK_ID_KEY];
    if (typeof raw === "string") return raw.trim() === "" ? [] : [raw.trim()];
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((one): one is string => typeof one === "string")
      .map((one) => one.trim())
      .filter((one) => one !== "");
  }

  /** Все заметки хранилища текстом — нужны только экрану привязки. */
  private async allNotes(): Promise<VaultNote[]> {
    const notes: VaultNote[] = [];
    for (const file of this.app.vault.getMarkdownFiles()) {
      notes.push({ path: file.path, text: await this.app.vault.cachedRead(file) });
    }
    return notes;
  }

  private fileAt(path: string): TFile {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) throw new Error(`заметки нет на месте: ${path}`);
    return file;
  }
}

/**
 * Адрес снимка внутри хранилища — общая граница со Swift.
 *
 * Сами объявления и разбор доводов, почему они именно такие, переехали в
 * `src/snapshot/paths.ts`: к ним обращается разбор снимка, а к разбору снимка
 * обращается точка входа, и объявления в точке входа замкнули бы импорты в
 * петлю. Здесь они перевыставлены, чтобы прежние потребители — в том числе
 * сверка с исходником Swift в `test/vault-address.test.ts` — ничего не
 * заметили.
 */
export {
  EXPORT_BOOKS_FOLDER_NAME,
  EXPORT_FOLDER_NAME,
  EXPORT_INDEX_FILE_NAME,
} from "./snapshot/paths";
