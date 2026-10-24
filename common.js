(function (root) {
  'use strict';

  const SETTINGS_KEY = 'olxFilterSettings';

  const DEFAULTS = Object.freeze({
    enabled: true,
    hideTop: true,
    hidePromoted: false,
    hideBarter: false,
    cleanResults: true,
    sort: 'filter_float_price:asc',
    view: 'grid',
    priceFrom: '',
    priceTo: '',
    priceCurrency: 'UAH',
    conditionNew: true,
    conditionUsed: true,
    autoApply: true
  });

  const SORT_VALUES = Object.freeze([
    'filter_float_price:asc',
    'filter_float_price:desc',
    'created_at:desc',
    'relevance:desc',
    ''
  ]);

  function normalizePrice(value) {
    const digits = String(value == null ? '' : value).replace(/[^\d]/g, '');
    return digits.replace(/^0+(?=\d)/, '');
  }

  function normalizeSettings(raw) {
    const out = { ...DEFAULTS };
    if (!raw || typeof raw !== 'object') return out;

    out.enabled = raw.enabled !== false;
    out.hideTop = raw.hideTop !== false;
    out.hidePromoted = raw.hidePromoted === true;
    out.hideBarter = raw.hideBarter === true;
    out.cleanResults = raw.cleanResults !== false;
    out.autoApply = raw.autoApply !== false;
    out.sort = typeof raw.sort === 'string' ? raw.sort : DEFAULTS.sort;
    out.view = raw.view === 'list' ? 'list' : 'grid';
    out.priceFrom = normalizePrice(raw.priceFrom);
    out.priceTo = normalizePrice(raw.priceTo);
    out.priceCurrency = typeof raw.priceCurrency === 'string' && /^[A-Z]{3}$/.test(raw.priceCurrency)
      ? raw.priceCurrency
      : DEFAULTS.priceCurrency;
    out.conditionNew = raw.conditionNew !== false;
    out.conditionUsed = raw.conditionUsed !== false;

    return out;
  }

  function getCurrency(url) {
    try {
      return (new URL(url).searchParams.get('currency') || 'UAH').toUpperCase();
    } catch {
      return 'UAH';
    }
  }

  function currencyLabel(code) {
    if (code === 'UAH') return 'грн.';
    if (code === 'USD') return '$';
    if (code === 'EUR') return '€';
    return code || 'грн.';
  }

  function isOlxUrl(url) {
    try {
      const parsed = new URL(url);
      return parsed.protocol === 'https:' &&
        (parsed.hostname === 'olx.ua' || parsed.hostname === 'www.olx.ua');
    } catch {
      return false;
    }
  }

  function keysWithPrefix(params, prefix) {
    const keys = [];
    params.forEach((value, key) => {
      if (key.startsWith(prefix) && !keys.includes(key)) keys.push(key);
    });
    return keys;
  }

  function stateValues(params) {
    const values = [];
    for (const key of keysWithPrefix(params, 'search[filter_enum_state]')) {
      for (const value of params.getAll(key)) {
        if (value === 'new' || value === 'used') values.push(value);
      }
    }
    return values;
  }

  function exclusiveState(value) {
    const onlyNew = value.conditionNew && !value.conditionUsed;
    const onlyUsed = value.conditionUsed && !value.conditionNew;
    return onlyNew ? 'new' : onlyUsed ? 'used' : '';
  }

  function deleteKeys(params, prefix) {
    for (const key of keysWithPrefix(params, prefix)) params.delete(key);
  }

  function getUrlValues(url, settings) {
    const params = new URL(url).searchParams;
    const hasSort = params.has('search[order]');
    const hasView = params.has('view');
    const hasFrom = params.has('search[filter_float_price:from]');
    const hasTo = params.has('search[filter_float_price:to]');
    const hasPrice = hasFrom || hasTo;
    const stateKeys = keysWithPrefix(params, 'search[filter_enum_state]');
    const states = stateValues(params);
    const hasState = stateKeys.length > 0;

    return {
      hasSort,
      hasView,
      hasFrom,
      hasTo,
      hasPrice,
      hasState,
      sort: hasSort ? (params.get('search[order]') || '') : settings.sort,
      view: hasView
        ? (params.get('view') === 'list' ? 'list' : 'grid')
        : settings.view,
      priceFrom: hasPrice
        ? (hasFrom ? normalizePrice(params.get('search[filter_float_price:from]')) : '')
        : settings.priceFrom,
      priceTo: hasPrice
        ? (hasTo ? normalizePrice(params.get('search[filter_float_price:to]')) : '')
        : settings.priceTo,
      conditionNew: hasState ? states.includes('new') : settings.conditionNew,
      conditionUsed: hasState ? states.includes('used') : settings.conditionUsed
    };
  }

  function buildFilterUrl(url, settings, options) {
    const mode = options && options.mode === 'auto' ? 'auto' : 'apply';
    const target = new URL(url);
    const params = target.searchParams;

    if (mode === 'auto') {
      let changed = false;
      let filterChanged = false;

      if (!params.has('search[order]') && settings.sort) {
        params.set('search[order]', settings.sort);
        changed = true;
        filterChanged = true;
      }

      if (!params.has('view') && settings.view) {
        params.set('view', settings.view === 'list' ? 'list' : 'grid');
        changed = true;
      }

      const invalidRange = settings.priceFrom && settings.priceTo &&
        Number(settings.priceFrom) > Number(settings.priceTo);
      const priceKeys = keysWithPrefix(params, 'search[filter_float_price:');
      const currencyOk = !settings.priceCurrency ||
        settings.priceCurrency === getCurrency(url);
      if (!priceKeys.length && !invalidRange && currencyOk &&
          (settings.priceFrom || settings.priceTo)) {
        if (settings.priceFrom) {
          params.set('search[filter_float_price:from]', settings.priceFrom);
          changed = true;
          filterChanged = true;
        }
        if (settings.priceTo) {
          params.set('search[filter_float_price:to]', settings.priceTo);
          changed = true;
          filterChanged = true;
        }
      }

      const stateKeys = keysWithPrefix(params, 'search[filter_enum_state]');
      if (!stateKeys.length) {
        const state = exclusiveState(settings);
        if (state) {
          params.set('search[filter_enum_state][0]', state);
          changed = true;
          filterChanged = true;
        }
      }

      if (filterChanged) params.delete('page');
      return target;
    }

    if (settings.sort) params.set('search[order]', settings.sort);
    else params.delete('search[order]');

    params.set('view', settings.view === 'list' ? 'list' : 'grid');

    deleteKeys(params, 'search[filter_float_price:');
    if (settings.priceFrom) {
      params.set('search[filter_float_price:from]', settings.priceFrom);
    }
    if (settings.priceTo) {
      params.set('search[filter_float_price:to]', settings.priceTo);
    }

    deleteKeys(params, 'search[filter_enum_state]');
    const state = exclusiveState(settings);
    if (state) params.set('search[filter_enum_state][0]', state);

    params.delete('page');
    return target;
  }

  root.OLXFilter = Object.freeze({
    SETTINGS_KEY,
    DEFAULTS,
    SORT_VALUES,
    normalizePrice,
    normalizeSettings,
    getCurrency,
    currencyLabel,
    isOlxUrl,
    keysWithPrefix,
    stateValues,
    getUrlValues,
    buildFilterUrl
  });
})(globalThis);
