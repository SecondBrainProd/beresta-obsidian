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
 * **С 0.3.4 страница описана, а не нарисована** (API настроек Obsidian 1.13,
 * `minAppVersion` 1.13.0, решение владельца 20261018): `getSettingDefinitions()`
 * вместо `display()`, чтобы настройки находил поиск Obsidian. Каждая строка
 * по-прежнему рисуется своим кодом — правила выше не изменились.
 *
 * **Решения здесь нет ни одного.** Что считать годным и какими словами
 * отказать — `readNumberField`/`readFolderField` в `settings.ts`, и это
 * проверяется обычным тестом. Здесь только показ, сбор нажатий и обращение к
 * Obsidian.
 */

import {
  Notice,
  PluginSettingTab,
  TFolder,
  type App,
  type Setting,
  type SettingDefinition,
  type SettingDefinitionGroup,
  type SettingDefinitionItem,
} from "obsidian";

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
import type { NoteFormat } from "../settings";
import { defaultFormats, defaultSectionFile } from "../render/default-formats";
import { interfaceLanguage } from "../render/defaults";
import { TemplateFileSuggest } from "./file-suggest";
import { fill, panelWords, type SettingsWords } from "./words";

/** Что странице нужно от плагина — и ничего больше. */
export interface SettingsHost {
  /**
   * Настройки СЕЙЧАС, а не снимок времён загрузки плагина.
   *
   * ⚠️ Вопросом, а не полем (правка 20260915). Полем это выражалось геттером в
   * объектном литерале, а тому нужен был псевдоним `const plugin = this` —
   * проверка каталога назвала его «Unexpected aliasing of „this“». Метод тем
   * же местом говорит правду: страница спрашивает настройки при каждом
   * открытии, иначе поправленное значение возвращалось бы на прежнее.
   */
  settingsNow(): BerestaSettings;
  save(next: BerestaSettings): Promise<void>;
  /**
   * Завести файл хранилища, если его нет. `false` — файл уже был и НЕ тронут:
   * кнопка готовых форматов не перезаписывает ничего (план шаблонов, задача 6).
   */
  createFile?(path: string, text: string): Promise<boolean>;
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

  /**
   * Страницу перестраиваем МЫ — после правки списка форматов или сброса
   * шаблона.
   *
   * Тогда снятые строки НЕ доприменяются: у поля формата номер взят при
   * отрисовке, и после удаления первого формата недоприменённое поле прежнего
   * второго легло бы в новый второй, то есть в чужой формат. Прежний `display()`
   * поступал так же — очищал список ожидающих, не исполняя. Строки, которые
   * снимает сам Obsidian (закрыли окно, ушли на другую вкладку), доприменяются.
   */
  private rebuilding = false;

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

  /** Слова страницы — по языку интерфейса на момент показа. */
  private get words(): SettingsWords {
    return panelWords(interfaceLanguage()).settings;
  }

