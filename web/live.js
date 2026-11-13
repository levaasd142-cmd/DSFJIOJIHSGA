'use strict';
/* Live activity (3.1): bell with unread badge and dropdown, live toasts, optional chime, LIVE indicator.
   Events arrive over Server-Sent Events (/api/live); the browser reconnects with backoff and, when the
   stream keeps failing, the panel polls /api/live/recent instead. Self-contained: uses only TM.api,
   TM.esc, TM.prefs, TM.go and TM.dialogs (all present since 3.0). */
(() => {
  const T = typeof TM !== 'undefined' ? TM : window.TM;
  if (!T || document.querySelector('.tmx-bell')) return;
  const {esc, api, prefs} = T;
  const MAX_ITEMS = 40, POLL_MS = 20000, TOAST_MS = 6500, MAX_TOASTS = 3;
  const state = {items: [], seen: 0, unread: 0, source: null, mode: 'connecting', failures: 0, timer: 0, poller: 0, opened: false};

  /* ------------------------------------------------------------ chrome */
  const bellIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 21h4"/></svg>';
  const right = document.querySelector('.top-right');
  if (!right) return;
  const live = document.createElement('span');
  live.className = 'tmx-live'; live.dataset.state = 'connecting'; live.setAttribute('role', 'status');
  live.innerHTML = '<i aria-hidden="true"></i><b>LIVE</b>';
  const bell = document.createElement('button');
  bell.type = 'button'; bell.className = 'icon-button tmx-bell'; bell.id = 'tmx-bell';
  bell.setAttribute('aria-haspopup', 'dialog'); bell.setAttribute('aria-expanded', 'false'); bell.setAttribute('aria-controls', 'tmx-feed');
  bell.innerHTML = bellIcon + '<span class="tmx-bell-count" hidden></span>';
  right.prepend(live, bell);

  const feed = document.createElement('section');
  feed.id = 'tmx-feed'; feed.className = 'tmx-feed'; feed.hidden = true;
  feed.setAttribute('role', 'dialog'); feed.setAttribute('aria-label', 'Активность магазина');
  feed.innerHTML = `<div class="tmx-feed-head"><h2>Активность</h2><button type="button" class="subtle" data-tmx-read>Прочитано</button><button type="button" class="close" data-tmx-close aria-label="Закрыть">×</button></div>
    <div class="tmx-feed-tools"><label><input type="checkbox" data-tmx-sound> Звук новых событий</label><span data-tmx-mode></span></div>
    <ul class="tmx-feed-list" aria-live="off"></ul>`;
  document.body.append(feed);
  const toasts = document.createElement('div');
  toasts.className = 'tmx-toasts'; toasts.setAttribute('aria-live', 'polite');
  document.body.append(toasts);
  const syncToasts = T.floatAbove ? T.floatAbove(toasts) : () => {};
  const list = feed.querySelector('.tmx-feed-list');
  const sound = feed.querySelector('[data-tmx-sound]');
  sound.checked = Boolean(prefs.get('live.sound', false));

  /* ------------------------------------------------------------ rendering */
  const ago = ts => T.ago ? T.ago(ts) : new Date(ts * 1000).toLocaleTimeString('ru-RU');
  const modeText = {live: 'В реальном времени', polling: 'Обновление раз в 20 с', connecting: 'Подключение…', offline: 'Нет связи'};
  function setMode(mode) {
    state.mode = mode; live.dataset.state = mode;
    live.title = modeText[mode] || '';
    live.setAttribute('aria-label', 'Лента событий: ' + (modeText[mode] || ''));
    feed.querySelector('[data-tmx-mode]').textContent = modeText[mode] || '';
  }
  function badge() {
    const count = bell.querySelector('.tmx-bell-count'), n = state.unread;
    count.hidden = !n; count.textContent = n > 99 ? '99+' : String(n || '');
    bell.setAttribute('aria-label', n ? `Активность: ${n} новых` : 'Активность магазина');
    bell.title = bell.getAttribute('aria-label');
  }
  const itemHtml = item => `<li><button type="button" class="tmx-feed-item ${item.id > state.seen ? 'unread' : ''}" data-tmx-event="${item.id}">
      <i class="tmx-dot ${esc(item.tone || '')}" aria-hidden="true"></i><span><b>${esc(item.title)}</b><span>${esc(item.text)}</span></span><small>${esc(ago(item.at))}</small></button></li>`;
  function draw() {
    list.innerHTML = state.items.length ? state.items.map(itemHtml).join('')
      : '<li class="tmx-feed-empty">Событий пока нет. Новые оплаты, обращения и остатки появятся здесь сразу.</li>';
    badge();
  }
  function add(items, notify) {
    const known = new Set(state.items.map(i => i.id));
    const fresh = items.filter(i => !known.has(i.id)).sort((a, b) => b.id - a.id);
    if (!fresh.length) return;
    state.items = [...fresh, ...state.items].sort((a, b) => b.id - a.id).slice(0, MAX_ITEMS);
    state.unread += fresh.filter(i => i.id > state.seen).length;
    if (!feed.hidden) markSeen(); else draw();
    if (notify) { fresh.slice(0, MAX_TOASTS).reverse().forEach(toast); if (sound.checked) chime(); }
  }

  /* ------------------------------------------------------------ toasts and chime */
  function toast(item) {
    const box = document.createElement('div');
    box.className = 'tmx-toast'; box.setAttribute('role', 'status'); box.dataset.tmxEvent = item.id;
    box.innerHTML = `<i class="tmx-dot ${esc(item.tone || '')}" aria-hidden="true"></i><div><b>${esc(item.title)}</b><span>${esc(item.text)}</span></div><button type="button" class="close" aria-label="Скрыть">×</button>`;
    const leave = () => { box.classList.add('leaving'); setTimeout(() => { box.remove(); syncToasts(); }, 220); };
    box.querySelector('.close').onclick = event => { event.stopPropagation(); leave(); };
    box.onclick = () => { leave(); open(item); };
    let timer = setTimeout(leave, TOAST_MS);
    box.onmouseenter = () => clearTimeout(timer);
    box.onmouseleave = () => { timer = setTimeout(leave, 2500); };
    toasts.prepend(box);
    while (toasts.children.length > MAX_TOASTS) toasts.lastElementChild.remove();
    syncToasts();
  }
  let audio = null;
  function chime() {
    try {
      audio ||= new (window.AudioContext || window.webkitAudioContext)();
      if (audio.state === 'suspended') audio.resume();
      const now = audio.currentTime, gain = audio.createGain();
      gain.connect(audio.destination);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.12, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.55);
      [[880, 0], [1318.5, 0.11]].forEach(([frequency, delay]) => {
        const osc = audio.createOscillator();
        osc.type = 'sine'; osc.frequency.setValueAtTime(frequency, now + delay);
        osc.connect(gain); osc.start(now + delay); osc.stop(now + 0.6);
      });
    } catch { /* no audio device or blocked: silent */ }
  }
  sound.onchange = () => { prefs.set('live.sound', sound.checked); if (sound.checked) chime(); };

  /* ------------------------------------------------------------ dropdown */
  function place() {
    const rect = bell.getBoundingClientRect();
    feed.style.top = Math.round(rect.bottom + 8) + 'px';
    feed.style.right = Math.max(12, Math.round(window.innerWidth - rect.right)) + 'px';
    feed.style.left = '';
  }
  async function markSeen() {
    const newest = state.items[0]?.id || 0;
    draw();
    if (!newest || newest <= state.seen) { state.unread = 0; badge(); return; }
    state.seen = newest; state.unread = 0; badge();
    try { const r = await api('live/seen', 'POST', {id: newest}); state.unread = r.unread || 0; badge(); } catch { /* retried next time */ }
  }
  function toggle(show = feed.hidden) {
    feed.hidden = !show; bell.setAttribute('aria-expanded', String(show));
    if (show) { place(); draw(); feed.querySelector('.tmx-feed-item, [data-tmx-close]')?.focus(); setTimeout(markSeen, 900); }
  }
  bell.onclick = () => toggle();
  feed.addEventListener('click', event => {
    if (event.target.closest('[data-tmx-close]')) { toggle(false); bell.focus(); return; }
    if (event.target.closest('[data-tmx-read]')) { markSeen(); return; }
    const row = event.target.closest('[data-tmx-event]');
    if (row) { toggle(false); open(state.items.find(i => String(i.id) === row.dataset.tmxEvent)); }
  });
  feed.addEventListener('keydown', event => {
    const rows = [...feed.querySelectorAll('.tmx-feed-item')], index = rows.indexOf(document.activeElement);
    if (event.key === 'Escape') { event.stopPropagation(); toggle(false); bell.focus(); }
    else if (event.key === 'ArrowDown' && rows.length) { event.preventDefault(); rows[Math.min(rows.length - 1, index + 1)].focus(); }
    else if (event.key === 'ArrowUp' && rows.length) { event.preventDefault(); rows[Math.max(0, index - 1)].focus(); }
  });
  document.addEventListener('pointerdown', event => {
    if (!feed.hidden && !feed.contains(event.target) && !bell.contains(event.target)) toggle(false);
  });
  window.addEventListener('resize', () => { if (!feed.hidden) place(); });
  function open(item) {
    if (!item) return;
    const view = (item.link || '').replace(/^#/, '');
    if (view && T.views?.has(view) && (!T.allowed || T.allowed(T.views.get(view)))) T.go?.(view);
    if (item.kind === 'order' && item.order_id && T.can?.('orders.view')) T.dialogs?.showOrder(item.order_id).catch?.(() => {});
    else if (item.kind === 'customer' && item.user_id && T.can?.('customers.view')) T.dialogs?.showCustomer(item.user_id).catch?.(() => {});
  }

  /* ------------------------------------------------------------ transport: SSE, then polling */
  async function loadRecent(notify = false) {
    const data = await api('live/recent?limit=30');
    if (!state.opened) { state.seen = data.seen || 0; state.opened = true; }
    if (notify) add(data.items, true);
    else { state.items = data.items.slice(0, MAX_ITEMS); state.unread = data.unread || 0; draw(); }
  }
  function startPolling() {
    if (state.poller) return;
    setMode('polling');
    state.poller = setInterval(() => { if (!document.hidden) loadRecent(true).catch(() => setMode('offline')); }, POLL_MS);
  }
  function stopPolling() { clearInterval(state.poller); state.poller = 0; }
  function connect() {
    clearTimeout(state.timer);
    if (!('EventSource' in window)) { startPolling(); return; }
    const source = new EventSource('/api/live');
    state.source = source;
    let opened = false;
    source.addEventListener('hello', event => {
      opened = true; state.failures = 0; stopPolling(); setMode('live');
      try { const hello = JSON.parse(event.data); state.unread = Math.max(state.unread, hello.unread || 0); badge(); } catch { /* ignore */ }
    });
    source.addEventListener('live', event => {
      try { add([JSON.parse(event.data)], true); } catch { /* malformed event: skip */ }
    });
    source.onerror = () => {
      // EventSource retries by itself after a dropped stream (retry: 3000); a refused one is CLOSED.
      if (source.readyState !== EventSource.CLOSED) { setMode(opened ? 'connecting' : state.mode); return; }
      source.close();
      state.failures += 1;
      if (state.failures >= 3) startPolling(); else setMode('connecting');
      const delay = Math.min(300000, 2000 * 2 ** Math.min(state.failures, 8)) * (0.8 + Math.random() * 0.4);
      state.timer = setTimeout(connect, delay);
    };
  }
  window.addEventListener('beforeunload', () => state.source?.close());

  const start = async () => {
    try { await loadRecent(); } catch { /* signed out or offline: the stream reports it */ }
    connect();
  };
  if (document.readyState === 'complete') start(); else window.addEventListener('load', start, {once: true});
  setInterval(() => { if (!feed.hidden) draw(); }, 60000); // keep "N мин назад" fresh
  T.live = {open: () => toggle(true), state};
})();
