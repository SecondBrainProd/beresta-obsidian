/**
 * Заводило: взгляд на указатель → проход по заметкам → состояние словами.
 *
 * **Это единственное место, где решается «работать или нет».** Опрос
 * (`poller.ts`) отвечает только на вопрос, изменились ли данные; проход
 * (`pass.ts`) только раскладывает; панель и строка состояния только говорят.
 * Порядок и правила — здесь, и здесь же они проверяются обычными тестами:
 * точка входа `main.ts` после этого содержит одну проводку к Obsidian и ни
 * одного решения.
 *
 * **Правило «можно ли завести секцию» — самое опасное из здешних, и оно
 * выведено, а не настроено.** Секция заводится в заметке, в которую плагин ещё
 * ни разу не писал: память о ней пуста, значит привязка свежая и человек ждёт
 * выписок. Заметка, в которую мы писали, секции второй раз не получает — там
 * её отсутствие означает, что человек её стёр, и дописать 81 цитату в конец
 * вычищенной заметки было бы грубостью, а не синхронизацией (задача 11). Вернуть
 * её можно, но только командой.
 *
 * **Известный край этого правила назван:** потеряйте `data.json` (переустановка
 * плагина, откат хранилища) — и заметка, где человек стёр секцию, получит её
 * снова. Заметки, где секция на месте, не пострадают: правило смотрит на память
 * только там, где маркеров нет. Лечится это лишь вторым списком в самой
 * заметке, а лишний наш ключ во frontmatter стоит дороже редкой лишней секции.
 *
 * **Второе здешнее правило — про чужой снимок постарше**, и оно тоже решается
 * только здесь: `laggingBehind` ниже. Оба Мака пишут в одну папку `.beresta/`,
 * и снимок второй машины отстаёт на день; применить его значит убрать из
 * заметок выписки, которых на той машине ещё нет.
 */

import { ConflictBoard } from "../conflicts-view";
import {
  lookAtSnapshot,
  type LookKind,
  type LookReason,
  type WatchSource,
} from "../poller";
import type { BerestaSettings, PluginState, SnapshotHealth } from "../settings";
import { EMPTY_STATUS, stampOf, type StatusState } from "../status";
import type { Snapshot, SnapshotHeader } from "../snapshot/model";
import type { BackupStore } from "../write/backup";
import { runSync, type NoteStore, type SyncReport } from "./pass";
import type { KnownSection } from "../merge/fuse";

export interface RunnerPorts {
  readonly source: WatchSource;
  readonly notes: NoteStore;
  readonly backups: BackupStore;
  /** Привязки хранилища: путь заметки → книги. Читается из frontmatter. */
  bindings(): Promise<ReadonlyMap<string, readonly string[]>>;
  /** Сохранить состояние в `data.json`. */
  persist(state: PluginState): Promise<void>;
  now(): number;
  /** Сказать человеку словами. У Obsidian это `Notice`. */
  announce(line: string): void;
}

export interface TickOptions {
  /** Сверить только эти заметки. */
  readonly only?: ReadonlySet<string>;
  /**
   * Привязки, которых ещё нет во frontmatter.
   *
   * Нужны ровно одному случаю — только что сделанному выбору в окне привязки:
   * ключ `beresta-book-id` впишет тот же проход, а до него хранилище об этих
   * книгах не знает. Без этого первый проход после привязки не увидел бы ни
   * одной выбранной книги, и человек решил бы, что окно ничего не сделало.
   */
  readonly alsoBind?: ReadonlyMap<string, readonly string[]>;
  /** Завести эти заметки: владелец выбрал «создать новую». */
  readonly creating?: ReadonlySet<string>;
  /** Вернуть секцию в эти заметки. */
  readonly mayCreateSection?: ReadonlySet<string>;
  /** Снять предохранитель по этим заметкам. */
  readonly allowRemovals?: ReadonlySet<string>;
}

export interface RunOutcome {
  readonly look: LookKind;
  readonly report: SyncReport | undefined;
  readonly status: StatusState;
}

