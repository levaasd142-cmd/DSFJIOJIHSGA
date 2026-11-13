'use strict';
/* Sales analytics: period report, chart, top products, sales and finance entries. */
(() => {
  const {$, esc, api, number, usd, date, empty, toast, prompt, download, bindForm, prefs} = TM;
  const moscowDay = () => new Intl.DateTimeFormat('sv-SE', {timeZone: 'Europe/Moscow'}).format(new Date());
  const categories = {advertising: 'Реклама', server: 'Сервер и сервисы', fees: 'Комиссии', other: 'Прочее', refund: 'Возврат', replacement: 'Замена товара'};
  const metrics = {revenue: 'Выручка', profit: 'Прибыль', expenses: 'Расходы'};
  // Only the chosen period is remembered between visits; page numbers live in memory.
  let filters = {period: 'month', start: '', end: '', ...prefs.get('analytics', {}), page: 1, expense_page: 1};
  let report = null, metric = 'revenue', tab = 'products', topSort = 'top_revenue';
  const saveFilters = () => prefs.set('analytics', {period: filters.period, start: filters.start, end: filters.end});

  /* ------------------------------------------------------------ chart */
  function buckets(days) {
    const groups = [];
    days.forEach((day, index) => {
      const key = days.length > 180 ? day.date.slice(0, 7) : days.length > 31 ? String(Math.floor(index / 7)) : day.date;
      let group = groups[groups.length - 1];
      if (!group || group.key !== key) { group = {key, start: day.date, end: day.date, revenue: 0, profit: 0, expenses: 0, orders: 0}; groups.push(group); }
      group.end = day.date; group.revenue += day.revenue; group.expenses += day.expenses; group.orders += day.orders || 0;
      group.profit = group.profit == null || day.profit == null ? null : group.profit + day.profit;
    });
    return groups;
  }
  const chartDate = value => new Date(value + 'T12:00:00Z').toLocaleDateString('ru-RU', {day: 'numeric', month: 'short', timeZone: 'UTC'});
  const chartDetail = g => (g.start === g.end ? chartDate(g.start) : chartDate(g.start) + ' — ' + chartDate(g.end)) + ' · ' + metrics[metric] + ': ' +
    (g[metric] == null ? 'не указана себестоимость' : usd(g[metric]));

  function chart(days, available) {
    const groups = buckets(days), width = Math.max(300, Math.min(900, available - 28)), height = 164, left = 60, right = 16, top = 16, bottom = 30;
    const values = groups.map(g => g[metric]).filter(v => v != null), low = Math.min(0, ...values), high = Math.max(100, ...values), span = high - low;
    const y = value => top + (high - value) * (height - top - bottom) / span;
    const slot = (width - left - right) / Math.max(1, groups.length), bar = Math.min(36, slot * 0.65);
    const short = value => '$' + new Intl.NumberFormat('ru-RU', {notation: 'compact', maximumFractionDigits: 1}).format(value / 100);
    const grid = [high, (high + low) / 2, low].map(value => `<line class="chart-grid" x1="${left}" y1="${y(value)}" x2="${width - right}" y2="${y(value)}"/><text class="chart-label" x="${left - 8}" y="${y(value) + 4}" text-anchor="end">${esc(short(value))}</text>`).join('');
    const bars = groups.map((g, index) => {
      const value = g[metric], x = left + slot * (index + 0.5);
      return `<g class="chart-item" tabindex="0" data-chart-index="${index}" role="img" aria-label="${esc(chartDetail(g))}"><title>${esc(chartDetail(g))}</title><rect class="chart-hit" x="${x - slot / 2}" y="${top}" width="${slot}" height="${height - top - bottom}"/>${
        value != null ? `<rect class="chart-bar ${value < 0 ? 'negative' : metric}" x="${x - bar / 2}" y="${y(Math.max(0, value))}" width="${bar}" height="${Math.abs(y(value) - y(0))}" rx="3"/>` : `<text class="chart-label" x="${x}" y="${y(0) - 6}" text-anchor="middle">?</text>`}</g>`;
    }).join('');
    const every = Math.max(1, Math.ceil(groups.length / (width < 500 ? 3 : 5)));
    const labels = groups.map((g, index) => index % every === 0 || index === groups.length - 1 ? `<text class="chart-label" x="${left + slot * (index + 0.5)}" y="${height - 7}" text-anchor="middle">${esc(days.length > 180 ? new Date(g.start + 'T12:00:00Z').toLocaleDateString('ru-RU', {month: 'short', year: '2-digit', timeZone: 'UTC'}) : chartDate(g.start))}</text>` : '').join('');
    const grouping = days.length > 180 ? 'По месяцам' : days.length > 31 ? 'По 7 дней' : 'По дням';
    return `<div class="chart-caption"><span>${grouping} · суммы в $</span><strong>${usd(report.summary[metric])}</strong></div><div class="sales-chart"><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(metrics[metric])} за выбранный период">${grid}<line class="chart-axis" x1="${left}" y1="${y(0)}" x2="${width - right}" y2="${y(0)}"/>${bars}${labels}</svg></div><p class="chart-detail" role="status">${groups.length ? esc(chartDetail(groups[groups.length - 1])) : 'Нет данных за период'}</p>`;
  }
  function drawChart(root, animate = false) {
    const box = root.querySelector('#analytics-chart');
    if (!box || !report) return;
    box.innerHTML = chart(report.days, box.clientWidth || 900);
    const svg = box.querySelector('svg');
    if (animate && svg && !TM.reducedMotion()) {
      svg.querySelectorAll('.chart-item').forEach((g, i) => g.style.setProperty('--i', Math.min(i, 40)));
      svg.classList.add('chart-enter');
      setTimeout(() => svg.classList.remove('chart-enter'), 1600);
    }
    root.querySelectorAll('[data-chart-metric]').forEach(b => { const active = b.dataset.chartMetric === metric; b.classList.toggle('active', active); b.setAttribute('aria-pressed', String(active)); });
    const show = event => {
      const item = event.target.closest('[data-chart-index]');
      if (item) box.querySelector('.chart-detail').textContent = chartDetail(buckets(report.days)[Number(item.dataset.chartIndex)]);
    };
    box.onpointerover = box.onfocusin = box.onclick = show;
  }
  function drawTab(root) {
    root.querySelectorAll('[data-analytics-panel]').forEach(panel => { panel.hidden = panel.dataset.analyticsPanel !== tab; });
    root.querySelectorAll('[data-analytics-tab]').forEach(b => { const active = b.dataset.analyticsTab === tab; b.classList.toggle('active', active); b.setAttribute('aria-pressed', String(active)); });
  }
  function drawTop(root) {
    const rows = report[topSort];
    root.querySelector('#analytics-top').innerHTML = TM.table([
      {label: 'Товар', cell: p => `${esc(p.title)}<small>Товар №${esc(p.product_id)}</small>`},
      {label: 'Продано', cell: p => `${number(p.units)} шт. · ${number(p.orders)} заказов`},
      {label: 'Выручка', className: 'nowrap', cell: p => usd(p.revenue)},
      {label: 'Возвраты', className: 'nowrap', cell: p => usd(p.refunds)},
      {label: 'Себестоимость', cell: p => usd(p.cost) + (p.unknown_cost_orders ? '<small>Учтена частично</small>' : '')},
      {label: 'Прибыль до общих расходов', cell: p => usd(p.profit) + (p.unknown_cost_orders ? '<small>Есть неизвестная себестоимость</small>' : '')},
    ], rows) || empty('Продаж пока нет', 'Выберите другой период.');
  }
  const pagerFor = (data, target) => TM.pager(data, `data-analytics-target="${target}"`);

  /* ------------------------------------------------------------ finance dialog */
  const financeForm = $('#finance-form');
  financeForm.elements.kind.onchange = () => {
    const linked = financeForm.elements.kind.value !== 'expense';
    $('#finance-order-label').hidden = !linked; financeForm.elements.order_id.required = linked; $('#finance-category-label').hidden = linked;
  };
  function openFinance(orderId) {
    financeForm.reset(); TM.formError(financeForm, null);
    financeForm.elements.reference.value = crypto.randomUUID();
    financeForm.elements.occurred_date.value = moscowDay(); financeForm.elements.occurred_date.max = moscowDay();
    if (orderId) { financeForm.elements.kind.value = 'refund'; financeForm.elements.order_id.value = orderId; }
    financeForm.elements.kind.onchange();
    $('#finance-dialog').showModal();
  }
  bindForm(financeForm, async form => {
    const values = Object.fromEntries(new FormData(form));
    values.category = values.kind === 'expense' ? values.category : values.kind;
    values.order_id = values.kind === 'expense' ? null : values.order_id;
    await api('analytics/entries', 'POST', values);
    toast('Операция учтена', 'success'); tab = 'expenses'; TM.emit('changed');
  });
  document.addEventListener('click', event => {
    const b = event.target.closest('[data-finance-order]');
    if (b) openFinance(b.dataset.financeOrder);
  });

  /* ------------------------------------------------------------ view */
  TM.view({
    id: 'analytics', perm: ['analytics'], title: 'Аналитика', subtitle: 'Продажи, себестоимость, расходы и прибыль.',
    async render({el}) {
      try {
        report = await api('analytics?' + new URLSearchParams(filters));
      } catch (error) {
        el.innerHTML = `<div class="notice"><h2>Отчёт не загружен</h2><p>${esc(error.message)}</p><div class="toolbar"><button class="action" type="button" data-analytics-reset>Показать текущий месяц</button><button class="action" type="button" data-go="currency">Оплата и валюта →</button></div></div>`;
        el.querySelector('[data-analytics-reset]').onclick = () => { filters = {period: 'month', start: '', end: '', page: 1, expense_page: 1}; saveFilters(); TM.rerender(); };
        return;
      }
      const s = report.summary, query = new URLSearchParams({period: 'custom', start: report.start, end: report.end}).toString();
      el.innerHTML = `<div class="analytics-toolbar"><form id="analytics-period" class="toolbar"><label>Период<select name="period"><option value="day">Сегодня</option><option value="yesterday">Вчера</option><option value="week">Последние 7 дней</option><option value="month">Этот месяц</option><option value="custom">Свои даты</option></select></label><label class="analytics-date">С<input name="start" type="date" required max="${moscowDay()}" value="${esc(report.start)}"></label><label class="analytics-date">По<input name="end" type="date" required max="${moscowDay()}" value="${esc(report.end)}"></label><button class="action" type="submit">Показать</button></form>
        <div class="analytics-actions"><button class="action" type="button" data-finance-add>+ Расход</button><button class="primary" type="button" data-file="analytics/export.xlsx?${esc(query)}">Скачать Excel</button><button class="action" type="button" data-file="analytics/export?${esc(query)}">CSV</button></div></div>
        <p class="analytics-period-note">${esc(report.start)} — ${esc(report.end)} · ${esc(report.timezone)}</p>
        ${s.unknown_cost_orders ? `<div class="notice analytics-incomplete"><b>Не хватает себестоимости: ${number(s.unknown_cost_orders)} заказов.</b><span> Откройте «Продажи» и заполните её в заказах, чтобы рассчитать прибыль.</span></div>` : ''}
        ${s.estimated_dates ? `<p class="muted">У ${number(s.estimated_dates)} старых заказов точная дата выполнения не сохранена. Используется дата оплаты или создания.</p>` : ''}
        <div class="stats">${[
          ['Выручка', usd(s.revenue), number(s.orders) + ' выполненных заказов', s.revenue, 'usd'], ['Прибыль', usd(s.profit), s.profit == null ? 'Нужна себестоимость' : 'После себестоимости и всех расходов', s.profit, 'usd'],
          ['Расходы', usd(s.expenses), 'Реклама, комиссии, сервисы и замены', s.expenses, 'usd'], ['Заказы', number(s.orders), 'Продано ' + number(s.units) + ' шт.', s.orders, 'number'],
        ].map(([title, value, note, raw, format]) => `<article class="stat lift"><div class="stat-label">${title}</div><strong${raw == null ? '' : ` data-count="${Number(raw) || 0}" data-format="${format}"`}>${value}</strong><small>${note}</small></article>`).join('')}</div>
        <section class="panel analytics-chart-panel"><div class="panel-heading"><h2>Динамика продаж</h2><div class="segmented" aria-label="Показатель графика">${Object.entries(metrics).map(([key, label]) => `<button type="button" data-chart-metric="${key}">${label}</button>`).join('')}</div></div><div id="analytics-chart"></div></section>
        <details class="analytics-extra" data-key="analytics-extra"><summary>Остальные показатели</summary><div class="extra-grid">${[
          ['Себестоимость', usd(s.cost) + (s.unknown_cost_orders ? ' · частично' : '')], ['Возвраты', usd(s.refunds)], ['Маржинальность', s.margin == null ? '—' : s.margin + '%'],
          ['Средний чек', usd(s.average_check)], ['Пополнения кошельков', usd(s.wallet_deposits)], ['Начислено по промокодам', usd(s.promo_credits || 0)],
        ].map(([title, value]) => `<article><span>${title}</span><b>${value}</b></article>`).join('')}</div><p class="muted">Пополнения кошельков учитываются отдельно от продаж. Себестоимость и возвраты уже вычтены из прибыли.</p></details>
        <div class="segmented analytics-tabs" aria-label="Детализация отчёта"><button type="button" data-analytics-tab="products">Товары</button><button type="button" data-analytics-tab="sales">Продажи · ${number(report.sales.total)}</button><button type="button" data-analytics-tab="expenses">Расходы · ${number(report.entries.total)}</button></div>
        <section class="panel" data-analytics-panel="products"><div class="panel-heading"><div><h2>Топ товаров</h2><p>До общих расходов магазина, с учётом возвратов и стоимости замен.</p></div><select id="analytics-top-sort" aria-label="Сортировка"><option value="top_revenue">По выручке после возвратов</option><option value="top_profit">По прибыли</option></select></div><div id="analytics-top"></div></section>
        <section class="panel" data-analytics-panel="sales"><div class="panel-heading"><h2>Продажи за период</h2></div>${TM.table([
          {label: 'Товар / заказ', cell: sale => `${esc(sale.title)}<small>#${TM.shortId(sale.id)}</small>`},
          {label: 'Дата выполнения', cell: sale => new Date(sale.sold_at * 1000).toLocaleString('ru-RU', {timeZone: 'Europe/Moscow'})},
          {label: 'Количество', cell: sale => number(sale.quantity)},
          {label: 'Выручка', className: 'nowrap', cell: sale => usd(sale.price)},
          {label: 'Себестоимость', cell: sale => usd(sale.cost_total) + (sale.cost_total == null ? '<small>Не указана</small>' : '')},
          {label: 'Действия', className: 'actions', cell: sale => `<button class="action" type="button" data-order="${esc(sale.id)}">Заказ / себестоимость</button>`},
        ], report.sales.items) || empty('Выполненных покупок нет', 'Выберите другой период.')}${pagerFor(report.sales, 'page')}</section>
        <section class="panel" data-analytics-panel="expenses"><div class="panel-heading"><div><h2>Расходы, возвраты и замены</h2><p>Записи для учёта. Добавление возврата не переводит деньги покупателю.</p></div><button class="action" type="button" data-finance-add>+ Добавить</button></div>
          <div class="finance-categories">${report.categories.map(c => `<span>${esc(c.title)} · ${usd(c.amount)}</span>`).join('')}</div>
          ${TM.table([
            {label: 'Дата МСК', cell: e => new Date(e.occurred_at * 1000).toLocaleDateString('ru-RU', {timeZone: 'Europe/Moscow'})},
            {label: 'Категория', cell: e => esc(categories[e.category] || e.category)},
            {label: 'Описание', cell: e => esc(e.note) + (e.order_id ? `<small><button class="subtle" type="button" data-order="${esc(e.order_id)}">${esc(e.title)} · #${TM.shortId(e.order_id)}</button></small>` : '')},
            {label: 'Сумма', className: 'nowrap', cell: e => usd(e.amount)},
            {label: 'Состояние', cell: e => e.voided_at ? 'Отменена' : 'Учтена'},
            {label: 'Действия', className: 'actions', cell: e => e.voided_at ? '' : `<button class="action" type="button" data-finance-void="${esc(e.id)}">Отменить запись</button>`},
          ], report.entries.items, e => e.voided_at ? 'voided' : '') || empty('Операций нет', 'Добавьте расходы магазина: сервер, рекламу или комиссию.')}${pagerFor(report.entries, 'expense_page')}</section>`;

      const form = el.querySelector('#analytics-period');
      form.elements.period.value = filters.period;
      const switchPeriod = () => {
        const custom = form.elements.period.value === 'custom';
        form.querySelectorAll('.analytics-date').forEach(label => { label.hidden = !custom; });
        form.elements.start.disabled = form.elements.end.disabled = !custom;
        form.querySelector('[type="submit"]').hidden = !custom;
      };
      switchPeriod();
      const apply = () => {
        filters = {period: form.elements.period.value, start: form.elements.start.value, end: form.elements.end.value, page: 1, expense_page: 1};
        saveFilters(); TM.rerender();
      };
      form.elements.period.onchange = () => { switchPeriod(); if (form.elements.period.value !== 'custom') apply(); };
      form.onsubmit = event => { event.preventDefault(); apply(); };
      const sort = el.querySelector('#analytics-top-sort');
      sort.value = topSort;
      sort.onchange = () => { topSort = sort.value; drawTop(el); };
      drawTop(el); drawTab(el);
      el.addEventListener('click', async event => {
        const b = event.target.closest('button');
        if (!b) return;
        const d = b.dataset, root = el;
        try {
          if (d.chartMetric) { metric = d.chartMetric; drawChart(root, true); }
          else if (d.analyticsTab) { tab = d.analyticsTab; drawTab(root); }
          else if ('financeAdd' in d) openFinance();
          else if (d.page && d.analyticsTarget) { filters[d.analyticsTarget] = Number(d.page); TM.rerender(); }
          else if (d.file) { b.disabled = true; await download(d.file); }
          else if (d.financeVoid) {
            const reason = await prompt({title: 'Отменить запись?', text: 'Деньги и баланс покупателя не изменятся.', ok: 'Отменить запись', danger: true, input: {label: 'Причина отмены', maxlength: 300}});
            if (!reason) return;
            b.disabled = true;
            await api('analytics/entries/' + encodeURIComponent(d.financeVoid) + '/void', 'POST', {reason});
            toast('Запись отменена', 'success'); TM.rerender();
          }
        } catch (error) { toast(error.message, 'error'); } finally { b.disabled = false; }
      });
    },
    mounted(root) { drawChart(root, root.classList.contains('enter')); },
  });

  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (document.body.dataset.screen === 'analytics') drawChart($('#view .view-root')); }, 150);
  });
})();
