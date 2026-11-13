'use strict';
/* Audit log and errors (server-side filtered). The errors view also lists open payment issues. */
(() => {
  const {esc, api, state, number, date, money, prefs, table, empty, pager, toast, download, prompt, badge} = TM;
  const pages = {audit: 1, errors: 1};
  let timer;

  function params(id, root) {
    const value = name => root.querySelector(`[data-filter="${name}"]`).value;
    const p = new URLSearchParams({query: value('query'), category: value('category'), level: value('level') || (id === 'errors' ? 'error' : '')});
    for (const key of ['after', 'before']) {
      if (!value(key)) continue;
      const day = new Date(value(key) + 'T00:00:00');
      if (key === 'before') day.setDate(day.getDate() + 1);
      p.set(key, String(day.getTime() / 1000));
    }
    return p;
  }
  const columns = [
    {label: 'Время / уровень', cell: e => `${date(e.at)}<small>${badge(TM.events.levels[e.level] || e.level, e.level === 'error' ? 'red' : e.level === 'warning' ? 'orange' : '')}</small>`},
    {label: 'Событие', cell: e => TM.events.entry(e)},
    {label: 'Кто / раздел', cell: e => `${esc(e.actor)}<small>${esc(TM.events.categories[e.category] || e.category)}</small>`},
    {label: 'Перейти', className: 'actions', cell: e => `<div class="row-actions">${e.order_id ? `<button class="action" type="button" data-order="${esc(e.order_id)}">Заказ</button>` : ''}${e.user_id ? `<button class="action" type="button" data-customer="${esc(e.user_id)}">TG ${esc(e.user_id)}</button>` : ''}</div>`},
  ];
  async function events(id, root) {
    const p = params(id, root);
    p.set('page', String(pages[id]));
    const data = await api('events?' + p);
    pages[id] = data.page;
    return (table(columns, data.items) || empty('Событий не найдено', 'Измените фильтры. Новые события появятся автоматически.')) + pager(data);
  }

  /* ------------------------------------------------------------ payment issues (store contract item 4) */
  const issueKinds = {order: 'Оплата заказа', stars_order: 'Оплата заказа Stars', topup: 'Пополнение Stars', stars_topup: 'Пополнение Stars', wallet: 'Оплата с баланса'};
  const issueAmount = i => i.currency === 'XTR' || i.currency === 'Stars' ? number(i.amount) + ' Stars' : i.currency === 'USD' ? TM.usd(i.amount) : i.amount != null ? money(i.amount) : '—';
  async function issues() {
    if (!state.features?.payment_issues) return '';
    const data = await api('payment-issues');
    if (!data.items.length) return `<section class="panel issues-panel"><div class="panel-heading"><div><h2>Проблемные платежи</h2><p>Несовпадающих оплат нет.</p></div>${badge('Всё в порядке', 'green')}</div></section>`;
    return `<section class="panel issues-panel attention"><div class="panel-heading"><div><h2>Проблемные платежи · ${number(data.items.length)}</h2><p>Платёж получен, но не совпал с заказом или пополнением. Проверьте его в Telegram и отметьте решение.</p></div></div>${table([
      {label: 'Когда', cell: i => `${date(i.created)}<small>${esc(issueKinds[i.kind] || i.kind || 'Платёж')}</small>`},
      {label: 'Покупатель', cell: i => i.user_id ? `<button class="subtle" type="button" data-customer="${esc(i.user_id)}">TG ${esc(i.user_id)}</button>` : '—'},
      {label: 'Сумма', className: 'nowrap', cell: issueAmount},
      {label: 'Что случилось', cell: i => `${esc(i.detail || 'Не указано')}${i.charge ? `<small class="payment-reference" title="${esc(i.charge)}">${esc(i.charge)}</small>` : ''}`},
      {label: 'Действия', className: 'actions', cell: i => `<button class="action" type="button" data-resolve-issue="${esc(i.id)}">Отметить решённым</button>`},
    ], data.items)}</section>`;
  }

  function define(id, title, subtitle) {
    TM.view({
      id, perm: ['audit'], title, nav: id === 'audit' ? 'Действия в магазине' : 'Ошибки', subtitle, auto: true,
      badge: id === 'errors' ? () => state.payment_issues || 0 : undefined, alertBadge: id === 'errors',
      async render({el}) {
        const f = {query: '', category: '', level: '', after: '', before: '', ...prefs.get('filters.' + id, {})};
        el.innerHTML = `<div id="issues-slot"></div><section class="panel"><div class="toolbar">
          <input data-filter="query" type="search" placeholder="Товар, покупатель, заказ или сотрудник" aria-label="Поиск событий">
          <select data-filter="category" aria-label="Раздел"><option value="">Все разделы</option>${Object.entries(TM.events.categories).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
          <select data-filter="level" aria-label="Уровень">${id === 'errors' ? '' : '<option value="">Все уровни</option>'}${Object.entries(TM.events.levels).filter(([k]) => id !== 'errors' || k !== 'info').map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
          <label class="date-filter">С даты<input data-filter="after" type="date"></label><label class="date-filter">По дату<input data-filter="before" type="date"></label>
          <button class="action" type="button" data-export>Экспорт CSV</button></div><div class="event-table"></div></section>`;
        for (const input of el.querySelectorAll('[data-filter]')) input.value = f[input.dataset.filter] ?? '';
        if (id === 'errors' && !f.level) el.querySelector('[data-filter="level"]').value = 'error';
        const [list, issueHtml] = await Promise.all([events(id, el), id === 'errors' ? issues() : '']);
        el.querySelector('.event-table').innerHTML = list;
        el.querySelector('#issues-slot').innerHTML = issueHtml;
        const reload = async () => {
          try { el.querySelector('.event-table').innerHTML = await events(id, el); } catch (error) { toast(error.message, 'error'); }
        };
        for (const input of el.querySelectorAll('[data-filter]')) {
          input.oninput = input.onchange = () => {
            prefs.set('filters.' + id, Object.fromEntries([...el.querySelectorAll('[data-filter]')].map(i => [i.dataset.filter, i.value])));
            pages[id] = 1; clearTimeout(timer); timer = setTimeout(reload, 250);
          };
        }
        el.addEventListener('click', async event => {
          const b = event.target.closest('button');
          if (!b) return;
          try {
            if (b.dataset.page) { pages[id] = Number(b.dataset.page); await reload(); }
            else if ('export' in b.dataset) { b.disabled = true; await download('events/export?' + params(id, el), 'GET', 'themarket-events.csv'); }
            else if (b.dataset.resolveIssue) {
              const note = await prompt({title: 'Платёж разобран?', text: 'Опишите, что сделано: возврат, ручная выдача или ошибка не подтвердилась.', ok: 'Отметить решённым', input: {label: 'Решение', maxlength: 300}});
              if (!note) return;
              b.disabled = true;
              await api('payment-issues/' + encodeURIComponent(b.dataset.resolveIssue) + '/resolve', 'POST', {note});
              toast('Платёж отмечен как решённый', 'success'); TM.emit('changed');
            }
          } catch (error) { toast(error.message, 'error'); } finally { b.disabled = false; }
        });
      },
      async refresh(root) {
        if (!root) return;
        const [list, issueHtml] = await Promise.all([events(id, root), id === 'errors' ? issues() : '']);
        root.querySelector('.event-table').innerHTML = list;
        root.querySelector('#issues-slot').innerHTML = issueHtml;
      },
    });
  }
  define('audit', 'Действия в магазине', 'Покупки, платежи, доставка и изменения настроек. Фильтры ищут по всей истории.');
  define('errors', 'Ошибки и предупреждения', 'Проблемные платежи, сбои доставки и работы бота. Фильтры ищут по всей истории.');
})();