/** Чей снимок уже разложен по заметкам и на какой он момент. */
export interface LaidSnapshot {
  readonly deviceId: string | undefined;
  readonly generatedAt: string | undefined;
}

/**
 * Отстаёт ли этот снимок от уже разложенного — и он ли вообще с другой машины.
 *
 * **Беда, ради которой правило написано.** Хранилище синхронизируется чужими
 * средствами, оба Мака пишут в одну папку `.beresta/`, и снимок второй машины
 * отстаёт на день: последних выписок там ещё нет. Применить его значит убрать
 * их из заметки. Замер приёмки 20260816: снимок с чужим `deviceId` и моментом
 * на сутки назад убрал из «Джедайских техник» три блока и переписал заметку.
 * Потолок молчаливой потери — 20 блоков за проход, выше встаёт предохранитель;
 * и вернуть их можно только из запасной копии, если человек догадается, что
 * что-то пропало.
 *
 * **Отказывает правило в сторону «применить», и это выбор, а не небрежность.**
 * Ошибись оно в другую сторону — плагин молча перестанет обновлять заметки, а
 * молчаливое отставание `poller.ts` называет главным отказом всего подхода.
 * Поэтому пропуск бывает ровно при трёх «да» сразу: устройства названы оба,
 * они разные, и оба момента разбираются, причём чужой строго старше. Нет
 * `deviceId` (снимок древней сборки), не разбирается момент, устройство своё,
 * моменты равны — работаем как ни в чём не бывало.
 */
export function laggingBehind(header: SnapshotHeader, laid: LaidSnapshot): boolean {
  if (header.deviceId === undefined || laid.deviceId === undefined) return false;
  if (header.deviceId === laid.deviceId) return false;
  if (header.generatedAt === undefined || laid.generatedAt === undefined) return false;
  const theirs = Date.parse(header.generatedAt);
  const ours = Date.parse(laid.generatedAt);
  if (Number.isNaN(theirs) || Number.isNaN(ours)) return false;
  return theirs < ours;
}

export class SyncRunner {
  readonly board = new ConflictBoard();

  private current: PluginState;
  private snapshot: Snapshot | undefined;
  private lastReport: SyncReport | undefined;
  private problems = 0;
  /**
   * Сколько выписок Beresta держит в каждой заметке хранилища.
   *
   * **Копится между проходами нарочно.** Проход бывает точечный — открыли
   * заметку, сверили её одну, — и его отчёт говорит правду про одну заметку и
   * молчит про остальные. Складывать «сколько заметок он обошёл» в число «в
   * скольких заметках лежат выписки» значит получить цифру, которая скачет от
   * того, чем был вызван последний заход: прогон глазами 20260818 (находка 5)
   * увидел единицу там, где секции стояли в двух заметках, и она держалась,
   * пока человек не запустил команду руками.
   *
   * Поэтому здесь карта на всё хранилище: заход правит записи тех заметок, про
   * которые узнал, и не трогает остальные. Живёт в `data.json` вместе с прочей
   * памятью — иначе перезапуск Obsidian на неизменившейся выгрузке (прохода не
   * будет вовсе) обнулял бы подпись.
   */
  private sections: Map<string, number>;
  /**
   * Книги, которые хоть одна заметка назвала своими.
   *
   * Нужны одному вопросу — скольким книгам выгрузки некуда лечь. Спрашивается
   * он на каждой отрисовке строки состояния, а привязки читаются раз в проход,
   * поэтому ответ держится здесь, а не пересчитывается заново.
   */
  private boundBooks = new Set<string>();

  constructor(
    private readonly ports: RunnerPorts,
    state: PluginState,
  ) {
    this.current = state;
    this.sections = new Map(Object.entries(state.sections));
  }

  get state(): PluginState {
    return this.current;
  }

  /** Снимок последнего взгляда — нужен экрану привязки. */
  get lastSnapshot(): Snapshot | undefined {
    return this.snapshot;
  }

