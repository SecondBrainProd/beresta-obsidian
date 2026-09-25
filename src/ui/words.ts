/**
 * Слова панелей плагина — команды, уведомления, страница настроек — по языку
 * интерфейса Obsidian.
 *
 * **Зачем** (долг 0.3в, решение владельца 20260925: плагин двуязычный). Слова
 * ЗАМЕТКИ переведены первыми и живут в `render/words.ts` — они остаются в
 * хранилище человека на годы. Здесь — то, что он видит, пока настраивает и
 * нажимает: имена в окне команд, уведомления в углу, подписи и отказы полей.
 * Перевод идёт партиями между делами; что ещё не переведено, считает
 * `count-ru-strings` по литералам с кириллицей вне комментариев.
 *
 * **Тот же уклад, что у слов заметки: один тип на оба языка.** Пропущенный
 * перевод — ошибка компиляции, а не русская строка у английского читателя.
 * Незнакомый язык — английский: плагин лежит в каталоге сообщества с
 * английским описанием, и показывать русское тому, о ком мы ничего не знаем,
 * — та самая беда, от которой заход и затевался.
 *
 * ⚠️ **Значения формата не переводятся и здесь не живут.** `health: "целый"`,
 * `LookReason`, `LookKind` — это слова в `data.json` и в договорах между
 * модулями, а не на экране; переведи их — и вчерашний файл состояния перестал
 * бы читаться. Счёт долга их ловит как «русские строки», но это не долг.
 *
 * **Подстановки — в фигурных скобках** (`{message}`), заполняет `fill`. Порядок
 * слов в двух языках разный, и строка, склеенная из кусков, в одном из них
 * непременно выйдет косой.
 */

/** Числовое поле страницы настроек — как оно названо и чем отказывает. */
export interface FieldWords {
  /** Имя на странице — этим же именем поле и отказывает. */
  readonly name: string;
  /** Единица в родительном множественном: «минут», «секунд», «версий». */
  readonly units: string;
  /** Что здесь бывает — примером, а не описанием. */
  readonly examples: string;
  /** Пояснение под именем. */
  readonly description: string;
}

export interface SettingsWords {
  /**
   * Папка для новых заметок по умолчанию — по языку интерфейса при ПЕРВОМ
   * запуске (решение владельца 20260925, вопрос 10.1): записанное в `data.json`
   * значение больше не трогается, иначе один человек на двух языках получил бы
   * две папки. В корне хранилища, без `Base/`: «Base» — устройство базы
   * владельца, а не чужих хранилищ (его слова 20260925). Это значение, а не
   * подпись, и живёт здесь потому, что зависит от языка ровно так же, как слова.
   */
  readonly defaultLibraryFolder: string;
  readonly fields: {
    readonly offset: FieldWords;
    readonly interval: FieldWords;
    readonly keepBackups: FieldWords;
    readonly removalCount: FieldWords;
  };
  /** `{typed}` — что напечатали, `{units}` и `{examples}` — из поля. */
  readonly notANumber: string;
  /** `{whole}`, `{least}`, `{most}`, `{examples}`. */
  readonly outOfRange: string;
  readonly templateEmpty: string;
  readonly templateNoAnchor: string;
  /** `{char}` — знак, которого Obsidian не примет. */
  readonly badFolderChar: string;
  /** `{folder}` — папка, которой пока нет. */
  readonly folderMissing: string;
  readonly templateName: string;
  readonly templateDescription: string;
  readonly resetTemplate: string;
  readonly folderName: string;
  readonly folderDescription: string;
}

/** Форма слова при числе. В русском три («книга», «книги», «книг»), в английском две. */
export type Form = "one" | "few" | "many";

/**
 * Три формы одной фразы с `{count}` внутри: «{count} книга», «{count} книги»,
 * «{count} книг». Фраза целиком, а не одно слово: у «ждёт» и «ждут» тоже
 * есть число, и по-английски «is waiting» / «are waiting» стоит не там, где
 * по-русски. Английская таблица держит в `few` и `many` одно и то же.
 */
export interface CountForms {
  readonly one: string;
  readonly few: string;
  readonly many: string;
}

/** Строка состояния в углу окна, подпись к ней и ответ команды «сейчас». */
export interface StatusWords {
  /** Начало строки — по здоровью выгрузки; `{stamp}` — момент данных. */
  readonly head: {
    readonly noExport: string;
    readonly unreadable: string;
    readonly looking: string;
    readonly dataAt: string;
    readonly stillArriving: string;
    readonly dataAtStillArriving: string;
    readonly noQuotes: string;
  };
  /** Хвосты строки через « · ». */
  readonly line: {
    readonly ownEdits: CountForms;
    readonly waitingToSave: CountForms;
    readonly booksStillArriving: CountForms;
  };
  /** Подпись при наведении, по строке на факт. */
  readonly hint: {
    readonly noExport: string;
    readonly unreadable: string;
    readonly halfway: string;
    /** `{stamp}` и `{age}` — хвост из `daysAgo` или пустота. */
    readonly dataAt: string;
    readonly daysAgo: CountForms;
    readonly notesWithQuotes: string;
    readonly unbound: string;
    readonly ownEdits: string;
    readonly deferred: string;
  };
  /** Ответ на «Разложить выписки сейчас» — числами, без бодрости. */
  readonly syncNow: {
    readonly noExport: string;
    readonly unreadable: string;
    readonly noBooks: string;
    /** `{books}` и `{quotes}` — уже со счётом из `books` и `quotes`. */
    readonly inExport: string;
    readonly books: CountForms;
    readonly quotes: CountForms;
    readonly noNotesYet: string;
    readonly quotesLieIn: CountForms;
    readonly nothingBound: string;
    readonly stillUnbound: CountForms;
    readonly halfway: CountForms;
    readonly deferred: CountForms;
  };
}

/** Панель расхождений: записи доски и её описание. */
export interface ConflictsWords {
  /** Заголовок вкладки панели. */
  readonly panelTitle: string;
  readonly deferred: string;
  readonly missing: string;
  /** `{ids}` — книги через запятую; форма — по их числу. */
  readonly unknownBooks: CountForms;
  readonly none: string;
  readonly noneExplained: string;
  readonly some: string;
  readonly someExplained: string;
  readonly entries: CountForms;
  /** `{stamp}` — момент данных, когда это увидели. */
  readonly dataAt: string;
}

