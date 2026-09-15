# Формат выгрузки Beresta в хранилище / Beresta Vault Export Format

Документ на двух языках: [Русский](#русский) · [English](#english).

Two-language document: [Русский](#русский) · [English](#english).

> **Статус: версия формата 1 — `formatVersion` = 1.** Раскладка папки, имена
> файлов, поля указателя и поля `beresta:` — публичное обязательство, а не
> рабочая заметка. Что при этом ещё может быть добавлено и чего мы намеренно не
> обещаем — в разделе [Версия формата](#версия-формата-и-правило-её-роста).
> Версию файл на диске называет сам (первым же ключом `index.json`), и верить на
> слово этому документу не обязан ни один инструмент.
>
> **Status: format version 1 — `formatVersion` = 1.** The folder layout, the file
> names, the index fields and the `beresta:` fields are a public commitment, not
> a working note. What may still be added, and what is deliberately not promised,
> is under [Format version](#format-version-and-the-rule-for-raising-it). A file
> on disk states its own version — the first key of `index.json` — so no tool has
> to take this document's word for it.

---

## Русский

### Назначение

Beresta кладёт в хранилище Obsidian машиночитаемый снимок ваших выписок. Плагин
Beresta для Obsidian — один из возможных читателей этого снимка, а не
единственный: снимок это обычные текстовые файлы в стандартном формате, и
прочитать их может любая программа, умеющая JSON. Ни SQLite, ни Swift, ни
Obsidian, ни сети для чтения не нужно.

Этот документ описывает снимок так, чтобы сторонний инструмент был написан по
нему одному. **Правило документа: ни одного утверждения, которое нельзя
проверить, открыв файл.** В конце каждого раздела стоит команда, которой
утверждение проверяется; раздел [Как проверить всё сразу](#как-проверить-всё-сразу)
собирает их в один список.

**Лицензия документа:** CC0 1.0 Universal (`docs/schema/LICENSE`), как и
`docs/schema/schema.md`, — в отличие от кода приложения: он проприетарен.
Экосистема вправе свободно читать, писать и реализовывать этот формат в других
программах — без спроса и без указания авторства.

### Раскладка

```
<хранилище>/.beresta/
    index.json               указатель: заголовок снимка и перечень книг
    context.jsonld           расширение словаря W3C полями beresta:
    anno.jsonld              дословный снимок словаря W3C anno.jsonld
    books/
        <uuid-книги>.jsonld  осколок: все выписки одной книги
        orphans.jsonld       осколок выписок, у которых книги нет вовсе
```

`orphans.jsonld` появляется, только если такие выписки есть; в снимке библиотеки
владельца 20260816 его нет — все 10 осколков названы по `uuid` книг.

Пять правил раскладки, и все пять проверяются открытием папки:

1. **Точка в начале имени — нарочно.** Obsidian не показывает такие папки в
   дереве заметок, не индексирует их поиском и не тянет в граф (замер
   20260812). Снимок лежит внутри хранилища, но не мозолит глаза.
2. **Приложение пишет только сюда.** Ни одного файла за пределами `.beresta/`
   Beresta в хранилище не создаёт и не меняет; заметки пишет плагин, а не
   приложение.
3. **Имя осколка — `<uuid>.jsonld`, где `uuid` тот же, что у книги в базе.** Не
   название книги: название меняется, а идентификатор нет.
4. **Файл с приставкой `.tmp-` — мусор, а не данные.** Так называется
   недописанный временный файл; читать его не нужно. Он появляется, если
   приложение убили между записью и переносом, и убирается следующим проходом
   (см. [Как читать снимок безопасно](#как-читать-снимок-безопасно)).
5. **Осколок, не названный указателем, не входит в снимок.** Он может остаться
   от прошлой версии библиотеки, если проход оборвали посреди уборки.

```bash
find <хранилище>/.beresta -type f | sort
```

### Как читать снимок безопасно

Порядок чтения — не совет по стилю, а условие правильности: снимок пишется
несколькими файлами, а «стал новым» он в один момент.

1. **Читайте `index.json` первым и входите в снимок только через него.**
   Пока указатель не заменён, снимок для вас прежний, сколько бы новых осколков
   ни лежало рядом. Обход папки `books/` вместо чтения указателя даст вам смесь
   двух снимков.
2. **Сверяйте `sha256` каждого осколка с тем, что обещает указатель.** Это
   отпечаток **байтов файла**: `shasum -a 256` на файле обязан дать ту же
   строку. Несовпадение значит «эта книга ещё едет» — пропустите её до
   следующего раза.
3. **Несовпадение — это «пропусти», а не «очисти».** Свидетельство здесь только
   положительное: файл может отставать посреди чужой синхронизации хранилища
   (iCloud, Obsidian Sync, Dropbox, git), и стирать по нему свои данные нельзя.
4. **Время изменения файла — подсказка, а не истина.** Чужая синхронизация
   двигает `mtime` по своим причинам и в обе стороны. Истина — `sha256` из
   указателя и поле `generatedAt`.
5. **Ни один файл снимка не бывает дописан наполовину.** Каждый пишется во
   временный файл в той же папке и переносится на своё имя одним `rename(2)`:
   читатель видит либо все старые байты, либо все новые. Проверено опытом, а не
   документацией: `VaultSnapshotWriterTests.readerNeverSeesAHalfWrittenFile`
   читает файл сотнями обращений, пока он переписывается.

```bash
cd <хранилище>/.beresta
python3 - <<'PY'
import json, hashlib, pathlib
root = pathlib.Path(".")
index = json.loads((root / "index.json").read_text())
for entry in index["books"]:
    data = (root / entry["file"]).read_bytes()
    print(entry["file"], hashlib.sha256(data).hexdigest() == entry["sha256"])
PY
```

### `index.json` — указатель

Обычный JSON, кодировка UTF-8, **ключи отсортированы по алфавиту**, слеши не
экранируются, завершающего перевода строки нет. Порядок ключей закреплён
нарочно: одни и те же данные обязаны давать одни и те же байты, иначе снимок
переписывался бы на каждом запуске и будил чужую синхронизацию хранилища.

Заголовок — девять полей верхнего уровня:

| Поле | Тип | Что означает |
|---|---|---|
| `format` | строка | Всегда `beresta-archive`. Другое значение — чужой файл под нашим именем; не трогайте его |
| `formatVersion` | целое | Версия формата. См. [Версия формата](#версия-формата-и-правило-её-роста) |
| `schemaVersion` | строка | Последняя применённая миграция базы, из которой собран снимок: `v34_format_version` |
| `schemaMigrations` | список строк | Все применённые миграции по порядку. Полный список, а не число: число молча протухает |
| `application` | строка | Имя приложения, собравшего снимок: `Beresta` |
| `applicationVersion` | строка | Его версия |
| `deviceId` | строка | Устройство, собравшее снимок. Хранилище синхронизируется чужими средствами, и снимки с двух Маков попадут в одну папку — по этому полю их различают |
| `generatedAt` | строка ISO 8601 | Момент, в который снимок **стал таким**. Не «когда приложение запускалось»: проход, ничего не изменивший, указатель не переписывает вовсе, и момент остаётся прежним |
| `books` | список | Перечень осколков, порядок — побайтовый по `file` |

Запись книги — шесть полей:

| Поле | Тип | Что означает |
|---|---|---|
| `bookUUID` | строка | `uuid` книги. **Пустая строка** — осколок выписок, у которых книги нет вовсе (`books/orphans.jsonld`) |
| `file` | строка | Путь осколка **относительно указателя**: `books/<uuid>.jsonld`. Склеивайте его с папкой, в которой лежит `index.json`, — знать нашу раскладку вам не нужно |
| `sha256` | строка | Отпечаток байтов файла осколка, шестнадцатеричный, строчными буквами |
| `total` | целое | Живых выписок в осколке |
| `removedTotal` | целое | Надгробий в осколке |
| `updatedAt` | строка ISO 8601 | Момент, которым датированы **данные** осколка, — самая поздняя правка среди книги и её выписок. Не «когда мы запускались» |

**Даты везде — ISO 8601 с разделителем `T` и явной зоной**, без долей секунды:
`2026-08-16T06:09:59Z`. Тот же формат, что у всех колонок-дат базы; второй
формат даты в одном снимке означал бы, что читатель обязан знать два правила
вместо одного.

Замер настоящего снимка библиотеки владельца 20260816: 10 записей, `total` в
сумме **289**, `removedTotal` в сумме **1**, `schemaMigrations` — 34 имени.

```bash
jq 'keys, (.books[0] | keys), (.books | length), ([.books[].total] | add)' \
   <хранилище>/.beresta/index.json
```

### Осколок книги — W3C Web Annotation

Осколок — документ **W3C Web Annotation Data Model** (Recommendation
23 February 2017) в сериализации JSON-LD. Это значит, что половину полей вы уже
знаете, если работали с аннотациями по стандарту, а вторую половину — наши
добавления с приставкой `beresta:` — описывает лежащий рядом
[`context.jsonld`](#словари-contextjsonld-и-annojsonld).

Верхний уровень — собрание (`AnnotationCollection`):

| Ключ | Что означает |
|---|---|
| `@context` | Ровно два значения: `http://www.w3.org/ns/anno.jsonld` (требование стандарта, раздел 3.1) и `../context.jsonld` — относительная ссылка на наш словарь, лежащий этажом выше |
| `id` | Адрес собрания, `urn:uuid:…`. Выводится из `uuid` книги детерминированно: на двух устройствах одна и та же книга даёт один и тот же адрес |
| `type` | `AnnotationCollection` |
| `label` | Название книги. Ключа нет, если названия нет |
| `total` | Число живых выписок — то же, что `total` записи указателя |
| `first` | Страница целиком, вложенная (`AnnotationPage`). **Ключа нет вовсе**, если живых выписок ноль: стандарт запрещает пустую страницу (раздел 5.2) |
| `last` | Адрес той же страницы. Нет, когда нет `first` |
| `generated` | Момент данных — то же, что `updatedAt` записи указателя |
| `beresta:book` | Книга: `id` (`urn:uuid:`), `type` (`Text`), `label` (название), `beresta:authors` (список имён по порядку), `beresta:sourceURL` (адрес первоисточника — у статей) |
| `beresta:removed` | Надгробия. См. [Надгробия](#надгробия-и-их-срок-жизни). Ключа нет, если удалённых выписок нет |

Страница (`first`) — четыре ключа плюс тип: `id`, `type` (`AnnotationPage`),
`partOf` (адрес собрания), `startIndex` (всегда `0` — страница у нас одна на
книгу, деления на страницы нет) и `items` — список выписок.

Одна выписка (`Annotation`):

| Ключ | Что означает |
|---|---|
| `id` | `urn:uuid:<uuid выписки>`. **Регистр букв не меняется** — это ровно та строка, что лежит в колонке `uuid` базы, и сравнение простым равенством строк работает |
| `type` | `Annotation` |
| `motivation` | `highlighting` для выделения, подчёркивания, области и росчерка; `commenting` для заметки и текстовой пометки. Мотив отвечает «зачем сделана пометка», а не «как она нарисована», и **не зависит** от наличия своей мысли |
| `created`, `modified` | Даты ISO 8601 |
| `body` | Тела. Одно тело — объектом, несколько — массивом (так в примерах 5 и 15 стандарта). Ключа нет вовсе, если тел нет. Своя мысль — тело с `purpose: "commenting"`, `format: "text/markdown"`; каждая метка — отдельное тело с `purpose: "tagging"` |
| `target` | Мишень: `type: "SpecificResource"`, `source` — адрес книги, `selector` — список якорей. Ключа `selector` нет, если якорей нет вовсе |

Якоря (`target.selector`) — по модели W3C. Для EPUB их обычно два, и это
осознанно: стандарт прямо разрешает описывать одно место несколькими способами,
«чтобы повысить шансы найти его позже» (раздел 4.2).

| Тип селектора | Что в нём |
|---|---|
| `FragmentSelector` | `value` — строка EPUB CFI, `conformsTo` — `http://www.idpf.org/epub/linking/cfi/epub-cfi.html`. Точный указатель |
| `TextQuoteSelector` | `exact` — сама цитата, `prefix` и `suffix` — окружение, если оно есть. Запасной якорь: переживает правку файла книги |
| любой другой | Селектор стороннего писателя доезжает **дословно и целиком**. См. [Терпимость к незнакомому](#терпимость-к-незнакомому) |

Замер настоящего снимка 20260816: 289 выписок, у всех 289 оба селектора —
`FragmentSelector` и `TextQuoteSelector`; `motivation` у всех `highlighting`;
своя мысль (`body`) у 25.

### Поля `beresta:`

Пятнадцать имён, и это весь список. Приставка `beresta:` разворачивается в
`https://second-brain.ru/ns/beresta#` — так объявлено в `context.jsonld`.

| Поле | Где стоит | Что означает |
|---|---|---|
| `beresta:book` | собрание | Книга собрания: `id`, `type`, `label`, `beresta:authors`, `beresta:sourceURL` |
| `beresta:authors` | внутри `beresta:book` | Авторы по порядку. Порядок значащий — отсюда `@list` в словаре |
| `beresta:sourceURL` | внутри `beresta:book` | Адрес первоисточника — у статей. У книги поля нет вовсе: пустая строка означала бы «адрес есть, но пуст». Года издания у статьи нет, а часть их без автора, и адрес — единственное, чем цитата из статьи перестаёт быть цитатой ниоткуда |
| `beresta:removed` | собрание | Надгробия мягко удалённых выписок |
| `beresta:deletedAt` | внутри `beresta:removed` | Момент мягкого удаления, ISO 8601 |
| `beresta:type` | выписка | Вид пометки: `highlight`, `underline`, `note`, `text`, `area`, `ink`. В модели W3C ему места нет: `motivation` отвечает на другой вопрос, и `highlight` с `underline` схлопнулись бы в один `highlighting` |
| `beresta:style` | выписка | Начертание черты: `solid`, `wavy`. Ключа нет — вид не выбирали, и пометка рисуется умолчанием своего вида. Не оформление ради оформления: сплошным и волнистым владелец различает пометки между собой (формат 1.14) |
| `beresta:color` | выписка | Имя цвета выделения (`blue`). По нему красит тема оформления и по нему же ищут |
| `beresta:colorHex` | выписка | Значение цвета (`#4a90d9`) — для того, кто нашей палитры имён не знает |
| `beresta:sortIndex` | выписка | Ключ порядка внутри книги. **Строка, а не число**: дробный индекс между соседями |
| `beresta:pageLabel` | выписка | Метка места так, как её показывает читалка (у EPUB это обычно заголовок раздела, а не номер страницы) |
| `beresta:chapterPath` | выписка | Путь по оглавлению: заголовки сверху вниз. Порядок значащий — `@list` |
| `beresta:intent` | выписка | Назначение выписки: `implement`, `remember`. Маршрут, а не оформление |
| `beresta:processed` | выписка | Состояние разбора: `raw`, `sorted`, `used`. Пишется всегда: «не разобрано» — это ответ, а не отсутствие ответа |
| `beresta:topic` | выписка | Тема выписки своими словами, свободный текст |
| `beresta:text` | выписка | Цитата, **не совпавшая** ни с одним `TextQuoteSelector` мишени. В обычном случае ключа нет вовсе: цитата — это якорь, её место в мишени. Ключ появляется там, где текст есть, а за место в книге он не отвечает: росчерк, PDF, расхождение после правки файла книги |
| `beresta:position` | выписка | Колонка `position` базы дословно, строкой. Ставится там, где привязку нельзя выразить селекторами W3C, не выдумывая: PDF, росчерк, незнакомый вид привязки |

**Ключа нет — значит значения нет.** Пустых строк, пустых списков и `null` в
осколке не бывает: 264 выписки владельца из 289 идут без своей мысли, и
`"body": []` у каждой было бы шумом в архиве.

```bash
jq -s -r '[.. | objects | keys[]] | unique | map(select(startswith("beresta:"))) | .[]' \
   <хранилище>/.beresta/books/*.jsonld
```

### Словари: `context.jsonld` и `anno.jsonld`

Рядом с указателем лежат два словаря, и оба нужны читателю без сети.

**`context.jsonld` — наш.** На него ссылается каждый осколок вторым значением
`@context`, относительной ссылкой `../context.jsonld` (JSON-LD 1.1 раздел 3.1
разрешает это прямо). Ссылка относительная нарочно: абсолютный адрес указывал бы
на сайт, которого через пять лет может не быть, а относительный указывает на
файл, лежащий рядом.

В нём **только наши поля** и ни одного ключа словаря W3C: Web Annotation
Vocabulary, раздел 4, запрещает расширениям переопределять существующие ключи.
Кроме `@context` там есть человеческое описание каждого поля — оно снаружи
`@context` нарочно: JSON не имеет комментариев, а внутри `@context` любая пара
«ключ: значение» это определение термина, а не примечание.

**`anno.jsonld` — дословный снимок словаря W3C** `http://www.w3.org/ns/anno.jsonld`,
снят 20260812, ни одного байта не изменено. Он **не назван** в `@context`
осколков: назвать его значило бы переопределить все ключи W3C, что запрещено.
Читателю без сети: скормите этот файл своему загрузчику документов как
содержимое адреса `http://www.w3.org/ns/anno.jsonld`. Отпечаток снимка объявлен
в самом `context.jsonld` и проверяется одной командой:

```bash
shasum -a 256 <хранилище>/.beresta/anno.jsonld
# c10fd886c5c726fbfd51747b8677eb8f7d02c039357269622de7382e5c20d410
jq -r '."beresta:snapshotNote"."снимок anno.jsonld".sha256' \
   <хранилище>/.beresta/context.jsonld
```

### Надгробия и их срок жизни

Удаление выписки — мягкое: строка остаётся в базе с проставленным `deletedAt`, а
в осколке появляется надгробие — пара `id` + `beresta:deletedAt` в списке
`beresta:removed`.

**Почему надгробие не лежит внутри `items`.** Аннотация без мишени по стандарту
невалидна («There MUST be 1 or more target relationships»), а мишени у удалённой
выписки больше нет: то место в книге больше не помечено. Оставить её в `items` с
мишенью значило бы утверждать, что пометка на месте; выбросить совсем — оставить
читателя без единственного признака, по которому он поймёт, что строку в своей
заметке пора убрать.

**Срок жизни: надгробие живёт столько же, сколько строка в базе, — то есть
сегодня вечно.** Ни одна строка кода Beresta не удаляет выписки физически:
удаление проставляет `deletedAt` и на этом заканчивается. Чистка «раз в N дней»
не заведена и в этой версии формата не обещана. Практическое следствие для
читателя: **`removedTotal` не уменьшается сам по себе**, и увидев надгробие
однажды, вы увидите его и через год. Обратное — исчезновение надгробия — не
ошибка формата, а признак того, что либо книгу удалили вместе с осколком, либо
базу подменили; на такой случай правило то же, что и везде здесь: пропустить, а
не стирать.

Полагаться на это правило можно ровно в объёме версии 1: если чистка когда-нибудь
появится, срок будет объявлен здесь и в `context.jsonld`, а не выведен читателем
из молчания.

```bash
jq -s '[.[] | ."beresta:removed" // [] | length] | add' <хранилище>/.beresta/books/*.jsonld
jq '[.books[].removedTotal] | add' <хранилище>/.beresta/index.json
```

### Версия формата и правило её роста

Версия одна на весь снимок, лежит в `index.json` и равна: `formatVersion` = 1.

**Правило роста — одно, и оно узкое.** Число растёт **только** тогда, когда
читатель предыдущей версии не может прочитать снимок правильно. Добавление
новых полей, новых видов селекторов и новых файлов рядом версию **не двигает**:
такой снимок прежний читатель читает как читал, просто не замечая нового.

Отсюда обязанности сторон.

- **Наша.** Пара `format` + `formatVersion` обещана неизменной на все будущие
  версии: без неё читающая сторона не смогла бы даже узнать, чего именно она не
  понимает. Имена полей 1.x не переименовываются и не отнимаются.
- **Ваша.** Снимок с `formatVersion` **больше** вашего — остановитесь и скажите
  человеку словами. Читать его наугад нельзя: заметка заполнилась бы половиной
  данных, а человек решил бы, что вторая половина потеряна. Снимок с `format` не
  равным `beresta-archive` — вообще не наш файл, не трогайте его.
- **Обе.** Число в этом документе и число в коде обязаны совпадать, иначе они
  разойдутся молча. Совпадение стоит проверкой
  (`packages/obsidian-plugin/test/vault-export-doc.test.ts`), а не соглашением
  между людьми.

### Терпимость к незнакомому

Правило проекта: **неизвестное сохраняется дословно и никогда не выбрасывается
молча.** Для этого формата оно раскрывается в три обязанности читателя.

1. **Незнакомый ключ — сохранить, а не выбросить.** Завтрашняя Beresta допишет
   свои ключи и оставит `formatVersion` равным 1 — это разрешено правилом выше.
   Читатель, выбрасывающий незнакомое, молча обеднит архив человека.
2. **Незнакомый селектор — сохранить целиком и не выдавать за якорь.** Формат
   открытый, и чужой инструмент вправе дописать свой вид привязки. Наш
   собственный плагин так и делает: незнакомый селектор доезжает дословно, как
   он лежал в файле.
3. **Незнакомое значение знакомого поля — не повод для отказа.** `beresta:type`
   со значением, которого нет в списке выше, означает вид пометки, которого вы
   не знаете, а не испорченный файл.

Обратная сторона правила названа честно: терпимость **не** распространяется на
`format` и `formatVersion`. Там читатель обязан остановиться — это ровно те два
поля, ради которых заголовок и заведён.

### Что формат не обещает

Раздел нужен затем же, зачем и всё остальное: чтобы вы не построили на
умолчании.

- **Снимок — не резервная копия базы.** В нём выписки и подписи книг, но нет
  файлов книг, нет позиций чтения, нет истории прочтений, нет коллекций и
  тегов книг. Полный слепок — это сама база (`docs/schema/schema.md`).
- **Снимок односторонний.** Beresta пишет его и никогда не читает обратно.
  Правка, внесённая в файл `.beresta/` руками, будет затёрта следующим
  проходом — и не потому, что мы её отвергли, а потому, что мы её не смотрим.
  Обратный канал не сделан и в этой версии не готовится.
- **`beresta://open/<uuid>` — ссылка, а не обещание.** Она открывает выписку в
  Beresta на этой машине. На машине без Beresta это просто строка; поэтому
  место в книге названо ещё и словами (`beresta:chapterPath`) и якорем
  (`FragmentSelector`), которые читаются без всякого протокола.
- **Порядок ключей внутри файла закреплён, порядок книг — тоже, но опираться
  на порядок не нужно.** Он существует ради устойчивости байтов, а не ради
  вашего разбора: разбирайте по именам.
- **В снимке лежит полный текст ваших цитат открытым текстом.** Хранилище
  Obsidian у большинства людей чем-нибудь синхронизируется. Это сказано здесь
  прямо, а не спрятано: решение ваше.

### Как проверить всё сразу

Ни одно утверждение выше не требует нашего кода. Средство «с нуля» — 72 строки
(`wc -l`) на стандартной библиотеке Python, из них половина — пояснение; лежит в
[`docs/tools/extract-highlights.py`](tools/extract-highlights.py) и печатает все
выписки с путями по оглавлению, своими мыслями и датами:

```bash
python3 docs/tools/extract-highlights.py <хранилище>
python3 docs/tools/extract-highlights.py <хранилище> --json | jq length
```

Второе средство — нарочно другое, чтобы ошибиться одинаково они не могли:

```bash
jq -s '[.[] | .first.items | length] | add' <хранилище>/.beresta/books/*.jsonld
```

Замер 20260816 на настоящем снимке библиотеки владельца (10 осколков, 289
живых выписок, 1 надгробие): скрипт — **289** выписок за 0,02–0,09 с (четыре
прогона), `jq` — **289**, плагин — **289**. Три независимых счёта сошлись.

---

## English

### What this is

Beresta writes a machine-readable snapshot of your highlights into your Obsidian
vault. The Beresta plugin for Obsidian is one possible reader of that snapshot,
not the only one: the snapshot is ordinary text files in a standard format, and
any program that can read JSON can read them. No SQLite, no Swift, no Obsidian
and no network are needed.

This document describes the snapshot well enough that a third-party tool can be
written from it alone. **The rule of this document: not one claim that cannot be
checked by opening a file.** Every section ends with the command that checks it;
[Checking all of it](#checking-all-of-it) collects them in one place.

**Licence of this document:** CC0 1.0 Universal (`docs/schema/LICENSE`), same
as `docs/schema/schema.md`, unlike the application code, which is proprietary.
The ecosystem is free to read, write and implement this format in other
programs, with no permission and no attribution required.

### Layout

```
<vault>/.beresta/
    index.json               the index: snapshot header and the list of books
    context.jsonld           extends the W3C vocabulary with the beresta: fields
    anno.jsonld              a verbatim snapshot of the W3C anno.jsonld vocabulary
    books/
        <book-uuid>.jsonld   one shard: every highlight of one book
        orphans.jsonld       highlights that have no book at all
```

`orphans.jsonld` appears only when such highlights exist; the owner's library
snapshot of 20260816 has none — all 10 shards are named after book `uuid`s.

Five rules, all five checked by opening the folder:

1. **The leading dot is deliberate.** Obsidian does not show such folders in the
   file explorer, does not index them for search and does not pull them into the
   graph (measured 20260812). The snapshot lives inside the vault without being
   in the way.
2. **The app writes here and nowhere else.** Beresta creates and changes no file
   in the vault outside `.beresta/`; notes are written by the plugin, not by the
   app.
3. **A shard is named `<uuid>.jsonld`, the same `uuid` the book has in the
   database.** Not the title: titles change, identifiers do not.
4. **A file prefixed `.tmp-` is rubbish, not data.** That is a half-written
   temporary file; do not read it. It appears when the app was killed between
   the write and the rename, and the next pass removes it (see
   [Reading a snapshot safely](#reading-a-snapshot-safely)).
5. **A shard the index does not name is not part of the snapshot.** It may be
   left over from an earlier state of the library if a pass was interrupted
   mid-cleanup.

```bash
find <vault>/.beresta -type f | sort
```

### Reading a snapshot safely

The order of reading is not a style preference: the snapshot is written as
several files, but it becomes new at one instant.

1. **Read `index.json` first and enter the snapshot only through it.** Until the
   index is replaced, the snapshot is the old one for you, however many new
   shards already sit next to it. Walking `books/` instead of reading the index
   hands you a mixture of two snapshots.
2. **Verify each shard's `sha256` against what the index promises.** It is a
   checksum of the **file's bytes**: `shasum -a 256` on the file must produce the
   same string. A mismatch means "this book is still in flight" — skip it until
   next time.
3. **A mismatch means "skip", never "clear".** Evidence here is positive only: a
   file can lag mid-way through somebody else's vault sync (iCloud, Obsidian
   Sync, Dropbox, git), and deleting your data on that basis is wrong.
4. **File modification time is a hint, never the truth.** Vault sync tools move
   `mtime` in both directions for their own reasons. The truth is the `sha256`
   from the index and the `generatedAt` field.
5. **No file in the snapshot is ever half-written.** Each is written to a
   temporary file in the same folder and moved onto its name with a single
   `rename(2)`: a reader sees either all the old bytes or all the new ones. This
   was measured rather than read out of documentation:
   `VaultSnapshotWriterTests.readerNeverSeesAHalfWrittenFile` reads the file
   hundreds of times while it is being rewritten.

```bash
cd <vault>/.beresta
python3 - <<'PY'
import json, hashlib, pathlib
root = pathlib.Path(".")
index = json.loads((root / "index.json").read_text())
for entry in index["books"]:
    data = (root / entry["file"]).read_bytes()
    print(entry["file"], hashlib.sha256(data).hexdigest() == entry["sha256"])
PY
```

### `index.json` — the index

Plain JSON, UTF-8, **keys sorted alphabetically**, slashes not escaped, no
trailing newline. The key order is fixed on purpose: the same data must produce
the same bytes, or the snapshot would be rewritten on every launch and would wake
up somebody else's vault sync for nothing.

The header is nine top-level fields:

| Field | Type | Meaning |
|---|---|---|
| `format` | string | Always `beresta-archive`. Any other value means a foreign file under our name; leave it alone |
| `formatVersion` | integer | The format version. See [Format version](#format-version-and-the-rule-for-raising-it) |
| `schemaVersion` | string | The last applied database migration the snapshot was built from: `v34_format_version` |
| `schemaMigrations` | list of strings | Every applied migration in order. The full list, not a count: a count goes stale silently |
| `application` | string | The application that built the snapshot: `Beresta` |
| `applicationVersion` | string | Its version |
| `deviceId` | string | The device that built the snapshot. Vaults are synced by other people's tools, and snapshots from two Macs land in one folder — this field is what tells them apart |
| `generatedAt` | ISO 8601 string | The moment the snapshot **became this**. Not "when the app last ran": a pass that changed nothing does not rewrite the index at all, and the moment stays as it was |
| `books` | list | The shards, ordered bytewise by `file` |

A book entry is six fields:

| Field | Type | Meaning |
|---|---|---|
| `bookUUID` | string | The book's `uuid`. **An empty string** means the shard of highlights that have no book at all (`books/orphans.jsonld`) |
| `file` | string | The shard's path **relative to the index**: `books/<uuid>.jsonld`. Join it with the folder that holds `index.json` — you do not need to know our layout |
| `sha256` | string | Checksum of the shard file's bytes, hex, lowercase |
| `total` | integer | Live highlights in the shard |
| `removedTotal` | integer | Tombstones in the shard |
| `updatedAt` | ISO 8601 string | The moment the shard's **data** is dated — the latest change among the book and its highlights. Not "when we ran" |

**Dates everywhere are ISO 8601 with a `T` separator and an explicit zone**, no
fractional seconds: `2026-08-16T06:09:59Z`. The same format as every date column
in the database; a second date format in one snapshot would mean the reader has
to know two rules instead of one.

Measured on the owner's real library snapshot, 20260816: 10 entries, `total`
summing to **289**, `removedTotal` summing to **1**, `schemaMigrations` holding
34 names.

```bash
jq 'keys, (.books[0] | keys), (.books | length), ([.books[].total] | add)' \
   <vault>/.beresta/index.json
```

### A book shard — W3C Web Annotation

A shard is a **W3C Web Annotation Data Model** document (Recommendation
23 February 2017) serialised as JSON-LD. So half the fields are already familiar
if you have worked with standard annotations, and the other half — ours, prefixed
`beresta:` — are described by the
[`context.jsonld`](#the-vocabularies-contextjsonld-and-annojsonld) lying next to
the shard.

The top level is a collection (`AnnotationCollection`):

| Key | Meaning |
|---|---|
| `@context` | Exactly two values: `http://www.w3.org/ns/anno.jsonld` (required by the standard, section 3.1) and `../context.jsonld`, a relative reference to our vocabulary one level up |
| `id` | The collection's IRI, `urn:uuid:…`, derived deterministically from the book's `uuid`: the same book gives the same IRI on two machines |
| `type` | `AnnotationCollection` |
| `label` | The book's title. The key is absent when there is no title |
| `total` | The number of live highlights — the same as `total` in the index entry |
| `first` | The page, embedded whole (`AnnotationPage`). **The key is absent** when there are no live highlights: the standard forbids an empty page (section 5.2) |
| `last` | The IRI of that same page. Absent when `first` is absent |
| `generated` | The data's moment — the same as `updatedAt` in the index entry |
| `beresta:book` | The book: `id` (`urn:uuid:`), `type` (`Text`), `label` (title), `beresta:authors` (names in order), `beresta:sourceURL` (the address of the original — for articles) |
| `beresta:removed` | Tombstones. See [Tombstones](#tombstones-and-how-long-they-live). The key is absent when nothing was deleted |

The page (`first`) has four keys plus its type: `id`, `type` (`AnnotationPage`),
`partOf` (the collection's IRI), `startIndex` (always `0` — there is one page per
book, we do not paginate) and `items`, the list of highlights.

One highlight (`Annotation`):

| Key | Meaning |
|---|---|
| `id` | `urn:uuid:<highlight uuid>`. **The letter case is left alone** — this is exactly the string in the database's `uuid` column, so comparing with plain string equality works |
| `type` | `Annotation` |
| `motivation` | `highlighting` for highlight, underline, area and ink; `commenting` for note and text. The motivation answers "why the mark was made", not "how it is drawn", and does **not** depend on whether you wrote a note |
| `created`, `modified` | ISO 8601 dates |
| `body` | Bodies. One body as an object, several as an array (as in examples 5 and 15 of the standard). The key is absent when there are none. Your own note is a body with `purpose: "commenting"` and `format: "text/markdown"`; each tag is a separate body with `purpose: "tagging"` |
| `target` | The target: `type: "SpecificResource"`, `source` — the book's IRI, `selector` — the list of anchors. The `selector` key is absent when there are no anchors at all |

Anchors (`target.selector`) follow the W3C model. For EPUB there are usually two,
deliberately: the standard explicitly allows describing one place in several ways
"in order to maximize the chances that it will be discoverable later"
(section 4.2).

| Selector type | What is in it |
|---|---|
| `FragmentSelector` | `value` — an EPUB CFI string, `conformsTo` — `http://www.idpf.org/epub/linking/cfi/epub-cfi.html`. The precise pointer |
| `TextQuoteSelector` | `exact` — the quote itself, `prefix` and `suffix` — its surroundings where we have them. The fallback anchor: it survives an edit to the book file |
| anything else | A third-party writer's selector travels through **verbatim and whole**. See [Tolerating the unknown](#tolerating-the-unknown) |

Measured on the real 20260816 snapshot: 289 highlights, all 289 with both
selectors — `FragmentSelector` and `TextQuoteSelector`; `motivation` is
`highlighting` for all of them; 25 carry a note (`body`).

### The `beresta:` fields

Fifteen names, and that is the whole list. The `beresta:` prefix expands to
`https://second-brain.ru/ns/beresta#`, as declared in `context.jsonld`.

| Field | Where | Meaning |
|---|---|---|
| `beresta:book` | collection | The collection's book: `id`, `type`, `label`, `beresta:authors`, `beresta:sourceURL` |
| `beresta:authors` | inside `beresta:book` | Authors in order. The order matters — hence `@list` in the vocabulary |
| `beresta:sourceURL` | inside `beresta:book` | The address of the original — present for articles. A book has no such field at all: an empty string would mean "there is an address, and it is empty". An article has no publication year and some have no author, so the address is the only thing that keeps a quote from an article from being a quote out of nowhere |
| `beresta:removed` | collection | Tombstones of softly deleted highlights |
| `beresta:deletedAt` | inside `beresta:removed` | The moment of soft deletion, ISO 8601 |
| `beresta:type` | highlight | The kind of mark: `highlight`, `underline`, `note`, `text`, `area`, `ink`. The W3C model has no place for it: `motivation` answers a different question, and `highlight` and `underline` would collapse into one `highlighting` |
| `beresta:style` | highlight | How the line is drawn: `solid`, `wavy`. No key means the style was never chosen and the mark is drawn with its kind's default. Not decoration for its own sake: the reader tells marks apart by it (format 1.14) |
| `beresta:color` | highlight | The colour name (`blue`). The theme paints by it and people search by it |
| `beresta:colorHex` | highlight | The colour value (`#4a90d9`) — for a reader who does not know our palette of names |
| `beresta:sortIndex` | highlight | The ordering key within the book. **A string, not a number**: a fractional index between neighbours |
| `beresta:pageLabel` | highlight | The place label as the reader app shows it (for EPUB usually a section heading, not a page number) |
| `beresta:chapterPath` | highlight | The path through the table of contents, top down. The order matters — `@list` |
| `beresta:intent` | highlight | What the highlight is for: `implement`, `remember`. A route, not a decoration |
| `beresta:processed` | highlight | How far it has been worked through: `raw`, `sorted`, `used`. Always written: "not worked through" is an answer, not an absence of one |
| `beresta:topic` | highlight | The highlight's topic in your own words, free text |
| `beresta:text` | highlight | A quote that matched **no** `TextQuoteSelector` of the target. Normally the key is absent altogether: a quote is an anchor, and its place is in the target. The key appears where text exists but does not vouch for a place in the book: ink, PDF, a divergence after the book file was edited |
| `beresta:position` | highlight | The database's `position` column verbatim, as a string. Used where the anchor cannot be expressed as W3C selectors without inventing something: PDF, ink, an unfamiliar kind of anchor |

**No key means no value.** Empty strings, empty lists and `null` do not appear in
a shard: 264 of the owner's 289 highlights carry no note of their own, and
`"body": []` on each of them would be noise in the archive.

```bash
jq -s -r '[.. | objects | keys[]] | unique | map(select(startswith("beresta:"))) | .[]' \
   <vault>/.beresta/books/*.jsonld
```

### The vocabularies: `context.jsonld` and `anno.jsonld`

Two vocabularies sit next to the index, and a reader without a network needs
both.

**`context.jsonld` is ours.** Every shard references it as the second value of
`@context`, with the relative reference `../context.jsonld` (JSON-LD 1.1 section
3.1 permits this explicitly). The reference is relative on purpose: an absolute
one would point at a website that may not exist in five years, a relative one
points at the file lying next to it.

It holds **only our fields** and not one key of the W3C vocabulary: the Web
Annotation Vocabulary, section 4, forbids extensions from redefining existing
keys. Besides `@context` it carries a human description of every field, placed
outside `@context` on purpose: JSON has no comments, and inside `@context` every
key–value pair is a term definition rather than a note.

**`anno.jsonld` is a verbatim snapshot of the W3C vocabulary**
`http://www.w3.org/ns/anno.jsonld`, taken 20260812, not one byte changed. It is
**not** named in the shards' `@context`: naming it would redefine every W3C key,
which is forbidden. For a reader without a network: feed this file to your
document loader as the content of `http://www.w3.org/ns/anno.jsonld`. The
snapshot's checksum is declared inside `context.jsonld` itself and checks in one
command:

```bash
shasum -a 256 <vault>/.beresta/anno.jsonld
# c10fd886c5c726fbfd51747b8677eb8f7d02c039357269622de7382e5c20d410
jq -r '."beresta:snapshotNote"."снимок anno.jsonld".sha256' \
   <vault>/.beresta/context.jsonld
```

### Tombstones and how long they live

Deleting a highlight is soft: the row stays in the database with `deletedAt` set,
and the shard grows a tombstone — a pair of `id` and `beresta:deletedAt` in the
`beresta:removed` list.

**Why a tombstone is not inside `items`.** An annotation without a target is
invalid by the standard ("There MUST be 1 or more target relationships"), and a
deleted highlight has no target any more: that place in the book is no longer
marked. Leaving it in `items` with a target would assert that the mark is still
there; dropping it entirely would leave the reader without the one sign by which
it learns that a line in its note should go.

**Lifetime: a tombstone lives as long as the row in the database — which today
means forever.** No line of Beresta's code deletes a highlight physically:
deletion sets `deletedAt` and stops there. There is no "prune after N days", and
this version of the format does not promise one. The practical consequence for a
reader: **`removedTotal` does not shrink on its own**, and a tombstone you saw
once you will still see a year later. The reverse — a tombstone disappearing — is
not a format error but a sign that either the book was deleted along with its
shard or the database was swapped; the rule for that case is the rule everywhere
here: skip, do not erase.

You may rely on this exactly as far as version 1 goes: if pruning is ever added,
its term will be declared here and in `context.jsonld`, rather than inferred by a
reader from silence.

```bash
jq -s '[.[] | ."beresta:removed" // [] | length] | add' <vault>/.beresta/books/*.jsonld
jq '[.books[].removedTotal] | add' <vault>/.beresta/index.json
```

### Format version and the rule for raising it

There is one version for the whole snapshot, it lives in `index.json`, and it
equals: `formatVersion` = 1.

**There is one rule for raising it, and it is a narrow one.** The number grows
**only** when a reader of the previous version cannot read the snapshot
correctly. Adding new fields, new kinds of selector and new files alongside does
**not** move it: an older reader reads such a snapshot exactly as before, simply
not noticing what is new.

Hence the obligations on both sides.

- **Ours.** The pair `format` + `formatVersion` is promised unchanged across all
  future versions: without it a reader could not even learn what it is that it
  fails to understand. Field names within 1.x are neither renamed nor taken away.
- **Yours.** A snapshot whose `formatVersion` is **greater** than yours: stop,
  and say so to the human in words. Reading it by guesswork is not allowed — the
  note would fill with half the data and the human would conclude the other half
  was lost. A snapshot whose `format` is not `beresta-archive` is not our file at
  all; leave it alone.
- **Both.** The number in this document and the number in the code must agree, or
  they will diverge silently. The agreement is held by a test
  (`packages/obsidian-plugin/test/vault-export-doc.test.ts`), not by an
  understanding between people.

### Tolerating the unknown

The project's rule: **the unknown is preserved verbatim and never silently
discarded.** For this format it unfolds into three obligations on the reader.

1. **An unfamiliar key is kept, not dropped.** Tomorrow's Beresta will add keys
   of its own and leave `formatVersion` at 1 — the rule above permits exactly
   that. A reader that discards what it does not know silently impoverishes a
   person's archive.
2. **An unfamiliar selector is kept whole and not passed off as an anchor.** The
   format is open, and a third-party tool is entitled to add its own kind of
   anchor. Our own plugin does precisely this: an unfamiliar selector arrives
   verbatim, exactly as it lay in the file.
3. **An unfamiliar value of a familiar field is not a reason to refuse.** A
   `beresta:type` holding a value absent from the list above means a kind of mark
   you do not know, not a corrupted file.

The other side of the rule is stated plainly: tolerance does **not** extend to
`format` and `formatVersion`. There a reader is obliged to stop — those are the
two fields the header exists for.

### What the format does not promise

This section exists for the same reason as everything else here: so that you do
not build on a silence.

- **A snapshot is not a backup of the database.** It carries highlights and the
  signatures of books, but no book files, no reading positions, no reading
  history, no collections and no book tags. The full picture is the database
  itself (`docs/schema/schema.md`).
- **A snapshot is one-way.** Beresta writes it and never reads it back. An edit
  made by hand inside `.beresta/` will be overwritten by the next pass — not
  because we rejected it, but because we do not look at it. There is no reverse
  channel, and none is being prepared in this version.
- **`beresta://open/<uuid>` is a link, not a promise.** It opens the highlight in
  Beresta on this machine. On a machine without Beresta it is simply a string;
  that is why the place in the book is also named in words
  (`beresta:chapterPath`) and by an anchor (`FragmentSelector`), both of which
  read without any protocol at all.
- **Key order within a file is fixed, and so is book order — but you should not
  rely on order.** It exists for byte stability, not for your parser: parse by
  name.
- **The full text of your quotes sits in the snapshot in the clear.** Most
  people's Obsidian vault is synced by something. That is said here plainly
  rather than hidden: the decision is yours.

### Checking all of it

Not one claim above needs our code. A from-scratch tool is 72 lines (`wc -l`) on
Python's standard library, half of them explanation — it lives in
[`docs/tools/extract-highlights.py`](tools/extract-highlights.py) and prints
every highlight with its chapter path, your own note and its dates:

```bash
python3 docs/tools/extract-highlights.py <vault>
python3 docs/tools/extract-highlights.py <vault> --json | jq length
```

The second tool is deliberately a different one, so that the two cannot be wrong
in the same way:

```bash
jq -s '[.[] | .first.items | length] | add' <vault>/.beresta/books/*.jsonld
```

Measured 20260816 on the owner's real library snapshot (10 shards, 289 live
highlights, 1 tombstone): the script — **289** highlights in 0.02–0.09 s (four
runs), `jq` — **289**, the plugin — **289**. Three independent counts agreed.
