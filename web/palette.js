'use strict';
/* Command palette (Ctrl+K / ⌘K): jump to a section, find an order by number, a customer by
   Telegram ID or @username, a product by name. Server search is debounced and permission-aware. */
(() => {
  const {$, esc, api, icon, views, allowed, money, orderBadge, debounce, number} = TM;
  const dialog = $('#palette'), input = $('#palette-query'), list = $('#palette-results');
  $('#palette-search-icon').innerHTML = icon('search');
  let items = [], active = 0, request = 0;

  const sectionItems = query => [...views.values()].filter(v => allowed(v) && (v.nav || v.title).toLowerCase().includes(query.toLowerCase()))
    .map(v => ({group: 'Разделы', icon: v.id, title: v.nav || v.title, hint: v.subtitle || '', run: () => TM.go(v.id)}));

  function render() {
    if (!items.length) {
      list.innerHTML = `<p class="palette-empty">${input.value.trim() ? 'Ничего не найдено. Номер заказа — от 3 символов, покупатель — Telegram ID или @username.' : 'Начните вводить…'}</p>`;
      input.removeAttribute('aria-activedescendant');
      return;
    }
    let group = '';
    list.innerHTML = items.map((item, index) => {
      const head = item.group !== group ? `<div class="palette-group" role="presentation">${esc(group = item.group)}</div>` : '';
      return head + `<div class="palette-item ${index === active ? 'active' : ''}" role="option" id="palette-${index}" aria-selected="${index === active}" data-index="${index}">${icon(item.icon, 'palette-icon')}<span><b>${esc(item.title)}</b><small>${item.hintHtml || esc(item.hint)}</small></span>${item.side || ''}</div>`;
    }).join('');
    input.setAttribute('aria-activedescendant', 'palette-' + active);
    list.querySelector('.active')?.scrollIntoView({block: 'nearest'});
  }
  const remote = debounce(async (query, mine) => {
    try {
      const found = await api('search?' + new URLSearchParams({q: query}));
      if (mine !== request) return;
      items = [...sectionItems(query),
        ...found.orders.map(o => ({group: 'Заказы', icon: 'orders', title: `#${o.id.slice(0, 8)} · ${o.title}`, hint: `TG ${o.user_id} · ${money(o.price)}`, side: orderBadge(o), run: () => TM.dialogs.showOrder(o.id)})),
        ...found.customers.map(c => ({group: 'Покупатели', icon: 'customers', title: [c.first_name, c.last_name].filter(Boolean).join(' ') || 'Без имени', hint: `${c.username ? '@' + c.username + ' · ' : ''}TG ${c.user_id} · заказов: ${number(c.orders || 0)}`, run: () => TM.dialogs.showCustomer(c.user_id)})),
        ...found.products.map(p => ({group: 'Товары', icon: 'products', title: p.name, hint: `${p.category} · ${money(p.price)}${p.mode === 'auto' ? ' · в наличии ' + number(p.available) : ''}`,
          run: () => { TM.prefs.set('filters.products', {search: p.name}); TM.go('products').then(() => TM.openProduct?.(p.id)); }}))];
      active = Math.min(active, Math.max(0, items.length - 1));
      render();
    } catch { /* keep local results */ }
  }, 200);
  function update() {
    const query = input.value.trim(), mine = ++request;
    items = sectionItems(query); active = 0; render();
    if (query.length >= 2 || /^\d+$/.test(query)) remote(query, mine);
  }
  function open() {
    if (dialog.open) return;
    input.value = ''; update(); dialog.showModal(); input.focus();
  }
  async function choose(index) {
    const item = items[index];
    if (!item) return;
    dialog.close();
    try { await item.run(); } catch (error) { TM.toast(error.message, 'error'); }
  }
  input.addEventListener('input', update);
  input.addEventListener('keydown', event => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (items.length) { active = (active + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length; render(); }
    } else if (event.key === 'Enter') { event.preventDefault(); choose(active); }
  });
  list.addEventListener('click', event => { const row = event.target.closest('[data-index]'); if (row) choose(Number(row.dataset.index)); });
  list.addEventListener('pointermove', event => {
    const row = event.target.closest('[data-index]');
    if (row && Number(row.dataset.index) !== active) { active = Number(row.dataset.index); render(); }
  });
  $('#palette-open').onclick = open;
  document.addEventListener('keydown', event => {
    // event.code: works on the Russian layout too (Ctrl+Л).
    if ((event.ctrlKey || event.metaKey) && event.code === 'KeyK' ||(event.key === '/' && !event.target.closest('input,textarea,select,[contenteditable]') && !document.querySelector('dialog[open]'))) {
      event.preventDefault();
      if (dialog.open) dialog.close(); else if (!document.querySelector('dialog[open]')) open();
    }
  });
})();