/** Окно привязки книг к заметкам и ответ на нажатие «Привязать выбранные». */
export interface BindingWords {
  readonly windowTitle: string;
  readonly noBooks: string;
  readonly allBound: string;
  readonly cancel: string;
  readonly submit: string;
  /** `{path}` — адрес заметки. */
  readonly createNew: string;
  readonly bindExisting: string;
  readonly bindExistingNote: string;
  readonly skipBook: string;
  /** Те же три действия в текстовом виде экрана (`describePlan`). */
  readonly planCreate: string;
  readonly planBind: string;
  readonly planSkip: string;
  readonly whyAuthorOnly: string;
  readonly whyHeadingOnly: string;
  readonly whyMachine: string;
  readonly onlyWeak: string;
  readonly nothingFound: string;
  readonly showMoreWeak: CountForms;
  readonly quotes: CountForms;
  readonly introBooksWaiting: CountForms;
  readonly introChoose: string;
  readonly nothingChosen: string;
  /** `{count}` выбранных из `{total}`. */
  readonly chosenOf: CountForms;
  /** `{bound}`, `{landed}`, `{into}` — уже со счётом из трёх форм ниже. */
  readonly noticeHead: string;
  readonly boundBooks: CountForms;
  readonly quotesLanded: CountForms;
  /** Одна заметка — без числа: «в заметку», «in the note». */
  readonly intoOneNote: string;
  readonly intoNotes: CountForms;
  readonly noteTail: CountForms;
  readonly nothingLandedOneOpen: string;
  readonly nothingLandedManyOpen: string;
  readonly nothingLandedFailed: CountForms;
  readonly nothingChanged: string;
  readonly leftDeferred: CountForms;
  readonly leftFailed: CountForms;
}

/**
 * Слова прохода: расхождения и отказы слияния (они доезжают до панели
 * расхождений как `conflict.message` и `refusal.message`), уведомления бегуна
 * и окно запасных копий.
 */
export interface PassWords {
  readonly headRewritten: string;
  readonly goneInApp: string;
  readonly unknownOrigin: string;
  readonly editedAndChanged: string;
  readonly edited: string;
  /** `{count}` блоков из `{previous}`. */
  readonly tooManyRemovals: CountForms;
  readonly noExportYet: string;
  readonly noSection: string;
  readonly unreadableExport: string;
  /** `{theirs}` и `{ours}` — моменты двух выгрузок. */
  readonly laggingExport: string;
  /** `{paths}` — заметки через запятую; форма — по их числу. */
  readonly deferredNotes: CountForms;
  readonly missingNotes: CountForms;
  readonly backupTitle: string;
  readonly backupNone: string;
  readonly backupExplained: string;
  /** `{savedAt}` и `{count}` знаков. */
  readonly backupRecord: CountForms;
  /** Отказы по маркерам секции: `{begins}` и `{ends}` — сколько нашлось. */
  readonly markersExtraPair: string;
  readonly markersOpeningOnly: string;
  readonly markersClosingOnly: string;
  readonly markersReversed: string;
  /** Жалобы чтения выгрузки: `{file}` — осколок, `{reason}` — слова разборщика. */
  readonly snapshotForeignFile: string;
  readonly snapshotShardMissing: string;
  readonly snapshotChecksum: string;
  readonly snapshotUnreadable: string;
  /**
   * Ошибки шаблона секции. `{opening}`, `{closing}`, `{broken}` — метки как
   * они написаны (`{{#имя}}`), `{name}`, `{where}`, `{known}` — что просили,
   * где и что есть. Слова шаблона `{{имя}}` в самих строках — не подстановки.
   */
  readonly templateUnopened: string;
  readonly templateMisclosed: string;
  readonly templateUnclosed: string;
  readonly templateBrokenBraces: string;
  readonly templateUnknownName: string;
  /** `{count}` строк-маркеров в отрисованной секции вместо двух. */
  readonly sectionMarkers: string;
  readonly sectionDuplicateAnchor: string;
  /** Выгрузка новее плагина: `{version}` против `{supported}`. */
  readonly snapshotTooNew: string;
  /** Под именем указателя чужой формат: `{format}` вместо `{expected}`. */
  readonly snapshotForeign: string;
  /** Заметка `{path}` открыта с несохранённым — запись отложена. */
  readonly noteDirty: string;
}

export interface PanelWords {
  /** Код языка этих слов — чтобы отдать его проходу (`SyncInput.language`). */
  readonly language: string;
  /** Какая форма слова при этом числе — правило языка. */
  readonly form: (count: number) => Form;
  readonly status: StatusWords;
  readonly conflicts: ConflictsWords;
  readonly binding: BindingWords;
  readonly pass: PassWords;
  /** Имена в окне команд. Приставку «Beresta:» Obsidian добавляет сам. */
  readonly commands: {
    readonly syncNow: string;
    readonly bindBooks: string;
    readonly showConflicts: string;
    readonly returnSection: string;
    readonly confirmRemovals: string;
    readonly restoreVersion: string;
  };
  /** Уведомления в углу окна. Каждое начинается с «Beresta:» — их источник виден сразу. */
  readonly notices: {
    /** `{message}` — слова ошибки. */
    readonly passFailed: string;
    readonly choiceNotApplied: string;
    readonly sectionReturned: string;
    readonly noteUnreadable: string;
    readonly sectionNotReturned: string;
    /** `{path}` — где искали указатель выгрузки. */
    readonly noExport: string;
    readonly bindingNotSaved: string;
    /** `{savedAt}` — время версии. */
    readonly restoredToVersion: string;
    /** Подстановка в `restoredToVersion`, когда времени у копии нет. */
    readonly previousVersion: string;
    /** Файла заметки нет там, где его ждали: `{path}`. */
    readonly noteMissing: string;
  };
  readonly settings: SettingsWords;
}

/** 1, 21, 101 — «книга»; 2–4, 22–24 — «книги»; 5–20, 11–14 и прочие — «книг». */
function russianForm(count: number): Form {
  const tens = count % 100;
  if (tens >= 11 && tens <= 14) return "many";
  const ones = count % 10;
  if (ones === 1) return "one";
  if (ones >= 2 && ones <= 4) return "few";
  return "many";
}

function englishForm(count: number): Form {
  return count === 1 ? "one" : "many";
}