  /**
   * Страница — описанием, а не отрисовкой (API настроек Obsidian 1.13, решение
   * владельца 20261018, вопрос 24 в `docs/вопросы-владельцу.md`).
   *
   * **Зачем.** Каталог плагинов считает `display()` устаревшим: описанные так
   * настройки не находит поиск по настройкам Obsidian. Здесь у каждой строки
   * имя и пояснение лежат в описании — их и ищет поиск, — а сама строка
   * рисуется прежним кодом (`render`). Поведение полей не меняется ни в чём:
   * применение уходом из поля, отказ словами под полем, поле не расходится с
   * `data.json`. Готовые элементы управления Obsidian (`control`) здесь нарочно
   * не взяты: они пишут настройку сами, на каждой правке, а сдвиг пояса
   * перерисовывает блоки ВСЕХ заметок.
   *
   * **Ключи строк.** Строку Obsidian узнаёт по имени внутри её группы, группу —
   * по заголовку; одинаковые ключи он перерисовывает непредсказуемо и пишет об
   * этом в консоль. Поэтому каждый формат — своя группа с заголовком «Формат N»:
   * четыре поля у двух форматов в одной группе дали бы четыре пары одинаковых
   * имён.
   *
   * **Описание зовётся при регистрации вкладки и при `update()`**, а не при
   * каждом открытии страницы. Число форматов — единственное, что меняет его
   * форму, и меняется оно только здесь же: после правки зовётся `rebuild()`.
   * Значения полей читаются при отрисовке строки, то есть всегда свежие.
   */
  override getSettingDefinitions(): SettingDefinitionItem[] {
    const words = this.words.formats;
    const formats = this.host.settingsNow().formats;
    return [
      {
        type: "group",
        items: [
          this.numberField(
            OFFSET_FIELD,
            () => this.host.settingsNow().timeZoneOffsetMinutes,
            (value) => ({ ...this.host.settingsNow(), timeZoneOffsetMinutes: value }),
          ),
          this.folderField(),
          this.numberField(
            INTERVAL_FIELD,
            () => Math.round(this.host.settingsNow().focusedIntervalMs / 1000),
            (value) => ({ ...this.host.settingsNow(), focusedIntervalMs: value * 1000 }),
          ),
          this.numberField(
            KEEP_BACKUPS_FIELD,
            () => this.host.settingsNow().keepBackups,
            (value) => ({ ...this.host.settingsNow(), keepBackups: value }),
          ),
          this.numberField(
            REMOVAL_COUNT_FIELD,
            () => this.host.settingsNow().removalCount,
            (value) => ({ ...this.host.settingsNow(), removalCount: value }),
          ),
          this.templateField(),
        ],
      },
      {
        type: "group",
        heading: words.heading,
        items: [this.addFormatRow(), ...this.defaultsRow()],
      },
      ...formats.map((_, index) => this.formatGroup(index)),
    ];
  }

  /** Перестроить страницу после правки, меняющей её форму. */
  private rebuild(): void {
    this.rebuilding = true;
    try {
      this.update();
    } finally {
      this.rebuilding = false;
    }
  }

  /**
   * Поле, ждущее применения: в список ожидающих, а при снятии строки —
   * доприменить, если снимаем не мы (см. `rebuilding`).
   */
  private awaitCommit(commit: () => Promise<void>): () => void {
    this.pending.push(commit);
    return () => {
      const at = this.pending.indexOf(commit);
      if (at < 0) return;
      this.pending.splice(at, 1);
      if (!this.rebuilding) void commit();
    };
  }

  /**
   * Форматы заметок — как «форматы ввоза» у Zotero Integration (план
   * `20261008-шаблоны-плагина-план.md`, задачи 3 и 6).
   */
  private addFormatRow(): SettingDefinition {
    const words = this.words.formats;
    return {
      name: words.add,
      desc: words.description,
      render: (setting) => {
        setting.addButton((button) => {
          button.setButtonText(words.add).onClick(() => {
            const formats = this.host.settingsNow().formats;
            const named = (number: number): string => fill(words.formatHeading, { index: String(number) });
            let number = formats.length + 1;
            while (formats.some((one) => one.name === named(number))) number += 1;
            void this.saveFormats([...formats, { name: named(number) }]);
          });
        });
      },
    };
  }

  private defaultsRow(): SettingDefinition[] {
    if (this.host.createFile === undefined) return [];
    const words = this.words.formats;
    return [
      {
        name: words.addDefaults,
        desc: words.addDefaultsDescription,
        render: (setting) => {
          const say = this.sayLine(setting);
          setting.addButton((button) => {
            button.setButtonText(words.addDefaults).onClick(() => {
              void (async () => {
                const created: string[] = [];
                const kept: string[] = [];
                let formats = [...this.host.settingsNow().formats];
                // Секция — тем же файлом и тем же правилом: есть — не трогаем. Оба
                // готовых формата получают её шаблоном секции, если своего нет: так
                // у человека живой образец цикла с {{anchor}} вместо подсказки (Н2).
                const section = defaultSectionFile(interfaceLanguage());
                const sectionMade = await this.host.createFile!(section.file, section.text);
                (sectionMade ? created : kept).push(section.file);
                for (const ready of defaultFormats(interfaceLanguage())) {
                  const made = await this.host.createFile!(ready.file, ready.text);
                  (made ? created : kept).push(ready.file);
                  if (!formats.some((one) => one.name === ready.name)) {
                    formats.push({
                      name: ready.name,
                      noteTemplate: ready.file,
                      blockTemplate: section.file,
                      pathPattern: `${ready.folder}/{{title}}.md`,
                    });
                  } else {
                    formats = formats.map((one) =>
                      one.name === ready.name && one.blockTemplate === undefined
                        ? { ...one, blockTemplate: section.file }
                        : one,
                    );
                  }
                }
                await this.host.save({ ...this.host.settingsNow(), formats });
                this.rebuild();
                const lines = [
                  created.length > 0 ? fill(words.defaultsCreated, { files: created.join(", ") }) : "",
                  kept.length > 0 ? fill(words.defaultsKept, { files: kept.join(", ") }) : "",
                ].filter((line) => line !== "");
                new Notice(`Beresta: ${lines.join(" ")}`, 10_000);
                // Строка перестроена — пишем в неё, а не в снятую: перестройка
                // синхронна, и `say` новой строки уже на месте.
                this.said?.(lines.join(" "), false);
              })();
            });
          });
          this.said = say;
          return () => {
            if (this.said === say) this.said = undefined;
          };
        },
      },
    ];
  }