  /** Чей снимок уже разложен по заметкам и на какой момент. */
  private get laid(): LaidSnapshot {
    return {
      deviceId: this.current.appliedDeviceId,
      generatedAt: this.current.appliedGeneratedAt,
    };
  }

  /**
   * Книг выгрузки, которым некуда лечь.
   *
   * Считается по книгам, а не по признаку «есть ли хоть одна привязка»: у
   * владельца одна книга привязана с первого дня, и правило «сказать, если
   * привязок ноль» на его хранилище не сработает больше никогда.
   */
  private get unbound(): number {
    if (this.snapshot?.kind !== "present") return 0;
    return this.snapshot.books.filter((book) => !this.boundBooks.has(book.uuid)).length;
  }

  get status(): StatusState {
    const books = this.snapshot?.kind === "present" ? this.snapshot.books : [];
    return {
      ...EMPTY_STATUS,
      snapshot: this.current.health,
      dataStamp: this.current.dataStamp,
      conflicts: this.board.ownEdits,
      deferred: this.lastReport?.deferred.length ?? 0,
      problems: this.problems,
      notesWithQuotes: [...this.sections.values()].filter((count) => count > 0).length,
      books: books.length,
      quotes: books.reduce((sum, book) => sum + book.annotations.length, 0),
      unbound: this.unbound,
      lookedAt: this.current.lookedAt,
    };
  }

  /**
   * Один заход: посмотреть и, если есть на что, разложить.
   *
   * Возвращает и вид взгляда, и отчёт: «ничего не сделано» бывает четырёх
   * разных сортов, и человеку (а равно проверке) важно, какого именно.
   */
  async tick(reason: LookReason, options: TickOptions = {}): Promise<RunOutcome> {
    const look = await lookAtSnapshot(this.ports.source, this.current.watch, reason);
    this.current = { ...this.current, watch: look.memory, lookedAt: this.ports.now() };

    if (look.kind === "снимка-нет") {
      this.snapshot = undefined;
      this.problems = 0;
      await this.settle("нет");
      return { look: look.kind, report: undefined, status: this.status };
    }

    if (look.kind === "не-читается") {
      // Один раз на эти байты: память об указателе уже помечена разложенной,
      // и следующий опрос по тем же байтам сюда не придёт.
      this.ports.announce(`Beresta: ${look.message ?? "выгрузка не читается"}`);
      await this.settle("не-читается");
      return { look: look.kind, report: undefined, status: this.status };
    }

    if (look.kind === "те-же-данные" || look.snapshot === undefined) {
      await this.settle(this.current.health);
      return { look: look.kind, report: undefined, status: this.status };
    }

    const snapshot = look.snapshot;
    if (snapshot.kind === "present" && laggingBehind(snapshot.header, this.laid)) {
      this.skipLagging(snapshot.header);
      // Память об указателе помечается разложенной нарочно: сам по себе этот
      // снимок новее не станет, а повторять уведомление каждые пять секунд по
      // тем же байтам — способ приучить человека закрывать его не читая. Тот же
      // ход, что у нечитаемого указателя в `poller.ts`.
      this.current = { ...this.current, watch: { ...look.memory, whole: true } };
      await this.settle(this.current.health);
      return { look: look.kind, report: undefined, status: this.status };
    }
    this.snapshot = snapshot;
    this.problems = snapshot.kind === "present" ? snapshot.problems.length : 0;

    const bindings = new Map(await this.ports.bindings());
    for (const [path, ids] of options.alsoBind ?? []) {
      const already = bindings.get(path) ?? [];
      bindings.set(path, [...already, ...ids.filter((id) => !already.includes(id))]);
    }
    const known = new Map<string, KnownSection>(Object.entries(this.current.known));
    const fresh = new Set<string>(options.mayCreateSection ?? []);
    for (const path of bindings.keys()) {
      if (!known.has(path)) fresh.add(path);
    }

    const report = await runSync({
      snapshot,
      bindings,
      notes: this.ports.notes,
      backups: this.ports.backups,
      memory: {
        get: (path) => known.get(path),
        set: (path, value) => {
          known.set(path, value);
        },
      },
      settings: this.current.settings,
      now: this.ports.now(),
      creating: options.creating,
      mayCreateSection: fresh,
      allowRemovals: options.allowRemovals,
      only: options.only,
    });

    this.lastReport = report;
    this.board.accept(report);
    await this.remember(report, bindings, known);
    this.current = {
      ...this.current,
      known: Object.fromEntries(known),
      sections: Object.fromEntries(this.sections),
      dataStamp: report.stamp,
      // Чьё и на какой момент разложено — записывается ЗДЕСЬ, после прохода:
      // снимок, который не применяли, разложенным не считается.
      appliedDeviceId:
        snapshot.kind === "present" ? snapshot.header.deviceId : this.current.appliedDeviceId,
      appliedGeneratedAt:
        snapshot.kind === "present" ? snapshot.header.generatedAt : this.current.appliedGeneratedAt,
    };
    this.say(report);
    await this.settle(this.problems > 0 ? "наполовину" : "целый");
    return { look: look.kind, report, status: this.status };
  }