const RUSSIAN: PanelWords = {
  language: "ru",
  form: russianForm,
  pass: {
    headRewritten:
      "Заголовок секции Beresta переписан вами — он остаётся вашим и больше не " +
      "обновляется. Цитаты под ним приезжают по-прежнему.",
    goneInApp:
      "В приложении этой выписки больше нет, но в заметке она ваша — правленая. " +
      "Блок остаётся на месте.",
    unknownOrigin:
      "Этот блок Beresta не помнит: ни своей пометки при нём, ни записи в памяти " +
      "(его писала сборка плагина до 20260901, а память с тех пор потерялась). Пока " +
      "не помнит — не трогает.",
    editedAndChanged:
      "Блок правили вы, и в приложении текст тоже изменился. Ваш текст остаётся, " +
      "новая версия — в свёрнутом предупреждении над ним.",
    edited: "Блок правили вы — он остаётся вашим и больше не перерисовывается.",
    tooManyRemovals: {
      one:
        "Этот проход убрал бы {count} блок из {previous}. Так бывает, когда указатель " +
        "Beresta прочитан наполовину или снимок приехал с другой машины, — поэтому " +
        "Beresta остановилась и ничего не записала. Посмотрите список и подтвердите, " +
        "если всё верно.",
      few:
        "Этот проход убрал бы {count} блока из {previous}. Так бывает, когда указатель " +
        "Beresta прочитан наполовину или снимок приехал с другой машины, — поэтому " +
        "Beresta остановилась и ничего не записала. Посмотрите список и подтвердите, " +
        "если всё верно.",
      many:
        "Этот проход убрал бы {count} блоков из {previous}. Так бывает, когда указатель " +
        "Beresta прочитан наполовину или снимок приехал с другой машины, — поэтому " +
        "Beresta остановилась и ничего не записала. Посмотрите список и подтвердите, " +
        "если всё верно.",
    },
    noExportYet:
      "Выгрузки Beresta в этом хранилище ещё нет: приложение сюда ни разу не писало. " +
      "Заметки не трогаем.",
    noSection:
      "В этой заметке нет секции Beresta — ни открывающего маркера, ни закрывающего. " +
      "Сама Beresta её не заводит: если вы убрали секцию нарочно, возвращать её без " +
      "спроса значит спорить с вами. Скажите «Вернуть секцию Beresta», и она появится " +
      "в конце заметки.",
    unreadableExport: "выгрузка не читается",
    laggingExport:
      "Beresta: выгрузка собрана другим устройством и она старше разложенной " +
      "({theirs} против {ours}) — заметки не тронуты. Отстающая выгрузка убрала бы из " +
      "них выписки, которых на той машине ещё нет; как только она догонит, всё приедет " +
      "само.",
    deferredNotes: {
      one:
        "Beresta: заметка открыта с несохранёнными правками — выписки приедут, как " +
        "только вы сохраните: {paths}",
      few:
        "Beresta: заметки открыты с несохранёнными правками — выписки приедут, как " +
        "только вы сохраните: {paths}",
      many:
        "Beresta: заметки открыты с несохранёнными правками — выписки приедут, как " +
        "только вы сохраните: {paths}",
    },
    missingNotes: {
      one:
        "Beresta: привязанной заметки нет на месте ({paths}). Заново не завожу — " +
        "посмотрите панель расхождений.",
      few:
        "Beresta: привязанных заметок нет на месте ({paths}). Заново не завожу — " +
        "посмотрите панель расхождений.",
      many:
        "Beresta: привязанных заметок нет на месте ({paths}). Заново не завожу — " +
        "посмотрите панель расхождений.",
    },
    backupTitle: "Прежние версии заметки",
    backupNone:
      "Копий этой заметки нет. Beresta снимает копию перед каждой своей записью " +
      "в заметку; если она сюда ещё не писала, копировать было нечего.",
    backupExplained:
      "Копия снимается перед каждой записью Beresta, если текст с прошлой копии " +
      "изменился; держатся последние несколько версий, число — в настройках. " +
      "Возврат перепишет заметку целиком — вместе с тем, что вы написали после " +
      "этого момента.",
    backupRecord: {
      one: "{savedAt} — {count} знак",
      few: "{savedAt} — {count} знака",
      many: "{savedAt} — {count} знаков",
    },
    markersExtraPair:
      "В заметке {begins} открывающих и {ends} закрывающих маркеров Beresta вместо " +
      "одной пары. Где кончается наша часть заметки, отсюда не видно, а угадывать " +
      "значит писать в ваш текст. Beresta ничего не записала: оставьте одну пару " +
      "маркеров.",
    markersOpeningOnly:
      "В заметке есть открывающий маркер Beresta, а закрывающего нет. Где кончается " +
      "наша часть заметки, отсюда не видно. Beresta ничего не записала: верните " +
      "вторую строку маркера или уберите обе.",
    markersClosingOnly:
      "В заметке есть закрывающий маркер Beresta, а открывающего нет. Где кончается " +
      "наша часть заметки, отсюда не видно. Beresta ничего не записала: верните " +
      "вторую строку маркера или уберите обе.",
    markersReversed:
      "В заметке закрывающий маркер Beresta стоит раньше открывающего. Beresta " +
      "ничего не записала: поменяйте их местами.",
    snapshotForeignFile:
      "Указатель снимка называет файл «{file}», который не похож на осколок " +
      "Beresta. Плагин его не читает: за пределы .beresta/books он не выходит.",
    snapshotShardMissing:
      "Указатель снимка называет осколок «{file}», а файла нет. Обычно так " +
      "выглядит хранилище посреди синхронизации: подождите и повторите.",
    snapshotChecksum:
      "Осколок «{file}» не сходится с отпечатком в указателе. Файл дописан не " +
      "до конца или изменён мимо Beresta — заметки по нему не обновляются.",
    snapshotUnreadable: "Осколок «{file}» не разбирается: {reason}",
    templateUnopened: "в шаблоне есть «{closing}», а открывающего «{opening}» нет",
    templateMisclosed:
      "в шаблоне «{opening}» закрыт как «{closing}» — куски должны закрываться в " +
      "том же порядке, в каком открыты",
    templateUnclosed: "в шаблоне не закрыт кусок «{opening}»",
    templateBrokenBraces:
      "в шаблоне есть «{broken}» без пары — метка пишется «{{имя}}», «{{#имя}}» " +
      "или «{{/имя}}», имя из латинских букв и цифр",
    templateUnknownName:
      "шаблон просит «{name}» ({where}), а такого значения здесь нет. Доступны: {known}",
    sectionMarkers:
      "в отрисованной секции {count} строк-маркеров вместо двух. Так бывает, если " +
      "строка маркера встретилась в тексте выписки или её дописали в шаблон: секция " +
      "разъехалась бы, и часть машинного текста оказалась бы в вашей части заметки. " +
      "Beresta ничего не записала.",
    sectionDuplicateAnchor:
      "в отрисованной секции два блока получили один якорь. Такой блок в заметке " +
      "перестал бы быть адресом одной выписки. Beresta ничего не записала.",
    snapshotTooNew:
      "Снимок Beresta собран форматом версии {version}, а этот плагин понимает " +
      "{supported}. Обновите плагин — читать снимок наугад нельзя: заметки " +
      "заполнились бы половиной данных.",
    snapshotForeign:
      "Файл .beresta/index.json называет себя форматом «{format}», а не «{expected}». " +
      "Это чужой файл: плагин его не трогает.",
    noteDirty:
      "Заметка «{path}» открыта, и в ней есть несохранённые правки. Beresta не " +
      "пишет в неё сейчас: запись видит файл на диске, а не то, что у вас на " +
      "экране, — ваша строка попала бы внутрь машинного блока, и он замёрз бы " +
      "навсегда. Сохраните заметку, и выписки приедут следующим проходом.",
  },
  binding: {
    windowTitle: "Привязка книг к заметкам",
    noBooks: "В выгрузке Beresta нет книг с выписками.",
    allBound: "Все книги выгрузки уже привязаны к заметкам.",
    cancel: "Отмена",
    submit: "Привязать выбранные",
    createNew: "Создать новую заметку: {path}",
    bindExisting: "Дописать в существующую заметку: {path}",
    bindExistingNote: "заметка по этому адресу уже есть — её текст останется на месте",
    skipBook: "Пропустить эту книгу",
    planCreate: "+ создать новую: {path}",
    planBind: "+ дописать в существующую: {path}",
    planSkip: "+ пропустить",
    whyAuthorOnly: "совпал только автор — возможно, другая книга",
    whyHeadingOnly: "название книги стоит только заголовком раздела внутри заметки",
    whyMachine: "похоже на машинный экспорт",
    onlyWeak: "Заметки с таким названием не нашлось — есть только слабые совпадения.",
    nothingFound: "Ни одной заметки с этим названием или автором в хранилище не нашлось.",
    showMoreWeak: {
      one: "Показать ещё {count} заметку со слабым совпадением",
      few: "Показать ещё {count} заметки со слабым совпадением",
      many: "Показать ещё {count} заметок со слабым совпадением",
    },
    quotes: { one: "{count} выписка", few: "{count} выписки", many: "{count} выписок" },
    introBooksWaiting: {
      one:
        "{count} книга с выписками ждёт заметки: Beresta не знает, куда их класть, " +
        "и сама не решает.",
      few:
        "{count} книги с выписками ждут заметки: Beresta не знает, куда их класть, " +
        "и сама не решает.",
      many:
        "{count} книг с выписками ждут заметки: Beresta не знает, куда их класть, " +
        "и сама не решает.",
    },
    introChoose:
      "Выберите заметку каждой книге — выписки лягут в неё отдельной секцией, ваш " +
      "собственный текст останется нетронутым. Книга без выбора не изменит ничего.",
    nothingChosen: "Пока не выбрано ничего",
    chosenOf: {
      one: "Выбрано {count} книга из {total}",
      few: "Выбрано {count} книги из {total}",
      many: "Выбрано {count} книг из {total}",
    },
    noticeHead: "Beresta: {bound}, {landed} {into}:",
    boundBooks: {
      one: "привязана {count} книга",
      few: "привязано {count} книги",
      many: "привязано {count} книг",
    },
    quotesLanded: {
      one: "{count} выписка легла",
      few: "{count} выписки легли",
      many: "{count} выписок легли",
    },
    intoOneNote: "в заметку",
    intoNotes: { one: "в {count} заметку", few: "в {count} заметки", many: "в {count} заметок" },
    noteTail: { one: "— {count} выписка", few: "— {count} выписки", many: "— {count} выписок" },
    nothingLandedOneOpen:
      "выписки не легли — заметка открыта с несохранёнными правками. Сохраните и " +
      "выберите заново: привязка тоже не записалась.",
    nothingLandedManyOpen:
      "выписки не легли — заметки открыты с несохранёнными правками. Сохраните и " +
      "выберите заново: привязка тоже не записалась.",
    nothingLandedFailed: {
      one: "выписки не легли — проход отказался от {count} заметки. Причина — отдельным сообщением.",
      few: "выписки не легли — проход отказался от {count} заметок. Причина — отдельным сообщением.",
      many: "выписки не легли — проход отказался от {count} заметок. Причина — отдельным сообщением.",
    },
    nothingChanged: "выбор принят, но ни одна заметка не изменилась: эти выписки в них уже стоят.",
    leftDeferred: {
      one:
        "Ещё {count} заметка открыта с несохранёнными правками — привязка по ней не " +
        "записана: сохраните и выберите заново.",
      few:
        "Ещё {count} заметки открыты с несохранёнными правками — привязка по ним не " +
        "записана: сохраните и выберите заново.",
      many:
        "Ещё {count} заметок открыты с несохранёнными правками — привязка по ним не " +
        "записана: сохраните и выберите заново.",
    },
    leftFailed: {
      one: "Ещё от {count} заметки проход отказался — причина отдельным сообщением.",
      few: "Ещё от {count} заметок проход отказался — причина отдельным сообщением.",
      many: "Ещё от {count} заметок проход отказался — причина отдельным сообщением.",
    },
  },
  conflicts: {
    panelTitle: "Расхождения Beresta",
    deferred:
      "Заметка открыта, и в ней есть несохранённые правки. Выписки приедут " +
      "следующим проходом, как только вы сохраните её.",
    missing:
      "Заметка привязана к книге, а файла на месте нет. Beresta не заводит его " +
      "заново: вернуть одной секцией заметку, которую вы удалили, хуже, чем не " +
      "вернуть. Если она нужна — привяжите книгу заново.",
    unknownBooks: {
      one:
        "В выгрузке нет книги {ids}. Так бывает, когда книгу удалили из Beresta или " +
        "выгрузка приехала с другой машины. Блоки этой книги в заметке не трогаются.",
      few:
        "В выгрузке нет книг {ids}. Так бывает, когда книгу удалили из Beresta или " +
        "выгрузка приехала с другой машины. Блоки этой книги в заметке не трогаются.",
      many:
        "В выгрузке нет книг {ids}. Так бывает, когда книгу удалили из Beresta или " +
        "выгрузка приехала с другой машины. Блоки этой книги в заметке не трогаются.",
    },
    none: "Расхождений нет.",
    noneExplained:
      "Здесь появятся места, где ваша правка и приложение разошлись: вы поправили " +
      "цитату в заметке, а в Beresta её текст изменился. Такие блоки Beresta " +
      "перестаёт перерисовывать — они остаются вашими.",
    some: "Здесь места, где ваша правка и приложение разошлись.",
    someExplained:
      "Делать ничего не нужно: ваш текст остаётся вашим, эти блоки Beresta больше не " +
      "перерисовывает. Свежую версию из приложения она кладёт свёрнутым " +
      "предупреждением над вашим текстом.",
    entries: { one: "{count} запись", few: "{count} записи", many: "{count} записей" },
    dataAt: "данные на {stamp}",
  },
  status: {
    head: {
      noExport: "выгрузки ещё нет",
      unreadable: "указатель не читается",
      looking: "смотрю",
      dataAt: "данные на {stamp}",
      stillArriving: "выгрузка ещё едет",
      dataAtStillArriving: "данные на {stamp}, выгрузка ещё едет",
      noQuotes: "выписок нет",
    },
    line: {
      ownEdits: { one: "{count} ваша правка", few: "{count} ваши правки", many: "{count} ваших правок" },
      waitingToSave: {
        one: "{count} заметка ждёт сохранения",
        few: "{count} заметки ждут сохранения",
        many: "{count} заметок ждут сохранения",
      },
      booksStillArriving: {
        one: "{count} книга ещё едет",
        few: "{count} книги ещё едет",
        many: "{count} книг ещё едет",
      },
    },
    hint: {
      noExport:
        "Выгрузки Beresta в этом хранилище ещё нет. Приложение пишет её само; " +
        "заметки до тех пор не трогаются.",
      unreadable:
        "Указатель выгрузки не разбирается. Заметки не трогаются, пока он не " +
        "станет читаемым — обычно это лечится следующей выгрузкой из приложения.",
      halfway:
        "Выгрузка доехала не целиком — так выглядит хранилище посреди " +
        "синхронизации. Плагин смотрит снова и доложит книги, как только они " +
        "появятся.",
      dataAt: "Данные на {stamp}{age}.",
      daysAgo: {
        one: " — это {count} день назад",
        few: " — это {count} дня назад",
        many: " — это {count} дней назад",
      },
      notesWithQuotes: "Заметок с выписками: {count}.",
      unbound:
        "Книг без заметки: {count}. Им некуда лечь — команда «Привязать книги " +
        "к заметкам».",
      ownEdits:
        "Ваших правок в секции: {count}. Эти блоки заморожены и остаются " +
        "вашими; список — команда «Показать расхождения Beresta».",
      deferred:
        "Ждут сохранения: {count}. Заметка открыта с несохранёнными правками — " +
        "запись видит файл на диске, а не то, что у вас на экране.",
    },
    syncNow: {
      noExport:
        "Beresta: выгрузки Beresta в этом хранилище нет — раскладывать нечего. " +
        "Приложение пишет её само; заметки до тех пор не трогаются.",
      unreadable:
        "Beresta: указатель выгрузки не разбирается — заметки не тронуты. " +
        "Обычно это лечится следующей выгрузкой из приложения.",
      noBooks: "Beresta: в выгрузке нет ни одной книги с выписками — раскладывать нечего.",
      inExport: "Beresta: в выгрузке {books}, {quotes}.",
      books: { one: "{count} книга", few: "{count} книги", many: "{count} книг" },
      quotes: { one: "{count} выписка", few: "{count} выписки", many: "{count} выписок" },
      noNotesYet: "Ни в одной заметке выписок Beresta пока нет.",
      quotesLieIn: {
        one: "Выписки лежат в {count} заметке.",
        few: "Выписки лежат в {count} заметках.",
        many: "Выписки лежат в {count} заметках.",
      },
      nothingBound:
        "Ни одна книга не привязана к заметке — раскладывать некуда. " +
        "Начните с команды «Привязать книги к заметкам».",
      stillUnbound: {
        one: "Ещё {count} книге некуда лечь — команда «Привязать книги к заметкам».",
        few: "Ещё {count} книгам некуда лечь — команда «Привязать книги к заметкам».",
        many: "Ещё {count} книгам некуда лечь — команда «Привязать книги к заметкам».",
      },
      halfway: {
        one: "Выгрузка доехала не целиком: {count} книга ещё едет.",
        few: "Выгрузка доехала не целиком: {count} книги ещё едет.",
        many: "Выгрузка доехала не целиком: {count} книг ещё едет.",
      },
      deferred: {
        one:
          "{count} заметка ждёт сохранения: заметка открыта с несохранёнными " +
          "правками, выписки приедут, как только вы сохраните.",
        few:
          "{count} заметки ждут сохранения: заметка открыта с несохранёнными " +
          "правками, выписки приедут, как только вы сохраните.",
        many:
          "{count} заметок ждут сохранения: заметка открыта с несохранёнными " +
          "правками, выписки приедут, как только вы сохраните.",
      },
    },
  },
  commands: {
    syncNow: "Разложить выписки сейчас",
    bindBooks: "Привязать книги к заметкам",
    showConflicts: "Показать расхождения",
    returnSection: "Вернуть секцию Beresta в эту заметку",
    confirmRemovals: "Подтвердить удаление блоков в этой заметке",
    restoreVersion: "Восстановить прежнюю версию этой заметки",
  },
  notices: {
    passFailed: "Beresta: проход не удался — {message}",
    choiceNotApplied:
      "Beresta: выбор не применён — предыдущий проход ещё идёт. Повторите " +
      "команду «Привязать книги к заметкам».",
    sectionReturned: "Beresta: секция вернулась в заметку.",
    noteUnreadable: "Beresta: заметку не прочитать — секция не возвращена.",
    sectionNotReturned:
      "Beresta: секция не вернулась. Похоже, эта заметка не привязана ни к одной " +
      "книге — привяжите её командой «Привязать книги к заметкам».",
    noExport:
      "Beresta: выгрузки в этом хранилище нет ({path}). Сделайте выгрузку в " +
      "приложении — и книги появятся здесь.",
    bindingNotSaved:
      "Beresta: выписки не легли — выгрузки Beresta сейчас не видно. Привязка " +
      "не записана: выберите заново, когда выгрузка появится.",
    restoredToVersion:
      "Beresta: заметка возвращена к версии от {savedAt}. Блоки в ней Beresta " +
      "теперь не помнит и потому не трогает; новые выписки будут приезжать по-прежнему.",
    previousVersion: "прежней",
    noteMissing: "заметки нет на месте: {path}",
  },
  settings: {
    defaultLibraryFolder: "Библиотека",
    fields: {
      offset: {
        name: "Часовой пояс выписок",
        units: "минут",
        examples: "300 — Караганда, 180 — Москва, 0 — Гринвич",
        description:
          "Сдвиг в минутах от UTC: 300 — Караганда, 180 — Москва. Время выделения " +
          "печатается в каждом блоке, поэтому сдвиг закреплён числом. Смените его — " +
          "и все блоки перерисуются один раз; блоки, которые вы правили руками, " +
          "останутся вашими.",
      },
      interval: {
        name: "Как часто смотреть на выгрузку",
        units: "секунд",
        examples: "5 — как сейчас, 60 — раз в минуту",
        description:
          "Секунд между взглядами, когда окно Obsidian впереди. Без фокуса Beresta " +
          "смотрит раз в минуту. Взгляд стоит одного обращения к файлу: заметки " +
          "трогаются, только если выгрузка изменилась.",
      },
      keepBackups: {
        name: "Сколько версий заметки хранить",
        units: "версий",
        examples: "5 — как сейчас",
        description:
          "Beresta снимает копию заметки перед КАЖДОЙ своей записью в неё — но только " +
          "если текст изменился с прошлой копии. Держится столько последних версий, " +
          "сколько здесь стоит; всё, что старше, вытесняется. Копии лежат в папке " +
          "плагина и не попадают ни в поиск, ни в граф.",
      },
      removalCount: {
        name: "Предохранитель: сколько блоков можно убрать за проход",
        units: "блоков",
        examples: "20 — как сейчас",
        description:
          "Если проход убирает больше этого числа блоков или больше пятой части — он " +
          "останавливается и показывает список. Так выглядит выгрузка, приехавшая " +
          "наполовину или с другой машины.",
      },
    },
    notANumber:
      "«{typed}» — это не число, настройка осталась прежней. Здесь нужны {units}: {examples}.",
    outOfRange:
      "{whole} — вне границ поля (от {least} до {most}), настройка осталась прежней. {examples}.",
    templateEmpty: "Пусто — значит как у всех: стандартный шаблон.",
    templateNoAnchor:
      "В шаблоне нет {{anchor}} — без него блок нечем связать с выпиской, и " +
      "следующий проход посчитает все прежние блоки убранными. Шаблон не сохранён.",
    badFolderChar: "Знак «{char}» в имени папки Obsidian не примет — настройка осталась прежней.",
    folderMissing:
      "Папки «{folder}» в хранилище нет — Beresta заведёт её, когда вы впервые скажете " +
      "«создать новую заметку».",
    templateName: "Шаблон секции выписок",
    templateDescription:
      "Как выглядит блок одной выписки в заметке. Пусто — как у всех: " +
      "стандартный шаблон, который будет улучшаться с новыми версиями. " +
      "Доступные значения: {{text}}, {{comment}}, {{caption}}, {{heading}}, " +
      "{{tags}}, {{link}}, {{page}}, {{date}}, {{color}} и другие; список " +
      "целиком плагин покажет в ошибке, если ошибётесь в имени. " +
      "{{anchor}} обязателен — им держится связь блока с выпиской.",
    resetTemplate: "Вернуть стандартный",
    folderName: "Папка для новых заметок",
    folderDescription: "Куда класть заметку книги, для которой вы выбрали «создать новую».",
  },
};

