'use strict';
/* Shared helpers for every panel view: DOM, formatting, API (with ETag cache), permissions, dialogs,
   tables, skeletons, motion. Views register themselves with TM.view({...}); app.js owns routing and refreshes.

   PUBLIC API (window.TM) — stable for view files and enhancer modules
   ----------------------------------------------------------------------------------------------------
   DOM/format  $(sel, root?) · $$(sel, root?) → Array · esc(v) · number(n) · usd(cents) · money(cents) · unit()
               usdActive() · amountInput(cents) · date(ts) · time(ms) · ago(ts) · firstChar(s) · shortId(id, size?)
   State/perm  state · can(...perms) → bool · prefs.get(key, fallback) / prefs.set(key, value)
   API         api(path, method?, body?) → Promise<json> · upload(path, file) · download(path, method?, name?)
               loadProducts() · saveBlob(blob, name) · csvCell(v) · csvDownload(rows, name) · ApiError
   Feedback    toast(text, tone?: 'info'|'success'|'error') — stacked, auto-dismiss with a progress line,
               paused on hover · banner(text) · formError(form, error) · bindForm(form, action) · isDirty()
               confirm({title, text?, ok?, danger?}) → Promise<bool> · prompt({..., input}) → Promise<string|null>
               cancelled() → Error · floatAbove(el) → sync() — keep a floating layer (toast stack) above open
               modal dialogs (manual popover re-homed into the topmost dialog); call sync() after its children change
   Markup      empty(title, text, action?: {label, attrs}) — empty state with an inline SVG illustration
               badge(text, tone?) · skeleton(kind?: 'table'|'dashboard') · table(columns, rows, rowClass?)
               pager(data, attrs?) · paginate(items, page, size?) · debounce(fn, ms?) · icon(name, cls?)
               iconButton(name, label, attrs, tone?) · orderLabels · attentionStatuses · orderBadge(o) · orderTable(...)
   Views       view({id, title, nav?, subtitle?, perm?, feature?, render(ctx), mounted?(root), refresh?(root),
                     leave?(), auto?, badge?(), alertBadge?, addProduct?, skeleton?, group?, after?}) · views (Map)
               allowed(v). A view not listed in app.js's nav groups appears under `group` (e.g. 'Финансы';
               a new group is created if needed; default 'Управление'), placed after the view id `after`.
               app.js adds: go(id) · current() → id · rerender() · refresh(manual?) · navBadges()
               shortcuts.add({code: 'KeyI', sequence?: true ("G, then I"), shift?: bool, keys: ['G', 'I'], label, run(event)})
   Event bus   on(event, fn) → unsubscribe() · off(event, fn) · once(event, fn) → unsubscribe() · emit(event, data)
               A throwing listener is logged and skipped, so one broken enhancer never breaks the panel.
   Motion      reducedMotion() → bool
               animateCount(el, to, {from?=0, duration?=900, format?: fn(n)→string | 'money'|'number'|'usd'|'percent'})
               stagger(container, {step?=38, max?=14}) — staggered entrance of the container's children
               bump(el) — replay the badge bump (nav badges bump by themselves when their number changes)
               settle(root) — finish one-shot entrance animations inside root (after silent refreshes)
               enhance(root) — run the declarative hooks ([data-count]) inside root; app.js calls it on first render
               transition(update, {className?, onStart?(vt)}) → Promise — run a DOM update inside a View Transition
               when supported (one at a time; className is set on <html> for the transition's duration)
               progress.start() / progress.done() — top progress bar; every api() call drives it already
   CSS utility classes / attributes
               .reveal (fade + slide in when inserted) · .stagger (children enter in sequence) · .lift (hover
               elevation) · .skeleton (shimmer; an empty .skeleton element is a placeholder block)
               [data-count="1234"] (+ optional data-format="money|number|usd|percent": counts up on first render)
               .pulse-dot (live indicator) · .badge-bump (plays a bump when added; TM.bump(el) replays it)
               .glass (frosted surface) · .draw-line on an SVG path with pathLength="1" (stroke draw-in)
   Events      'view:rendered' {id, root, first} — after any view renders (first=false for refresh re-renders)
               'state' {state} — after each /api/state poll (the payload also carries the state fields directly)
               'theme' 'light'|'dark' · 'changed' (data mutated; app.js refreshes) · 'nav:collapsed' bool
               'view:registered' def — a view was registered (late registrations rebuild the nav)
   ---------------------------------------------------------------------------------------------------- */