  /**
   * Запомнить, где сколько выписок лежит и какие книги куда легли.
   *
   * **Правится только то, о чём отчёт сказал.** Точечный проход знает правду
   * про одну заметку; стереть по нему всё остальное значило бы получить то же
   * враньё, что и `visited.length`, только с другой стороны. Заметка, у
   * которой пропала привязка (человек убрал `beresta-book-id`), из карты
   * уходит: выписки в ней, может, и лежат, но нашими они больше не считаются и
   * обновляться не будут.
   *
   * **Память о записанных блоках подрезается по ДВУМ признакам сразу.** Запись
   * `known` лежит по ПУТИ заметки, а путь — самое недолговечное, что у заметки
   * есть: её переименовывают и перекладывают. До 20260901 мёртвые пути
   * копились в `data.json` навсегда, и стереть их не мог никто, кроме отката к
   * запасной копии (`forgetNote`). Подрезать их стало можно ровно тогда, когда
   * владение переехало в саму заметку: заметка, потерявшая здешнюю запись,
   * узнаётся по отпечаткам при блоках, а не по этой карте.
   *
   * **Пропажи из привязок для этого мало — нужна пропажа файла.** Привязки
   * читаются из `metadataCache` Obsidian, а он к первому проходу
   * (`onLayoutReady`) разобран не весь: живая заметка на большом хранилище
   * умеет не попасть в карту привязок просто потому, что её frontmatter ещё не
   * прочитан. Подрежь её по одному этому признаку — и потеряется `known.head`,
   * а он-то отпечатками в заметке НЕ подстрахован: заголовок «## Выписки из
   * Beresta» замёрзнет навсегда и будет висеть расхождением в панели. Проверка
   * `exists` стоит поиска в карте путей и снимает весь этот случай: холодный
   * разбор файла не удаляет.
   *
   * Привязок ноль — не подрезаем ничего даже с проверкой файла: так выглядит и
   * хранилище без единой привязанной заметки, и хранилище, которое ещё не
   * прочитано, а второе от первого отсюда не отличить.
   */
  private async remember(
    report: SyncReport,
    bindings: ReadonlyMap<string, readonly string[]>,
    known: Map<string, KnownSection>,
  ): Promise<void> {
    for (const [path, count] of Object.entries(report.quotes)) this.sections.set(path, count);
    for (const path of [...this.sections.keys()]) {
      if (!bindings.has(path)) this.sections.delete(path);
    }
    if (bindings.size > 0) {
      for (const path of [...known.keys()]) {
        if (bindings.has(path)) continue;
        if (await this.ports.notes.exists(path)) continue;
        known.delete(path);
      }
    }
    this.boundBooks = new Set<string>();
    for (const ids of bindings.values()) for (const id of ids) this.boundBooks.add(id);
  }

