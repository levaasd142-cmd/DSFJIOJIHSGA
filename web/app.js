'use strict';
/* Shell: navigation (filtered by the staff member's permissions), routing (#hash), theme, state
   polling and safe auto-refresh. Data views refresh every 30 s while visible; screens with forms
   never re-render on their own. Unchanged data comes back as 304 (ETag), so polling is cheap.
   Motion: route changes run in a View Transition (CSS fallback), the sidebar has a sliding active
   indicator and an icons-only mode, the mobile drawer closes with a swipe, the theme switch reveals
   the new theme in a circle from the button. Emits 'view:rendered' {id, root, first} and 'state' {state}. */
(() => {
  const {$, $$, esc, api, state, views, icon, banner, prefs, time, allowed, reducedMotion} = TM;
  const REFRESH_MS = 30000;
  const groups = [['Магазин', ['overview', 'tasks', 'orders', 'products', 'customers', 'support']],
    ['Маркетинг', ['promo', 'broadcasts']],
    ['Финансы', ['analytics', 'payments', 'currency']],
    ['Управление', ['bot-settings', 'notifications', 'staff', 'audit', 'errors', 'backups']]];
  let current = '', token = 0, lastRefresh = 0, refreshing = null, booted = false;
  const mobile = () => window.innerWidth <= 760;

  /* ------------------------------------------------------------ static chrome */
  $('#brand-mark').innerHTML = icon('brand', '');
  $('#refresh').innerHTML = icon('refresh', '');
  $('#sidebar-toggle').innerHTML = icon('menu', 'menu-icon') + icon('sidebar', 'collapse-icon');
  $('#logout').innerHTML = icon('logout');
  $('#palette-icon').innerHTML = icon('search');
  $('#shortcuts-open').innerHTML = icon('keyboard', '');

  /** Groups with their visible view ids. Views registered by other files (not listed above) join the
      group named by their `group` field (a new group if needed), or «Управление». */
  function navGroups() {
    const result = groups.map(([title, ids]) => [title, [...ids]]);
    const listed = new Set(result.flatMap(([, ids]) => ids));
    for (const v of views.values()) {
      if (listed.has(v.id)) continue;
      let group = result.find(([title]) => title === (v.group || 'Управление'));
      if (!group) result.push(group = [v.group, []]);
      const after = v.after && group[1].indexOf(v.after);
      if (after >= 0) group[1].splice(after + 1, 0, v.id); else group[1].push(v.id);
    }
    return result.map(([title, ids]) => [title, ids.filter(id => views.has(id) && allowed(views.get(id)))]);
  }
  function buildNav() {
    $('#nav').innerHTML = navGroups().map(([title, items]) => {
      if (!items.length) return '';
      return `<div class="nav-group-title"><span>${esc(title)}</span></div>` + items.map(id => {
        const v = views.get(id);
        return `<button type="button" data-view="${id}" title="${esc(v.nav || v.title)}">${icon(id, 'nav-icon')}<span>${esc(v.nav || v.title)}</span><small class="nav-badge" hidden></small></button>`;
      }).join('');
    }).join('') + '<span class="nav-indicator" aria-hidden="true"></span>';
    for (const b of $$('#nav [data-view]')) {
      b.classList.toggle('selected', b.dataset.view === current);
      if (b.dataset.view === current) b.setAttribute('aria-current', 'page');
    }
    moveIndicator(true);
  }
  /** The active pill is one element that slides between items (transform only). */
  function moveIndicator(instant = false) {
    const pill = $('#nav .nav-indicator'), button = $('#nav button.selected');
    if (!pill) return;
    pill.classList.toggle('on', Boolean(button));
    if (!button) return;
    if (instant) pill.classList.add('instant');
    pill.style.height = button.offsetHeight + 'px';
    pill.style.transform = `translateY(${button.offsetTop}px)`;
    if (instant) { void pill.offsetWidth; pill.classList.remove('instant'); }
  }
  TM.navBadges = () => navBadges();
  TM.on('view:registered', () => { if (state.loaded) navBadges(); });
  let navKey = '';
  function navBadges() {
    const key = (state.me.permissions || []).join(',') + JSON.stringify(state.features) + views.size;
    if (key !== navKey) { navKey = key; buildNav(); }
    for (const button of $$('#nav [data-view]')) {
      const v = views.get(button.dataset.view), count = v.badge ? v.badge() : 0, small = button.querySelector('.nav-badge');
      const text = count > 999 ? '999+' : count ? String(count) : '';
      const before = small.textContent;
      small.hidden = !count; small.textContent = text;
      small.classList.toggle('alert', Boolean(v.alertBadge && count));
      button.classList.toggle('has-badge', Boolean(count));
      if (text && before !== text && booted) TM.bump(small);
    }
  }

  /* ------------------------------------------------------------ theme: system by default, explicit choice remembered */
  const media = matchMedia('(prefers-color-scheme: light)');
  const effectiveTheme = () => document.documentElement.dataset.theme || (media.matches ? 'light' : 'dark');
  function syncThemeButton() {
    const next = effectiveTheme() === 'dark' ? 'light' : 'dark';
    const button = $('#theme-toggle');
    button.innerHTML = icon(next === 'light' ? 'sun' : 'moon', 'theme-icon');
    button.title = next === 'light' ? 'Светлая тема' : 'Тёмная тема';
    button.setAttribute('aria-label', 'Включить ' + (next === 'light' ? 'светлую' : 'тёмную') + ' тему');
  }
  /** Switch the theme; with View Transitions the new theme grows as a circle from the button. */
  function switchTheme() {
    const next = effectiveTheme() === 'dark' ? 'light' : 'dark';
    const apply = () => {
      document.documentElement.dataset.theme = next;
      prefs.set('theme', next);
      syncThemeButton();
      TM.emit('theme', next);
    };
    const r = $('#theme-toggle').getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
    const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
    TM.transition(apply, {className: 'theme-vt', onStart: vt => vt.ready.then(() => document.documentElement.animate(
      {clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`]},
      {duration: 560, easing: 'cubic-bezier(.32,.72,0,1)', pseudoElement: '::view-transition-new(root)'})).catch(() => {})});
  }
  $('#theme-toggle').onclick = switchTheme;
  media.addEventListener('change', () => { syncThemeButton(); TM.emit('theme', effectiveTheme()); });
  syncThemeButton();

  /* ------------------------------------------------------------ who am I & logout */
  function syncMe() {
    const me = state.me || {};
    $('#actor').textContent = me.username || state.actor || '—';
    $('#me-role').textContent = me.mode === 'basic' ? 'Владелец · вход по паролю браузера' : me.role_label || '';
    $('#me-avatar').textContent = TM.firstChar(me.username || '?').toUpperCase();
    $('#logout').hidden = me.mode === 'basic';
  }
  $('#logout').onclick = async () => {
    if (TM.isDirty() && !await TM.confirm({title: 'Выйти без сохранения?', text: 'Введённые данные пропадут.', ok: 'Выйти', danger: true})) return;
    try { await api('logout', 'POST'); } catch { /* the session may already be gone */ }
    location.replace('/login');
  };

  /* ------------------------------------------------------------ sidebar: drawer on phones, icons-only mode on desktop */
  const toggle = $('#sidebar-toggle'), sidebar = $('#sidebar'), scrim = $('#scrim');
  function syncSidebar() {
    const phone = mobile(), closed = !document.body.classList.contains('nav-open');
    sidebar.inert = phone && closed;
    $('#main').inert = phone && !closed;
    if (phone) sidebar.setAttribute('aria-hidden', String(closed)); else sidebar.removeAttribute('aria-hidden');
    const collapsed = document.body.classList.contains('nav-collapsed');
    toggle.setAttribute('aria-label', phone ? 'Открыть меню' : collapsed ? 'Развернуть боковое меню' : 'Свернуть боковое меню');
    toggle.title = phone ? 'Меню' : (collapsed ? 'Развернуть меню' : 'Свернуть меню') + ' ( [ )';
    toggle.setAttribute('aria-expanded', String(phone ? !closed : !collapsed));
  }
  function closeSidebar() {
    document.body.classList.remove('nav-open'); syncSidebar();
  }
  function setCollapsed(collapsed) {
    if (mobile() || collapsed === document.body.classList.contains('nav-collapsed')) return;
    TM.transition(() => {
      document.body.classList.toggle('nav-collapsed', collapsed);
      syncSidebar(); moveIndicator(true);
    }, {className: 'collapse-vt'});
    prefs.set('nav.collapsed', collapsed);
    TM.emit('nav:collapsed', collapsed);
  }
  document.body.classList.toggle('nav-collapsed', Boolean(prefs.get('nav.collapsed', false)));
  toggle.onclick = () => {
    if (!mobile()) { setCollapsed(!document.body.classList.contains('nav-collapsed')); return; }
    const open = document.body.classList.toggle('nav-open');
    syncSidebar();
    if (open) $('#nav button.selected')?.focus({preventScroll: true});
  };
  scrim.onclick = closeSidebar;
  let wasMobile = mobile();
  window.addEventListener('resize', () => {
    syncSidebar();
    if (wasMobile !== mobile()) { wasMobile = mobile(); closeSidebar(); requestAnimationFrame(() => moveIndicator(true)); }
  });
  syncSidebar();
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && document.body.classList.contains('nav-open')) { closeSidebar(); toggle.focus(); }
  });
  // Swipe the open drawer to the left to close it. Vertical scrolling of the nav stays native (touch-action: pan-y).
  (() => {
    let startX = 0, startY = 0, startT = 0, dx = 0, axis = '', width = 1;
    sidebar.addEventListener('touchstart', event => {
      if (!mobile() || !document.body.classList.contains('nav-open') || event.touches.length !== 1) { axis = 'none'; return; }
      const t = event.touches[0];
      startX = t.clientX; startY = t.clientY; startT = performance.now(); dx = 0; axis = ''; width = sidebar.offsetWidth || 1;
    }, {passive: true});
    sidebar.addEventListener('touchmove', event => {
      if (axis === 'none' || axis === 'y') return;
      const t = event.touches[0], mx = t.clientX - startX, my = t.clientY - startY;
      if (!axis) {
        if (Math.abs(mx) < 8 && Math.abs(my) < 8) return;
        axis = Math.abs(mx) > Math.abs(my) ? 'x' : 'y';
        if (axis === 'y') return;
        document.body.classList.add('nav-dragging');
      }
      dx = Math.min(0, mx);
      sidebar.style.transform = `translate3d(${dx}px,0,0)`;
      scrim.style.opacity = String(Math.max(0, 1 + dx / width));
    }, {passive: true});
    const end = () => {
      if (axis !== 'x') { axis = ''; return; }
      axis = '';
      const velocity = dx / Math.max(1, performance.now() - startT);
      document.body.classList.remove('nav-dragging');
      sidebar.style.transform = ''; scrim.style.opacity = '';
      if (dx < -width * 0.33 || velocity < -0.45) closeSidebar();
    };
    sidebar.addEventListener('touchend', end);
    sidebar.addEventListener('touchcancel', end);
  })();

  /* ------------------------------------------------------------ routing */
  const order = () => navGroups().flatMap(([, ids]) => ids);
  const firstAllowed = () => order()[0] || 'overview';
  const usable = id => views.has(id) && allowed(views.get(id));
  const initial = () => {
    const hash = location.hash.slice(1);
    if (usable(hash)) return hash;
    const saved = prefs.get('view', 'overview');
    return usable(saved) ? saved : firstAllowed();
  };
  async function leaveAllowed() {
    if (!TM.isDirty()) return true;
    return TM.confirm({title: 'Есть несохранённые изменения', text: 'Если уйти с этой страницы, введённые данные пропадут.', ok: 'Уйти без сохранения', danger: true});
  }
  async function go(id) {
    if (!usable(id)) id = firstAllowed();
    if (id !== current && !await leaveAllowed()) {
      if (location.hash.slice(1) !== current) history.replaceState(null, '', '#' + current);
      return;
    }
    if (location.hash.slice(1) !== id) history.pushState(null, '', '#' + id);
    await show(id, false);
  }
  TM.go = go;
  TM.current = () => current;

  function snapshot() {
    return {scroll: window.scrollY, open: $$('#view details[data-key]').filter(d => d.open).map(d => d.dataset.key)};
  }
  function restore(saved) {
    for (const d of $$('#view details[data-key]')) d.open = saved.open.includes(d.dataset.key);
    window.scrollTo(0, saved.scroll);
  }

  /** Render a view into a detached node and swap it in once its data has arrived (no flicker).
      A route change swaps the page heading and a skeleton in a View Transition; the real content then
      enters with a short staggered rise. Refresh re-renders (keep=true) swap silently. */
  async function show(id, keep) {
    const v = views.get(id), mine = ++token, changed = id !== current, saved = keep ? snapshot() : null, first = !keep;
    if (changed) views.get(current)?.leave?.();
    current = id; prefs.set('view', id);
    let swapped = Promise.resolve();
    if (changed) {
      banner('');
      const update = () => {
        document.body.dataset.screen = id;
        $('#page-title').textContent = v.title;
        $('#page-subtitle').textContent = v.subtitle || '';
        $('#breadcrumb').textContent = v.nav || v.title;
        document.title = (v.nav || v.title) + ' · TheMarket';
        $('#add-product').hidden = !v.addProduct || !TM.can('products.manage');
        for (const b of $$('#nav [data-view]')) {
          b.classList.toggle('selected', b.dataset.view === id);
          if (b.dataset.view === id) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
        }
        moveIndicator(!booted);
        if (mine === token) $('#view').innerHTML = TM.skeleton(v.skeleton || 'table');
        window.scrollTo(0, 0);
      };
      swapped = booted ? TM.transition(update, {className: 'route-vt'}) : (update(), Promise.resolve());
    }
    const next = document.createElement('div');
    next.className = 'view-root';
    const ctx = {el: next, current: () => mine === token, rerender: () => show(id, true)};
    $('#view').setAttribute('aria-busy', 'true');
    try {
      await v.render(ctx);
      await swapped;
      if (!ctx.current()) return;
      if (first && !reducedMotion()) markEnter(next);
      $('#view').replaceChildren(next);
      v.mounted?.(next);
      if (saved) { restore(saved); TM.settle(next); }
      if (first) TM.enhance(next);
      TM.emit('view:rendered', {id, root: next, first});
    } catch (error) {
      await swapped;
      if (!ctx.current()) return;
      if (changed) $('#view').innerHTML = TM.empty('Раздел не загружен', error.message, {label: 'Повторить', attrs: 'data-retry-view'});
      else banner(error.message);
    } finally { if (mine === token) $('#view').setAttribute('aria-busy', 'false'); booted = true; }
  }
  TM.rerender = () => show(current, true);
  /** First render only: the root's blocks, KPI tiles, quick actions and the first table rows rise in
      sequence (CSS reads the index from --n; animations use fill "backwards", so nothing lingers). */
  const STAGGERED = '.stats, .overview-actions, tbody, .ticket-list, .columns > .column, .task-explainer';
  function markEnter(root) {
    root.classList.add('enter');
    for (const box of [root, ...root.querySelectorAll(STAGGERED)]) {
      const children = box.children;
      for (let i = 0; i < children.length; i++) children[i].style.setProperty('--n', Math.min(i, 14));
    }
    // Drop the class once everything has landed, so later in-place updates never replay it.
    setTimeout(() => root.classList.remove('enter'), 1800);
  }

  /* ------------------------------------------------------------ state & refresh */
  async function loadState() {
    const data = await api('state');
    Object.assign(state, data, {loaded: true});
    await TM.loadProducts();
    lastRefresh = Date.now();
    const connection = $('#connection');
    connection.textContent = state.bot_configured ? 'Токен бота настроен' : 'Бот не подключён';
    connection.classList.toggle('warn', !state.bot_configured);
    $('#updated-at').textContent = 'Обновлено ' + time(lastRefresh);
    syncMe();
    navBadges();
    // {state} per the 3.1 contract; the fields are spread too, so `data.payment_issues` also works.
    TM.emit('state', {...state, state});
  }
  /** manual: user pressed refresh. Otherwise only data views refresh, and never over unsaved input. */
  async function refresh(manual = false) {
    if (refreshing) return refreshing;
    const v = views.get(current);
    refreshing = (async () => {
      $('#refresh').disabled = true;
      try {
        await loadState();
        if (!usable(current)) { await go(firstAllowed()); return; }
        if (manual) {
          if (await leaveAllowed()) { $$('#view form[data-dirty]').forEach(f => delete f.dataset.dirty); await show(current, true); }
        } else if (v.refresh) { await v.refresh($('#view .view-root')); TM.settle($('#view .view-root')); TM.emit('view:rendered', {id: current, root: $('#view .view-root'), first: false}); }
        else if (v.auto) await show(current, true);
        banner('');
      } catch (error) {
        banner(error.message);
      } finally { $('#refresh').disabled = false; refreshing = null; }
    })();
    return refreshing;
  }
  TM.refresh = refresh;
  const interactionBusy = () => document.hidden || $('dialog[open]') || TM.isDirty() ||
    ($('#view').contains(document.activeElement) && document.activeElement.matches('input,textarea,select'));
  setInterval(() => {
    if (Date.now() - lastRefresh >= REFRESH_MS && !interactionBusy()) refresh();
  }, 5000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && Date.now() - lastRefresh >= REFRESH_MS && !interactionBusy()) refresh();
  });
  // After a mutation (dialog saved, order claimed…) refresh what is on screen.
  TM.on('changed', async () => {
    try { await loadState(); } catch (error) { banner(error.message); return; }
    const v = views.get(current);
    if (TM.isDirty()) return;
    if (v.refresh) { await v.refresh($('#view .view-root')); TM.settle($('#view .view-root')); TM.emit('view:rendered', {id: current, root: $('#view .view-root'), first: false}); }
    else await show(current, true);
  });

  $('#refresh').onclick = () => refresh(true);
  document.addEventListener('click', event => {
    if (event.target.closest('[data-retry-view]')) { show(current, false); return; }
    const target = event.target.closest('[data-view],[data-go]');
    if (!target) return;
    event.preventDefault();
    if (target.closest('#nav')) closeSidebar();
    go(target.dataset.view || target.dataset.go);
  });
  window.addEventListener('popstate', async () => {
    const id = initial();
    if (id === current) return;
    if (await leaveAllowed()) show(id, false); else history.pushState(null, '', '#' + current);
  });
  window.addEventListener('beforeunload', event => { if (TM.isDirty()) event.preventDefault(); });

  /* ------------------------------------------------------------ keyboard shortcuts & the "?" overlay */
  // Physical keys (event.code), so the shortcuts also work on the Russian layout.
  const jumps = [['KeyO', 'O', 'overview'], ['KeyT', 'T', 'tasks'], ['KeyR', 'R', 'orders'], ['KeyP', 'P', 'products'],
    ['KeyC', 'C', 'customers'], ['KeyS', 'S', 'support'], ['KeyM', 'M', 'promo'], ['KeyB', 'B', 'broadcasts'],
    ['KeyA', 'A', 'analytics'], ['KeyY', 'Y', 'payments'], ['KeyK', 'K', 'currency'], ['KeyG', 'G', 'bot-settings'],
    ['KeyN', 'N', 'notifications'], ['KeyU', 'U', 'staff'], ['KeyL', 'L', 'audit'], ['KeyE', 'E', 'errors'], ['KeyX', 'X', 'backups']];
  const extra = [];
  TM.shortcuts = {
    /** {code: 'KeyI', sequence?: true (= "G, then I"), shift?: bool, keys: ['G', 'I'] (shown), label, run(event)} */
    add(entry) { extra.push(entry); },
  };
  /** keys → <kbd> chips; a sequence ("G, then O") is joined with «затем», a chord with «+». */
  const kbd = (keys, sequence) => keys.map(k => `<kbd>${esc(k)}</kbd>`).join(`<span class="kbd-then">${sequence ? 'затем' : '+'}</span>`);
  function drawShortcuts() {
    const nav = jumps.filter(([, , id]) => usable(id)).map(([, key, id]) => [['G', key], views.get(id).nav || views.get(id).title, true]);
    const general = [[['Ctrl', 'K'], 'Поиск и переход'], [['/'], 'Поиск и переход'], [['?'], 'Эта подсказка'],
      [['['], 'Свернуть или развернуть боковое меню'], [['Shift', 'T'], 'Сменить тему'], [['Shift', 'R'], 'Обновить данные'],
      [['Esc'], 'Закрыть окно или меню']];
    const custom = extra.filter(e => e.label && e.keys).map(e => [e.keys, e.label, Boolean(e.sequence)]);
    const block = (title, rows) => rows.length ? `<section><h3>${esc(title)}</h3><dl>${rows.map(([keys, label, sequence]) =>
      `<div><dt>${esc(label)}</dt><dd>${kbd(keys, sequence)}</dd></div>`).join('')}</dl></section>` : '';
    $('#shortcuts-body').innerHTML = block('Переход по разделам', nav) + block('Общие', general) + block('Дополнительно', custom);
  }
  function openShortcuts() {
    const dialog = $('#shortcuts-dialog');
    if (dialog.open) { dialog.close(); return; }
    if ($('dialog[open]')) return;
    drawShortcuts(); dialog.showModal();
  }
  $('#shortcuts-open').onclick = openShortcuts;
  let leader = 0;
  const typing = target => target.closest?.('input,textarea,select,[contenteditable]:not([contenteditable="false"])');
  document.addEventListener('keydown', event => {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return;
    if (typing(event.target)) return;
    const dialogOpen = $('dialog[open]');
    if (event.key === '?' || (event.code === 'Slash' && event.shiftKey)) {
      if (!dialogOpen || dialogOpen.id === 'shortcuts-dialog') { event.preventDefault(); openShortcuts(); }
      return;
    }
    if (dialogOpen) return;
    const now = performance.now();
    if (leader && now - leader < 1200) {
      leader = 0;
      const jump = jumps.find(([code]) => code === event.code);
      const custom = extra.find(e => e.sequence && e.code === event.code);
      if (jump && usable(jump[2])) { event.preventDefault(); closeSidebar(); go(jump[2]); }
      else if (custom) { event.preventDefault(); custom.run(event); }
      return;
    }
    if (event.code === 'KeyG' && !event.shiftKey) { leader = now; return; }
    if (event.code === 'BracketLeft' && !event.shiftKey) { event.preventDefault(); setCollapsed(!document.body.classList.contains('nav-collapsed')); return; }
    if (event.code === 'KeyT' && event.shiftKey) { event.preventDefault(); switchTheme(); return; }
    if (event.code === 'KeyR' && event.shiftKey) { event.preventDefault(); refresh(true); return; }
    const custom = extra.find(e => !e.sequence && e.code === event.code && Boolean(e.shift) === event.shiftKey);
    if (custom) { event.preventDefault(); custom.run(event); }
  });

  (async () => {
    // Placeholders until /api/state answers: the nav and the last opened view shimmer instead of a blank page.
    $('#nav').innerHTML = '<div class="nav-skeleton" aria-hidden="true">' + '<span class="sk-line"></span>'.repeat(9) + '</div>';
    $('#view').innerHTML = TM.skeleton(views.get(prefs.get('view', 'overview'))?.skeleton || 'table');
    try { await loadState(); } catch (error) { banner(error.message); }
    const id = initial();
    history.replaceState(null, '', '#' + id);
    await show(id, false);
  })();
})();
