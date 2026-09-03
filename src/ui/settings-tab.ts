/**
 * Страница настроек.
 *
 * Настроек мало нарочно: каждая — ещё один способ получить хранилище, в
 * котором плагин ведёт себя не так, как у всех, и разбирать это придётся по
 * переписке. Здесь только то, что у разных людей действительно разное:
 * куда класть новые заметки, какой у них часовой пояс, как часто смотреть и
 * когда останавливаться.
 *
 * **Сдвиг часового пояса стоит первым и объяснён словами.** Он единственный
 * влияет на БАЙТЫ заметки: время выделения печатается в каждом блоке, а разные
 * байты блока задача 11 читает как «человек правил» и замораживает блок. Хуже
 * всего это на хранилище, синхронизированном между двумя машинами в разных
 * поясах, — поэтому сдвиг закреплён числом, а не берётся у машины при каждом
 * проходе.
 *
 * **Отказ здесь виден, а не молчалив (находка 7 прогона глазами 20260818).**
 * До этого дня поле принимало что угодно: в «Часовой пояс выписок» вписывалось
 * слово `Караганда`, поле показывало `Караганда`, а в `data.json` оставалось
 * `300` — и узнать об этом было нельзя ничем. Теперь у страницы два правила, и
 * второе важнее первого:
 *
 * 1. негодное значение названо словами под своим полем — что отвергнуто,
 *    почему и что осталось в настройке;
 * 2. **поле не имеет права расходиться с `data.json`.** Уходя из поля, человек
 *    видит в нём ровно то, что лежит в настройке: принялось — своё, не
 *    принялось — прежнее. Экран, показывающий одно, когда в файле другое, —
 *    это и есть находка 7, и лечится она не сообщением, а тем, что такого
 *    состояния не бывает.
 *
 * **Настройка применяется, когда человек ушёл из поля, а не на каждой букве.**
 * Сдвиг пояса перерисовывает блоки ВСЕХ заметок и снимает по запасной копии с
 * каждой; сохранение на каждом нажатии клавиши делало бы это трижды, пока
 * человек печатает «300», и трижды же съедало бы круг версий. `hide()`
 * дописывает недоприменённое: закрытая страница не имеет права проглотить
 * набранное.
 *
 * **Решения здесь нет ни одного.** Что считать годным и какими словами
 * отказать — `readNumberField`/`readFolderField` в `settings.ts`, и это
 * проверяется обычным тестом. Здесь только показ, сбор нажатий и обращение к
 * Obsidian.
 */

import { PluginSettingTab, Setting, TFolder, type App } from "obsidian";

import {
  INTERVAL_FIELD,
  KEEP_BACKUPS_FIELD,
  OFFSET_FIELD,
  REMOVAL_COUNT_FIELD,
  readFolderField,
  readTemplateField,
  readNumberField,
  type BerestaSettings,
  type NumberField,
} from "../settings";

/** Что странице нужно от плагина — и ничего больше. */
export interface SettingsHost {
  settings: BerestaSettings;
  save(next: BerestaSettings): Promise<void>;
}

export class BerestaSettingTab extends PluginSettingTab {
  /**
   * Поля, ещё не сверенные с настройкой.
   *
   * Обычно поле применяется само — уходом фокуса. Но страницу закрывают и
   * не уходя из поля (⌘W, крестик, переключение на другой плагин), и тогда
   * `blur` может не прийти вовсе. Проглотить набранное в этом случае значит
   * повторить находку 7 другим ходом.
   */
  private readonly pending: (() => Promise<void>)[] = [];

  constructor(
    app: App,
    // `PluginSettingTab` требует сам плагин; нам от него нужны две вещи, и
    // берём мы ровно их — через узкий порт, чтобы страницу можно было собрать
    // и без Obsidian.
    plugin: import("obsidian").Plugin,
    private readonly host: SettingsHost,
  ) {
    super(app, plugin);
  }