  /**
   * Сказать словами, что снимок не применён, — и назвать оба момента.
   *
   * Молчать здесь нельзя вдвойне: человек видит, что выписок в заметке не
   * прибавилось, и без объяснения это выглядит поломкой плагина. Названы оба
   * момента — иначе непонятно, кто кого ждёт.
   */
  private skipLagging(header: SnapshotHeader): void {
    const offset = this.current.settings.timeZoneOffsetMinutes;
    this.ports.announce(
      `Beresta: выгрузка собрана другим устройством и она старше разложенной ` +
        `(${stampOf(header.generatedAt, offset)} против ` +
        `${stampOf(this.current.appliedGeneratedAt, offset)}) — заметки не тронуты. ` +
        "Отстающая выгрузка убрала бы из них выписки, которых на той машине ещё нет; " +
        "как только она догонит, всё приедет само.",
    );
  }

  /**
   * Принять новые настройки, не потеряв ни памяти, ни панели.
   *
   * Заменять всё заводило целиком было бы проще на вид и хуже по делу: с ним
   * ушли бы накопленные расхождения, и человек, поправивший размер круга
   * копий, увидел бы пустую панель — как будто его правки перестали быть
   * расхождениями.
   */
  applySettings(settings: BerestaSettings): void {
    this.current = { ...this.current, settings };
  }

  /**
   * Забыть, что мы записали в эту заметку.
   *
   * Зовётся после возврата заметки к запасной копии: блоки в возвращённом
   * тексте писали мы, но не в том виде, в каком мы их помним. Выдать их за свои
   * значило бы перерисовать поверх того, ради чего человек и откатывался;
   * незнакомые блоки слияние не трогает (`unknown-origin`), а новые выписки
   * приезжают по-прежнему.
   */
  forgetNote(path: string): void {
    const known = { ...this.current.known };
    delete known[path];
    this.current = { ...this.current, known };
    this.board.forget(path);
  }

  /** Что лежит в заметках по нашей памяти — нужно проверке и никому больше. */
  get quotesPerNote(): ReadonlyMap<string, number> {
    return this.sections;
  }

  /** Забыть, что мы видели указатель: следующий взгляд разложит его заново. */
  forgetSnapshot(): void {
    this.current = {
      ...this.current,
      watch: { hash: undefined, hint: undefined, whole: false },
    };
  }

  private async settle(health: SnapshotHealth): Promise<void> {
    this.current = { ...this.current, health };
    await this.ports.persist(this.current);
  }

  /**
   * Что сказать вслух после прохода.
   *
   * Молча проходит обычный случай — выписки приехали, и это видно в заметке.
   * Вслух говорится только то, чего человек иначе не заметит: отложенная
   * запись, отказ по файлу, остановленный предохранитель. Каждое такое
   * сообщение — одно и на весь проход, а не по строке на заметку: пять
   * всплывающих окошек подряд человек закрывает не читая.
   */
  private say(report: SyncReport): void {
    if (report.deferred.length > 0) {
      this.ports.announce(
        `Beresta: ${report.deferred.length === 1 ? "заметка открыта" : "заметки открыты"} с ` +
          "несохранёнными правками — выписки приедут, как только вы сохраните: " +
          report.deferred.join(", "),
      );
    }
    const safety = report.refusals.filter((one) => one.refused === "too-many-removals");
    if (safety.length > 0) {
      this.ports.announce(`Beresta: ${safety[0].message}`);
    }
    const other = report.refusals.filter((one) => one.refused !== "too-many-removals");
    if (other.length > 0) {
      this.ports.announce(`Beresta: ${other[0].message}`);
    }
    if (report.missing.length > 0) {
      this.ports.announce(
        `Beresta: ${report.missing.length === 1 ? "привязанной заметки" : "привязанных заметок"} ` +
          `нет на месте (${report.missing.join(", ")}). Заново не завожу — посмотрите панель ` +
          "расхождений.",
      );
    }
  }
}
