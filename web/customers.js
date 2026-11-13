'use strict';
/* Customers are paginated and searched on the server; the list refreshes with other data views (30 s). */
(() => {
  const {esc, api, state, number, money, date, prefs, table, empty, pager, download, toast} = TM;
  let page = 1, searchTimer;

  // Balances and spend come only with 'customers.balance'.
  const columns = () => [
    {label: 'Покупатель', cell: c => `${esc([c.first_name, c.last_name].filter(Boolean).join(' ') || 'Без имени')}<small>${c.username ? '@' + esc(c.username) + ' · ' : ''}ID ${esc(c.user_id)}</small>`},
    TM.can('customers.balance') && {label: 'Баланс', className: 'nowrap', cell: c => money(c.balance)},
    {label: 'Заказов', cell: c => number(c.orders)},
    TM.can('customers.balance') && {label: 'Покупки', className: 'nowrap', cell: c => money(c.spent)},
    {label: 'Первый вход / активность', cell: c => `${date(c.first_seen)}<small>Активность: ${date(c.last_seen)}</small>`},
    {label: 'Действия', className: 'actions', cell: c => `<div class="row-actions"><button class="action" type="button" data-customer="${esc(c.user_id)}">История</button>${TM.can('customers.balance') ? `<button class="action" type="button" data-wallet="${esc(c.user_id)}" data-balance="${esc(c.balance)}">Баланс ±</button>` : ''}</div>`},
  ].filter(Boolean);
  const query = () => prefs.get('filters.customers', {}).search || '';
  const list = data => (table(columns(), data.items) || empty('Покупатели не найдены', query() ? 'Никто не подходит под поиск. Проверьте ID или @username.' : 'Новые посетители появятся после входа в бота.', query() ? {label: 'Сбросить поиск', attrs: 'data-clear-search'} : null)) + pager(data);
  const load = () => api('customers?' + new URLSearchParams({query: query(), page: String(page)}));

  TM.view({
    id: 'customers', perm: ['customers.view'], title: 'Покупатели и кошельки', nav: 'Покупатели', auto: true,
    subtitle: 'Все посетители бота, балансы и история операций.',
    badge: () => state.customers_total || 0,
    async render({el}) {
      const data = await load();
      page = data.page;
      el.innerHTML = `<div class="stats two"><article class="stat"><div class="stat-label">Покупатели</div><strong>${number(state.customers_total ?? data.total)}</strong><small>Все вошедшие в бота</small></article>${TM.can('customers.balance') ? `<article class="stat accent"><div class="stat-label">Баланс всех кошельков</div><strong>${money(state.metrics?.wallet_total || 0)}</strong><small>Внутренние единицы магазина</small></article>` : ''}</div>
        <section class="panel"><div class="toolbar"><input id="customer-search" type="search" placeholder="ID, username или имя" aria-label="Поиск покупателей" value="${esc(query())}">${TM.can('customers.balance') ? '<button class="action" type="button" data-wallet="">Корректировка баланса</button>' : ''}<button class="action" type="button" data-export>Экспорт CSV</button></div><div id="customer-table">${list(data)}</div></section>`;
      const target = el.querySelector('#customer-table');
      const redraw = async () => {
        try { const next = await load(); page = next.page; target.innerHTML = list(next); } catch (error) { toast(error.message, 'error'); }
      };
      el.querySelector('#customer-search').oninput = event => {
        prefs.set('filters.customers', {search: event.target.value});
        page = 1; clearTimeout(searchTimer); searchTimer = setTimeout(redraw, 250);
      };
      el.querySelector('.panel').addEventListener('click', async event => {
        const b = event.target.closest('button');
        if (!b) return;
        if (b.dataset.page) { page = Number(b.dataset.page); redraw(); }
        if ('clearSearch' in b.dataset) { prefs.set('filters.customers', {}); el.querySelector('#customer-search').value = ''; page = 1; redraw(); }
        if ('export' in b.dataset) {
          b.disabled = true;
          try { await download('customers/export?' + new URLSearchParams({query: query()}), 'GET', 'themarket-customers.csv'); }
          catch (error) { toast(error.message, 'error'); } finally { b.disabled = false; }
        }
      });
    },
  });
})();
