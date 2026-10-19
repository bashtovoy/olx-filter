(() => {
  'use strict';

  const F = globalThis.OLXFilter;
  if (!F) return;

  const STORAGE_KEY = F.SETTINGS_KEY;
  const DEFAULTS = F.DEFAULTS;
  const BASE_STYLE_ID = 'olxf-base-style';
  const TOP_STYLE_ID = 'olxf-top-ids';
  const CLEAN_STYLE_ID = 'olxf-clean-style';
  const HIDDEN_CLASS = 'olxf-hidden';
  const JUNK_CLASS = 'olxf-junk';
  const SCAN_REQ = 'olxf:scan';
  const SCAN_RES = 'olxf:scan-result';
  const SSR_EVENT = 'olxf:ssr';
  const AUTO_GUARD_MS = 5000;

  const CLEAN_CSS = `
    [data-testid="qa-advert-slot"],
    [data-testid="seo-popular-searches"],
    [data-testid="seo-text"],
    .${JUNK_CLASS} { display: none !important; }
  `;

  const api = globalThis.browser || globalThis.chrome;
  if (!api) return;

  let settings = { ...DEFAULTS };
  let settingsLoaded = false;
  let topIds = new Set();
  let promotedIds = new Set();
  let ssrState = null;
  let ssrUrl = '';
  let lastUrl = location.href;
  let domTimer = 0;
  let fiberTimer = 0;
  let bridgeInjected = false;
  let scanSequence = 0;
  let pendingScanId = '';
  let scanFallbackTimer = 0;

  function escapeAttr(value) {
    return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }

  function isListingPage() {
    if (ssrState && ssrUrl === location.href) return true;
    return !!document.querySelector('[data-testid="listing-grid"]');
  }

  function ensureStyle(id, css) {
    let style = document.getElementById(id);
    if (style) return style;
    const parent = document.head || document.documentElement;
    if (!parent) return null;
    style = document.createElement('style');
    style.id = id;
    style.textContent = css;
    parent.appendChild(style);
    return style;
  }

  function injectBaseStyle() {
    ensureStyle(BASE_STYLE_ID,
      `[data-testid="l-card"].${HIDDEN_CLASS}{display:none!important}`);
  }

  function hasTopBadge(card) {
    const nodes = card.querySelectorAll('span, div, b, strong');
    for (const node of nodes) {
      if (node.children.length) continue;
      const text = (node.textContent || '').trim();
      if (!/^(топ|top)$/i.test(text)) continue;
      if (node.closest('h1, h2, h3, h4, h5, h6, p')) continue;
      return true;
    }
    return false;
  }

  function hasPromotedLink(card) {
    const links = card.querySelectorAll('a[href]');
    for (const link of links) {
      let href = link.getAttribute('href') || '';
      try {
        href = decodeURIComponent(href);
      } catch {
        // Keep the original href.
      }
      if (href.includes('search_reason=search|promoted')) return true;
    }
    return false;
  }

  function isBarterPrice(card) {
    const price = (card.querySelector('[data-testid="ad-price"]')?.textContent || '').trim();
    return /^(обмін|обмен)(\s|$)/i.test(price);
  }

  function cleanJunk() {
    if (!settings.cleanResults) return;

    const grid = document.querySelector('[data-testid="listing-grid"]');
    const saveButton = document.querySelector('[data-testid="l-save-search-banner-button"]');
    if (saveButton) {
      let marked = false;
      if (grid) {
        let node = saveButton;
        while (node && node.parentElement && node.parentElement !== grid) {
          node = node.parentElement;
        }
        if (node && node.parentElement === grid) {
          node.classList.add(JUNK_CLASS);
          marked = true;
        }
      }
      if (!marked) {
        const section = saveButton.closest('section, aside');
        if (section && !section.querySelector(
          '[data-testid="listing-grid"], [data-testid="pagination-wrapper"]')) {
          section.classList.add(JUNK_CLASS);
        }
      }
    }

    const seo = document.querySelector(
      '[data-testid="seo-popular-searches"], [data-testid="seo-text"]');
    if (seo) {
      const section = seo.closest('section');
      if (section && !section.querySelector(
        '[data-testid="listing-grid"], [data-testid="pagination-wrapper"]')) {
        section.classList.add(JUNK_CLASS);
      }
    }
  }

  function applyClean() {
    if (!settings.cleanResults) {
      const style = document.getElementById(CLEAN_STYLE_ID);
      if (style) style.remove();
      return;
    }
    ensureStyle(CLEAN_STYLE_ID, CLEAN_CSS);
    cleanJunk();
  }

  function scanCards() {
    const cards = document.querySelectorAll('[data-testid="l-card"]');
    for (const card of cards) {
      const id = card.id;
      let hide = false;
      if (settings.hideTop && (topIds.has(id) || hasTopBadge(card))) hide = true;
      if (!hide && settings.hidePromoted &&
          (promotedIds.has(id) || hasPromotedLink(card))) hide = true;
      if (!hide && settings.hideBarter && isBarterPrice(card)) hide = true;
      card.classList.toggle(HIDDEN_CLASS, hide);
    }
  }

  function applyTopHiding() {
    const ids = new Set();
    if (settings.hideTop) {
      for (const id of topIds) ids.add(id);
    }
    if (settings.hidePromoted) {
      for (const id of promotedIds) ids.add(id);
    }

    let style = document.getElementById(TOP_STYLE_ID);
    if (!ids.size) {
      if (style) style.textContent = '';
      return;
    }

    style = ensureStyle(TOP_STYLE_ID, '');
    if (!style) return;
    const selectors = [...ids]
      .map((id) => `[data-testid="l-card"][id="${escapeAttr(id)}"]`)
      .join(',');
    const css = `${selectors}{display:none!important}`;
    if (style.textContent !== css) style.textContent = css;
  }

  function applyAll() {
    injectBaseStyle();
    applyTopHiding();
    applyClean();
    scanCards();
  }

  function getStatus() {
    const cards = [...document.querySelectorAll('[data-testid="l-card"]')];
    let hidden = 0;
    let topHidden = 0;
    let promoHidden = 0;
    let barterHidden = 0;

    for (const card of cards) {
      if (!card.classList.contains(HIDDEN_CLASS)) continue;
      hidden += 1;
      const id = card.id;
      const top = settings.hideTop && (topIds.has(id) || hasTopBadge(card));
      const promo = settings.hidePromoted &&
        (promotedIds.has(id) || hasPromotedLink(card));
      const barter = settings.hideBarter && isBarterPrice(card);
      if (top) topHidden += 1;
      else if (promo) promoHidden += 1;
      else if (barter) barterHidden += 1;
    }

    const junk = settings.cleanResults
      ? document.querySelectorAll('[data-testid="qa-advert-slot"]').length +
        document.querySelectorAll(`.${JUNK_CLASS}`).length
      : 0;

    const params = new URL(location.href).searchParams;
    return {
      isListing: isListingPage(),
      url: location.href,
      cards: cards.length,
      hidden,
      topHidden,
      promoHidden,
      barterHidden,
      junk,
      sort: params.get('search[order]') || '',
      view: params.get('view') === 'list' ? 'list' : 'grid'
    };
  }

  function maybeAutoApply() {
    if (!settingsLoaded || !settings.autoApply || !isListingPage()) return false;

    const target = F.buildFilterUrl(location.href, settings, { mode: 'auto' });
    if (target.href === location.href) return false;

    const key = `olxf:auto:${location.pathname}`;
    try {
      const now = Date.now();
      const raw = sessionStorage.getItem(key);
      if (raw) {
        const guard = JSON.parse(raw);
        if (guard && guard.target === target.search && now - guard.ts < AUTO_GUARD_MS) {
          return false;
        }
      }
      sessionStorage.setItem(key, JSON.stringify({ target: target.search, ts: now }));
    } catch {
      // If storage is unavailable, still navigate; the target is stable.
    }

    try {
      location.replace(target.href);
      return true;
    } catch {
      return false;
    }
  }
  function scanViaWrappedJSObject() {
    const grid = document.querySelector('[data-testid="listing-grid"]');
    if (!grid) return null;

    let node = grid;
    try {
      if (grid.wrappedJSObject) node = grid.wrappedJSObject;
    } catch {
      // Use the Xray wrapper.
    }

    const keys = [];
    try {
      keys.push(...Object.keys(node));
    } catch {
      // Ignore.
    }
    try {
      keys.push(...Object.getOwnPropertyNames(node));
    } catch {
      // Ignore.
    }
    const fiberKey = keys.find((key) => key.startsWith('__reactFiber$') || key.startsWith('__reactInternalInstance$'));
    if (!fiberKey) return null;

    let root = node[fiberKey];
    if (!root) return null;
    while (root.return) root = root.return;

    const cardIds = new Set([...document.querySelectorAll('[data-testid="l-card"]')].map((card) => card.id));
    const isArrayLike = (value) => {
      if (!value || typeof value !== 'object') return false;
      if (Array.isArray(value)) return true;
      try {
        return typeof value.length === 'number' && typeof value.slice === 'function';
      } catch {
        return false;
      }
    };
    const collect = (ads) => {
      if (!isArrayLike(ads) || !ads.length) return null;
      const first = ads[0];
      if (!first || typeof first !== 'object') return null;
      if (!('isHighlighted' in first || 'isPromoted' in first || 'promotion' in first || 'searchReason' in first)) {
        return null;
      }
      const top = [];
      const promoted = [];
      for (let index = 0; index < ads.length; index += 1) {
        const ad = ads[index];
        if (!ad || typeof ad !== 'object') continue;
        const id = ad.id != null ? String(ad.id) : '';
        if (!id) continue;
        if (ad.isHighlighted || (ad.promotion && ad.promotion.top_ad)) top.push(id);
        if (ad.isPromoted || ad.searchReason === 'promoted') promoted.push(id);
      }
      return {
        topIds: [...new Set(top)],
        promotedIds: [...new Set(promoted)],
        total: ads.length
      };
    };

    const stack = [root];
    const seen = new Set();
    let visited = 0;
    let best = null;
    let bestScore = 0;

    while (stack.length && visited < 30000) {
      const current = stack.pop();
      visited += 1;
      if (!current || seen.has(current)) continue;
      seen.add(current);

      let props;
      try {
        props = current.memoizedProps;
      } catch {
        props = null;
      }

      if (props && typeof props === 'object') {
        const arrays = [];
        if (isArrayLike(props.ads)) arrays.push(props.ads);
        if (isArrayLike(props.items)) arrays.push(props.items);
        if (props.data && isArrayLike(props.data.ads)) arrays.push(props.data.ads);
        if (props.listing && isArrayLike(props.listing.ads)) arrays.push(props.listing.ads);

        for (const ads of arrays) {
          const collected = collect(ads);
          if (!collected) continue;
          let score = 0;
          for (let index = 0; index < Math.min(12, ads.length); index += 1) {
            if (ads[index] && cardIds.has(String(ads[index].id))) score += 1;
          }
          if (score > bestScore) {
            best = collected;
            bestScore = score;
          }
        }
      }

      if (current.child) stack.push(current.child);
      if (current.sibling) stack.push(current.sibling);
    }

    if (!best || bestScore <= 0) return null;
    return {
      ...best,
      cards: cardIds.size,
      visited,
      reason: 'ok',
      source: 'wrapped',
      url: location.href
    };
  }

  // BEGIN PAGE BRIDGE
  function pageBridge() {
    if (window.__olxFilterBridgeInstalled) return;
    window.__olxFilterBridgeInstalled = true;

    const REQ = 'olxf:scan';
    const RES = 'olxf:scan-result';
    const SSR = 'olxf:ssr';
    const MAX_NODES = 30000;
    let ssr = null;

    const isArray = (value) => Array.isArray(value);

    const parseSsr = (text) => {
      if (!text || text.indexOf('__PRERENDERED_STATE__') < 0) return null;
      const match = text.match(/__PRERENDERED_STATE__\s*=\s*("(?:\\.|[^"\\])*")/);
      if (!match) return null;
      try {
        const state = JSON.parse(JSON.parse(match[1]));
        const listing = state && state.listing && state.listing.listing;
        const ads = listing && listing.ads;
        if (!isArray(ads) || !ads.length) return null;

        const top = [];
        const promoted = [];
        for (const ad of ads) {
          if (!ad || typeof ad !== 'object') continue;
          const id = ad.id != null ? String(ad.id) : '';
          if (!id) continue;
          if (ad.isHighlighted || (ad.promotion && ad.promotion.top_ad)) top.push(id);
          if (ad.isPromoted || ad.searchReason === 'promoted') promoted.push(id);
        }

        const promotedIndexes = listing.metaData && listing.metaData.promoted;
        if (isArray(promotedIndexes)) {
          for (const index of promotedIndexes) {
            const ad = ads[index];
            if (ad && ad.id != null) promoted.push(String(ad.id));
          }
        }

        return {
          topIds: [...new Set(top)],
          promotedIds: [...new Set(promoted)],
          total: ads.length,
          source: 'ssr',
          reason: 'ok',
          url: location.href
        };
      } catch {
        return null;
      }
    };

    const capture = (script) => {
      if (!script || script.tagName !== 'SCRIPT') return;
      const text = script.textContent || '';
      if (script.id !== 'olx-init-config' && text.indexOf('__PRERENDERED_STATE__') < 0) return;
      const parsed = parseSsr(text);
      if (!parsed) return;
      ssr = parsed;
      try {
        document.dispatchEvent(new CustomEvent(SSR, { detail: JSON.stringify(parsed) }));
      } catch {
        // Ignore event failures.
      }
    };

    try {
      const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          for (const node of mutation.addedNodes) {
            if (node.nodeType !== 1) continue;
            if (node.tagName === 'SCRIPT') {
              capture(node);
            } else if (node.querySelectorAll) {
              for (const script of node.querySelectorAll('script')) capture(script);
            }
          }
        }
      });
      observer.observe(document, { childList: true, subtree: true });
    } catch {
      // Ignore observer failures.
    }

    try {
      for (const script of document.querySelectorAll('script#olx-init-config')) capture(script);
    } catch {
      // Ignore.
    }

    const getFiber = (element) => {
      const keys = [];
      try {
        keys.push(...Object.keys(element));
      } catch {
        // Ignore.
      }
      try {
        keys.push(...Object.getOwnPropertyNames(element));
      } catch {
        // Ignore.
      }
      const key = keys.find((item) => item.startsWith('__reactFiber$') || item.startsWith('__reactInternalInstance$'));
      return key ? element[key] : null;
    };

    const scanFiber = () => {
      const grid = document.querySelector('[data-testid="listing-grid"]');
      if (!grid) {
        return { topIds: [], promotedIds: [], total: 0, cards: 0, reason: 'no-grid', source: 'fiber', url: location.href };
      }
      const fiber = getFiber(grid);
      if (!fiber) {
        return { topIds: [], promotedIds: [], total: 0, cards: 0, reason: 'no-fiber', source: 'fiber', url: location.href };
      }

      let root = fiber;
      while (root.return) root = root.return;

      const cardIds = new Set([...document.querySelectorAll('[data-testid="l-card"]')].map((card) => card.id));
      const collect = (ads) => {
        if (!isArray(ads) || !ads.length) return null;
        const first = ads[0];
        if (!first || typeof first !== 'object') return null;
        if (!('isHighlighted' in first || 'isPromoted' in first || 'promotion' in first || 'searchReason' in first)) {
          return null;
        }
        const top = [];
        const promoted = [];
        for (const ad of ads) {
          if (!ad || typeof ad !== 'object') continue;
          const id = ad.id != null ? String(ad.id) : '';
          if (!id) continue;
          if (ad.isHighlighted || (ad.promotion && ad.promotion.top_ad)) top.push(id);
          if (ad.isPromoted || ad.searchReason === 'promoted') promoted.push(id);
        }
        return {
          topIds: [...new Set(top)],
          promotedIds: [...new Set(promoted)],
          total: ads.length
        };
      };

      const stack = [root];
      const seen = new Set();
      let visited = 0;
      let best = null;
      let bestScore = 0;

      while (stack.length && visited < MAX_NODES) {
        const current = stack.pop();
        visited += 1;
        if (!current || seen.has(current)) continue;
        seen.add(current);

        let props;
        try {
          props = current.memoizedProps;
        } catch {
          props = null;
        }

        if (props && typeof props === 'object') {
          const arrays = [];
          if (isArray(props.ads)) arrays.push(props.ads);
          if (isArray(props.items)) arrays.push(props.items);
          if (props.data && isArray(props.data.ads)) arrays.push(props.data.ads);
          if (props.listing && isArray(props.listing.ads)) arrays.push(props.listing.ads);

          for (const ads of arrays) {
            const collected = collect(ads);
            if (!collected) continue;
            let score = 0;
            for (let index = 0; index < Math.min(12, ads.length); index += 1) {
              if (ads[index] && cardIds.has(String(ads[index].id))) score += 1;
            }
            if (score > bestScore) {
              best = collected;
              bestScore = score;
            }
          }
        }

        if (current.child) stack.push(current.child);
        if (current.sibling) stack.push(current.sibling);
      }

      if (!best || bestScore <= 0) {
        return { topIds: [], promotedIds: [], total: 0, cards: cardIds.size, reason: 'no-ads', source: 'fiber', visited, url: location.href };
      }

      return {
        ...best,
        cards: cardIds.size,
        visited,
        reason: 'ok',
        source: 'fiber',
        url: location.href
      };
    };

    const scan = () => {
      const fiber = scanFiber();
      const currentSsr = ssr && ssr.url === location.href ? ssr : null;
      if (currentSsr) {
        const top = new Set([...(currentSsr.topIds || []), ...(fiber.topIds || [])]);
        const promoted = new Set([...(currentSsr.promotedIds || []), ...(fiber.promotedIds || [])]);
        return {
          topIds: [...top],
          promotedIds: [...promoted],
          total: currentSsr.total || fiber.total || 0,
          cards: fiber.cards || 0,
          source: 'ssr+fiber',
          reason: 'ok',
          url: location.href
        };
      }
      return fiber;
    };

    document.addEventListener(REQ, (event) => {
      let result;
      try {
        result = scan();
      } catch (error) {
        result = {
          topIds: [],
          promotedIds: [],
          total: 0,
          cards: 0,
          reason: 'error',
          source: 'fiber',
          error: String(error),
          url: location.href
        };
      }
      result.requestId = event && event.detail ? event.detail : '';
      result.url = location.href;
      try {
        document.dispatchEvent(new CustomEvent(RES, { detail: JSON.stringify(result) }));
      } catch {
        // Ignore.
      }
    });
  }
  // END PAGE BRIDGE

  function handleScanResult(data) {
    if (!data || typeof data !== 'object') return;
    if (data.url && data.url !== location.href) return;
    if (data.reason !== 'ok') return;

    const nextTopIds = new Set(
      (Array.isArray(data.topIds) ? data.topIds : []).map(String));
    const nextPromotedIds = new Set(
      (Array.isArray(data.promotedIds) ? data.promotedIds : []).map(String));
    const changed = !setsEqual(topIds, nextTopIds) ||
      !setsEqual(promotedIds, nextPromotedIds);

    topIds = nextTopIds;
    promotedIds = nextPromotedIds;

    if (data.source === 'ssr' || data.source === 'ssr+fiber') {
      ssrState = data;
      ssrUrl = data.url || location.href;
    }

    if (changed) applyAll();
    else scanCards();
    maybeAutoApply();
  }

  function setsEqual(left, right) {
    if (left.size !== right.size) return false;
    for (const value of left) {
      if (!right.has(value)) return false;
    }
    return true;
  }

  function injectBridge() {
    if (bridgeInjected) return;
    const parent = document.head || document.documentElement;
    if (!parent) {
      setTimeout(injectBridge, 10);
      return;
    }
    try {
      const script = document.createElement('script');
      script.textContent = `(${pageBridge.toString()})();`;
      parent.appendChild(script);
      script.remove();
      bridgeInjected = true;
    } catch {
      bridgeInjected = false;
    }
  }

  function requestFiberScan() {
    if (!isListingPage()) return;
    injectBridge();
    const id = String((scanSequence += 1));
    pendingScanId = id;

    clearTimeout(scanFallbackTimer);
    scanFallbackTimer = setTimeout(() => {
      if (pendingScanId !== id) return;
      const fallback = scanViaWrappedJSObject();
      if (fallback) {
        handleScanResult({ ...fallback, requestId: id });
      }
    }, 700);

    try {
      document.dispatchEvent(new CustomEvent(SCAN_REQ, { detail: id }));
    } catch {
      // The fallback timer will try the Xray route.
    }
  }

  function scheduleFiberScan(delay = 150) {
    clearTimeout(fiberTimer);
    fiberTimer = setTimeout(requestFiberScan, delay);
  }

  function scheduleDomWork() {
    clearTimeout(domTimer);
    domTimer = setTimeout(() => {
      checkUrl();
      if (!isListingPage()) return;
      injectBaseStyle();
      applyClean();
      scanCards();
      scheduleFiberScan(120);
    }, 100);
  }

  function urlPath(value) {
    try {
      return new URL(value).pathname;
    } catch {
      return '';
    }
  }

  function checkUrl() {
    if (location.href === lastUrl) return;
    const oldPath = urlPath(lastUrl);
    lastUrl = location.href;
    if (oldPath !== urlPath(lastUrl)) {
      topIds = new Set();
      promotedIds = new Set();
      ssrState = null;
      ssrUrl = '';
    }
    applyAll();
    scheduleFiberScan(60);
    maybeAutoApply();
  }

  function onScanResult(event) {
    let data;
    try {
      data = JSON.parse(event.detail);
    } catch {
      return;
    }
    if (data.requestId && pendingScanId && data.requestId !== pendingScanId) return;
    if (data.reason === 'ok') {
      clearTimeout(scanFallbackTimer);
      pendingScanId = '';
    }
    handleScanResult(data);
  }

  function onSsr(event) {
    let data;
    try {
      data = JSON.parse(event.detail);
    } catch {
      return;
    }
    if (!data || !data.url || data.url !== location.href) return;
    ssrState = data;
    ssrUrl = data.url;
    handleScanResult(data);
  }

  const settingsReady = (async () => {
    if (api && api.storage && api.storage.local) {
      try {
        const stored = await api.storage.local.get(STORAGE_KEY);
        settings = F.normalizeSettings(stored && stored[STORAGE_KEY]);
      } catch {
        // Keep defaults.
      }
    }
    settingsLoaded = true;
    return settings;
  })();

  document.addEventListener(SCAN_RES, onScanResult);
  document.addEventListener(SSR_EVENT, onSsr);

  if (api && api.storage && api.storage.onChanged) {
    api.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes[STORAGE_KEY]) return;
      const next = F.normalizeSettings(changes[STORAGE_KEY].newValue);
      if (JSON.stringify(next) === JSON.stringify(settings)) return;
      settings = next;
      settingsLoaded = true;
      applyAll();
    });
  }

  if (api && api.runtime && api.runtime.onMessage) {
    api.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (!message || typeof message !== 'object') return;

      if (message.type === 'olxf:get-status') {
        sendResponse(getStatus());
        return;
      }

      if (message.type === 'olxf:navigate') {
        if (typeof message.url === 'string' && F.isOlxUrl(message.url)) {
          location.href = message.url;
          sendResponse({ ok: true });
        } else {
          sendResponse({ ok: false });
        }
        return;
      }

      if (message.type === 'olxf:preview' || message.type === 'olxf:apply-now') {
        if (message.settings) {
          settings = F.normalizeSettings(message.settings);
          settingsLoaded = true;
        }
        applyAll();
        sendResponse(getStatus());
        return;
      }

      if (message.type === 'olxf:auto-apply') {
        maybeAutoApply();
        sendResponse(getStatus());
      }
    });
  }

  injectBaseStyle();
  applyClean();
  injectBridge();

  settingsReady.then(() => {
    applyAll();
    scheduleFiberScan(50);
    maybeAutoApply();
  });

  const onReady = () => {
    applyAll();
    scheduleFiberScan(50);
    maybeAutoApply();
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', onReady, { once: true });
  } else {
    onReady();
  }

  try {
    new MutationObserver(scheduleDomWork).observe(document, {
      childList: true,
      subtree: true
    });
  } catch {
    // Ignore observer failures.
  }

  window.addEventListener('popstate', checkUrl);
  setInterval(checkUrl, 500);
})();