  override display(): void {
    const { containerEl } = this;
    containerEl.empty();
    this.pending.length = 0;

    this.numberField(
      OFFSET_FIELD,
      "Сдвиг в минутах от UTC: 300 — Караганда, 180 — Москва. Время выделения " +
        "печатается в каждом блоке, поэтому сдвиг закреплён числом. Смените его — " +
        "и все блоки перерисуются один раз; блоки, которые вы правили руками, " +
        "останутся вашими.",
      () => this.host.settings.timeZoneOffsetMinutes,
      (value) => ({ ...this.host.settings, timeZoneOffsetMinutes: value }),
    );

    this.folderField();

    this.numberField(
      INTERVAL_FIELD,
      "Секунд между взглядами, когда окно Obsidian впереди. Без фокуса Beresta " +
        "смотрит раз в минуту. Взгляд стоит одного обращения к файлу: заметки " +
        "трогаются, только если выгрузка изменилась.",
      () => Math.round(this.host.settings.focusedIntervalMs / 1000),
      (value) => ({ ...this.host.settings, focusedIntervalMs: value * 1000 }),
    );

    this.numberField(
      KEEP_BACKUPS_FIELD,
      "Beresta снимает копию заметки перед КАЖДОЙ своей записью в неё — но только " +
        "если текст изменился с прошлой копии. Держится столько последних версий, " +
        "сколько здесь стоит; всё, что старше, вытесняется. Копии лежат в папке " +
        "плагина и не попадают ни в поиск, ни в граф.",
      () => this.host.settings.keepBackups,
      (value) => ({ ...this.host.settings, keepBackups: value }),
    );

    this.numberField(
      REMOVAL_COUNT_FIELD,
      "Если проход убирает больше этого числа блоков или больше пятой части — он " +
        "останавливается и показывает список. Так выглядит выгрузка, приехавшая " +
        "наполовину или с другой машины.",
      () => this.host.settings.removalCount,
      (value) => ({ ...this.host.settings, removalCount: value }),
    );

    this.templateField();
  }

  /**
   * Шаблон секции выписок.
   *
   * **Зачем поле вообще появилось.** Владелец 20260818 спросил, есть ли шаблоны
   * выгрузки, — и не нашёл их, потому что их не было: шаблон был зашит
   * константой, и сменить его можно было только пересборкой плагина. Путь
   * человека П04 постановки настроек: «ищу, где задаётся шаблон выгрузки →
   * нахожу его, не спрашивая никого».
   *
   * **Отказ говорит словами и НЕ пишет.** Негодный шаблон — не «покажем ошибку
   * и сохраним»: секция без якорей читается слиянием как «человек убрал все
   * блоки», и на новой заметке это создало бы пустую управляемую секцию молча.
   */
  private templateField(): void {
    const setting = new Setting(this.containerEl)
      .setName("Шаблон секции выписок")
      .setDesc(
        "Как выглядит блок одной выписки в заметке. Пусто — как у всех: " +
          "стандартный шаблон, который будет улучшаться с новыми версиями. " +
          "Доступные значения: {{text}}, {{comment}}, {{caption}}, {{heading}}, " +
          "{{tags}}, {{link}}, {{page}}, {{date}}, {{color}} и другие; список " +
          "целиком плагин покажет в ошибке, если ошибётесь в имени. " +
          "{{anchor}} обязателен — им держится связь блока с выпиской.",
      );
    const say = this.sayLine(setting);

    setting.addTextArea((area) => {
      area.setValue(this.host.settings.template ?? "");
      area.inputEl.rows = 12;
      area.inputEl.style.width = "100%";
      area.inputEl.style.fontFamily = "var(--font-monospace)";

      const commit = async (): Promise<void> => {
        const verdict = readTemplateField(area.getValue());
        if (verdict.kind === "ok") {
          say(verdict.said, false);
          if (verdict.value !== this.host.settings.template) {
            await this.host.save({ ...this.host.settings, template: verdict.value });
          }
        } else if (verdict.kind === "refused") {
          say(verdict.said, true);
        }
        area.setValue(this.host.settings.template ?? "");
      };
      this.pending.push(commit);
      area.inputEl.addEventListener("blur", () => void commit());
    });

    setting.addExtraButton((button) => {
      button
        .setIcon("rotate-ccw")
        .setTooltip("Вернуть стандартный")
        .onClick(() => {
          void this.host.save({ ...this.host.settings, template: undefined });
          this.display();
        });
    });
  }

  /** Страницу закрыли — доприменяем то, из чего человек не успел уйти. */
  override hide(): void {
    const waiting = [...this.pending];
    this.pending.length = 0;
    for (const commit of waiting) void commit();
  }

