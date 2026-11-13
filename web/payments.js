'use strict';
(() => {
  const {esc, api, state, number, date, prefs, table, empty, pager, paginate, toast, badge, csvDownload} = TM;
  let page = 1;
  const networks = {bsc: 'BEP20', ton: 'TON', tron: 'TRC20', aptos: 'Aptos'};
  const labels = {paid: 'Подтверждён', pending: 'Проверяется', review: 'Нужна проверка', waiting: 'Ждёт оплаты', expired: 'Истёк', cancelled: 'Отменён'};

  function cryptoAmount(payment) {
    const decimals = !payment.network || payment.network === 'bsc' ? 18 : 6;
    const raw = String(payment.amount_raw || '0').padStart(decimals + 1, '0');
    const fraction = raw.slice(-decimals).replace(/0+$/, '');
    return raw.slice(0, -decimals) + (fraction ? '.' + fraction : '');
  }
  function rows(payments) {
    const now = Date.now() / 1000;
    return [
      ...payments.crypto.map(p => ({...p, method: 'USDT ' + networks[p.network || 'bsc'], reference: p.txid || p.submitted,
        status: p.txid ? 'paid' : p.cancelled ? 'cancelled' : p.status || 'waiting', amount: cryptoAmount(p) + ' USDT',
        destination: p.applied_order ? 'Заказ' : p.txid && p.order_id && p.applied_order == null ? 'См. заказ и баланс' : 'Баланс',
        retry: !p.txid && !p.cancelled && Boolean(p.submitted)})),
      ...payments.stars.map(p => ({...p, method: 'Stars', reference: p.charge, status: p.charge ? 'paid' : 'waiting',
        amount: number(p.amount) + ' Stars', destination: p.destination === 'order' ? 'Заказ' : 'Баланс'})),
    ].map(p => !['paid', 'cancelled'].includes(p.status) && p.expires && p.expires <= now ? {...p, status: 'expired'} : p)
      .sort((a, b) => b.created - a.created);
  }
  const tone = status => status === 'paid' ? 'green' : status === 'review' ? 'red' : status === 'cancelled' || status === 'expired' ? '' : 'orange';
  const columns = [
    {label: 'Счёт', cell: p => `<b>#${TM.shortId(p.id, 10)}</b><small>${date(p.created)} · TG ${esc(p.user_id)}</small>`},
    {label: 'Сумма', className: 'nowrap', cell: p => `${esc(p.amount)}<small>${esc(p.status === 'paid' ? p.destination : p.method)}</small>`},
    {label: 'Статус', cell: p => `${badge(labels[p.status] || p.status, tone(p.status))}<small class="payment-detail">${esc(p.detail || '')}${p.failed_attempts ? ' · Неверных TXID: ' + p.failed_attempts + '/5' : ''}</small>`},
    {label: 'TXID / платёж', cell: p => `<small class="payment-reference" title="${esc(p.reference || '')}">${esc(p.reference || '—')}</small>`},
    {label: 'Действия', className: 'actions', cell: p => p.retry ? `<button class="action" type="button" data-payment-retry="${esc(p.id)}">Проверить снова</button>` : '—'},
  ];

  TM.view({
    id: 'payments', perm: ['payments'], title: 'Платежи', subtitle: 'Счета Stars и USDT, состояние проверки и зачисления.', auto: true,
    async render({el}) {
      const all = rows(await api('payments'));
      const f = {search: '', status: '', ...prefs.get('filters.payments', {})};
      el.innerHTML = `${state.payment_issues ? `<div class="notice alert-notice"><div><h2>Проблемные платежи · ${number(state.payment_issues)}</h2><p>Оплаты, которые не совпали с заказом или пополнением.</p></div><button class="action" type="button" data-go="errors">Разобрать →</button></div>` : ''}
        <section class="panel"><div class="toolbar"><input id="payment-search" type="search" placeholder="ID покупателя, счёта или TXID" aria-label="Поиск платежей" value="${esc(f.search)}"><select id="payment-filter" aria-label="Статус платежа"><option value="">Все платежи</option>${Object.entries(labels).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select><button class="action" type="button" data-export>Экспорт CSV</button></div><div id="payment-table"></div></section>`;
      const search = el.querySelector('#payment-search'), filter = el.querySelector('#payment-filter'), target = el.querySelector('#payment-table');
      filter.value = f.status;
      const filtered = () => {
        const query = search.value.trim().toLowerCase();
        return all.filter(p => (!filter.value || filter.value === p.status) && [p.id, p.user_id, p.reference].join(' ').toLowerCase().includes(query));
      };
      const draw = () => {
        const data = paginate(filtered(), page);
        page = data.page;
        target.innerHTML = (table(columns, data.items) || empty('Платежи не найдены', 'Измените фильтр или дождитесь новых счетов.')) + pager(data);
      };
      search.oninput = filter.onchange = () => { prefs.set('filters.payments', {search: search.value, status: filter.value}); page = 1; draw(); };
      el.querySelector('.panel').addEventListener('click', async event => {
        const b = event.target.closest('button');
        if (!b) return;
        if (b.dataset.page) { page = Number(b.dataset.page); draw(); }
        else if ('export' in b.dataset) {
          csvDownload([['Счёт', 'Создан', 'Telegram ID', 'Способ', 'Сумма', 'Статус', 'Зачисление', 'TXID / платёж'],
            ...filtered().map(p => [p.id, new Date(p.created * 1000).toISOString(), p.user_id, p.method, p.amount, labels[p.status] || p.status, p.destination, p.reference || ''])],
          'themarket-payments-' + new Date().toISOString().slice(0, 10) + '.csv');
        } else if (b.dataset.paymentRetry) {
          b.disabled = true;
          try { await api('payments/' + encodeURIComponent(b.dataset.paymentRetry) + '/retry', 'POST'); toast('Бот повторит проверку', 'success'); TM.emit('changed'); }
          catch (error) { toast(error.message, 'error'); b.disabled = false; }
        }
      });
      draw();
    },
  });
})();