const TM = (() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));

  /* ------------------------------------------------------------ shared state */
  const state = {products: [], metrics: {}, currency: {}, actor: '', me: {permissions: []}, bot_configured: false,
    payment_issues: 0, support_unread: 0, customers_total: null, features: {}, loaded: false};
  /* Event bus. on() returns an unsubscribe function; a throwing listener is logged and skipped. */
  const listeners = {};
  const off = (name, fn) => { if (listeners[name]) listeners[name] = listeners[name].filter(f => f !== fn); };
  const on = (name, fn) => { (listeners[name] ||= []).push(fn); return () => off(name, fn); };
  const once = (name, fn) => { const stop = on(name, data => { stop(); fn(data); }); return stop; };
  const emit = (name, data) => {
    for (const fn of [...(listeners[name] || [])]) {
      try { fn(data); } catch (error) { console.error('TM listener for "' + name + '" failed:', error); }
    }
  };
  /** True when the signed-in staff member holds any of the permissions. */
  const can = (...names) => names.some(name => (state.me?.permissions || []).includes(name));

  /* ------------------------------------------------------------ formatting */
  const number = n => new Intl.NumberFormat('ru-RU').format(Number(n) || 0);
  const usdActive = () => Boolean(state.currency?.active);
  const usd = cents => cents == null ? '—' : (cents < 0 ? '−' : '') + '$' + (Math.abs(cents) / 100).toFixed(2);
  const money = cents => usdActive() ? usd(Number(cents) || 0) : number(cents) + ' Stars';
  const unit = () => usdActive() ? '$' : 'Stars';
  const amountInput = cents => cents == null ? '' : usdActive() ? (cents / 100).toFixed(2) : String(cents);
  const date = ts => ts ? new Date(ts * 1000).toLocaleString('ru-RU', {day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'}) : '—';
  const time = ts => new Date(ts).toLocaleTimeString('ru-RU', {hour: '2-digit', minute: '2-digit', second: '2-digit'});
  const ago = ts => {
    if (!ts) return '—';
    const seconds = Math.max(0, Date.now() / 1000 - ts);
    if (seconds < 60) return 'только что';
    if (seconds < 3600) return Math.floor(seconds / 60) + ' мин назад';
    if (seconds < 86400) return Math.floor(seconds / 3600) + ' ч назад';
    return date(ts);
  };
  const firstChar = text => Array.from(String(text || '').trim())[0] || '?';
  const shortId = (id, size = 8) => esc(String(id || '').slice(0, size));

  /* ------------------------------------------------------------ preferences */
  const prefs = {
    get(key, fallback) {
      try { const value = JSON.parse(localStorage.getItem('themarket.' + key)); return value ?? fallback; } catch { return fallback; }
    },
    set(key, value) { try { localStorage.setItem('themarket.' + key, JSON.stringify(value)); } catch { /* private mode */ } },
  };

  /* ------------------------------------------------------------ API */
  class ApiError extends Error {
    constructor(message, status = 0, field = null) { super(message); this.status = status; this.field = field; }
  }
  const statusMessages = {
    401: 'Сессия истекла. Войдите снова.',
    403: 'Запрос отклонён: недостаточно прав или панель открыта не по основному адресу.',
    405: 'Запущена старая версия сервера. В окне запуска нажмите «Остановить всё», затем «Запустить всё» и обновите панель.',
    413: 'Слишком большой запрос.',
    429: 'Слишком много неудачных входов. Повторите позже.',
  };
  async function failure(response) {
    let data = {};
    try { data = await response.json(); } catch { /* not JSON */ }
    const detail = typeof data.detail === 'string' ? data.detail : '';
    return new ApiError(detail || statusMessages[response.status] || 'Сервер не выполнил запрос. Повторите попытку.',
      response.status, data.field || null);
  }
  let signedOut = false;
  function sessionEnded() {
    if (signedOut) return;
    signedOut = true;
    // Staff mode: back to the login page. Basic-auth fallback: the browser asks again on reload.
    if (state.me?.mode !== 'basic') location.replace('/login' + location.hash);
  }
  /** GET answers are remembered with their ETag; an unchanged resource comes back as an empty 304. */
  const cache = new Map();
  async function request(path, method = 'GET', body, extraHeaders = {}) {
    const headers = {'X-TheMarket': '1', ...extraHeaders};
    const raw = body instanceof Blob;
    if (body !== undefined && !raw) headers['Content-Type'] = 'application/json';
    const cached = method === 'GET' ? cache.get(path) : null;
    if (cached) headers['If-None-Match'] = cached.etag;
    let response;
    progress.start();
    try {
      response = await fetch('/api/' + path, {method, headers, body: body === undefined ? undefined : raw ? body : JSON.stringify(body), credentials: 'same-origin'});
    } catch {
      throw new ApiError('Нет связи с панелью. Проверьте, что сервер запущен.');
    } finally { progress.done(); }
    if (response.status === 401 && path !== 'login') sessionEnded();
    if (response.status === 405) throw new ApiError(statusMessages[405], 405);
    if (response.status === 304 && cached) return {cached: cached.data};
    if (!response.ok) throw await failure(response);
    return response;
  }
  async function api(path, method = 'GET', body) {
    const response = await request(path, method, body);
    if (response.cached !== undefined) return structuredClone(response.cached);
    let data;
    try { data = await response.json(); } catch { throw new ApiError('Сервер вернул некорректный ответ'); }
    const etag = response.headers.get('ETag');
    if (method === 'GET' && etag) {
      if (cache.size > 80) cache.delete(cache.keys().next().value);
      cache.set(path, {etag, data: structuredClone(data)});
    }
    return data;
  }
  /** Raw upload (e.g. an image): the file is the request body, its type the Content-Type. */
  async function upload(path, file) {
    const response = await request(path, 'POST', file, {'Content-Type': file.type || 'application/octet-stream'});
    return response.json();
  }
  async function loadProducts() {
    if (!can('products.manage', 'orders.view', 'broadcasts', 'promo.view')) { state.products = []; return state.products; }
    state.products = await api('products');
    return state.products;
  }
  function saveBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = filename; link.hidden = true;
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  /** Fetch a file; on error show the server message instead of saving it or navigating away. */
  async function download(path, method = 'GET', fallbackName = 'themarket-file') {
    const response = await request(path, method);
    const disposition = response.headers.get('Content-Disposition') || '';
    const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition);
    saveBlob(await response.blob(), match ? decodeURIComponent(match[1]) : fallbackName);
  }

  /* ------------------------------------------------------------ CSV */
  const csvDangerous = /^[=+\-@\t\r\n ＝＋－＠]/;
  const csvCell = value => {
    if (value == null) return '';
    if (typeof value === 'number') return String(value);
    let text = String(value);
    if (csvDangerous.test(text)) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  };
  function csvDownload(rows, filename) {
    if (rows.length < 2) { toast('Нет данных для экспорта'); return; }
    const text = rows.map(row => row.map(csvCell).join(';')).join('\r\n');
    saveBlob(new Blob(['﻿' + text], {type: 'text/csv;charset=utf-8'}), filename);
  }

  /* ------------------------------------------------------------ floating layers above modal dialogs */
  /* A modal <dialog> lives in the browser's top layer and makes the rest of the page inert, so a toast
     stack with any z-index would stay hidden (and unclickable) under it. A floating layer is a manual
     popover (top layer too): while modal dialogs are open it lives inside the topmost one (drawn above it
     and still interactive), otherwise in <body>; it is shown only while it has children.
     floatAbove(el) registers el and returns sync(), to call after el's children changed. */
  const floating = new Set(), modals = [];
  let layerEpoch = 0;
  function placeFloating(el) {
    if (!el.showPopover) return; // no Popover API: the z-index fallback applies
    const visible = el.childElementCount > 0 && !el.hidden, isOpen = el.matches(':popover-open');
    if (!visible) { if (isOpen) el.hidePopover(); return; }
    const host = modals.findLast(d => d.open && d.isConnected) || document.body;
    if (isOpen && el.parentElement === host && el.dataset.layer === String(layerEpoch)) return;
    // Re-showing replays CSS entrance animations: the items already on screen keep still.
    for (const child of el.children) child.classList.add('settled');
    if (isOpen) el.hidePopover();
    if (el.parentElement !== host) host.append(el);
    el.showPopover(); el.dataset.layer = String(layerEpoch);
  }
  function floatAbove(el) {
    if (!el.hasAttribute('popover') && el.showPopover) el.setAttribute('popover', 'manual');
    floating.add(el);
    return () => placeFloating(el);
  }
  document.addEventListener('toggle', event => {
    const dialog = event.target;
    if (!(dialog instanceof HTMLDialogElement)) return;
    const index = modals.indexOf(dialog);
    if (index >= 0) modals.splice(index, 1);
    if (event.newState === 'open' && dialog.open && dialog.matches(':modal')) modals.push(dialog);
    layerEpoch++;
    floating.forEach(placeFloating);
  }, true);

  /* ------------------------------------------------------------ feedback */
  /* Toast stack: newest at the bottom, at most 4; each slides in, shows a draining progress line and
     dismisses itself (hover or focus pauses the timer). The same text twice in a row just restarts. */
  const toastIcons = {
    success: '<path d="m5 12.5 4.2 4L19 7"/>',
    error: '<path d="M12 7v6M12 17h.01"/>',
    info: '<path d="M12 11v6M12 7.5h.01"/>',
  };
  let syncToasts = null;
  function toast(text, tone = 'info') {
    const box = $('#toast');
    if (!box) return;
    syncToasts ||= floatAbove(box);
    tone = toastIcons[tone] ? tone : 'info';
    const duration = tone === 'error' ? 7000 : 4500;
    const last = box.lastElementChild;
    if (last && !last.classList.contains('leaving') && last.dataset.tone === tone && last.querySelector('.toast-text').textContent === text) {
      last.restart(); bump(last); return;
    }
    const item = document.createElement('div');
    item.className = 'toast'; item.dataset.tone = tone;
    item.setAttribute('role', tone === 'error' ? 'alert' : 'status');
    item.innerHTML = `<span class="toast-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${toastIcons[tone]}</svg></span><span class="toast-text"></span><button type="button" class="toast-close" aria-label="Скрыть уведомление">×</button><span class="toast-progress" aria-hidden="true"></span>`;
    item.querySelector('.toast-text').textContent = text;
    const bar = item.querySelector('.toast-progress');
    let timer = 0, started = 0, left = duration, anim = null;
    const dismiss = () => {
      if (item.classList.contains('leaving')) return;
      clearTimeout(timer); item.classList.add('leaving');
      // FLIP: the remaining toasts glide into the freed space instead of jumping.
      const done = () => {
        if (!item.isConnected) return;
        const others = [...box.children].filter(c => c !== item), before = others.map(c => c.getBoundingClientRect().top);
        item.remove();
        if (!box.children.length) { box.hidden = true; syncToasts(); return; }
        if (reducedMotion()) return;
        others.forEach((c, i) => {
          const dy = before[i] - c.getBoundingClientRect().top;
          if (dy) c.animate([{transform: `translate3d(0, ${dy}px, 0)`}, {transform: 'none'}], {duration: 320, easing: 'cubic-bezier(.22,1,.36,1)'});
        });
      };
      if (reducedMotion()) done(); else { item.addEventListener('animationend', done, {once: true}); setTimeout(done, 400); }
    };
    const run = () => {
      started = performance.now(); clearTimeout(timer); timer = setTimeout(dismiss, left);
      if (!reducedMotion() && bar.animate) {
        anim?.cancel();
        anim = bar.animate([{transform: `scaleX(${left / duration})`}, {transform: 'scaleX(0)'}], {duration: left, easing: 'linear', fill: 'forwards'});
      }
    };
    const pause = () => { clearTimeout(timer); left = Math.max(600, left - (performance.now() - started)); anim?.pause(); };
    item.restart = () => { left = duration; run(); };
    item.addEventListener('pointerenter', pause); item.addEventListener('pointerleave', run);
    item.addEventListener('focusin', pause); item.addEventListener('focusout', run);
    item.querySelector('.toast-close').onclick = dismiss;
    box.hidden = false; box.append(item);
    while (box.children.length > 4) box.firstElementChild.remove();
    syncToasts();
    run();
  }
  function banner(text) {
    const box = $('#error');
    box.textContent = text || ''; box.hidden = !text;
  }
  function formError(form, error) {
    const box = form.querySelector('.form-error');
    if (box) box.textContent = error?.message || '';
    $$('[aria-invalid="true"]', form).forEach(el => el.removeAttribute('aria-invalid'));
    const field = error?.field && form.elements[error.field];
    if (field && field.setAttribute) {
      field.setAttribute('aria-invalid', 'true');
      field.closest('details')?.setAttribute('open', '');
      field.focus();
    }
  }
  /** Submit handler: disables the submit button, shows field errors, clears the dirty flag on success. */
  function bindForm(form, action) {
    form.addEventListener('submit', async event => {
      event.preventDefault();
      const button = form.querySelector('[type="submit"]');
      if (button) button.disabled = true;
      formError(form, null);
      try {
        const keep = await action(form, event);
        delete form.dataset.dirty;
        if (keep !== false && form.closest('dialog')?.open) form.closest('dialog').close();
      } catch (error) {
        if (error?.cancelled) return;
        formError(form, error);
      } finally { if (button) button.disabled = false; }
    });
  }
  const isDirty = () => Boolean($('#view form[data-dirty]'));
  document.addEventListener('input', event => {
    const form = event.target.closest?.('form[data-track]');
    if (form) form.dataset.dirty = '1';
    if (event.target.getAttribute?.('aria-invalid')) event.target.removeAttribute('aria-invalid');
  });

  /* ------------------------------------------------------------ modal dialogs (replace confirm/prompt) */
  function ask({title, text = '', ok = 'Подтвердить', danger = false, input = null}) {
    const dialog = $('#ask-dialog'), form = $('#ask-form');
    form.reset(); formError(form, null);
    $('#ask-title').textContent = title;
    $('#ask-text').textContent = text;
    const label = $('#ask-input-label'), field = form.elements.value;
    label.hidden = !input;
    field.disabled = !input;
    if (input) {
      $('#ask-input-text').textContent = input.label || '';
      field.maxLength = input.maxlength || 300; field.required = input.required !== false; field.value = input.value || '';
    }
    const submit = $('#ask-ok');
    submit.textContent = ok; submit.classList.toggle('danger', danger);
    return new Promise(resolve => {
      let answer = null;
      form.onsubmit = event => {
        event.preventDefault();
        if (input && field.required && !field.value.trim()) { formError(form, {message: 'Заполните поле', field: 'value'}); return; }
        answer = input ? field.value.trim() : true; dialog.close();
      };
      dialog.addEventListener('close', () => resolve(answer), {once: true});
      dialog.showModal();
      (input ? field : submit).focus();
    });
  }
  const confirm = options => ask(options).then(Boolean);
  const prompt = options => ask({...options, input: options.input || {}});
  const cancelled = () => Object.assign(new Error('Действие отменено'), {cancelled: true});

  /* ------------------------------------------------------------ markup helpers */
  /** Empty state: what is missing, why, and (optionally) the one action that fixes it. */
  /* Small inline illustrations (no files: CSP is 'self'); colours come from CSS classes .ei-*. */
  const emptyArt = {
    box: '<path class="ei-fill" d="M14 26 32 17l18 9v20L32 55 14 46z"/><path class="ei-line" d="M14 26 32 35l18-9M32 35v20M14 26l18-9 18 9v20L32 55 14 46zM23 21.5l18 9"/>',
    search: '<circle class="ei-fill" cx="28" cy="28" r="13"/><circle class="ei-line" cx="28" cy="28" r="13"/><path class="ei-line" d="m38 38 11 11M22 28h12"/>',
    inbox: '<path class="ei-fill" d="M12 18h40v24H30l-9 8v-8h-9z"/><path class="ei-line" d="M12 18h40v24H30l-9 8v-8h-9zM20 27h24M20 33h14"/>',
    chart: '<rect class="ei-fill" x="14" y="34" width="8" height="14" rx="2"/><rect class="ei-fill" x="28" y="24" width="8" height="24" rx="2"/><rect class="ei-fill" x="42" y="30" width="8" height="18" rx="2"/><path class="ei-line" d="M10 14v36h44"/><path class="ei-line ei-dash" d="m16 28 13-10 12 6 11-9"/>',
    done: '<circle class="ei-fill" cx="32" cy="32" r="19"/><circle class="ei-line" cx="32" cy="32" r="19"/><path class="ei-line" d="m24 32.5 5.5 5.5L41 26.5"/>',
    error: '<path class="ei-fill" d="M32 13 53 49H11z"/><path class="ei-line" d="M32 13 53 49H11zM32 27v10M32 43h.01"/>',
    people: '<circle class="ei-fill" cx="26" cy="25" r="8"/><path class="ei-fill" d="M12 49a14 14 0 0 1 28 0z"/><path class="ei-line" d="M12 49a14 14 0 0 1 28 0zM34 25a8 8 0 1 1-16 0 8 8 0 0 1 16 0M40 17.5a7 7 0 0 1 0 14M44 37a12 12 0 0 1 8 12"/>',
  };
  const emptyKind = title => {
    const t = String(title).toLowerCase();
    if (/не загруж|ошиб/.test(t)) return 'error';
    if (/не найден|ничего/.test(t)) return 'search';
    if (/пуста|хватает|нет открытых|все выполн/.test(t)) return 'done';
    if (/обращ|сообщ|рассыл/.test(t)) return 'inbox';
    if (/продаж|операц|покупок|событ|платеж|копий/.test(t)) return 'chart';
    if (/покупател|сотрудник/.test(t)) return 'people';
    return 'box';
  };
  const empty = (title, text, action = null) => `<div class="empty"><span class="empty-mark" aria-hidden="true"><svg viewBox="0 0 64 64" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle class="ei-glow" cx="32" cy="34" r="27"/>${emptyArt[emptyKind(title)]}<path class="ei-spark" d="M52 10v6M49 13h6M10 50v4M8 52h4"/></svg></span><strong>${esc(title)}</strong><span>${esc(text)}</span>${
    action ? `<button class="action" type="button" ${action.attrs || ''}>${esc(action.label)}</button>` : ''}</div>`;
  const badge = (text, tone = '') => `<span class="badge ${tone}">${esc(text)}</span>`;
  /** Grey placeholder blocks shown while a view loads. */
  function skeleton(kind = 'table') {
    const line = (w = 4) => `<span class="sk-line w${w}"></span>`;
    const rows = n => Array.from({length: n}, (_, i) => `<div class="sk-row">${line(1 + i % 3)}${line(5)}${line(6)}</div>`).join('');
    if (kind === 'dashboard') {
      const tile = `<div class="sk-card">${line(5)}<span class="sk-big"></span>${line(3)}</div>`;
      return `<div class="skeleton" aria-hidden="true"><div class="stats">${tile.repeat(4)}</div><div class="sk-card sk-chart"></div><div class="sk-card">${rows(5)}</div></div>`;
    }
    return `<div class="skeleton" aria-hidden="true"><div class="sk-card">${line(2)}</div><div class="sk-card">${rows(7)}</div></div>`;
  }
  /** Responsive table: on phones every row becomes a card, cells are labelled via data-label. */
  function table(columns, rows, rowClass = () => '') {
    if (!rows.length) return '';
    return `<div class="table-wrap"><table class="table"><thead><tr>${columns.map(c => `<th class="${c.className || ''}" scope="col">${esc(c.label)}</th>`).join('')}</tr></thead><tbody>${
      rows.map(row => `<tr class="${rowClass(row)}">${columns.map(c => `<td class="${c.className || ''}" data-label="${esc(c.label)}"><div class="cell">${c.cell(row)}</div></td>`).join('')}</tr>`).join('')
    }</tbody></table></div>`;
  }
  function pager(data, attrs = '') {
    if (!data || data.pages <= 1) return data ? `<div class="pager"><span class="muted">Найдено: ${number(data.total)}</span></div>` : '';
    return `<div class="pager"><span class="muted">Найдено: ${number(data.total)} · Страница ${data.page} из ${data.pages}</span><div class="pager-buttons">` +
      `<button class="action" type="button" data-page="${data.page - 1}" ${attrs} ${data.page <= 1 ? 'disabled' : ''}>← Назад</button>` +
      `<button class="action" type="button" data-page="${data.page + 1}" ${attrs} ${data.page >= data.pages ? 'disabled' : ''}>Далее →</button></div></div>`;
  }
  /** Client-side paging of an array already bounded by the server (25 rows per page). */
  function paginate(items, page, size = 25) {
    const pages = Math.max(1, Math.ceil(items.length / size)), current = Math.min(Math.max(1, page || 1), pages);
    return {items: items.slice((current - 1) * size, current * size), total: items.length, page: current, pages};
  }
  const debounce = (fn, ms = 250) => { let timer; return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); }; };

  /* ------------------------------------------------------------ motion (transform/opacity only) */
  const reducedQuery = matchMedia('(prefers-reduced-motion: reduce)');
  const reducedMotion = () => reducedQuery.matches;
  const easeOut = t => 1 - (1 - t) ** 4;
  const formats = {money: v => money(Math.round(v)), usd: v => usd(Math.round(v)), number: v => number(Math.round(v)),
    percent: v => Math.round(v) + '%'};
  /** Count el's text from `from` to `to`; the final text is always exactly format(to). */
  function animateCount(el, to, {from = 0, duration = 900, format = number} = {}) {
    if (!el) return;
    const fmt = typeof format === 'function' ? format : formats[format] || number;
    const target = Number(to) || 0;
    cancelAnimationFrame(el._countFrame);
    if (reducedMotion() || target === from || document.hidden) { el.textContent = fmt(target); return; }
    const start = performance.now();
    const frame = now => {
      const t = Math.min(1, (now - start) / duration);
      el.textContent = fmt(t === 1 ? target : from + (target - from) * easeOut(t));
      if (t < 1) el._countFrame = requestAnimationFrame(frame);
    };
    el._countFrame = requestAnimationFrame(frame);
  }
  /** Staggered entrance of container's children (pure CSS animation; delays via --i). */
  function stagger(container, {step = 38, max = 14} = {}) {
    if (!container || reducedMotion()) return;
    [...container.children].forEach((child, i) => child.style.setProperty('--i', Math.min(i, max)));
    container.style.setProperty('--stagger-step', step + 'ms');
    container.classList.remove('stagger-run'); void container.offsetWidth; container.classList.add('stagger-run');
    const children = container.children.length;
    setTimeout(() => container.classList.remove('stagger-run'), 520 + step * Math.min(children, max));
  }
  /** Jump the one-shot entrance animations (.reveal, .stagger, .empty, chart draw-in…) inside root to
      their end. Used after silent refresh re-renders, so content that did not change does not fade and
      rise again every 30 s. Looping animations (pulse, float, shimmer) are left alone. */
  const ENTRANCES = new Set(['rise', 'row-in', 'pop', 'fade-in', 'bar-grow', 'draw-line', 'tmx-rise', 'tmx-pop']);
  function settle(root) {
    if (!root?.getAnimations) return;
    for (const animation of root.getAnimations({subtree: true})) {
      if (ENTRANCES.has(animation.animationName)) try { animation.finish(); } catch { /* infinite or detached */ }
    }
  }
  /** Replay the bump animation of a badge / counter. */
  function bump(el) {
    if (!el || reducedMotion()) return;
    el.classList.remove('badge-bump'); void el.offsetWidth; el.classList.add('badge-bump');
    el.addEventListener('animationend', () => el.classList.remove('badge-bump'), {once: true});
  }
  /** Declarative hooks inside a freshly rendered root: [data-count] counters. */
  function enhance(root) {
    if (!root) return;
    for (const el of root.querySelectorAll('[data-count]')) {
      if (el.dataset.counted) continue;
      el.dataset.counted = '1';
      const to = Number(el.dataset.count);
      if (Number.isFinite(to)) animateCount(el, to, {format: el.dataset.format || 'number', duration: Number(el.dataset.duration) || 900});
    }
  }
  /** DOM update inside a View Transition when the browser has one; resolves once the update ran.
      Only one transition runs at a time: a new one first finishes the previous one and drops its class
      right away, so two transitions never share html classes (and so never name one element twice).
      onStart(vt) receives the ViewTransition (e.g. to animate its pseudo-elements once vt.ready). */
  let activeTransition = null;
  function transition(update, {className = '', onStart = null} = {}) {
    if (!document.startViewTransition || reducedMotion() || document.hidden) { update(); return Promise.resolve(); }
    const root = document.documentElement;
    if (activeTransition) {
      const previous = activeTransition;
      activeTransition = null;
      if (previous.className) root.classList.remove(previous.className);
      try { previous.vt.skipTransition(); } catch { /* already finished */ }
    }
    if (className) root.classList.add(className);
    let vt;
    try { vt = document.startViewTransition(update); } catch { if (className) root.classList.remove(className); update(); return Promise.resolve(); }
    const entry = activeTransition = {vt, className};
    vt.finished.catch(() => {}).finally(() => {
      if (activeTransition !== entry) return;
      activeTransition = null;
      if (className) root.classList.remove(className);
    });
    vt.ready.catch(() => {});
    try { onStart?.(vt); } catch (error) { console.error(error); }
    return vt.updateCallbackDone.catch(() => {});
  }
  /** Thin progress bar at the top while requests are in flight (appears only after 160 ms). */
  const progress = (() => {
    let active = 0, showTimer = 0, bar = null;
    const el = () => bar ||= document.getElementById('top-progress');
    return {
      start() {
        if (active++ || !el()) return;
        clearTimeout(showTimer);
        showTimer = setTimeout(() => { if (active) { bar.classList.remove('done'); void bar.offsetWidth; bar.classList.add('busy'); } }, 160);
      },
      done() {
        if (!active || --active || !el()) return;
        clearTimeout(showTimer);
        if (bar.classList.contains('busy')) { bar.classList.remove('busy'); bar.classList.add('done'); }
      },
    };
  })();

  /* ------------------------------------------------------------ orders (used by several views) */
  const orderLabels = {pending: 'Ожидает оплаты', expired: 'Истёк', awaiting_details: 'Ждём данные', queued: 'В очереди',
    processing: 'В работе', fulfilled: 'Выполнен', needs_review: 'Нужна проверка'};
  const attentionStatuses = ['awaiting_details', 'queued', 'processing', 'needs_review'];
  const orderTone = status => status === 'fulfilled' ? 'green' : status === 'needs_review' ? 'red' : attentionStatuses.includes(status) ? 'orange' : '';
  const orderBadge = order => badge(orderLabels[order.status] || order.status, orderTone(order.status));
  function orderActions(order) {
    const id = esc(order.id), manage = can('orders.manage');
    return `<div class="row-actions">${(manage && order.status === 'queued' ? `<button class="action" type="button" data-claim="${id}">Взять в работу</button>` : '') +
      (manage && order.status === 'processing' ? `<button class="action" type="button" data-complete="${id}">Выполнить</button>` : '') +
      `<button class="action" type="button" data-order="${id}">Подробнее</button>`}</div>`;
  }
  function orderTable(orders, actions = true, emptyState = null) {
    const columns = [
      {label: 'Заказ / покупатель', cell: o => `<b>#${shortId(o.id)}</b><small>${date(o.created)} · TG ${esc(o.user_id)}</small>`},
      {label: 'Товар', cell: o => `${esc(o.title)} × ${o.quantity || 1}<small>${o.mode === 'auto' ? 'Автовыдача' : 'Через менеджера'}</small>`},
      {label: 'Сумма', className: 'nowrap num', cell: o => money(o.price)},
      {label: 'Статус', cell: orderBadge},
    ];
    if (actions) columns.push({label: 'Действия', className: 'actions', cell: orderActions});
    return table(columns, orders) || emptyState || empty('Заказов пока нет', 'Новые покупки появятся здесь автоматически.');
  }

  /* ------------------------------------------------------------ icons */
  const iconPaths = {
    insights: '<path d="M3 12a9 9 0 1 0 9-9v9z"/><path d="M15 3.5A9 9 0 0 1 20.5 9H15z"/>',
    sidebar: '<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M9.5 4v16M5.8 8h1.2M5.8 11h1.2"/>',
    keyboard: '<rect x="2.5" y="6" width="19" height="12" rx="2.5"/><path d="M6.5 10h.01M10 10h.01M13.5 10h.01M17 10h.01M7.5 14h9"/>',
    overview: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    tasks: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V2h6v2M9 10h6M9 15h6"/>',
    orders: '<path d="M6 3h12l2 4v14l-4-2-4 2-4-2-4 2V7zM8 8h8M8 12h5"/>',
    products: '<path d="m12 3 9 5-9 5-9-5zM3 8v9l9 5 9-5V8M12 13v9M7 5.8l9 5"/>',
    customers: '<circle cx="9" cy="8" r="3"/><path d="M3 21v-2a6 6 0 0 1 12 0v2M16 5a3 3 0 0 1 0 6M21 21v-2a6 6 0 0 0-3-5"/>',
    support: '<path d="M4 5h16v11H9l-5 4z"/><path d="M8 9h8M8 12h5"/>',
    promo: '<path d="M3 9V5h18v4a3 3 0 0 0 0 6v4H3v-4a3 3 0 0 0 0-6z"/><path d="M14 5v14" stroke-dasharray="2 2.5"/>',
    analytics: '<path d="M4 3v17h17M9 15V9M14 15V5M19 15v-4"/>',
    payments: '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="M3 10h18M7 15h3"/>',
    currency: '<path d="M7 7h13l-4-4M17 17H4l4 4M20 7l-4 4M4 17l4-4"/>',
    broadcasts: '<path d="m3 10 17-6v16L3 14zM7 15l2 6h4l-2-5M20 9h2M20 15h2"/>',
    notifications: '<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 21h4"/>',
    'bot-settings': '<path d="M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1z"/><circle cx="12" cy="12" r="3"/>',
    staff: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0M17 4l2 2 3-3"/>',
    audit: '<path d="M8 3h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7zM8 3v4H4M8 12h8M8 16h6"/>',
    errors: '<path d="m10.3 4-8 14a2 2 0 0 0 1.7 3h16a2 2 0 0 0 1.7-3l-8-14a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01"/>',
    backups: '<path d="M4 7h16v14H4zM3 3h18v4H3zM9 11h6M12 11v6m-3-3 3 3 3-3"/>',
    eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    hide: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><path d="m3 3 18 18"/>',
    copy: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',
    trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v6M14 10v6"/>',
    refresh: '<path d="M20 7v5h-5M4 17v-5h5M6 7a7 7 0 0 1 12-2l2 2M4 17l2 2a7 7 0 0 0 12-2"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    brand: '<path d="M5 6h14M12 6v13M5 14V6l7 6 7-6v8"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"/>',
    logout: '<path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10"/>',
    up: '<path d="m6 15 6-6 6 6"/>',
    down: '<path d="m6 9 6 6 6-6"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/>',
    send: '<path d="M4 12 20 4l-6 16-3-7z"/>',
    arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
  };
  const icon = (name, className = 'icon') => `<svg class="${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${iconPaths[name] || ''}</svg>`;
  const iconButton = (name, label, attrs, tone = '') => `<button class="icon-action ${tone}" type="button" title="${esc(label)}" aria-label="${esc(label)}" ${attrs}>${icon(name)}</button>`;

  /* ------------------------------------------------------------ view registry */
  const views = new Map();
  /** def: {id, title, nav, subtitle, perm: [..], feature?, render(ctx) → Promise, auto: bool, refresh?(root), addProduct?: bool, badge?(), skeleton? } */
  const view = def => { views.set(def.id, {auto: false, perm: [], ...def}); emit('view:registered', views.get(def.id)); };
  const allowed = v => (!v.perm.length || can(...v.perm)) && (!v.feature || state.features?.[v.feature]);

  return {$, $$, esc, state, on, off, once, emit, can, number, usd, money, unit, usdActive, amountInput, date, time, ago, firstChar, shortId,
    prefs, ApiError, api, upload, loadProducts, download, saveBlob, csvCell, csvDownload, toast, banner, formError, bindForm, isDirty,
    confirm, prompt, cancelled, floatAbove, empty, badge, skeleton, table, pager, paginate, debounce, orderLabels, attentionStatuses, orderBadge,
    orderTable, icon, iconButton, views, view, allowed, reducedMotion, animateCount, stagger, bump, enhance, settle, transition, progress};
})();
