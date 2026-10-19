(() => {
  'use strict';
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
  pageBridge();
})();