  /** Строка ответа у кнопки готовых форматов — та, что на экране сейчас. */
  private said: ((said: string | undefined, refused: boolean) => void) | undefined;

  /** Один формат — своя группа: заголовок с кнопкой удаления и четыре поля. */
  private formatGroup(index: number): SettingDefinitionGroup {
    const words = this.words.formats;
    return {
      type: "group",
      heading: fill(words.formatHeading, { index: String(index + 1) }),
      extraButtons: [
        (button) => {
          button
            .setIcon("trash")
            .setTooltip(words.remove)
            .onClick(() => {
              void this.saveFormats(this.host.settingsNow().formats.filter((_, at) => at !== index));
            });
        },
      ],
      items: [
        this.formatText(index, "name", words.name),
        this.formatText(index, "noteTemplate", words.noteTemplate),
        this.formatText(index, "blockTemplate", words.blockTemplate, words.blockTemplateDescription),
        this.formatText(index, "pathPattern", words.pathPattern),
      ],
    };
  }

  /** Одно поле формата; применяется уходом фокуса, как прочие поля страницы. */
  private formatText(
    index: number,
    key: "name" | "noteTemplate" | "blockTemplate" | "pathPattern",
    label: string,
    description?: string,
  ): SettingDefinition {
    return {
      name: label,
      ...(description === undefined ? {} : { desc: description }),
      render: (setting) => {
        const say = this.sayLine(setting);
        let release: () => void = () => {};
        setting.addText((text) => {
          text.setValue(this.host.settingsNow().formats[index]?.[key] ?? "");
          const commit = async (): Promise<void> => {
            const formats = this.host.settingsNow().formats;
            const current = formats[index];
            if (current === undefined) return;
            const value = text.getValue().trim();
            if (key === "name") {
              if (value === "" || formats.some((one, at) => at !== index && one.name === value)) {
                say(this.words.formats.nameTaken, true);
                text.setValue(current.name);
                return;
              }
              say(undefined, false);
            }
            const next = { ...current, [key]: value === "" && key !== "name" ? undefined : value };
            if (next[key] === current[key]) return;
            await this.saveFormats(formats.map((one, at) => (at === index ? next : one)));
          };
          release = this.awaitCommit(commit);
          text.inputEl.addEventListener("blur", () => void commit());
          // Файлы шаблонов — подсказкой по мере набора, а не полным путём по
          // памяти (заказ владельца 20261019). Выбор сохраняется сразу: уход
          // фокуса после щелчка по списку не гарантирован.
          if (key === "noteTemplate" || key === "blockTemplate") {
            const suggest = new TemplateFileSuggest(this.app, text.inputEl, () =>
              this.app.vault.getMarkdownFiles().map((file) => file.path),
            );
            suggest.onSelect((path) => {
              text.setValue(path);
              suggest.close();
              void commit();
            });
          }
        });
        return release;
      },
    };
  }