const ENGLISH: PanelWords = {
  language: "en",
  form: englishForm,
  pass: {
    headRewritten:
      "You rewrote the heading of the Beresta section — it stays yours and is no " +
      "longer updated. The quotes under it keep arriving.",
    goneInApp:
      "The app no longer has this highlight, but in the note it is yours — edited. " +
      "The block stays in place.",
    unknownOrigin:
      "Beresta does not remember this block: neither its own mark next to it nor a " +
      "record in memory (a plugin build before 20260901 wrote it, and the memory has " +
      "been lost since). While it does not remember, it does not touch.",
    editedAndChanged:
      "You edited this block, and the text changed in the app too. Your text stays; " +
      "the new version is in the folded warning above it.",
    edited: "You edited this block — it stays yours and is no longer redrawn.",
    tooManyRemovals: {
      one:
        "This pass would remove {count} block of {previous}. This is what a half-read " +
        "Beresta index or a snapshot from another machine looks like — so Beresta " +
        "stopped and wrote nothing. Look through the list and confirm if all is right.",
      few:
        "This pass would remove {count} blocks of {previous}. This is what a half-read " +
        "Beresta index or a snapshot from another machine looks like — so Beresta " +
        "stopped and wrote nothing. Look through the list and confirm if all is right.",
      many:
        "This pass would remove {count} blocks of {previous}. This is what a half-read " +
        "Beresta index or a snapshot from another machine looks like — so Beresta " +
        "stopped and wrote nothing. Look through the list and confirm if all is right.",
    },
    noExportYet:
      "There is no Beresta export in this vault yet: the app has never written here. " +
      "Notes are left alone.",
    noSection:
      "This note has no Beresta section — neither the opening marker nor the closing " +
      "one. Beresta does not create it by itself: if you removed the section on " +
      "purpose, bringing it back unasked would mean arguing with you. Say “Return the " +
      "Beresta section”, and it will appear at the end of the note.",
    unreadableExport: "the export cannot be read",
    laggingExport:
      "Beresta: the export was made by another device and it is older than the one " +
      "laid out ({theirs} against {ours}) — notes were not touched. A lagging export " +
      "would remove highlights that machine does not have yet; as soon as it catches " +
      "up, everything will arrive by itself.",
    deferredNotes: {
      one:
        "Beresta: a note is open with unsaved edits — the highlights will arrive as " +
        "soon as you save: {paths}",
      few:
        "Beresta: notes are open with unsaved edits — the highlights will arrive as " +
        "soon as you save: {paths}",
      many:
        "Beresta: notes are open with unsaved edits — the highlights will arrive as " +
        "soon as you save: {paths}",
    },
    missingNotes: {
      one:
        "Beresta: a bound note is not in place ({paths}). Not creating it anew — " +
        "see the discrepancies panel.",
      few:
        "Beresta: bound notes are not in place ({paths}). Not creating them anew — " +
        "see the discrepancies panel.",
      many:
        "Beresta: bound notes are not in place ({paths}). Not creating them anew — " +
        "see the discrepancies panel.",
    },
    backupTitle: "Earlier versions of the note",
    backupNone:
      "There are no copies of this note. Beresta saves a copy before every write of " +
      "its own into a note; if it has never written here, there was nothing to copy.",
    backupExplained:
      "A copy is saved before every Beresta write, if the text changed since the last " +
      "copy; the last few versions are kept, the number is in the settings. Restoring " +
      "rewrites the whole note — together with what you wrote after that moment.",
    backupRecord: {
      one: "{savedAt} — {count} character",
      few: "{savedAt} — {count} characters",
      many: "{savedAt} — {count} characters",
    },
    markersExtraPair:
      "The note has {begins} opening and {ends} closing Beresta markers instead of one " +
      "pair. Where our part of the note ends cannot be seen from here, and guessing " +
      "would mean writing into your text. Beresta wrote nothing: leave one pair of " +
      "markers.",
    markersOpeningOnly:
      "The note has an opening Beresta marker but no closing one. Where our part of " +
      "the note ends cannot be seen from here. Beresta wrote nothing: put the second " +
      "marker line back or remove both.",
    markersClosingOnly:
      "The note has a closing Beresta marker but no opening one. Where our part of " +
      "the note ends cannot be seen from here. Beresta wrote nothing: put the second " +
      "marker line back or remove both.",
    markersReversed:
      "In the note the closing Beresta marker comes before the opening one. Beresta " +
      "wrote nothing: swap them.",
    snapshotForeignFile:
      "The snapshot index names the file “{file}”, which does not look like a Beresta " +
      "shard. The plugin does not read it: it never leaves .beresta/books.",
    snapshotShardMissing:
      "The snapshot index names the shard “{file}”, but the file is not there. This is " +
      "what a vault in the middle of a sync usually looks like: wait and try again.",
    snapshotChecksum:
      "The shard “{file}” does not match the fingerprint in the index. The file was not " +
      "written to the end or was changed outside Beresta — its notes are not updated.",
    snapshotUnreadable: "The shard “{file}” cannot be parsed: {reason}",
    templateUnopened: "the template has “{closing}” but no opening “{opening}”",
    templateMisclosed:
      "in the template “{opening}” is closed as “{closing}” — pieces must close in the " +
      "order they were opened",
    templateUnclosed: "the template does not close the piece “{opening}”",
    templateBrokenBraces:
      "the template has “{broken}” without a pair — a tag is written as “{{name}}”, " +
      "“{{#name}}” or “{{/name}}”, the name in Latin letters and digits",
    templateUnknownName:
      "the template asks for “{name}” ({where}), and there is no such value here. " +
      "Available: {known}",
    sectionMarkers:
      "the rendered section has {count} marker lines instead of two. This happens when a " +
      "marker line appears in a highlight’s text or was added to the template: the " +
      "section would fall apart, and part of the machine text would end up in your part " +
      "of the note. Beresta wrote nothing.",
    sectionDuplicateAnchor:
      "in the rendered section two blocks got the same anchor. Such a block would no " +
      "longer be the address of one highlight in the note. Beresta wrote nothing.",
    snapshotTooNew:
      "The Beresta snapshot was made with format version {version}, and this plugin " +
      "understands {supported}. Update the plugin — reading the snapshot blindly is " +
      "not an option: the notes would fill up with half the data.",
    snapshotForeign:
      "The file .beresta/index.json calls itself format “{format}”, not “{expected}”. " +
      "It is someone else’s file: the plugin does not touch it.",
    noteDirty:
      "The note “{path}” is open and has unsaved edits. Beresta is not writing into " +
      "it now: the write sees the file on disk, not what is on your screen — your " +
      "line would end up inside a machine block and freeze there for good. Save the " +
      "note, and the highlights will arrive with the next pass.",
  },
  binding: {
    windowTitle: "Bind books to notes",
    noBooks: "The Beresta export has no books with highlights.",
    allBound: "Every book in the export is already bound to a note.",
    cancel: "Cancel",
    submit: "Bind the chosen",
    createNew: "Create a new note: {path}",
    bindExisting: "Add to the existing note: {path}",
    bindExistingNote: "a note already exists at this path — its text stays in place",
    skipBook: "Skip this book",
    planCreate: "+ create a new one: {path}",
    planBind: "+ add to the existing one: {path}",
    planSkip: "+ skip",
    whyAuthorOnly: "only the author matched — possibly a different book",
    whyHeadingOnly: "the book title appears only as a section heading inside the note",
    whyMachine: "looks like a machine-generated export",
    onlyWeak: "No note with this title was found — only weak matches.",
    nothingFound: "No note with this title or author was found in the vault.",
    showMoreWeak: {
      one: "Show {count} more note with a weak match",
      few: "Show {count} more notes with a weak match",
      many: "Show {count} more notes with a weak match",
    },
    quotes: { one: "{count} highlight", few: "{count} highlights", many: "{count} highlights" },
    introBooksWaiting: {
      one:
        "{count} book with highlights is waiting for a note: Beresta does not know " +
        "where to put them, and does not decide by itself.",
      few:
        "{count} books with highlights are waiting for a note: Beresta does not know " +
        "where to put them, and does not decide by itself.",
      many:
        "{count} books with highlights are waiting for a note: Beresta does not know " +
        "where to put them, and does not decide by itself.",
    },
    introChoose:
      "Choose a note for each book — the highlights will go into it as a separate " +
      "section, your own text stays untouched. A book without a choice changes nothing.",
    nothingChosen: "Nothing chosen yet",
    chosenOf: {
      one: "{count} book chosen of {total}",
      few: "{count} books chosen of {total}",
      many: "{count} books chosen of {total}",
    },
    noticeHead: "Beresta: {bound}, {landed} {into}:",
    boundBooks: { one: "{count} book bound", few: "{count} books bound", many: "{count} books bound" },
    quotesLanded: {
      one: "{count} highlight landed",
      few: "{count} highlights landed",
      many: "{count} highlights landed",
    },
    intoOneNote: "in the note",
    intoNotes: { one: "in {count} note", few: "in {count} notes", many: "in {count} notes" },
    noteTail: { one: "— {count} highlight", few: "— {count} highlights", many: "— {count} highlights" },
    nothingLandedOneOpen:
      "the highlights did not land — the note is open with unsaved edits. Save it and " +
      "choose again: the binding was not recorded either.",
    nothingLandedManyOpen:
      "the highlights did not land — the notes are open with unsaved edits. Save them " +
      "and choose again: the binding was not recorded either.",
    nothingLandedFailed: {
      one: "the highlights did not land — the pass refused {count} note. The reason comes as a separate message.",
      few: "the highlights did not land — the pass refused {count} notes. The reason comes as a separate message.",
      many: "the highlights did not land — the pass refused {count} notes. The reason comes as a separate message.",
    },
    nothingChanged: "the choice was accepted, but no note changed: these highlights are already in them.",
    leftDeferred: {
      one:
        "{count} more note is open with unsaved edits — its binding was not recorded: " +
        "save and choose again.",
      few:
        "{count} more notes are open with unsaved edits — their binding was not recorded: " +
        "save and choose again.",
      many:
        "{count} more notes are open with unsaved edits — their binding was not recorded: " +
        "save and choose again.",
    },
    leftFailed: {
      one: "The pass refused {count} more note — the reason comes as a separate message.",
      few: "The pass refused {count} more notes — the reason comes as a separate message.",
      many: "The pass refused {count} more notes — the reason comes as a separate message.",
    },
  },
  conflicts: {
    panelTitle: "Beresta discrepancies",
    deferred:
      "The note is open and has unsaved edits. The highlights will arrive with the " +
      "next pass, as soon as you save it.",
    missing:
      "The note is bound to a book, but the file is not there. Beresta does not create " +
      "it anew: bringing back a note you deleted as a single section is worse than not " +
      "bringing it back. If you need it, bind the book again.",
    unknownBooks: {
      one:
        "The export has no book {ids}. This happens when the book was deleted from " +
        "Beresta or the export came from another machine. This book’s blocks in the " +
        "note are left alone.",
      few:
        "The export has no books {ids}. This happens when a book was deleted from " +
        "Beresta or the export came from another machine. These books’ blocks in the " +
        "note are left alone.",
      many:
        "The export has no books {ids}. This happens when a book was deleted from " +
        "Beresta or the export came from another machine. These books’ blocks in the " +
        "note are left alone.",
    },
    none: "No discrepancies.",
    noneExplained:
      "Here you will see the places where your edit and the app diverged: you corrected " +
      "a quote in the note, and its text changed in Beresta. Beresta stops redrawing " +
      "such blocks — they stay yours.",
    some: "Here are the places where your edit and the app diverged.",
    someExplained:
      "Nothing needs to be done: your text stays yours, Beresta no longer redraws these " +
      "blocks. It puts the newer version from the app as a folded warning above your text.",
    entries: { one: "{count} entry", few: "{count} entries", many: "{count} entries" },
    dataAt: "data as of {stamp}",
  },
  status: {
    head: {
      noExport: "no export yet",
      unreadable: "the export index is unreadable",
      looking: "looking",
      dataAt: "data as of {stamp}",
      stillArriving: "the export is still arriving",
      dataAtStillArriving: "data as of {stamp}, the export is still arriving",
      noQuotes: "no highlights",
    },
    line: {
      ownEdits: { one: "{count} edit of yours", few: "{count} edits of yours", many: "{count} edits of yours" },
      waitingToSave: {
        one: "{count} note waiting to be saved",
        few: "{count} notes waiting to be saved",
        many: "{count} notes waiting to be saved",
      },
      booksStillArriving: {
        one: "{count} book still arriving",
        few: "{count} books still arriving",
        many: "{count} books still arriving",
      },
    },
    hint: {
      noExport:
        "There is no Beresta export in this vault yet. The app writes it by itself; " +
        "notes are left alone until then.",
      unreadable:
        "The export index cannot be parsed. Notes are left alone until it becomes " +
        "readable — usually the next export from the app fixes this.",
      halfway:
        "The export has not fully arrived — this is what a vault looks like in the " +
        "middle of a sync. The plugin keeps looking and will report the books as soon " +
        "as they appear.",
      dataAt: "Data as of {stamp}{age}.",
      daysAgo: {
        one: " — that is {count} day ago",
        few: " — that is {count} days ago",
        many: " — that is {count} days ago",
      },
      notesWithQuotes: "Notes with highlights: {count}.",
      unbound:
        "Books without a note: {count}. They have nowhere to go — the " +
        "“Bind books to notes” command.",
      ownEdits:
        "Your edits in the section: {count}. These blocks are frozen and stay yours; " +
        "the list — the “Show discrepancies” command.",
      deferred:
        "Waiting to be saved: {count}. The note is open with unsaved edits — " +
        "the write sees the file on disk, not what is on your screen.",
    },
    syncNow: {
      noExport:
        "Beresta: there is no Beresta export in this vault — nothing to lay out. " +
        "The app writes it by itself; notes are left alone until then.",
      unreadable:
        "Beresta: the export index cannot be parsed — notes were not touched. " +
        "Usually the next export from the app fixes this.",
      noBooks: "Beresta: the export has no book with highlights — nothing to lay out.",
      inExport: "Beresta: the export holds {books}, {quotes}.",
      books: { one: "{count} book", few: "{count} books", many: "{count} books" },
      quotes: { one: "{count} highlight", few: "{count} highlights", many: "{count} highlights" },
      noNotesYet: "No note holds Beresta highlights yet.",
      quotesLieIn: {
        one: "The highlights lie in {count} note.",
        few: "The highlights lie in {count} notes.",
        many: "The highlights lie in {count} notes.",
      },
      nothingBound:
        "No book is bound to a note — nowhere to lay out. " +
        "Start with the “Bind books to notes” command.",
      stillUnbound: {
        one: "{count} more book has nowhere to go — the “Bind books to notes” command.",
        few: "{count} more books have nowhere to go — the “Bind books to notes” command.",
        many: "{count} more books have nowhere to go — the “Bind books to notes” command.",
      },
      halfway: {
        one: "The export has not fully arrived: {count} book is still arriving.",
        few: "The export has not fully arrived: {count} books are still arriving.",
        many: "The export has not fully arrived: {count} books are still arriving.",
      },
      deferred: {
        one:
          "{count} note is waiting to be saved: the note is open with unsaved edits, " +
          "the highlights will arrive as soon as you save.",
        few:
          "{count} notes are waiting to be saved: the notes are open with unsaved edits, " +
          "the highlights will arrive as soon as you save.",
        many:
          "{count} notes are waiting to be saved: the notes are open with unsaved edits, " +
          "the highlights will arrive as soon as you save.",
      },
    },
  },
  commands: {
    syncNow: "Lay out highlights now",
    bindBooks: "Bind books to notes",
    showConflicts: "Show discrepancies",
    returnSection: "Return the Beresta section to this note",
    confirmRemovals: "Confirm removing blocks from this note",
    restoreVersion: "Restore an earlier version of this note",
  },
  notices: {
    passFailed: "Beresta: the pass failed — {message}",
    choiceNotApplied:
      "Beresta: your choice was not applied — the previous pass is still running. " +
      "Run “Bind books to notes” again.",
    sectionReturned: "Beresta: the section is back in the note.",
    noteUnreadable: "Beresta: the note could not be read — the section was not returned.",
    sectionNotReturned:
      "Beresta: the section did not come back. This note seems to be bound to no " +
      "book — bind it with “Bind books to notes”.",
    noExport:
      "Beresta: there is no export in this vault ({path}). Export from the app, " +
      "and the books will appear here.",
    bindingNotSaved:
      "Beresta: the highlights were not laid out — the Beresta export is not visible " +
      "right now. The binding was not saved: choose again once the export appears.",
    restoredToVersion:
      "Beresta: the note was returned to the version from {savedAt}. Beresta no longer " +
      "remembers the blocks in it and leaves them alone; new highlights will keep arriving.",
    previousVersion: "an earlier time",
    noteMissing: "the note is not in place: {path}",
  },
  settings: {
    defaultLibraryFolder: "Library",
    fields: {
      offset: {
        name: "Time zone of highlights",
        units: "minutes",
        examples: "300 — Karaganda, 180 — Moscow, 0 — Greenwich",
        description:
          "Offset in minutes from UTC: 300 — Karaganda, 180 — Moscow. The time of a " +
          "highlight is printed in every block, so the offset is fixed as a number. " +
          "Change it — and every block is redrawn once; blocks you edited by hand " +
          "stay yours.",
      },
      interval: {
        name: "How often to look at the export",
        units: "seconds",
        examples: "5 — as now, 60 — once a minute",
        description:
          "Seconds between looks while the Obsidian window is in front. Without focus " +
          "Beresta looks once a minute. A look costs one file access: notes are " +
          "touched only if the export changed.",
      },
      keepBackups: {
        name: "How many versions of a note to keep",
        units: "versions",
        examples: "5 — as now",
        description:
          "Beresta saves a copy of the note before EVERY write of its own — but only " +
          "if the text changed since the last copy. It keeps as many recent versions " +
          "as set here; anything older is pushed out. Copies live in the plugin folder " +
          "and appear neither in search nor in the graph.",
      },
      removalCount: {
        name: "Fuse: how many blocks a pass may remove",
        units: "blocks",
        examples: "20 — as now",
        description:
          "If a pass removes more blocks than this number, or more than a fifth of " +
          "them, it stops and shows the list. That is what an export looks like when " +
          "it arrived halfway or from another machine.",
      },
    },
    notANumber:
      "“{typed}” is not a number, the setting stays as it was. This field takes {units}: {examples}.",
    outOfRange:
      "{whole} is outside the field’s range ({least} to {most}), the setting stays as it was. {examples}.",
    templateEmpty: "Empty means the same as for everyone: the standard template.",
    templateNoAnchor:
      "The template has no {{anchor}} — without it a block cannot be tied to its " +
      "highlight, and the next pass will count every earlier block as removed. " +
      "The template was not saved.",
    badFolderChar: "Obsidian will not accept “{char}” in a folder name — the setting stays as it was.",
    folderMissing:
      "There is no folder “{folder}” in the vault — Beresta will create it the first " +
      "time you choose “create a new note”.",
    templateName: "Highlight section template",
    templateDescription:
      "How the block of one highlight looks in the note. Empty means the same as for " +
      "everyone: the standard template, which will improve with new versions. " +
      "Available values: {{text}}, {{comment}}, {{caption}}, {{heading}}, " +
      "{{tags}}, {{link}}, {{page}}, {{date}}, {{color}} and others; the plugin " +
      "shows the full list in the error if you misspell a name. " +
      "{{anchor}} is required — it keeps the block tied to its highlight.",
    resetTemplate: "Restore the standard one",
    folderName: "Folder for new notes",
    folderDescription: "Where to put the note of a book for which you chose “create a new one”.",
  },
};

const WORDS: Readonly<Record<string, PanelWords>> = {
  ru: RUSSIAN,
  en: ENGLISH,
};

/** Слова панелей для этого языка интерфейса; незнакомый язык — английский. */
export function panelWords(language: string): PanelWords {
  return WORDS[language] ?? ENGLISH;
}

/**
 * Подставляет значения в `{имя}`. Незнакомое имя остаётся как есть — это
 * видно глазами и в проверке, а молчаливая пустота — нет. Двойные скобки
 * шаблона (`{{anchor}}`) не трогаются: это слово шаблона, а не подстановка.
 */
export function fill(template: string, values: Readonly<Record<string, string | number>>): string {
  return template.replace(/(?<!\{)\{([a-zA-Z]+)\}(?!\})/g, (whole, name: string) =>
    name in values ? String(values[name]) : whole,
  );
}

/** Фраза с числом в форме этого языка: «21 книга», «21 books». */
export function counted(words: PanelWords, count: number, forms: CountForms): string {
  return fill(forms[words.form(count)], { count });
}
