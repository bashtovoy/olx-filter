(() => {
  'use strict';

  const F = globalThis.OLXFilter;
  const api = globalThis.browser || globalThis.chrome;
  if (!F || !api) return;

  const STRINGS = {
    ru: {
      title: 'OLX Фильтр',
      subtitle: 'Чистая выдача без лишнего',
      loading: 'Проверяем вкладку…',
      masterTitle: 'Расширение',
      masterOn: 'Включено',
      masterOff: 'Выключено',
      masterToggle: 'Включить или выключить расширение',
      disabled: 'Расширение выключено.',
      display: 'Отображение',
      cleanBadge: 'чистая выдача',
      hideTop: 'Скрывать ТОП',
      hidePromoted: 'Скрывать рекламу',
      hideBarter: 'Скрывать «Обмен»',
      cleanResults: 'Чистая выдача',
      cleanHint: 'Убирает рекламные блоки, «Сохранить поиск» и SEO-блоки.',
      filters: 'Фильтры',
      sort: 'Сортировка',
      sortCheapest: 'Сначала дешёвые',
      sortExpensive: 'Сначала дорогие',
      sortNewest: 'Сначала новые',
      sortRelevance: 'Рекомендованные',
      sortNone: 'Не менять',
      view: 'Вид',
      viewGrid: 'Плитка',
      viewList: 'Список',
      price: 'Цена',
      from: 'от',
      to: 'до',
      condition: 'Состояние',
      conditionNew: 'Новое',
      conditionUsed: 'Б/у',
      auto: 'Применять автоматически',
      reset: 'Сбросить фильтры',
      apply: 'Применить',
      note: 'Сортировка, цена и вид применяются к активной вкладке OLX.',
      noOlx: 'Откройте страницу OLX.ua',
      notListing: 'Откройте результаты поиска OLX',
      reload: 'Обновите страницу OLX, чтобы применить настройки.',
      saved: 'Настройки сохранены.',
      applied: 'Применено',
      hidden: 'Скрыто',
      top: 'ТОП',
      promo: 'реклам.',
      barter: 'обмен',
      junk: 'блоков',
      clean: 'Выдача чистая',
      errRange: 'Минимальная цена больше максимальной.',
      currencyMismatch: 'Сохранённый диапазон был в другой валюте — введите цены заново.',
      loadError: 'Не удалось загрузить настройки.'
    },
    uk: {
      title: 'OLX Фільтр',
      subtitle: 'Чиста видача без зайвого',
      loading: 'Перевіряємо вкладку…',
      masterTitle: 'Розширення',
      masterOn: 'Увімкнено',
      masterOff: 'Вимкнено',
      masterToggle: 'Увімкнути або вимкнути розширення',
      disabled: 'Розширення вимкнено.',
      display: 'Відображення',
      cleanBadge: 'чиста видача',
      hideTop: 'Приховувати ТОП',
      hidePromoted: 'Приховувати рекламу',
      hideBarter: 'Приховувати «Обмін»',
      cleanResults: 'Чиста видача',
      cleanHint: 'Прибирає рекламні блоки, «Зберегти пошук» і SEO-блоки.',
      filters: 'Фільтри',
      sort: 'Сортування',
      sortCheapest: 'Спочатку дешеві',
      sortExpensive: 'Спочатку дорогі',
      sortNewest: 'Спочатку нові',
      sortRelevance: 'Рекомендовані',
      sortNone: 'Не змінювати',
      view: 'Вигляд',
      viewGrid: 'Плитка',
      viewList: 'Список',
      price: 'Ціна',
      from: 'від',
      to: 'до',
      condition: 'Стан',
      conditionNew: 'Нове',
      conditionUsed: 'Вживане',
      auto: 'Застосовувати автоматично',
      reset: 'Скинути фільтри',
      apply: 'Застосувати',
      note: 'Сортування, ціна та вигляд застосовуються до активної вкладки OLX.',
      noOlx: 'Відкрийте сторінку OLX.ua',
      notListing: 'Відкрийте результати пошуку OLX',
      reload: 'Оновіть сторінку OLX, щоб застосувати налаштування.',
      saved: 'Налаштування збережено.',
      applied: 'Застосовано',
      hidden: 'Приховано',
      top: 'ТОП',
      promo: 'реклам.',
      barter: 'обмін',
      junk: 'блоків',
      clean: 'Видача чиста',
      errRange: 'Мінімальна ціна більша за максимальну.',
      currencyMismatch: 'Збережений діапазон був в іншій валюті — введіть ціни заново.',
      loadError: 'Не вдалося завантажити налаштування.'
    }
  };

  const lang = (navigator.language || '').toLowerCase().startsWith('ru') ? 'ru' : 'uk';
  const t = STRINGS[lang];
  const $ = (id) => document.getElementById(id);

  let activeTab = null;
  let stored = { ...F.DEFAULTS };
  let statusTimer = 0;

  function isOlxTab(tab) {
    return !!(tab && tab.url && F.isOlxUrl(tab.url));
  }

  function applyI18n() {
    document.documentElement.lang = lang;
    document.title = t.title;
    document.querySelectorAll('[data-i18n]').forEach((el) => {
      const key = el.getAttribute('data-i18n');
      if (t[key]) el.textContent = t[key];
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
      const key = el.getAttribute('data-i18n-placeholder');
      if (t[key]) el.placeholder = t[key];
    });
    document.querySelectorAll('[data-i18n-aria-label]').forEach((el) => {
      const key = el.getAttribute('data-i18n-aria-label');
      if (t[key]) el.setAttribute('aria-label', t[key]);
    });
  }

  function setStatus(text, tone) {
    const el = $('status');
    const textEl = $('statusText');
    if (!el || !textEl) return;
    textEl.textContent = text;
    el.dataset.tone = tone || 'muted';
  }

  function setNotice(text) {
    const el = $('notice');
    if (!el) return;
    el.textContent = text || '';
    el.hidden = !text;
  }

  function setError(text) {
    const el = $('error');
    if (!el) return;
    el.textContent = text || '';
    el.hidden = !text;
  }

  function renderMaster(enabled) {
    const bar = $('masterBar');
    if (!bar) return;
    bar.dataset.enabled = enabled ? 'true' : 'false';
    $('masterValue').textContent = enabled ? 'ON' : 'OFF';
    $('masterState').textContent = enabled ? t.masterOn : t.masterOff;
    const app = document.querySelector('.app');
    if (app) app.classList.toggle('is-off', !enabled);
  }

  function ensureSortOption(value) {
    const select = $('sort');
    if (!select || !value) return;
    if ([...select.options].some((option) => option.value === value)) return;
    const option = document.createElement('option');
    option.value = value;
    option.textContent = value;
    select.appendChild(option);
  }

  function renderValues(values) {
    $('enabled').checked = values.enabled !== false;
    renderMaster(values.enabled !== false);
    $('hideTop').checked = !!values.hideTop;
    $('hidePromoted').checked = !!values.hidePromoted;
    $('hideBarter').checked = !!values.hideBarter;
    $('cleanResults').checked = !!values.cleanResults;
    $('cleanBadge').hidden = !values.cleanResults;
    $('autoApply').checked = !!values.autoApply;

    ensureSortOption(values.sort);
    $('sort').value = values.sort || '';
    $('view').value = values.view === 'list' ? 'list' : 'grid';
    $('priceFrom').value = values.priceFrom || '';
    $('priceTo').value = values.priceTo || '';
    $('currency').textContent = F.currencyLabel(values.priceCurrency || 'UAH');

    $('conditionNew').setAttribute('aria-pressed', String(!!values.conditionNew));
    $('conditionUsed').setAttribute('aria-pressed', String(!!values.conditionUsed));
  }

  function readControls() {
    const priceCurrency = isOlxTab(activeTab)
      ? F.getCurrency(activeTab.url)
      : stored.priceCurrency;
    return {
      hideTop: $('hideTop').checked,
      hidePromoted: $('hidePromoted').checked,
      hideBarter: $('hideBarter').checked,
      cleanResults: $('cleanResults').checked,
      autoApply: $('autoApply').checked,
      sort: $('sort').value,
      view: $('view').value === 'list' ? 'list' : 'grid',
      priceFrom: F.normalizePrice($('priceFrom').value),
      priceTo: F.normalizePrice($('priceTo').value),
      priceCurrency,
      conditionNew: $('conditionNew').getAttribute('aria-pressed') === 'true',
      conditionUsed: $('conditionUsed').getAttribute('aria-pressed') === 'true'
    };
  }

  async function loadStored() {
    try {
      const data = await api.storage.local.get(F.SETTINGS_KEY);
      return F.normalizeSettings(data && data[F.SETTINGS_KEY]);
    } catch {
      return { ...F.DEFAULTS };
    }
  }

  async function saveStored(next) {
    stored = F.normalizeSettings(next);
    await api.storage.local.set({ [F.SETTINGS_KEY]: stored });
    return stored;
  }

  async function refreshActiveTab() {
    try {
      const tabs = await api.tabs.query({ active: true, currentWindow: true });
      if (tabs && tabs[0]) activeTab = tabs[0];
    } catch {
      // Зберігаємо вкладку з ініціалізації.
    }
  }

  async function navigateActiveTab(url) {
    try {
      await api.tabs.update(activeTab.id, { url });
      return true;
    } catch {
      try {
        await api.tabs.sendMessage(activeTab.id, { type: 'olxf:navigate', url });
        return true;
      } catch {
        return false;
      }
    }
  }

  function renderStatus(status) {
    if (status && status.enabled === false) {
      setStatus(t.disabled, 'muted');
      return;
    }
    if (!isOlxTab(activeTab)) {
      setStatus(t.noOlx, 'warn');
      return;
    }
    if (!status || !status.isListing) {
      setStatus(t.notListing, 'warn');
      return;
    }

    const parts = [];
    if (status.topHidden) parts.push(`${status.topHidden} ${t.top}`);
    if (status.promoHidden) parts.push(`${status.promoHidden} ${t.promo}`);
    if (status.barterHidden) parts.push(`${status.barterHidden} ${t.barter}`);
    if (status.junk) parts.push(`${status.junk} ${t.junk}`);

    if (!parts.length) setStatus(t.clean, 'ok');
    else setStatus(`${t.hidden}: ${parts.join(' · ')}`, 'ok');
  }

  async function refreshStatus() {
    if (!stored.enabled) {
      setStatus(t.disabled, 'muted');
      return;
    }
    if (!isOlxTab(activeTab)) {
      setStatus(t.noOlx, 'warn');
      return;
    }
    try {
      const status = await api.tabs.sendMessage(activeTab.id, { type: 'olxf:get-status' });
      renderStatus(status);
    } catch {
      setStatus(t.reload, 'warn');
    }
  }

  function scheduleStatus() {
    clearTimeout(statusTimer);
    statusTimer = setTimeout(refreshStatus, 180);
  }

  async function onToggle(id) {
    const next = { ...stored, [id]: $(id).checked };
    try {
      await saveStored(next);
    } catch {
      setStatus(t.loadError, 'warn');
      return;
    }

    if (id === 'cleanResults') {
      $('cleanBadge').hidden = !$(id).checked;
    }
    if (id === 'enabled') renderMaster(next.enabled);

    if (!isOlxTab(activeTab)) {
      setStatus(id === 'enabled' && !next.enabled ? t.disabled : t.noOlx,
        id === 'enabled' && !next.enabled ? 'muted' : 'warn');
      return;
    }

    try {
      if (id === 'autoApply' && next.autoApply) {
        await api.tabs.sendMessage(activeTab.id, { type: 'olxf:auto-apply' });
      } else {
        await api.tabs.sendMessage(activeTab.id, {
          type: 'olxf:preview',
          settings: next
        });
      }
      scheduleStatus();
    } catch {
      setStatus(id === 'enabled' && !next.enabled ? t.disabled : t.reload,
        id === 'enabled' && !next.enabled ? 'muted' : 'warn');
    }
  }

  async function onApply() {
    setError('');
    await refreshActiveTab();
    const next = { ...stored, ...readControls() };

    if (next.priceFrom && next.priceTo &&
        Number(next.priceFrom) > Number(next.priceTo)) {
      setError(t.errRange);
      return;
    }

    try {
      await saveStored(next);
    } catch {
      setStatus(t.loadError, 'warn');
      return;
    }

    setNotice('');
    if (!stored.enabled) {
      setStatus(t.disabled, 'muted');
      return;
    }
    if (!isOlxTab(activeTab)) {
      setStatus(t.noOlx, 'warn');
      return;
    }

    const target = F.buildFilterUrl(activeTab.url, next, { mode: 'apply' });
    if (target.href !== activeTab.url) {
      setStatus(`${t.applied}…`, 'ok');
      const navigated = await navigateActiveTab(target.href);
      if (!navigated) setStatus(t.saved, 'warn');
      return;
    }

    try {
      const status = await api.tabs.sendMessage(activeTab.id, {
        type: 'olxf:apply-now',
        settings: next
      });
      renderStatus(status);
    } catch {
      setStatus(t.reload, 'warn');
    }
  }

  async function onReset() {
    setError('');
    await refreshActiveTab();
    const priceCurrency = isOlxTab(activeTab)
      ? F.getCurrency(activeTab.url)
      : stored.priceCurrency;
    const next = {
      ...stored,
      sort: F.DEFAULTS.sort,
      view: F.DEFAULTS.view,
      priceFrom: '',
      priceTo: '',
      priceCurrency,
      conditionNew: true,
      conditionUsed: true
    };

    try {
      await saveStored(next);
    } catch {
      setStatus(t.loadError, 'warn');
      return;
    }
    setNotice('');
    renderValues({ ...next, priceCurrency });

    if (!stored.enabled) {
      setStatus(t.disabled, 'muted');
      return;
    }

    if (!isOlxTab(activeTab)) {
      setStatus(t.saved, 'ok');
      return;
    }

    const target = F.buildFilterUrl(activeTab.url, next, { mode: 'apply' });
    if (target.href !== activeTab.url) {
      setStatus(`${t.applied}…`, 'ok');
      const navigated = await navigateActiveTab(target.href);
      if (!navigated) setStatus(t.saved, 'warn');
      return;
    }

    try {
      const status = await api.tabs.sendMessage(activeTab.id, {
        type: 'olxf:apply-now',
        settings: next
      });
      renderStatus(status);
    } catch {
      setStatus(t.reload, 'warn');
    }
  }

  function bindEvents() {
    for (const id of ['enabled', 'hideTop', 'hidePromoted', 'hideBarter', 'cleanResults', 'autoApply']) {
      $(id).addEventListener('change', () => onToggle(id));
    }

    for (const id of ['sort', 'view']) {
      $(id).addEventListener('change', () => {
        setError('');
      });
    }

    for (const id of ['priceFrom', 'priceTo']) {
      $(id).addEventListener('input', () => {
        const input = $(id);
        input.value = F.normalizePrice(input.value);
        setError('');
      });
    }

    for (const id of ['conditionNew', 'conditionUsed']) {
      $(id).addEventListener('click', () => {
        const chip = $(id);
        const pressed = chip.getAttribute('aria-pressed') === 'true';
        chip.setAttribute('aria-pressed', String(!pressed));
        setError('');
      });
    }

    $('apply').addEventListener('click', onApply);
    $('reset').addEventListener('click', onReset);
  }

  async function init() {
    applyI18n();
    setStatus(t.loading, 'muted');
    await refreshActiveTab();
    stored = await loadStored();

    let values = { ...stored };
    let mismatch = false;

    if (isOlxTab(activeTab)) {
      const pageCurrency = F.getCurrency(activeTab.url);
      const urlValues = F.getUrlValues(activeTab.url, stored);
      values = { ...stored, ...urlValues, priceCurrency: pageCurrency };

      if (!urlValues.hasPrice && (stored.priceFrom || stored.priceTo) &&
          stored.priceCurrency !== pageCurrency) {
        values.priceFrom = '';
        values.priceTo = '';
        mismatch = true;
      }
    }

    renderValues(values);
    bindEvents();
    if (mismatch) setNotice(t.currencyMismatch);
    await refreshStatus();
  }

  init().catch(() => {
    setStatus(t.loadError, 'warn');
  });
})();