  private async saveFormats(formats: readonly NoteFormat[]): Promise<void> {
    await this.host.save({ ...this.host.settingsNow(), formats });
    this.rebuild();
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
  private templateField(): SettingDefinition {
    return {
      name: this.words.templateName,
      desc: this.words.templateDescription,
      render: (setting) => {
        // Строка — столбиком: описание сверху во всю ширину, поле под ним тоже во
        // всю. В обычной строке колонка управления сжимается под длинное описание,
        // и поле шириной «100 %» от неё вырождалось в узкую полоску (кадр владельца
        // 20261007, Obsidian 1.14).
        setting.settingEl.addClass("beresta-setting-stacked");
        const say = this.sayLine(setting);
        let release: () => void = () => {};

        setting.addTextArea((area) => {
          area.setValue(this.host.settingsNow().template ?? "");
          area.inputEl.rows = 12;
          // ⚠️ Вид — КЛАССОМ, а не присваиванием в `style` (замечание проверки
          // каталога 20260915, правило `obsidianmd/no-static-styles-assignment`).
          // Присвоенный стиль не переопределить темой и не отменить пользователю:
          // он старше любого правила таблицы.
          area.inputEl.addClass("beresta-template-area");

          const commit = async (): Promise<void> => {
            const verdict = readTemplateField(area.getValue(), this.words);
            if (verdict.kind === "ok") {
              say(verdict.said, false);
              if (verdict.value !== this.host.settingsNow().template) {
                await this.host.save({ ...this.host.settingsNow(), template: verdict.value });
              }
            } else if (verdict.kind === "refused") {
              say(verdict.said, true);
            }
            area.setValue(this.host.settingsNow().template ?? "");
          };
          release = this.awaitCommit(commit);
          area.inputEl.addEventListener("blur", () => void commit());
        });

        setting.addExtraButton((button) => {
          button
            .setIcon("rotate-ccw")
            .setTooltip(this.words.resetTemplate)
            .onClick(() => {
              void (async () => {
                await this.host.save({ ...this.host.settingsNow(), template: undefined });
                this.rebuild();
              })();
            });
        });
        return release;
      },
    };
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
    read: () => number,
    write: (value: number) => BerestaSettings,
  ): SettingDefinition {
    const field = this.words.fields[spec.key];
    return {
      name: field.name,
      desc: field.description,
      render: (setting) => {
        const say = this.sayLine(setting);
        let release: () => void = () => {};

        setting.addText((text) => {
          text.setValue(String(read()));

          const commit = async (): Promise<void> => {
            const verdict = readNumberField(spec, text.getValue(), this.words);
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
          release = this.awaitCommit(commit);

          // На каждой букве — только слова, без записи: человек видит отказ сразу,
          // а хранилище не перерисовывается на полпути к «300».
          text.onChange((typed) => {
            const verdict = readNumberField(spec, typed, this.words);
            say(verdict.kind === "refused" ? verdict.said : undefined, true);
          });
          text.inputEl.addEventListener("blur", () => void commit());
          text.inputEl.addEventListener("keydown", (event) => {
            if (event.key === "Enter") void commit();
          });
        });
        return release;
      },
    };
  }

  private folderField(): SettingDefinition {
    return {
      name: this.words.folderName,
      desc: this.words.folderDescription,
      render: (setting) => {
        const say = this.sayLine(setting);
        let release: () => void = () => {};

        setting.addText((text) => {
          text.setValue(this.host.settingsNow().libraryFolder);

          const commit = async (): Promise<void> => {
            const verdict = readFolderField(text.getValue(), (path) => this.folderExists(path), this.words);
            if (verdict.kind === "ok") {
              say(verdict.said, false);
              if (verdict.value !== this.host.settingsNow().libraryFolder) {
                await this.host.save({ ...this.host.settingsNow(), libraryFolder: verdict.value });
              }
            } else if (verdict.kind === "refused") {
              say(verdict.said, true);
            }
            text.setValue(this.host.settingsNow().libraryFolder);
          };
          release = this.awaitCommit(commit);

          text.onChange((typed) => {
            const verdict = readFolderField(typed, (path) => this.folderExists(path), this.words);
            if (verdict.kind === "refused") say(verdict.said, true);
            else say(verdict.kind === "ok" ? verdict.said : undefined, false);
          });
          text.inputEl.addEventListener("blur", () => void commit());
          text.inputEl.addEventListener("keydown", (event) => {
            if (event.key === "Enter") void commit();
          });
        });
        return release;
      },
    };
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
   * `setErrorMessage` Obsidian (1.13.0) сюда не зовётся и после подъёма
   * `minAppVersion` до 1.13.0: он знает только отказ, а строке нужны оба
   * ответа — у папки «принято, но такой папки пока нет» отказом не является.
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
