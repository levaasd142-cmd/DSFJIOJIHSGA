'use strict';
/* Promo codes (3.2): a code credits a fixed amount to the customer's wallet balance.
   Server-side list with uses / credited amount / unique customers, create/edit dialog, activate/deactivate,
   and «Кто использовал» — recent activations of a code. Managers see everything read-only (promo.view);
   owners manage codes (promo.manage). The dialogs are built here, so index.html needs no promo markup. */
(() => {
  const {$, esc, api, number, money, date, empty, toast, table, pager, badge, bindForm, can, prefs, debounce} = TM;
  let filters = {query: '', status: '', page: 1, ...prefs.get('filters.promo', {})};

  const pad = n => String(n).padStart(2, '0');
  /** Unix seconds ↔ <input type=datetime-local> in Moscow time (UTC+3, no DST). */
  const toLocal = ts => { if (!ts) return ''; const d = new Date((ts + 3 * 3600) * 1000); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`; };
  const fromLocal = value => value ? Date.parse(value + ':00Z') / 1000 - 3 * 3600 : null;
  TM.moscowInput = {toLocal, fromLocal};
  const dateTime = ts => ts ? `${date(ts)} ${toLocal(ts).slice(11)}` : '';

  /* ------------------------------------------------------------ dialogs (markup owned by this file) */
  const closeButton = '<button type="button" class="close" data-close aria-label="Закрыть окно">×</button>';
  function dialog(id, html, className = '') {
    let el = document.getElementById(id);
    if (!el) { el = document.createElement('dialog'); el.id = id; document.body.append(el); }
    if (className) el.className = className;
    el.innerHTML = html;
    return el;
  }
  dialog('promo-dialog', `<form id="promo-form">
    <div class="dialog-heading"><div><span class="eyebrow">МАРКЕТИНГ</span><h2 id="promo-dialog-title">Новый промокод</h2></div>${closeButton}</div>
    <input type="hidden" name="id">
    <div class="form-grid"><label>Код<input name="code" required maxlength="32" pattern="[A-Za-z0-9_\\-]{3,32}" placeholder="GIFT5" autocapitalize="characters" spellcheck="false"><small>3–32 символа: латиница, цифры, «_» и «-». Регистр не важен.</small></label>
    <label><span id="promo-amount-label">Сумма на баланс</span><input name="amount" type="number" required min="0.01" step="0.01" max="10000"><small>Зачисляется покупателю при активации, не больше $10 000.</small></label></div>
    <div class="form-grid"><label>Всего активаций<input name="max_uses" type="number" min="0" value="0"><small>0 — без ограничения</small></label>
    <label>На одного покупателя<input name="per_user" type="number" min="1" max="1000" value="1"></label></div>
    <div class="form-grid"><label>Действует с, МСК<input name="starts_at" type="datetime-local"></label><label>Действует до, МСК<input name="ends_at" type="datetime-local"></label></div>
    <label>Заметка для команды<input name="note" maxlength="200" placeholder="Например: для подписчиков канала"></label>
    <label class="checkbox"><input type="checkbox" name="active" checked> Активен сразу после сохранения</label>
    <p class="form-error" role="alert"></p>
    <div class="dialog-actions"><button class="action" type="button" data-close>Отмена</button><button class="primary" type="submit">Сохранить промокод</button></div>
  </form>`);
  const usesDialog = dialog('promo-uses-dialog', '');
  const form = $('#promo-form');

  /* ------------------------------------------------------------ list */
  const amount = p => p.amount_cents != null ? '+' + money(p.amount_cents) : `−${p.legacy_percent}% · старый`;
  function period(p) {
    const now = Date.now() / 1000;
    if (p.amount_cents == null) return badge('Отключён в 3.2', '');
    if (p.ends_at && p.ends_at < now) return badge('Истёк', '');
    if (p.starts_at && p.starts_at > now) return badge('С ' + date(p.starts_at), 'blue');
    if (p.max_uses && p.used >= p.max_uses) return badge('Исчерпан', 'orange');
    return p.active ? badge('Активен', 'green') : badge('Выключен', '');
  }
  const term = p => p.starts_at && p.ends_at ? `${date(p.starts_at)} — ${date(p.ends_at)}` : p.ends_at ? 'до ' + date(p.ends_at) : p.starts_at ? 'с ' + date(p.starts_at) : 'бессрочно';
  const columns = () => [
    {label: 'Код', cell: p => `<b class="mono-code">${esc(p.code)}</b><small>${esc(p.note || '—')}</small>`},
    {label: 'На баланс', className: 'nowrap num', cell: p => `<b>${esc(amount(p))}</b><small>${p.per_user} на покупателя</small>`},
    {label: 'Активаций', className: 'num', cell: p => `${number(p.used)}${p.max_uses ? ' / ' + number(p.max_uses) : ''}<small>${p.max_uses ? 'осталось ' + number(Math.max(0, p.max_uses - p.used)) : 'без лимита'}</small>`},
    {label: 'Начислено', className: 'nowrap num', cell: p => `${money(p.credited_cents || 0)}<small>${number(p.users || 0)} покуп.${p.discount_cents ? ' · скидки до 3.2: ' + money(p.discount_cents) : ''}</small>`},
    {label: 'Срок', cell: p => `${period(p)}<small>${term(p)}</small>`},
    {label: 'Действия', className: 'actions', cell: p => `<div class="row-actions"><button class="action" type="button" data-promo-uses="${p.id}" ${p.used ? '' : 'disabled'}>Кто использовал</button>${
      can('promo.manage') ? `<button class="action" type="button" data-promo-edit="${p.id}">Изменить</button><button class="action" type="button" data-promo-toggle="${p.id}" data-active="${p.active ? 1 : 0}" ${!p.active && p.amount_cents == null ? 'disabled title="Укажите сумму в «Изменить»"' : ''}>${p.active ? 'Выключить' : 'Включить'}</button>` : ''}</div>`},
  ];
  let current = {items: []};
  const load = () => api('promos?' + new URLSearchParams({query: filters.query, status: filters.status, page: String(filters.page)}));
  function list(data) {
    current = data;
    const searching = filters.query || filters.status;
    return (table(columns(), data.items) || empty(searching ? 'Ничего не найдено' : 'Промокодов пока нет',
      searching ? 'Измените поиск или фильтр.' : 'Создайте код с суммой на баланс и расскажите о нём в канале или рассылке.',
      searching ? {label: 'Сбросить фильтры', attrs: 'data-promo-reset'} : can('promo.manage') ? {label: '+ Создать промокод', attrs: 'data-promo-new'} : null)) + pager(data);
  }

  /* ------------------------------------------------------------ create / edit */
  form.elements.code.addEventListener('input', () => { const f = form.elements.code, at = f.selectionStart; f.value = f.value.toUpperCase(); f.setSelectionRange(at, at); });
  function openDialog(p = null) {
    form.reset(); TM.formError(form, null);
    const usd = TM.usdActive(), field = form.elements.amount;
    $('#promo-amount-label').textContent = 'Сумма на баланс, ' + TM.unit();
    field.step = usd ? '0.01' : '1'; field.min = usd ? '0.01' : '1';
    form.elements.id.value = p?.id || '';
    $('#promo-dialog-title').textContent = p ? 'Промокод ' + p.code : 'Новый промокод';
    if (p) {
      for (const key of ['code', 'max_uses', 'per_user', 'note']) form.elements[key].value = p[key] ?? '';
      field.value = p.amount_cents != null ? TM.amountInput(p.amount_cents) : '';
      form.elements.starts_at.value = toLocal(p.starts_at); form.elements.ends_at.value = toLocal(p.ends_at);
      form.elements.active.checked = Boolean(p.active);
    }
    $('#promo-dialog').showModal();
  }
  bindForm(form, async f => {
    const body = {code: f.elements.code.value.trim(), amount: f.elements.amount.value,
      max_uses: Number(f.elements.max_uses.value || 0), per_user: Number(f.elements.per_user.value || 1),
      starts_at: fromLocal(f.elements.starts_at.value), ends_at: fromLocal(f.elements.ends_at.value),
      active: f.elements.active.checked, note: f.elements.note.value};
    const id = f.elements.id.value;
    await api('promos' + (id ? '/' + id : ''), id ? 'PUT' : 'POST', body);
    toast(id ? 'Промокод сохранён' : 'Промокод ' + body.code.toUpperCase() + ' создан', 'success');
    TM.emit('changed');
  });

  /* ------------------------------------------------------------ who used a code */
  const useColumns = [
    {label: 'Покупатель', cell: r => `<b>${esc(r.name || 'ID ' + r.user_id)}</b><small>${r.name ? 'ID ' + r.user_id : ''}</small>`},
    {label: 'Когда', className: 'nowrap', cell: r => esc(dateTime(r.created))},
    {label: 'Сумма', className: 'nowrap num', cell: r => r.kind === 'credit' ? `<b class="positive">+${money(r.amount_cents)}</b><small>на баланс</small>` : `${money(r.amount_cents)}<small>скидка в заказе ${esc(String(r.order_id || '').slice(0, 8))}</small>`},
  ];
  async function openUses(id, page = 1) {
    const data = await api(`promos/${id}/redemptions?page=${page}`);
    usesDialog.innerHTML = `<div class="dialog-heading"><div><span class="eyebrow">ПРОМОКОД</span><h2>${esc(data.code)} · кто использовал</h2></div>${closeButton}</div>
      ${table(useColumns, data.items) || empty('Активаций пока нет', 'Здесь появятся покупатели, которые ввели этот код.')}${pager(data, `data-uses-id="${id}"`)}
      <div class="dialog-actions"><button class="action" type="button" data-close>Закрыть</button></div>`;
    if (!usesDialog.open) usesDialog.showModal();
  }
  usesDialog.addEventListener('click', async event => {
    const b = event.target.closest('button[data-page][data-uses-id]');
    if (!b) return;
    try { await openUses(Number(b.dataset.usesId), Number(b.dataset.page)); } catch (error) { toast(error.message, 'error'); }
  });

  TM.view({
    id: 'promo', perm: ['promo.view', 'promo.manage'], feature: 'promo', title: 'Промокоды', subtitle: 'Коды на пополнение баланса: сумма, лимиты, сроки и кто их активировал.',
    auto: true,
    async render({el}) {
      const data = await load(), totals = data.totals || {uses: 0, credited_cents: 0, users: 0};
      el.innerHTML = `<div class="stats"><article class="stat"><div class="stat-label">Промокодов</div><strong>${number(data.total)}</strong><small>${filters.status === 'active' ? 'только активные' : 'включая выключенные'}</small></article>
          <article class="stat"><div class="stat-label">Активаций</div><strong data-count="${totals.uses}" data-format="number">${number(totals.uses)}</strong><small>все коды, за всё время</small></article>
          <article class="stat accent"><div class="stat-label">Начислено по промокодам</div><strong>${money(totals.credited_cents)}</strong><small>на балансы, не выручка</small></article>
          <article class="stat"><div class="stat-label">Покупателей</div><strong>${number(totals.users)}</strong><small>получили хотя бы один код</small></article></div>
        <section class="panel"><div class="toolbar"><input id="promo-search" type="search" placeholder="Поиск по коду" aria-label="Поиск промокодов" value="${esc(filters.query)}">
          <div class="segmented" role="group" aria-label="Фильтр"><button type="button" data-promo-status="">Все</button><button type="button" data-promo-status="active">Активные</button></div>
          ${can('promo.manage') ? '<button class="primary toolbar-end" type="button" data-promo-new>+ Создать промокод</button>' : '<span class="muted toolbar-end">Только просмотр</span>'}</div>
          <div id="promo-table">${list(data)}</div></section>`;
      const target = el.querySelector('#promo-table');
      const sync = () => el.querySelectorAll('[data-promo-status]').forEach(b => { const on = b.dataset.promoStatus === filters.status; b.classList.toggle('active', on); b.setAttribute('aria-pressed', String(on)); });
      const redraw = async () => { prefs.set('filters.promo', {query: filters.query, status: filters.status}); sync(); try { target.innerHTML = list(await load()); } catch (e) { toast(e.message, 'error'); } };
      sync();
      el.querySelector('#promo-search').oninput = debounce(event => { filters.query = event.target.value; filters.page = 1; redraw(); }, 300);
      el.addEventListener('click', async event => {
        const b = event.target.closest('button');
        if (!b) return;
        try {
          if ('promoNew' in b.dataset) openDialog();
          else if ('promoStatus' in b.dataset) { filters.status = b.dataset.promoStatus; filters.page = 1; redraw(); }
          else if ('promoReset' in b.dataset) { filters = {query: '', status: '', page: 1}; el.querySelector('#promo-search').value = ''; redraw(); }
          else if (b.dataset.page) { filters.page = Number(b.dataset.page); redraw(); }
          else if (b.dataset.promoUses) await openUses(Number(b.dataset.promoUses));
          else if (b.dataset.promoEdit) openDialog(current.items.find(p => p.id === Number(b.dataset.promoEdit)));
          else if (b.dataset.promoToggle) {
            b.disabled = true;
            const active = b.dataset.active !== '1';
            await api(`promos/${b.dataset.promoToggle}/active`, 'POST', {active});
            toast(active ? 'Промокод включён' : 'Промокод выключен', 'success');
            redraw();
          }
        } catch (error) { toast(error.message, 'error'); b.disabled = false; }
      });
    },
  });
})();
