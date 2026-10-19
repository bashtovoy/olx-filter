# Проверка Chrome-сборки

Дата проверки: 19.10.2026.

Сборка: `dist/chrome` (Chrome MV3).

Браузер: Google Chrome for Testing `153.0.8010.12` с отдельным профилем
`$TMPDIR/olx-chrome-profile`. Расширение загружено через `--load-extension` и
`--disable-extensions-except`; MCP-сервер `chrome-devtools-mcp 1.11.0`
подключён к `http://127.0.0.1:9223`.

## Сборка и загрузка

- `node scripts/build-chrome.mjs` — успешно.
- `node --check` для `common.js`, `content.js`, `page-bridge.js`, `popup.js` — успешно.
- `manifest.json` в `dist/chrome` — валидный JSON, без `browser_specific_settings`,
  с `minimum_chrome_version: "111"`.
- Расширение появилось в `chrome://extensions` и в списке расширений Chrome DevTools MCP.
- `page-bridge.js` работает в MAIN world: React fiber доступен, ошибок CSP нет.

## Живые проверки на OLX.ua

Проверки выполнялись на реальных страницах `www.olx.ua`; для `olx.ua` сайт
перенаправляет на `www.olx.ua`, content script при этом работает.

### CSP и bridge

Причина ошибки: Chrome content script вызывал legacy `injectBridge()`, который
вставлял inline `<script>`. На строгой CSP-странице callback Chrome блокировал
его с сообщением `Executing inline script violates ...` и указывал на
`content.js` / `injectBridge`.

Исправление: content script находит `page-bridge.js` в
`runtime.getManifest().content_scripts` и не выполняет inline-вставку. В Chrome
bridge уже подключён манифестом в `world: "MAIN"`; Firefox-путь с inline bridge
не изменён. Chrome тоже предоставляет объект `browser`, поэтому проверка по
наличию `chrome`/`browser` ненадёжна — источник истины именно манифест.

Проверка на реальном callback URL
`https://www.olx.ua/d/uk/callback/?code=…&state=…`:

- до редиректа на главную в DOM успели появиться `#olxf-base-style` и
  `#olxf-clean-style` — content script на callback-странице действительно
  выполнился;
- MutationObserver не зафиксировал ни одной вставки inline `<script>` с bridge:
  `0`;
- после загрузки `inlineBridgeScripts = 0`;
- `window.__olxFilterBridgeInstalled = true` — MAIN-world bridge работает;
- в console нет `Executing inline script violates ...` и нет ошибок
  `content.js:... (injectBridge)`;
- остался только независимый console error самой OLX: браузер блокирует
  `data:video/mp4` по её CSP `default-src 'self' *`. К расширению он не относится.

Повторная проверка обычной выдачи после этой же сборки:

- 52 карточки, 39 видимых, 13 скрытых (13 ТОП);
- 0 видимых бейджей «ТОП», 0 видимых рекламных слотов;
- 4 колонки в плитке;
- `inlineBridgeScripts = 0`, `window.__olxFilterBridgeInstalled = true`.

Переключатель «Скрывать ТОП» в попапе:

- выключен: 52 видимых / 0 скрытых, статус `Скрыто: 15 блоков`;
- включён: 39 видимых / 13 скрытых, статус `Скрыто: 13 ТОП · 15 блоков`;
- изменения применяются сразу, без перезагрузки страницы.

### Скрытие ТОП и рекламы

- Электроника, сортировка «Сначала дешёвые», плитка:
  - 51 карточка, 14 скрыто, 37 видно;
  - 0 видимых бейджей «ТОП»;
  - 13 рекламных слотов, 0 видимых;
  - блоки «Сохранить поиск» и SEO скрыты.
- Электроника без параметров, сортировка по умолчанию:
  - 50 ТОП из 52 карточек было скрыто до автоприменения фильтров;
  - после автоприменения — 14 ТОП и 36–37 видимых карточек.
- «Скрывать рекламу»:
  - при выключенном ТОП скрыто 38 карточек, 0 видимых промо-ссылок;
  - при включённом ТОП дополнительных изменений нет, если все промо-карточки
    уже входят в ТОП.
- «Скрывать «Обмен»» на выдаче «Сначала дешёвые»:
  - 22 карточки с ценой «Обмін» скрыто, 0 видимых;
  - статус: `14 ТОП · 22 обмен · 15 блоков`.

### Вид выдачи

- `view=grid` — 4 колонки, ширина карточек около 295.5 px.
- `view=list` — одна колонка шириной около 1029 px.

### Фильтры через попап

Применение настроек: сортировка «Сначала дорогие», вид «Список», цена
`1000–5000`, состояние «Б/у».

Итоговый URL:

```text
https://www.olx.ua/uk/elektronika/?search%5Bfilter_enum_state%5D%5B0%5D=used&search%5Bfilter_float_price%3Afrom%5D=1000&search%5Bfilter_float_price%3Ato%5D=5000&search%5Border%5D=filter_float_price%3Adesc&view=list
```

Результат: 52 карточки, 36 видимых, 16 скрытых, вид «Список», цены в диапазоне
1000–5000, состояние «Вживане».

- «Сбросить фильтры» вернул `search[order]=filter_float_price:asc&view=grid`,
  очистил цену и состояние, вернул 4 колонки.
- Невалидный диапазон `5000–1000`: показана ошибка
  «Минимальная цена больше максимальной», URL не изменился.
- Автоприменение включено: новая страница без параметров получила сортировку,
  вид, цену и состояние из сохранённых настроек.
- Автоприменение выключено: новая страница открылась без добавленных параметров.
- Перезагрузка попапа сохранила все значения из `chrome.storage.local`.
- Пагинация `page=2` сохранилась вместе с `search[order]` и `view`.

### Состояния попапа

- На `about:blank`: «Откройте страницу OLX.ua».
- На главной OLX: «Откройте результаты поиска OLX».
- На странице выдачи: корректный счётчик скрытых элементов.

## Ошибки

После CSP-фикса на проверенных страницах расширения и попапа нет console
errors/warnings, связанных с расширением. В частности, больше нет
`Executing inline script violates ...` и ошибок `content.js:... (injectBridge)`.

На OLX остаётся независимый console error: браузер блокирует `data:video/mp4`
самой OLX по её CSP `default-src 'self' *`. Он не связан с расширением. Сетевые
ошибки рекламных iframe OLX также к расширению не относятся.

## Скриншоты

Скриншоты проверки сохранены во временной папке:

- `chrome-popup.png` — попап;
- `chrome-grid.png` / `chrome-grid-cards.png` — плитка;
- `chrome-list.png` / `chrome-list-cards.png` — список;
- `chrome-page2.png` — пагинация.

## Ограничение

В стабильном Google Chrome флаг `--load-extension` может быть отключён. Для
автоматизированных тестов использовался Chrome for Testing; для обычной
установки — загрузка распакованной папки `dist/chrome` через
`chrome://extensions`.
