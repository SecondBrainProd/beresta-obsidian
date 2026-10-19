import { MarkdownView, Notice, Plugin, TFile, normalizePath, type WorkspaceLeaf } from "obsidian";

import { BindingIndex } from "./binding/index";

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
import { FormatTemplates, notePathFor } from "./formats";
import { FORMAT_KEY, renderNote } from "./render/note";
import { FormatPickModal, BookPickModal } from "./ui/format-modals";
import type { NoteFormat } from "./settings";
import type { SnapshotBook } from "./snapshot/model";
import { BOOK_ID_KEY } from "./merge/frontmatter";
import { PollSchedule } from "./poller";
import { interfaceLanguage } from "./render/defaults";
import { readState, stateToJSON, type BerestaSettings } from "./settings";
import { statusHint, statusLine, syncNowWords } from "./status";
import type { NoteStore } from "./sync/pass";
import { SyncRunner, type RunOutcome, type RunnerPorts, type TickOptions } from "./sync/runner";
import { BackupModal, backupTroubleLine } from "./ui/backup-modal";
import { BindingModal } from "./ui/binding-modal";
import { CONFLICTS_VIEW_TYPE, ConflictsPanel } from "./ui/conflicts-panel";
import { BerestaSettingTab } from "./ui/settings-tab";
import { fill, panelWords, type PanelWords } from "./ui/words";
import {
  BACKUP_FOLDER,
  readBackupIndex,
  restoreBackup,
  type BackupStore,
} from "./write/backup";
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
  private formats!: FormatTemplates;
  /** Привязки «заметка → книги»: одно перечисление при загрузке, дальше события. */
  private bindingIndex!: BindingIndex<TFile>;
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
    // Шаблоны форматов читаются ДО первого прохода: проход — чистая функция и
    // файлов посреди отрисовки не ждёт (план шаблонов, задачи 3–5).
    this.formats = new FormatTemplates(
      {
        read: async (path) => await this.app.vault.adapter.read(normalizePath(path)),
        formatOf: (path) => {
          const file = this.app.vault.getAbstractFileByPath(path);
          if (!(file instanceof TFile)) return undefined;
          const value: unknown = this.app.metadataCache.getFileCache(file)?.frontmatter?.[FORMAT_KEY];
          return typeof value === "string" ? value : undefined;
        },
      },
      () => this.runner.state.settings,
      () => this.words,
    );
    this.runner = new SyncRunner(this.ports(), state);
    await this.formats.reload();
    this.applySchedule(state.settings);
    this.focused = document.hasFocus();

    this.statusEl = this.addStatusBarItem();
    this.paint();

    for (const spec of commandSpecs(this.actions(), this.words.commands)) {
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

    this.registerFormatCommands();
    // Правка файла шаблона действует со следующего прохода: человек поправил
    // шаблон и ждёт, что блоки станут новыми (П04).
    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (this.formats.paths().has(file.path)) void this.formats.reload();
      }),
    );
    // Рекомендация каталога к 0.3.3 (Vault Enumeration): хранилище
    // перечисляется здесь и ещё раз, когда кэш дочитан (`resolved`, холодный
    // старт), а не на каждый такт опроса; дальше указатель правят события.
    this.bindingIndex = new BindingIndex<TFile>({
      files: () => this.app.vault.getMarkdownFiles(),
      idsOf: (file) => this.bookIdsOf(file),
    });
    this.bindingIndex.rebuild();
    let resolvedOnce = false;
    this.registerEvent(
      this.app.metadataCache.on("resolved", () => {
        if (resolvedOnce) return;
        resolvedOnce = true;
        this.bindingIndex.rebuild();
      }),
    );
    this.registerEvent(this.app.metadataCache.on("changed", (file) => this.bindingIndex.refresh(file)));
    this.registerEvent(
      this.app.vault.on("delete", (file) => {
        if (file instanceof TFile) this.bindingIndex.forget(file.path);
      }),
    );
    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        if (file instanceof TFile) this.bindingIndex.rename(file, oldPath);
      }),
    );

    // Страница настроек читает настройки КАЖДЫЙ раз, когда её открывают, а не
    // тот их снимок, что был при загрузке плагина: иначе поправленное значение
    // возвращается на прежнее при следующем открытии страницы, и человек
    // решает, что настройка не сохраняется.
    this.addSettingTab(
      new BerestaSettingTab(this.app, this, {
        settingsNow: () => this.runner.state.settings,
        save: async (next) => {
          await this.saveSettings(next);
        },
        // Готовые форматы кладут файлы шаблонов — и НИКОГДА не перезаписывают
        // существующий: человек мог уже править свой «Книга».
        createFile: async (path, text) => {
          const normalized = normalizePath(path);
          if (await this.app.vault.adapter.exists(normalized)) return false;
          const at = normalized.lastIndexOf("/");
          if (at > 0) {
            const folder = normalized.slice(0, at);
            if (this.app.vault.getAbstractFileByPath(folder) === null) await this.app.vault.createFolder(folder);
          }
          await this.app.vault.create(normalized, text);
          return true;
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

  /** Слова панелей — по языку интерфейса в момент, когда они нужны. */
  private get words(): PanelWords {
    return panelWords(interfaceLanguage());
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
      new Notice(
        fill(this.words.notices.passFailed, { message: (error as Error).message }),
        15_000,
      );
      return undefined;
    } finally {
      this.busy = false;
      this.paint();
      this.redrawPanel();
      this.tellGoneFormats();
    }
  }

  /** Имена форматов, о пропаже которых уже сказано, — чтобы не повторять каждым тактом. */
  private readonly goneSaid = new Set<string>();

  /**
   * Заметки, помнящие формат, которого больше нет, — вслух, один раз на имя
   * (Н4 приёмки 20261012). Проход рисует их стандартным шаблоном, и без слов
   * человек видел бы лишь «блоки стали другими».
   */
  private tellGoneFormats(): void {
    for (const [name, paths] of this.formats.takeGone()) {
      if (this.goneSaid.has(name)) continue;
      this.goneSaid.add(name);
      new Notice(
        fill(this.words.formats.formatGone, { format: name, paths: [...paths].sort().join(", ") }),
        15_000,
      );
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
      new Notice(this.words.notices.choiceNotApplied, 12_000);
      return undefined;
    }
    return await this.run("команда", options);
  }

  // MARK: - Что показываем

  private paint(): void {
    if (this.statusEl === undefined) return;
    const status = this.runner.status;
    this.statusEl.setText(statusLine(status, this.words));
    this.statusEl.setAttr(
      "aria-label",
      statusHint(
        status,
        Date.now(),
        this.runner.state.settings.timeZoneOffsetMinutes,
        this.words,
      ).join("\n"),
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
        new Notice(syncNowWords(this.runner.status, this.words), 15_000);
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
          new Notice(this.words.notices.sectionReturned, 6_000);
        } else if (after === undefined) {
          new Notice(this.words.notices.noteUnreadable, 8_000);
        } else {
          new Notice(this.words.notices.sectionNotReturned, 10_000);
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
      new Notice(fill(this.words.notices.noExport, { path: indexPath() }), 10_000);
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
    // Своя копия: путь создаваемой заметки ниже может смениться по образцу формата.
    const creations = outcome.creations.map((one) => ({ ...one }));
    for (const creation of creations) bindings.set(creation.path, [creation.bookUUID]);
    if (bindings.size === 0) return;

    // «Создать новую заметку» спрашивает формат списком (слово владельца R03:
    // «Вручную при создании»). Форматов нет — вопроса нет, всё как прежде.
    const texts = new Map<string, string>();
    // Формат каждой заводимой заметки — проходу, рисующему её первую секцию.
    const creatingFormats = new Map<string, string>();
    const formats = this.runner.state.settings.formats;
    if (formats.length > 0 && creations.length > 0) {
      const format = await new Promise<NoteFormat | undefined | "cancel">((answer) => {
        const modal = new FormatPickModal(
          this.app, formats, this.words.formats.pickFormat, this.words.formats.noFormat,
          (chosen) => answer(chosen),
        );
        const close = modal.onClose.bind(modal);
        // Закрытое без выбора окно — «без формата», а не потерянный выбор
        // привязки: человек уже нажал «Привязать выбранные».
        modal.onClose = () => {
          close();
          window.setTimeout(() => answer(undefined), 0);
        };
        modal.open();
      });
      if (format !== undefined && format !== "cancel") {
        let template: string | undefined;
        try {
          template = await this.formats.noteTemplate(format);
        } catch (error) {
          new Notice((error as Error).message, 15_000);
          return;
        }
        const snapshot = this.runner.lastSnapshot;
        const byUUID = new Map(
          snapshot !== undefined && snapshot.kind === "present"
            ? snapshot.books.map((book) => [book.uuid, book] as const)
            : [],
        );
        const folder = this.runner.state.settings.libraryFolder;
        for (const creation of creations) {
          const book = byUUID.get(creation.bookUUID);
          if (book === undefined) continue;
          // Путь — по ОБРАЗЦУ формата, а не тот, что панель обещала до выбора
          // формата: иначе «Статья» из панели ложилась в `Библиотека/`, а та же
          // «Статья» командой палитры — в `Библиотека/Статьи/` (приёмка
          // 20261012, Н3). Занятый путь — та же дверь, что у команды: заметка
          // не заводится, человеку сказано словами.
          let path: string;
          try {
            path = notePathFor(format, book, folder);
          } catch (error) {
            new Notice(fill(this.words.formats.noteFailed, { message: (error as Error).message }), 15_000);
            return;
          }
          if (path !== creation.path) {
            if (this.app.vault.getAbstractFileByPath(path) instanceof TFile) {
              new Notice(fill(this.words.formats.noteExists, { path }), 8_000);
              return;
            }
            bindings.delete(creation.path);
            bindings.set(path, [creation.bookUUID]);
            creation.path = path;
          }
          try {
            texts.set(creation.path, renderNote(template ?? "{{annotations}}", book, format.name, this.words.pass));
            creatingFormats.set(creation.path, format.name);
          } catch (error) {
            new Notice(fill(this.words.formats.noteFailed, { message: (error as Error).message }), 15_000);
            return;
          }
        }
      }
    }

    // Привязки ещё нет во frontmatter — её впишет этот же проход. Поэтому они
    // передаются заходу отдельно: иначе первый проход не увидел бы ни одной.
    this.runner.forgetSnapshot();
    const release = this.formats.expectCreating(creatingFormats);
    let run: Awaited<ReturnType<typeof this.runChoice>>;
    try {
      run = await this.runChoice({
        alsoBind: bindings,
        creating: new Set(creations.map((one) => one.path)),
        only: new Set(bindings.keys()),
        initialText: (path) => texts.get(path),
      });
    } finally {
      release();
    }
    // Прохода не было или он упал — про это уже сказано вслух своими словами.
    // Второе сообщение здесь только повторило бы то же самое другими.
    if (run === undefined) return;
    if (run.report === undefined) {
      // Проход состоялся, а раскладывать оказалось нечего: выгрузка исчезла
      // или перестала читаться между открытием окна и нажатием. Молчать здесь
      // нельзя — человек только что нажал.
      new Notice(this.words.notices.bindingNotSaved, 12_000);
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
    const words = bindingNoticeWords(after, this.words);
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
    const index = await readBackupIndex(store);
    const records = index.records.filter((one) => one.path === path);
    const trouble = backupTroubleLine(
      index,
      normalizePath(`${this.pluginHome()}/${BACKUP_FOLDER}`),
      this.words.pass,
    );
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
        const savedAt = records.find((one) => one.id === id)?.savedAt;
        new Notice(
          fill(this.words.notices.restoredToVersion, {
            savedAt: savedAt ?? this.words.notices.previousVersion,
          }),
          12_000,
        );
      })();
    }, trouble).open();
  }

  private async showConflicts(): Promise<void> {
    const open = this.app.workspace.getLeavesOfType(CONFLICTS_VIEW_TYPE);
    const leaf = open[0] ?? this.app.workspace.getRightLeaf(false);
    if (leaf === null) return;
    if (open.length === 0) await leaf.setViewState({ type: CONFLICTS_VIEW_TYPE, active: true });
    await this.app.workspace.revealLeaf(leaf);
    this.redrawPanel();
  }

  // MARK: - Форматы заметок

  /** Имена команд форматов, заведённых этим запуском, — чтобы снять их при правке. */
  private formatCommandIds: string[] = [];

  /**
   * Команда на каждый формат, как у Zotero Integration (Р10), и «назначить
   * формат» (Р9). Пересобираются при сохранении настроек без перезапуска
   * Obsidian: прежние снимаются, новые заводятся.
   */
  private registerFormatCommands(): void {
    const commands = (this.app as unknown as { commands?: { removeCommand?(id: string): void } }).commands;
    for (const id of this.formatCommandIds) commands?.removeCommand?.(`${this.manifest.id}:${id}`);
    this.formatCommandIds = [];
    const formats = this.runner.state.settings.formats;
    formats.forEach((format, index) => {
      const id = `new-note-format-${index}`;
      this.addCommand({
        id,
        name: fill(this.words.formats.newNote, { format: format.name }),
        callback: () => void this.newNoteOfFormat(format),
      });
      this.formatCommandIds.push(id);
    });
    if (formats.length > 0) {
      const id = "assign-format";
      this.addCommand({
        id,
        name: this.words.formats.assignFormat,
        checkCallback: (checking: boolean) => {
          const file = this.app.workspace.getActiveFile();
          if (file === null || this.bookIdsOf(file).length === 0) return false;
          if (!checking) void this.assignFormat(file);
          return true;
        },
      });
      this.formatCommandIds.push(id);
    }
  }

  /** Книги снимка, у которых заметки ещё нет. */
  private async unboundBooks(): Promise<SnapshotBook[] | undefined> {
    this.runner.forgetSnapshot();
    await this.run("команда");
    const snapshot = this.runner.lastSnapshot;
    if (snapshot === undefined || snapshot.kind !== "present") {
      new Notice(fill(this.words.notices.noExport, { path: indexPath() }), 10_000);
      return undefined;
    }
    const bound = new Set<string>();
    for (const ids of (await this.bindings()).values()) ids.forEach((id) => bound.add(id));
    return snapshot.books.filter((book) => book.uuid !== "" && !bound.has(book.uuid));
  }

  /** «Новая заметка — <формат>»: выбрать книгу, завести заметку по шаблону (Р10). */
  private async newNoteOfFormat(format: NoteFormat): Promise<void> {
    const books = await this.unboundBooks();
    if (books === undefined) return;
    if (books.length === 0) {
      new Notice(this.words.formats.allBound, 8_000);
      return;
    }
    new BookPickModal(this.app, books, fill(this.words.formats.pickBook, { format: format.name }), (book) => {
      void this.createNotes([book], format);
    }).open();
  }

  /**
   * Заводит заметки книг в формате `format` (`undefined` — без формата, как
   * прежде). Существующий файл не перезаписывается — открывается (Р8, задача 4).
   */
  private async createNotes(books: readonly SnapshotBook[], format: NoteFormat | undefined): Promise<void> {
    const folder = this.runner.state.settings.libraryFolder;
    const texts = new Map<string, string>();
    // Формат каждой заводимой заметки — проходу, рисующему её первую секцию.
    const creatingFormats = new Map<string, string>();
    const bindings = new Map<string, readonly string[]>();
    let template: string | undefined;
    try {
      template = format === undefined ? undefined : await this.formats.noteTemplate(format);
    } catch (error) {
      new Notice((error as Error).message, 15_000);
      return;
    }
    for (const book of books) {
      let path: string;
      try {
        path = notePathFor(format, book, folder);
      } catch (error) {
        new Notice(fill(this.words.formats.noteFailed, { message: (error as Error).message }), 15_000);
        continue;
      }
      if (this.app.vault.getAbstractFileByPath(path) instanceof TFile) {
        new Notice(fill(this.words.formats.noteExists, { path }), 8_000);
        if (books.length === 1) await this.app.workspace.openLinkText(path, "", false);
        continue;
      }
      if (format !== undefined) {
        try {
          // Без файла шаблона заметки — пустая заметка, но со свойством формата:
          // блоки всё равно рисуются шаблоном блока формата.
          texts.set(path, renderNote(template ?? "{{annotations}}", book, format.name, this.words.pass));
          creatingFormats.set(path, format.name);
        } catch (error) {
          new Notice(fill(this.words.formats.noteFailed, { message: (error as Error).message }), 15_000);
          continue;
        }
      }
      bindings.set(path, [book.uuid]);
    }
    if (bindings.size === 0) return;
    // Байты снимка не менялись с прохода в `unboundBooks` — без забывания
    // раннер счёл бы, что смотреть не на что, и заметку не завёл бы.
    this.runner.forgetSnapshot();
    const release = this.formats.expectCreating(creatingFormats);
    try {
      await this.runChoice({
        alsoBind: bindings,
        creating: new Set(bindings.keys()),
        only: new Set(bindings.keys()),
        initialText: (path) => texts.get(path),
      });
    } finally {
      release();
    }
    if (bindings.size === 1) {
      const [path] = bindings.keys();
      if (this.app.vault.getAbstractFileByPath(path) instanceof TFile) {
        await this.app.workspace.openLinkText(path, "", false);
        // Заметка открылась — и всё же словами, где она: из панели привязки
        // уведомление есть, а из палитры не было (приёмка 20261012, Н10).
        new Notice(fill(this.words.formats.noteCreated, { path }), 6_000);
      }
    }
  }

  /** «Назначить формат этой заметке» (Р9): свойство и перерисовка блоков. */
  private async assignFormat(file: TFile): Promise<void> {
    const formats = this.runner.state.settings.formats;
    new FormatPickModal(this.app, formats, this.words.formats.pickFormat, undefined, (format) => {
      if (format === undefined) return;
      void (async () => {
        await this.app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
          frontmatter[FORMAT_KEY] = format.name;
        });
        // Кэш свойств Obsidian обновляется не мгновенно — проход читает формат
        // из него, поэтому ждём, пока свойство в кэше станет новым.
        const until = Date.now() + 3_000;
        while (
          Date.now() < until &&
          this.app.metadataCache.getFileCache(file)?.frontmatter?.[FORMAT_KEY] !== format.name
        ) {
          await new Promise((wake) => window.setTimeout(wake, 50));
        }
        this.runner.forgetSnapshot();
        await this.runChoice({ only: new Set([file.path]) });
        new Notice(fill(this.words.formats.formatAssigned, { format: format.name }), 6_000);
      })();
    }).open();
  }

  // MARK: - Настройки

  private async saveSettings(next: BerestaSettings): Promise<void> {
    this.runner.applySettings(next);
    this.applySchedule(next);
    await this.formats.reload();
    this.registerFormatCommands();
    // Форматы могли вернуться — пропажу тех же имён надо будет сказать заново.
    this.goneSaid.clear();
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
      templateFor: (path) => this.formats.templateFor(path),
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

  /** Папка плагина в хранилище — там лежат копии. */
  private pluginHome(): string {
    return this.manifest.dir ?? `${this.app.vault.configDir}/plugins/${this.manifest.id}`;
  }

  private backupStore(): BackupStore {
    const adapter = this.app.vault.adapter;
    const home = this.pluginHome();
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
   * Берётся из указателя (`BindingIndex`), а не перечислением хранилища: опрос
   * ходит сюда раз в пять секунд, и даже обход одного `metadataCache` по всем
   * заметкам каждые пять секунд каталог Obsidian счёл перечислением
   * хранилища (проверка 0.3.3, 20261017). Указатель строится при загрузке и
   * живёт событиями кэша и хранилища.
   */
  private async bindings(): Promise<Map<string, readonly string[]>> {
    return this.bindingIndex.snapshot();
  }

  private bookIdsOf(file: TFile): string[] {
    const raw: unknown = this.app.metadataCache.getFileCache(file)?.frontmatter?.[BOOK_ID_KEY];
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
    if (!(file instanceof TFile)) throw new Error(fill(this.words.notices.noteMissing, { path }));
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
