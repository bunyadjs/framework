/**
 * Browser runtime for `@bunyad/live`.
 *
 * Supports:
 * - `data-action` / `live:click` (+ params)
 * - `live:submit` / `data-submit` on forms (sends every model field, then calls the action)
 * - `data-model` / `live:model` (+ `.lazy` / `.debounce.N`; `.defer` waits for the next action)
 * - `data-loading` / `live:loading` targets while in flight
 * - DOM morph (preserve focus) instead of full replace
 * - Server `dispatch` → `document` CustomEvents; `redirect` / `navigate`
 * - `live:navigate` / `data-navigate` SPA link navigation + prefetch
 * - Alpine.js `$live.entangle('prop')` when Alpine is present
 */
export function clientScript(updatePath = "/live/update"): string {
  // NOTE: This string is browser JS. Escape carefully inside the template.
  return `(() => {
  const UPDATE_PATH = ${JSON.stringify(updatePath)};
  const debounceTimers = new WeakMap();
  const prefetchCache = new Map();
  let progressEl = null;
  let navigating = false;

  function rootOf(el) {
    return el.closest("[data-live]");
  }

  function utf8FromBase64(b64) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  function readSnapshot(root) {
    const raw = root.getAttribute("data-snapshot");
    if (!raw) throw new Error("Missing Live snapshot.");
    return JSON.parse(utf8FromBase64(raw));
  }

  function csrfToken() {
    const meta = document.querySelector('meta[name="csrf-token"]');
    if (meta && meta.content) return meta.content;
    const input = document.querySelector('input[name="_token"]');
    return input && input.value ? input.value : "";
  }

  function parseAction(attr) {
    const match = /^(.*?)(?:\\((.*)\\))?$/.exec(attr.trim());
    if (!match) return { method: attr, params: [] };
    const method = match[1].trim();
    const raw = (match[2] || "").trim();
    if (!raw) return { method, params: [] };
    try {
      return { method, params: JSON.parse("[" + raw + "]") };
    } catch {
      return {
        method,
        params: raw.split(",").map((part) => {
          const p = part.trim();
          if ((p.startsWith('"') && p.endsWith('"')) || (p.startsWith("'") && p.endsWith("'"))) {
            return p.slice(1, -1);
          }
          const n = Number(p);
          return Number.isFinite(n) ? n : p;
        }),
      };
    }
  }

  function actionFrom(el) {
    const data = el.getAttribute("data-action");
    if (data) return data;
    const wire = el.getAttribute("live:click");
    if (wire) return wire;
    return null;
  }

  function modelBinding(el) {
    for (const attr of el.getAttributeNames()) {
      if (attr === "data-model" || attr === "live:model") {
        return { key: el.getAttribute(attr), lazy: false, debounce: 0 };
      }
      if (attr === "data-model.lazy" || attr === "live:model.lazy") {
        return { key: el.getAttribute(attr), lazy: true, debounce: 0 };
      }
      if (attr === "data-model.defer" || attr === "live:model.defer") {
        return { key: el.getAttribute(attr), lazy: false, debounce: 0, defer: true };
      }
      const deb = /^(?:data-model|live:model)\\.debounce(?:\\.(\\d+))?$/.exec(attr);
      if (deb) {
        return {
          key: el.getAttribute(attr),
          lazy: false,
          debounce: Number(deb[1] || 150),
        };
      }
    }
    return null;
  }

  function modelValue(target) {
    if (target.type === "checkbox") return target.checked;
    return target.value;
  }

  function setLoading(root, on) {
    if (on) {
      root.classList.add("data-loading");
      root.setAttribute("data-loading", "");
    } else {
      root.classList.remove("data-loading");
      root.removeAttribute("data-loading");
    }
    root.querySelectorAll("[data-loading], [live\\\\:loading]").forEach((el) => {
      if (el === root) return;
      el.classList.toggle("data-loading", on);
      if (on) {
        el.setAttribute("data-loading", "");
      } else {
        el.removeAttribute("data-loading");
      }
    });
  }

  function morphAttrs(from, to) {
    for (const name of from.getAttributeNames()) {
      if (!to.hasAttribute(name)) from.removeAttribute(name);
    }
    for (const name of to.getAttributeNames()) {
      const next = to.getAttribute(name);
      if (from.getAttribute(name) !== next) from.setAttribute(name, next);
    }
  }

  function isInput(el) {
    return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement;
  }

  function wireId(el) {
    return el.nodeType === 1 ? el.getAttribute("live:id") : null;
  }

  function morphChildren(from, to) {
    const fromKids = [...from.childNodes];
    const toKids = [...to.childNodes];
    const used = new Set();

    for (const tk of toKids) {
      const id = wireId(tk);
      let fk = null;
      if (id) {
        fk = fromKids.find((n) => !used.has(n) && wireId(n) === id) || null;
      }
      if (!fk) {
        fk = fromKids.find((n) => {
          if (used.has(n)) return false;
          if (id && wireId(n)) return false;
          const ti = toKids.indexOf(tk);
          return fromKids.indexOf(n) === ti || (!wireId(n) && n.nodeType === tk.nodeType);
        }) || null;
      }
      if (!fk) {
        from.appendChild(tk.cloneNode(true));
        continue;
      }
      used.add(fk);
      morph(fk, tk);
    }
    for (const fk of fromKids) {
      if (!used.has(fk)) fk.remove();
    }
  }

  function morph(from, to) {
    if (from.nodeType !== 1 || to.nodeType !== 1) {
      if (from.nodeType === 3 && to.nodeType === 3) {
        if (from.textContent !== to.textContent) from.textContent = to.textContent;
        return;
      }
      from.replaceWith(to.cloneNode(true));
      return;
    }
    if (from.tagName !== to.tagName) {
      from.replaceWith(to.cloneNode(true));
      return;
    }
    morphAttrs(from, to);
    if (isInput(from) && isInput(to)) {
      const active = document.activeElement === from;
      const start = active && "selectionStart" in from ? from.selectionStart : null;
      const end = active && "selectionEnd" in from ? from.selectionEnd : null;
      if (from.type === "checkbox" || from.type === "radio") {
        from.checked = to.checked;
      } else if (from.value !== to.value) {
        from.value = to.value;
      }
      if (active && start != null && end != null && "setSelectionRange" in from) {
        try { from.setSelectionRange(start, end); } catch {}
      }
      return;
    }
    morphChildren(from, to);
  }

  function showProgress(on) {
    if (on) {
      if (!progressEl) {
        progressEl = document.createElement("div");
        progressEl.setAttribute("data-live-progress", "");
        progressEl.style.cssText = "position:fixed;top:0;left:0;height:2px;width:0;background:#0d6efd;z-index:99999;transition:width .2s ease";
        document.documentElement.appendChild(progressEl);
      }
      progressEl.style.width = "70%";
      progressEl.style.opacity = "1";
    } else if (progressEl) {
      progressEl.style.width = "100%";
      setTimeout(() => {
        if (!progressEl) return;
        progressEl.style.opacity = "0";
        progressEl.style.width = "0";
      }, 150);
    }
  }

  async function fetchPage(url) {
    if (prefetchCache.has(url)) return prefetchCache.get(url);
    const promise = fetch(url, {
      headers: {
        Accept: "text/html",
        "X-Bunyad-Navigate": "1",
        "X-Requested-With": "XMLHttpRequest",
      },
      credentials: "same-origin",
    }).then(async (res) => {
      if (!res.ok) throw new Error("Navigate failed: " + res.status);
      // Where the server's redirects ended up (e.g. /dashboard → /login).
      const final = new URL(res.url);
      return { html: await res.text(), url: final.pathname + final.search + final.hash };
    });
    prefetchCache.set(url, promise);
    try {
      return await promise;
    } catch (err) {
      prefetchCache.delete(url);
      throw err;
    }
  }

  function applyDocumentHtml(html, url, push) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    if (doc.title) document.title = doc.title;
    // Logging in or out rotates the session's CSRF token.
    const nextCsrf = doc.querySelector('meta[name="csrf-token"]');
    const csrf = document.querySelector('meta[name="csrf-token"]');
    if (nextCsrf && csrf) csrf.setAttribute("content", nextCsrf.getAttribute("content") || "");
    const nextBody = doc.body;
    if (nextBody) morph(document.body, nextBody);
    const nextHtml = doc.documentElement;
    if (nextHtml) {
      for (const name of ["lang", "class"]) {
        const v = nextHtml.getAttribute(name);
        if (v == null) document.documentElement.removeAttribute(name);
        else document.documentElement.setAttribute(name, v);
      }
    }
    if (push) history.pushState({ bunyadNavigate: true }, "", url);
    document.dispatchEvent(new CustomEvent("live:navigated", { detail: { url } }));
    scanPolls();
  }

  async function navigateTo(url, { push = true } = {}) {
    if (navigating) return;
    navigating = true;
    showProgress(true);
    try {
      const page = await fetchPage(url);
      prefetchCache.delete(url);
      applyDocumentHtml(page.html, page.url, push);
    } catch (err) {
      // Fall back to a normal page load rather than leaving the click dead.
      console.error(err);
      window.location.href = url;
    } finally {
      showProgress(false);
      navigating = false;
    }
  }

  function applyEffects(effects) {
    if (!effects) return;
    // An action may have signed in or out; pages prefetched before are stale.
    prefetchCache.clear();
    if (effects.navigate) {
      navigateTo(effects.navigate).catch((err) => console.error(err));
      return;
    }
    if (effects.redirect) {
      window.location.href = effects.redirect;
      return;
    }
    for (const event of effects.events || []) {
      document.dispatchEvent(
        new CustomEvent(event.name, {
          detail: event.params || {},
          bubbles: true,
        }),
      );
    }
  }

  function collectNestedChildren(root) {
    const snap = readSnapshot(root);
    const keys = snap.children ? Object.keys(snap.children) : [];
    if (keys.length === 0) return undefined;
    const nested = [...root.querySelectorAll(":scope [data-live]")];
    const byId = new Map(nested.map((el) => [el.getAttribute("live:id"), el]));
    const children = {};
    for (const key of keys) {
      const prev = snap.children[key];
      if (!prev) continue;
      const el = byId.get(prev.id);
      if (el) {
        children[key] = readSnapshot(el);
      } else {
        children[key] = prev;
      }
    }
    return children;
  }

  async function requestUpdate(root, payload) {
    setLoading(root, true);
    const headers = {
      "Content-Type": "application/json",
      Accept: "application/json",
      "X-Requested-With": "XMLHttpRequest",
    };
    const token = csrfToken();
    if (token) headers["X-CSRF-TOKEN"] = token;

    const children = collectNestedChildren(root);
    if (children) payload.children = children;

    try {
      const res = await fetch(UPDATE_PATH, {
        method: "POST",
        headers,
        credentials: "same-origin",
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || ("Wire update failed: " + res.status));
      }
      const data = await res.json();
      const tmp = document.createElement("template");
      tmp.innerHTML = data.html.trim();
      const next = tmp.content.firstElementChild;
      if (!next) throw new Error("Empty Live response.");
      morph(root, next);
      applyEffects(data.effects);
      bindPoll(root);
    } finally {
      setLoading(root, false);
    }
  }

  function collectModelUpdates(root) {
    const updates = {};
    for (const el of root.querySelectorAll("input, textarea, select")) {
      if (rootOf(el) !== root) continue;
      const binding = modelBinding(el);
      if (!binding || !binding.key) continue;
      updates[binding.key] = modelValue(el);
    }
    return updates;
  }

  function sendModel(root, key, value) {
    const snapshot = readSnapshot(root);
    const name = root.getAttribute("data-live");
    return requestUpdate(root, {
      name,
      snapshot,
      updates: { [key]: value },
    });
  }

  function navigateLink(el) {
    if (!(el instanceof HTMLAnchorElement)) return null;
    if (el.hasAttribute("live:navigate") || el.hasAttribute("data-navigate")) return el;
    if (el.hasAttribute("live:navigate.hover") || el.hasAttribute("data-navigate.hover")) return el;
    return null;
  }

  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const nav = navigateLink(target.closest("a"));
    if (nav && nav.href) {
      const url = new URL(nav.href, window.location.href);
      if (url.origin === window.location.origin && !event.metaKey && !event.ctrlKey && !event.shiftKey && nav.target !== "_blank") {
        event.preventDefault();
        navigateTo(url.pathname + url.search + url.hash).catch((err) => console.error(err));
        return;
      }
    }

    const actionEl = target.closest("[data-action], [live\\\\:click]");
    if (!actionEl) return;
    const root = rootOf(actionEl);
    if (!root) return;
    event.preventDefault();
    const rawAction = actionFrom(actionEl);
    if (!rawAction) return;
    const parsed = parseAction(rawAction);
    let params = parsed.params;
    const paramsAttr = actionEl.getAttribute("data-params") || actionEl.getAttribute("live:params");
    if (paramsAttr) {
      try {
        params = JSON.parse(paramsAttr);
      } catch {
        /* keep parsed params */
      }
    }
    const snapshot = readSnapshot(root);
    const name = root.getAttribute("data-live");
    requestUpdate(root, {
      name,
      snapshot,
      updates: collectModelUpdates(root),
      calls: [{ method: parsed.method, params }],
    }).catch((err) => console.error(err));
  });

  document.addEventListener("submit", (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    const action = form.getAttribute("live:submit") || form.getAttribute("data-submit");
    if (!action) return;
    const root = rootOf(form);
    if (!root) return;
    event.preventDefault();
    const parsed = parseAction(action);
    requestUpdate(root, {
      name: root.getAttribute("data-live"),
      snapshot: readSnapshot(root),
      updates: collectModelUpdates(root),
      calls: [{ method: parsed.method, params: parsed.params }],
    }).catch((err) => console.error(err));
  });

  document.addEventListener("mouseover", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const nav = navigateLink(target.closest("a"));
    if (!nav || !(nav instanceof HTMLAnchorElement) || !nav.href) return;
    const url = new URL(nav.href, window.location.href);
    if (url.origin !== window.location.origin) return;
    const href = url.pathname + url.search + url.hash;
    if (!prefetchCache.has(href)) fetchPage(href).catch(() => {});
  }, true);

  window.addEventListener("popstate", () => {
    navigateTo(window.location.pathname + window.location.search + window.location.hash, { push: false }).catch((err) => console.error(err));
  });

  document.addEventListener("input", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement)) {
      return;
    }
    const binding = modelBinding(target);
    if (!binding || !binding.key || binding.lazy || binding.defer) return;
    const root = rootOf(target);
    if (!root) return;
    const value = modelValue(target);

    if (binding.debounce > 0) {
      const prev = debounceTimers.get(target);
      if (prev) clearTimeout(prev);
      debounceTimers.set(
        target,
        setTimeout(() => {
          sendModel(root, binding.key, value).catch((err) => console.error(err));
        }, binding.debounce),
      );
      return;
    }

    sendModel(root, binding.key, value).catch((err) => console.error(err));
  });

  function onLazyCommit(event) {
    const target = event.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement)) {
      return;
    }
    const binding = modelBinding(target);
    if (!binding || !binding.key || !binding.lazy) return;
    const root = rootOf(target);
    if (!root) return;
    sendModel(root, binding.key, modelValue(target)).catch((err) => console.error(err));
  }

  document.addEventListener("change", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement)) {
      return;
    }
    const binding = modelBinding(target);
    if (!binding || !binding.key || binding.defer) return;
    const root = rootOf(target);
    if (!root) return;

    if (binding.lazy) {
      sendModel(root, binding.key, modelValue(target)).catch((err) => console.error(err));
      return;
    }

    if (target.type === "checkbox" || target.tagName === "SELECT") {
      sendModel(root, binding.key, modelValue(target)).catch((err) => console.error(err));
    }
  });

  document.addEventListener("blur", onLazyCommit, true);

  const pollTimers = new WeakMap();

  function pollFrom(root) {
    const nodes = [root, ...root.querySelectorAll("*")];
    for (const node of nodes) {
      for (const name of node.getAttributeNames()) {
        const match = /^(?:live:poll|data-poll)(?:\\.(\\d+)s)?$/.exec(name);
        if (!match) continue;
        const method = (node.getAttribute(name) || "reload").trim() || "reload";
        const seconds = match[1] ? Number(match[1]) : 2;
        return { method, ms: Math.max(1, seconds) * 1000 };
      }
    }
    return null;
  }

  function bindPoll(root) {
    const prev = pollTimers.get(root);
    if (prev) clearInterval(prev);
    const spec = pollFrom(root);
    if (!spec) return;
    const id = setInterval(() => {
      if (!document.contains(root)) {
        clearInterval(id);
        return;
      }
      const snapshot = readSnapshot(root);
      const name = root.getAttribute("data-live");
      requestUpdate(root, {
        name,
        snapshot,
        updates: collectModelUpdates(root),
        calls: [{ method: spec.method, params: [] }],
      }).catch((err) => console.error(err));
    }, spec.ms);
    pollTimers.set(root, id);
  }

  function scanPolls() {
    document.querySelectorAll("[data-live]").forEach(bindPoll);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", scanPolls);
  } else {
    scanPolls();
  }

  function wireApi(root) {
    return {
      get(name) {
        return readSnapshot(root).data[name];
      },
      set(name, value) {
        return sendModel(root, name, value);
      },
      /** Alpine-compatible two-way sync — \`x-data="{ n: $live.entangle('n') }"\`. */
      entangle(name, options) {
        const live = !options || options.live !== false;
        let local = readSnapshot(root).data[name];
        return {
          get() {
            return local;
          },
          set(value) {
            // Keep Alpine local state only — never rewrite data-snapshot
            // (HMAC checksum would break; updates go via sendModel).
            local = value;
            if (live) {
              sendModel(root, name, value).catch((err) => console.error(err));
            }
          },
        };
      },
    };
  }

  function registerAlpine() {
    const Alpine = window.Alpine;
    if (!Alpine || Alpine.__bunyadWire) return;
    Alpine.__bunyadWire = true;
    Alpine.magic("wire", (el) => {
      const root = rootOf(el);
      if (!root) {
        throw new Error("$live requires a Live root ([data-live]).");
      }
      return wireApi(root);
    });
  }

  if (window.Alpine) {
    registerAlpine();
  } else {
    document.addEventListener("alpine:init", registerAlpine);
  }
})();`;
}
