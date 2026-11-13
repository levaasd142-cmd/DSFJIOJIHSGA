'use strict';
/* Overview dashboard: KPI tiles with change vs the previous 30 days, a 30-day revenue/orders chart
   (inline SVG, one series at a time, one axis), low stock, open support and recent orders. */
(() => {
  const {esc, api, state, money, number, empty, orderTable, badge, prefs, icon, can, ago} = TM;
  let metric = prefs.get('overview.metric', 'revenue'), data = null;

  const day = value => new Date(value + 'T12:00:00Z').toLocaleDateString('ru-RU', {day: 'numeric', month: 'short', timeZone: 'UTC'});
  const weekday = value => new Date(value + 'T12:00:00Z').toLocaleDateString('ru-RU', {weekday: 'short', timeZone: 'UTC'});
  const formatValue = (value, which = metric) => which === 'revenue' ? money(value) : number(value) + ' ' + plural(value, 'заказ', 'заказа', 'заказов');
  function plural(n, one, few, many) {
    const m10 = n % 10, m100 = n % 100;
    return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many;
  }
  function compact(value) {
    const shown = metric === 'revenue' && TM.usdActive() ? value / 100 : value;
    const text = new Intl.NumberFormat('ru-RU', {notation: 'compact', maximumFractionDigits: 1}).format(shown);
    return metric === 'revenue' && TM.usdActive() ? '$' + text : text;
  }
  /** "Nice" axis maximum and step so gridlines land on round numbers. */
  function scale(max) {
    if (max <= 0) return {top: 4, step: 1};
    const raw = max / 4, power = 10 ** Math.floor(Math.log10(raw)), unit = [1, 2, 2.5, 5, 10].find(n => n * power >= raw) * power;
    return {top: unit * 4, step: unit};
  }

  function chart(width) {
    const series = data.series, height = 230, left = 52, right = 12, top = 14, bottom = 30;
    const values = series.map(d => d[metric]), {top: max, step} = scale(Math.max(...values));
    const plotW = width - left - right, plotH = height - top - bottom;
    const slot = plotW / series.length, bar = Math.max(3, Math.min(18, slot - 2));
    const y = v => top + plotH - (v / max) * plotH;
    const ticks = [];
    for (let v = 0; v <= max + 1e-9; v += step) ticks.push(v);
    const grid = ticks.map(v => `<line class="chart-grid" x1="${left}" x2="${width - right}" y1="${y(v)}" y2="${y(v)}"/><text class="chart-label" x="${left - 8}" y="${y(v) + 3.5}" text-anchor="end">${esc(compact(v))}</text>`).join('');
    const every = width < 520 ? 7 : 5;
    const labels = series.map((d, i) => (series.length - 1 - i) % every === 0 ? `<text class="chart-label" x="${left + slot * (i + 0.5)}" y="${height - 9}" text-anchor="middle">${esc(day(d.date))}</text>` : '').join('');
    const bars = series.map((d, i) => {
      const x = left + slot * (i + 0.5), v = d[metric], h = Math.max(v > 0 ? 2 : 0, top + plotH - y(v));
      const r = Math.min(4, bar / 2, h);
      // Rounded data end, square baseline end.
      const path = h > 0 ? `M${x - bar / 2},${top + plotH} v${-(h - r)} q0,${-r} ${r},${-r} h${bar - 2 * r} q${r},0 ${r},${r} v${h - r} z` : '';
      return `<g class="chart-item" data-index="${i}" tabindex="${i === series.length - 1 ? 0 : -1}" role="img" aria-label="${esc(day(d.date) + ': ' + formatValue(v))}"><rect class="chart-hit" x="${left + slot * i}" y="${top}" width="${slot}" height="${plotH}"/>${path ? `<path class="chart-bar" d="${path}"/>` : ''}</g>`;
    }).join('');
    // 7-day moving average as a smooth line over the bars (decorative; the bars carry the data).
    const avg = series.map((_, i) => { const w = values.slice(Math.max(0, i - 6), i + 1); return w.reduce((a, b) => a + b, 0) / w.length; });
    const pts = avg.map((v, i) => [left + slot * (i + 0.5), y(v)]);
    const line = pts.length > 1 ? pts.reduce((d, [px, py], i) => {
      if (!i) return `M${px.toFixed(1)},${py.toFixed(1)}`;
      const [qx, qy] = pts[i - 1], mx = (qx + px) / 2;
      return d + ` C${mx.toFixed(1)},${qy.toFixed(1)} ${mx.toFixed(1)},${py.toFixed(1)} ${px.toFixed(1)},${py.toFixed(1)}`;
    }, '') : '';
    const trend = line ? `<path class="chart-trend" d="${line}" pathLength="1" aria-hidden="true"/>` : '';
    return `<svg class="dash-chart-svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="group" aria-label="${metric === 'revenue' ? 'Выручка' : 'Оплаченные заказы'} по дням за 30 дней. Стрелки влево и вправо — переход между днями.">${grid}<line class="chart-axis" x1="${left}" x2="${width - right}" y1="${y(0)}" y2="${y(0)}"/>${bars}${trend}${labels}</svg>`;
  }
  /** animate: bars grow from the baseline in sequence and the trend line draws itself (first render,
      metric switch); resize and theme redraws are instant. */
  function drawChart(root, animate = false) {
    const box = root?.querySelector('#dash-chart');
    if (!box || !data) return;
    const width = Math.max(300, Math.round(box.clientWidth || 800));
    box.innerHTML = chart(width) + '<div class="chart-tooltip" role="status"></div>';
    const svg = box.querySelector('svg');
    if (animate && !TM.reducedMotion()) {
      svg.querySelectorAll('.chart-item').forEach((g, i) => g.style.setProperty('--i', i));
      svg.classList.add('chart-enter');
      setTimeout(() => svg.classList.remove('chart-enter'), 1600);
    }
    const tip = box.querySelector('.chart-tooltip'), items = [...box.querySelectorAll('.chart-item')];
    const show = item => {
      items.forEach(g => g.classList.toggle('active', g === item));
      const d = data.series[Number(item.dataset.index)], hit = item.querySelector('.chart-hit');
      tip.innerHTML = `<span>${esc(weekday(d.date))}, ${esc(day(d.date))}</span><b>${esc(formatValue(d[metric]))}</b><small>${esc(formatValue(d[metric === 'revenue' ? 'orders' : 'revenue'], metric === 'revenue' ? 'orders' : 'revenue'))}</small>`;
      const fresh = !tip.classList.contains('show');
      if (fresh) tip.classList.add('instant');
      tip.classList.add('show');
      const svg = box.querySelector('svg').getBoundingClientRect(), rect = hit.getBoundingClientRect(), host = box.getBoundingClientRect();
      // Beside the hovered day, never on top of it: right of the bar, or left near the right edge.
      const tw = tip.offsetWidth, right = rect.right - host.left - 16 + 6;
      const x = right + tw <= svg.width ? right : rect.left - host.left - 16 - tw - 6;
      tip.style.setProperty('--x', Math.max(0, x) + 'px');
      if (fresh) { void tip.offsetWidth; tip.classList.remove('instant'); }
    };
    const hide = () => { tip.classList.remove('show'); items.forEach(g => g.classList.remove('active')); };
    box.onpointermove = event => { const item = event.target.closest('.chart-item'); if (item) show(item); };
    box.onpointerleave = () => { if (!box.contains(document.activeElement)) hide(); };
    box.onfocusin = event => { const item = event.target.closest('.chart-item'); if (item) show(item); };
    box.onfocusout = event => { if (!box.contains(event.relatedTarget)) hide(); };
    box.onkeydown = event => {
      const item = event.target.closest('.chart-item');
      if (!item || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const i = Number(item.dataset.index), n = items.length;
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? n - 1 : Math.min(n - 1, Math.max(0, i + (event.key === 'ArrowRight' ? 1 : -1)));
      item.tabIndex = -1; items[next].tabIndex = 0; items[next].focus();
    };
    root.querySelectorAll('[data-metric]').forEach(b => { const on = b.dataset.metric === metric; b.classList.toggle('active', on); b.setAttribute('aria-pressed', String(on)); });
    const total = data.kpi[metric === 'revenue' ? 'revenue' : 'orders'].value;
    root.querySelector('#dash-total').textContent = formatValue(total);
  }

  function delta(kpi) {
    if (!kpi.previous) return kpi.value ? '<span class="delta up">новое</span>' : '<span class="delta">—</span>';
    const change = (kpi.value - kpi.previous) / kpi.previous * 100, rounded = Math.round(change);
    const tone = rounded > 0 ? 'up' : rounded < 0 ? 'down' : '';
    return `<span class="delta ${tone}" title="Предыдущие 30 дней">${rounded > 0 ? '▲' : rounded < 0 ? '▼' : ''} ${Math.abs(rounded)}%</span>`;
  }
  /** KPI tile; the number counts up on first render ([data-count], see core.js). */
  const tile = (label, iconName, kpi, format, note, accent = false) => `<article class="stat lift ${accent ? 'accent' : ''}">
    <div class="stat-label">${label}<span>${icon(iconName, '')}</span></div><strong data-count="${Number(kpi.value) || 0}" data-format="${format}">${format === 'money' ? money(kpi.value) : number(kpi.value)}</strong><small>${delta(kpi)} ${note}</small></article>`;

  function supportWidget(s) {
    if (!s) return '';
    const rows = s.items.map(t => `<button type="button" class="list-row" data-ticket="${esc(t.id)}"><span class="avatar small" aria-hidden="true">${esc(TM.firstChar(t.first_name || t.username || '?'))}</span><span class="list-main"><b>${esc(t.first_name || (t.username ? '@' + t.username : 'TG ' + t.user_id))}</b><small>${esc(t.last_text || '')}</small></span><span class="list-side">${t.unread_for_staff ? `<span class="count-dot">${number(t.unread_for_staff)}</span>` : ''}<small>${esc(ago(t.last_message_at))}</small></span></button>`).join('');
    return `<section class="panel"><div class="panel-heading"><div><h2>Поддержка</h2><p>Открыто: ${number(s.open)} · непрочитанных: ${number(s.unread)}</p></div><button class="subtle" type="button" data-go="support">Все обращения →</button></div>${rows || empty('Нет открытых обращений', 'Сообщения покупателей из бота появятся здесь.')}</section>`;
  }
  function stockWidget(low) {
    const rows = low.items.map(p => `<div class="stock-row"><div><b>${esc(p.name)}</b><small>${esc(p.category)}</small></div><span class="stock-count ${p.available ? 'low' : 'empty'}">${number(p.available)}</span></div>`).join('');
    const action = can('stock.manage') ? {label: 'Открыть склад', attrs: 'data-open-work="low"'} : null;
    return `<section class="panel"><div class="panel-heading"><div><h2>Заканчиваются</h2><p>Порог: ${number(low.threshold)} шт. и меньше</p></div>${low.total ? `<button class="subtle" type="button" data-open-work="low">Все · ${number(low.total)} →</button>` : ''}</div>${rows || empty('Остатков хватает', 'Все активные товары с автовыдачей в наличии.', action)}</section>`;
  }

  document.addEventListener('click', event => {
    const button = event.target.closest('[data-open-work],[data-metric],[data-ticket]');
    if (!button) return;
    if (button.dataset.metric) {
      metric = button.dataset.metric; prefs.set('overview.metric', metric); drawChart(document.querySelector('#view .view-root'), true); return;
    }
    if (button.dataset.ticket) { prefs.set('support.open', Number(button.dataset.ticket)); TM.go('support'); return; }
    const kind = button.dataset.openWork;
    if (kind === 'low') prefs.set('filters.products', {stock: 'low'});
    if (kind === 'attention') prefs.set('filters.orders', {status: 'attention'});
    TM.go(kind === 'low' ? 'products' : kind === 'attention' ? 'orders' : kind);
  });
  let resizeTimer;
  window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { if (TM.current?.() === 'overview') drawChart(document.querySelector('#view .view-root')); }, 150); });

  TM.view({
    id: 'overview', perm: ['orders.view'], title: 'Обзор магазина', nav: 'Обзор', subtitle: 'Продажи за 30 дней, остатки, поддержка и свежие заказы.',
    auto: true, addProduct: true, skeleton: 'dashboard',
    async render({el}) {
      data = await api('dashboard');
      const m = state.metrics || {}, k = data.kpi, attention = m.attention || 0, issues = state.payment_issues || 0;
      el.innerHTML = `
        ${issues ? `<div class="notice alert-notice"><div><h2>Проблемные платежи · ${number(issues)}</h2><p>Оплата не совпала с заказом или пополнением. Проверьте и отметьте решённые.</p></div><button class="action" type="button" data-go="errors">Открыть список →</button></div>` : ''}
        <div class="stats">
          ${tile('Выручка · 30 дней', 'payments', k.revenue, 'money', 'к прошлым 30 дням', true)}
          ${tile('Оплаченные заказы', 'orders', k.orders, 'number', 'к прошлым 30 дням')}
          ${tile('Средний чек', 'analytics', k.average, 'money', 'к прошлым 30 дням')}
          ${tile('Новые покупатели', 'customers', k.customers, 'number', 'впервые открыли бота')}
        </div>
        <div class="overview-actions">
          <button type="button" data-open-work="attention">Требуют внимания <b>${number(attention)}</b></button>
          <button type="button" data-open-work="low">Заканчиваются <b>${number(data.low_stock.total)}</b></button>
          ${data.support ? `<button type="button" data-go="support">Непрочитанные обращения <b>${number(data.support.unread)}</b></button>` : ''}
          ${can('customers.view') && state.customers_total != null ? `<button type="button" data-open-work="customers">Покупатели <b>${number(state.customers_total)}</b></button>` : ''}
        </div>
        <section class="panel dash-chart-panel"><div class="panel-heading"><div><h2>Продажи по дням</h2><p>Последние 30 дней по Москве · всего <b id="dash-total"></b><span class="trend-key">среднее за 7 дней</span></p></div>
          <div class="segmented" role="group" aria-label="Показатель"><button type="button" data-metric="revenue">Выручка</button><button type="button" data-metric="orders">Заказы</button></div></div>
          <div id="dash-chart" class="dash-chart"></div></section>
        <div class="columns">
          <div class="column">
            <section class="panel"><div class="panel-heading"><div><h2>Последние заказы</h2><p>Свежие покупки в магазине</p></div><button class="subtle" type="button" data-go="orders">Все заказы →</button></div>${orderTable(data.recent_orders, false, empty('Заказов пока нет', 'Добавьте товар и поделитесь ботом — первые покупки появятся здесь.', can('products.manage') ? {label: 'Создать товар', attrs: 'data-new-product'} : null))}</section>
          </div>
          <div class="column">
            ${supportWidget(data.support)}
            ${stockWidget(data.low_stock)}
            <section class="panel"><div class="panel-heading"><h2>Подключение</h2></div>
              <div class="stock-row"><div><b>Telegram Bot</b><small>${state.bot_configured ? 'Токен задан; статус бота виден в окне запуска' : 'Укажите токен бота в окне запуска'}</small></div>${badge(state.bot_configured ? 'Настроен' : 'Ожидает', state.bot_configured ? 'green' : 'orange')}</div>
              <div class="stock-row"><div><b>Валюта магазина</b><small>${TM.usdActive() ? 'Доллары · ' + esc(state.currency.stars_per_usd) + ' Stars за $1' : 'Цены и балансы в Telegram Stars'}</small></div>${badge(TM.usdActive() ? 'USD' : 'Stars', TM.usdActive() ? 'green' : '')}</div>
            </section>
          </div>
        </div>`;
    },
    mounted(root) { drawChart(root, root.classList.contains('enter')); },
  });
  TM.on('theme', () => { if (TM.current?.() === 'overview') drawChart(document.querySelector('#view .view-root')); });
  document.addEventListener('click', event => { if (event.target.closest('[data-new-product]')) document.querySelector('#add-product').click(); });
})();
