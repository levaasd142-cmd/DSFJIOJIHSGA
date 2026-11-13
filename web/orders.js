'use strict';
/* Tasks and orders: both are server-side pages (/api/orders?status&query&page), so they stay fast
   with 100k+ orders. Search and filters hit the server with a short debounce. */
(() => {
  const {esc, api, state, number, prefs, orderLabels, orderTable, pager, empty, download, toast, debounce} = TM;
  const pages = {tasks: 1, orders: 1};

  TM.view({
    id: 'tasks', perm: ['orders.view'], title: 'Задачи магазина', nav: 'Задачи', auto: true,
    subtitle: 'Оплаченные заказы, которые ещё требуют действий. Выполненные покупки сюда не попадают.',
    badge: () => state.metrics?.attention || 0,
    async render({el}) {
      const data = await api('orders?' + new URLSearchParams({status: 'attention', page: String(pages.tasks)}));
      pages.tasks = data.page;
      el.innerHTML = `<div class="task-explainer"><article><b>В очереди</b><p>Возьмите заказ и выполните услугу.</p></article><article><b>На проверке</b><p>Откройте детали проблемной оплаты.</p></article><article><b>Ждём данные</b><p>Покупатель ещё не прислал информацию.</p></article></div>
        <section class="panel"><div class="panel-heading"><h2>Нужно обработать · ${number(data.total)}</h2><button class="subtle" type="button" data-go="orders">Все заказы →</button></div>${
          orderTable(data.items, true, empty('Очередь пуста', 'Все оплаченные заказы выполнены. Новые задачи появятся здесь автоматически.', {label: 'Открыть все заказы', attrs: 'data-go="orders"'}))}${pager(data)}</section>`;
      el.querySelector('.pager')?.addEventListener('click', event => {
        const b = event.target.closest('[data-page]');
        if (b) { pages.tasks = Number(b.dataset.page); TM.rerender(); }
      });
    },
  });

  const quick = [['', 'Все'], ['attention', 'Требуют внимания'], ['queued', 'В очереди'], ['processing', 'В работе'], ['needs_review', 'Проверка'], ['fulfilled', 'Выполнены']];

  TM.view({
    id: 'orders', perm: ['orders.view'], title: 'Заказы', auto: true, subtitle: 'Следите за оплатой и выполняйте ручные заказы.',
    badge: () => state.metrics?.attention || 0,
    async render({el}) {
      const filters = {search: '', status: '', ...prefs.get('filters.orders', {})};
      const query = () => new URLSearchParams({status: filters.status, query: filters.search.trim()});
      const load = () => api('orders?' + query() + '&page=' + pages.orders);
      const first = await load();
      el.innerHTML = `<section class="panel"><div class="toolbar">
          <input id="order-search" type="search" placeholder="Номер заказа, товар или Telegram ID" aria-label="Поиск заказов" value="${esc(filters.search)}">
          <select id="order-status" aria-label="Статус заказа"><option value="">Все статусы</option><option value="attention">Требуют внимания</option>${Object.entries(orderLabels).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select>
          <button class="action" type="button" data-export>Экспорт CSV</button><button class="action" type="button" data-reset>Сбросить фильтры</button>
        </div>
        <div class="quick-filters" role="group" aria-label="Быстрые фильтры">${quick.map(([status, label]) => `<button type="button" data-status="${status}">${label}${status === 'attention' ? `<b>${number(state.metrics?.attention || 0)}</b>` : ''}</button>`).join('')}</div>
        <div id="order-table"></div></section>`;
      const search = el.querySelector('#order-search'), select = el.querySelector('#order-status'), target = el.querySelector('#order-table');
      select.value = filters.status;
      const draw = data => {
        pages.orders = data.page;
        const filtered = filters.search || filters.status;
        target.innerHTML = orderTable(data.items, true, filtered
          ? empty('Ничего не найдено', 'Под фильтр не подходит ни один заказ.', {label: 'Сбросить фильтры', attrs: 'data-reset'})
          : empty('Заказов пока нет', 'Первые покупки появятся здесь автоматически.')) + pager(data);
        for (const b of el.querySelectorAll('[data-status]')) {
          const active = b.dataset.status === filters.status;
          b.classList.toggle('active', active); b.setAttribute('aria-pressed', String(active));
        }
      };
      const reload = async () => {
        target.setAttribute('aria-busy', 'true');
        try { draw(await load()); } catch (error) { toast(error.message, 'error'); } finally { target.removeAttribute('aria-busy'); }
      };
      const changed = () => {
        filters.search = search.value; filters.status = select.value;
        prefs.set('filters.orders', filters); pages.orders = 1; reload();
      };
      const typed = debounce(changed, 300);
      search.oninput = typed; select.onchange = changed;
      el.querySelector('.panel').addEventListener('click', async event => {
        const b = event.target.closest('button');
        if (!b) return;
        if (b.dataset.page) { pages.orders = Number(b.dataset.page); reload(); }
        else if ('status' in b.dataset) { select.value = b.dataset.status; changed(); }
        else if ('reset' in b.dataset) { search.value = ''; select.value = ''; changed(); }
        else if ('export' in b.dataset) {
          b.disabled = true;
          try { await download('orders/export?' + query(), 'GET', 'themarket-orders.csv'); }
          catch (error) { toast(error.message, 'error'); } finally { b.disabled = false; }
        }
      });
      draw(first);
    },
  });
})();