  // MARK: - Внутреннее

  private numberField(
    spec: NumberField,
    desc: string,
    read: () => number,
    write: (value: number) => BerestaSettings,
  ): void {
    const setting = new Setting(this.containerEl).setName(spec.name).setDesc(desc);
    const say = this.sayLine(setting);

    setting.addText((text) => {
      text.setValue(String(read()));

      const commit = async (): Promise<void> => {
        const verdict = readNumberField(spec, text.getValue());
        if (verdict.kind === "ok") {
          say(undefined, false);
          if (verdict.value !== read()) await this.host.save(write(verdict.value));
        } else if (verdict.kind === "refused") {
          say(verdict.said, true);
        }
        // Всегда: в поле стоит то, что лежит в настройке. Отказ оставляет
        // прежнее число видимым, а не своё зачёркнутое.
        text.setValue(String(read()));
      };
      this.pending.push(commit);

      // На каждой букве — только слова, без записи: человек видит отказ сразу,
      // а хранилище не перерисовывается на полпути к «300».
      text.onChange((typed) => {
        const verdict = readNumberField(spec, typed);
        say(verdict.kind === "refused" ? verdict.said : undefined, true);
      });
      text.inputEl.addEventListener("blur", () => void commit());
      text.inputEl.addEventListener("keydown", (event) => {
        if (event.key === "Enter") void commit();
      });
    });
  }

  private folderField(): void {
    const setting = new Setting(this.containerEl)
      .setName("Папка для новых заметок")
      .setDesc("Куда класть заметку книги, для которой вы выбрали «создать новую».");
    const say = this.sayLine(setting);

    setting.addText((text) => {
      text.setValue(this.host.settings.libraryFolder);

      const commit = async (): Promise<void> => {
        const verdict = readFolderField(text.getValue(), (path) => this.folderExists(path));
        if (verdict.kind === "ok") {
          say(verdict.said, false);
          if (verdict.value !== this.host.settings.libraryFolder) {
            await this.host.save({ ...this.host.settings, libraryFolder: verdict.value });
          }
        } else if (verdict.kind === "refused") {
          say(verdict.said, true);
        }
        text.setValue(this.host.settings.libraryFolder);
      };
      this.pending.push(commit);

      text.onChange((typed) => {
        const verdict = readFolderField(typed, (path) => this.folderExists(path));
        if (verdict.kind === "refused") say(verdict.said, true);
        else say(verdict.kind === "ok" ? verdict.said : undefined, false);
      });
      text.inputEl.addEventListener("blur", () => void commit());
      text.inputEl.addEventListener("keydown", (event) => {
        if (event.key === "Enter") void commit();
      });
    });
  }

  private folderExists(path: string): boolean {
    return this.app.vault.getAbstractFileByPath(path) instanceof TFolder;
  }

  /**
   * Строка под описанием поля, которой оно отвечает человеку.
   *
   * Одна и та же строка на два разных ответа — отказ и предупреждение, — и
   * различает их цвет: отказ значит «не принято», предупреждение значит
   * «принято, но знайте вот что». Двух строк под одним полем не заводим:
   * человек читает поле, а не переписку с ним.
   *
   * Живёт в `infoEl` — там же, где имя и описание, и потому встаёт под ними
   * само, без правки чужой раскладки. Своё окно `Notice` в углу здесь не
   * годится вовсе: человек, печатающий в поле, смотрит в поле.
   *
   * `setErrorMessage` Obsidian сюда не зовётся нарочно: он появился в 1.13.0, а
   * `minAppVersion` плагина — 1.4.0. На 1.4–1.12 это был бы не отказ, а падение
   * страницы настроек в тот самый момент, когда человек ошибся.
   */
  private sayLine(setting: Setting): (said: string | undefined, refused: boolean) => void {
    const line = setting.infoEl.createDiv({ cls: "beresta-setting-said" });
    line.hide();
    return (said, refused) => {
      const input = setting.controlEl.querySelector("input");
      if (said === undefined || said === "") {
        line.setText("");
        line.hide();
        input?.removeClass("beresta-setting-invalid");
        return;
      }
      line.setText(said);
      line.toggleClass("is-refused", refused);
      input?.toggleClass("beresta-setting-invalid", refused);
      line.show();
    };
  }
}
