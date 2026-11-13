'use strict';
/* «Инсайты» (3.1, permission 'analytics'): monthly revenue goal with a progress ring and forecast,
   conversion funnel, weekday×hour heatmap of paid orders, top customers and purchase cohorts.
   Charts are inline SVG/HTML using panel.css tokens; every mark is focusable and labelled. */
(() => {
  const T = typeof TM !== 'undefined' ? TM : window.TM;
  if (!T) return;
  const {esc, api, number, money, date, prefs, toast, empty, table} = T;
  let filters = {period: 'month', start: '', end: '', ...prefs.get('insights', {})};
  let metric = 'orders', report = null;
  const moscowDay = () => new Intl.DateTimeFormat('sv-SE', {timeZone: 'Europe/Moscow'}).format(new Date());
  const periods = [['week', '7 дней'], ['month', 'Этот месяц'], ['custom', 'Период']];
  const plural = (n, one, few, many) => { const m10 = n % 10, m100 = n % 100; return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many; };

  /* ------------------------------------------------------------ goal ring */
  function goalPanel(goal) {
    const r = 54, c = 2 * Math.PI * r, pct = goal.goal ? Math.min(1, goal.revenue / goal.goal) : 0;
    const forecastPct = goal.goal ? Math.min(1, goal.forecast / goal.goal) : 0;
    const label = goal.goal ? `${Math.round(goal.progress)}%` : '—';
    const month = new Date(goal.month + '-15T12:00:00Z').toLocaleDateString('ru-RU', {month: 'long', year: 'numeric', timeZone: 'UTC'});
    const summary = goal.goal ? `Выручка ${money(goal.revenue)} из ${money(goal.goal)} (${label}), прогноз ${money(goal.forecast)}` : 'Цель не задана';
    return `<section class="panel reveal"><div class="panel-heading"><div><h2>Цель на ${esc(month)}</h2><p class="muted">День ${number(Math.floor(goal.days_elapsed))} из ${goal.days_total} · прогноз — линейно по прошедшим дням</p></div>${
      T.can('analytics') ? '<button class="action" type="button" data-tmx-goal>Изменить цель</button>' : ''}</div>
      <div class="tmx-body tmx-goal"><svg class="tmx-ring" viewBox="0 0 132 132" role="img" aria-label="${esc(summary)}"><title>${esc(summary)}</title>
        <circle class="track" cx="66" cy="66" r="${r}"/>
        <circle class="forecast" cx="66" cy="66" r="${r}" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - forecastPct)}" transform="rotate(-90 66 66)"/>
        <circle class="value ${pct >= 1 ? 'done' : ''}" cx="66" cy="66" r="${r}" stroke-dasharray="${c}" stroke-dashoffset="${c}" data-offset="${c * (1 - pct)}" transform="rotate(-90 66 66)"/>
        <text x="66" y="70">${esc(label)}</text><text class="sub" x="66" y="88">${goal.goal ? 'от цели' : 'нет цели'}</text></svg>
        <div><dl><dt>Выручка за месяц</dt><dd data-count="${goal.revenue}" data-format="money">${money(goal.revenue)}</dd><dt>Цель</dt><dd>${goal.goal ? money(goal.goal) : 'не задана'}</dd>
          <dt>Прогноз на конец месяца</dt><dd>${money(goal.forecast)}</dd>${goal.goal ? `<dt>Прогноз к цели</dt><dd>${Math.round(goal.forecast_progress)}%</dd>` : ''}</dl>
          <p class="tmx-note">${goal.goal ? (goal.forecast >= goal.goal ? 'При текущем темпе цель будет выполнена.' : `Чтобы успеть, нужно ещё ${money(Math.max(0, goal.goal - goal.revenue))}.`) : 'Задайте цель, чтобы видеть прогресс и прогноз.'}</p></div></div></section>`;
  }

  /* ------------------------------------------------------------ funnel */
  function funnelPanel(funnel) {
    const rows = funnel.steps.map(step => `<div class="tmx-funnel-row" role="listitem" aria-label="${esc(step.label)}: ${number(step.value)} (${step.share}% от посетителей)">
        <span>${esc(step.label)}${step.step != null ? `<small>${step.step}% от предыдущего шага</small>` : '<small>за выбранный период</small>'}</span>
        <div class="tmx-funnel-track" aria-hidden="true"><div class="tmx-funnel-bar" data-w="${Math.max(0, Math.min(100, step.share))}%"></div></div>
        <b>${number(step.value)}<small>${step.share}%</small></b></div>`).join('');
    return `<section class="panel"><div class="panel-heading"><div><h2>Воронка</h2><p class="muted">Новые посетители периода и их покупки до сегодняшнего дня</p></div></div>
      <div class="tmx-body"><div class="tmx-funnel stagger" role="list">${rows}</div>
      <p class="tmx-note">Открытия каталога бот не записывает, поэтому воронка начинается с первого входа.</p></div></section>`;
  }

  /* ------------------------------------------------------------ heatmap */
  const heatDetail = (heat, d, h) => `${heat.weekdays[d]}, ${String(h).padStart(2, '0')}:00–${String(h).padStart(2, '0')}:59 · ${number(heat.orders[d][h])} ${plural(heat.orders[d][h], 'заказ', 'заказа', 'заказов')} · ${money(heat.revenue[d][h])}`;
  function heatmapSvg(heat) {
    const values = heat[metric], max = Math.max(1, ...values.flat());
    const left = 30, top = 18, size = 22, gap = 0, width = left + 24 * size + 4, height = top + 7 * size + 4;
    const cells = values.map((row, d) => row.map((value, h) => {
      const x = left + h * (size + gap), y = top + d * (size + gap), share = value / max;
      return `<rect class="cell ${value ? '' : 'zero'}" x="${x}" y="${y}" width="${size}" height="${size}" rx="4" fill-opacity="${value ? (0.18 + 0.82 * share).toFixed(3) : 1}"
        tabindex="${d === 0 && h === 0 ? 0 : -1}" role="img" data-d="${d}" data-h="${h}" aria-label="${esc(heatDetail(heat, d, h))}"><title>${esc(heatDetail(heat, d, h))}</title></rect>`;
    }).join('')).join('');
    const hours = Array.from({length: 24}, (_, h) => h % 3 === 0 ? `<text x="${left + h * size + size / 2}" y="12" text-anchor="middle">${h}</text>` : '').join('');
    const days = heat.weekdays.map((name, d) => `<text x="${left - 8}" y="${top + d * size + size / 2 + 3.5}" text-anchor="end">${esc(name)}</text>`).join('');
    return `<svg viewBox="0 0 ${width} ${height}" role="grid" aria-label="Оплаченные заказы по дням недели и часам (МСК). Стрелки — перемещение по ячейкам.">${hours}${days}${cells}</svg>`;
  }
  function heatmapPanel(heat) {
    const peak = heat.peak ? `Пик: ${heatDetail(heat, heat.peak.weekday, heat.peak.hour)}` : 'Нет оплат за период';
    return `<section class="panel"><div class="panel-heading"><div><h2>Когда покупают</h2><p class="muted">Оплаченные заказы по дням недели и часам, МСК</p></div>
      <div class="segmented" role="group" aria-label="Показатель">${[['orders', 'Заказы'], ['revenue', 'Выручка']].map(([key, label]) => `<button type="button" data-tmx-metric="${key}" class="${metric === key ? 'active' : ''}" aria-pressed="${metric === key}">${label}</button>`).join('')}</div></div>
      <div class="tmx-body"><div class="tmx-heatmap" id="tmx-heatmap">${heatmapSvg(heat)}</div>
      <div class="tmx-heat-foot"><p class="chart-detail" id="tmx-heat-detail" role="status">${esc(peak)}</p><span class="tmx-legend" aria-hidden="true">меньше <i class="l1"></i><i class="l2"></i><i></i> больше</span></div></div></section>`;
  }
  function bindHeatmap(root) {
    const box = root.querySelector('#tmx-heatmap'), detail = root.querySelector('#tmx-heat-detail');
    if (!box) return;
    const show = cell => {
      box.querySelectorAll('.cell.active').forEach(c => c.classList.remove('active'));
      cell.classList.add('active');
      detail.textContent = heatDetail(report.heatmap, Number(cell.dataset.d), Number(cell.dataset.h));
    };
    box.onpointerover = event => { const cell = event.target.closest('.cell'); if (cell) show(cell); };
    box.onfocusin = event => { const cell = event.target.closest('.cell'); if (cell) show(cell); };
    box.onkeydown = event => {
      const cell = event.target.closest('.cell');
      if (!cell) return;
      const moves = {ArrowRight: [0, 1], ArrowLeft: [0, -1], ArrowDown: [1, 0], ArrowUp: [-1, 0], Home: [0, -24], End: [0, 24]};
      const move = moves[event.key];
      if (!move) return;
      event.preventDefault();
      const d = Math.max(0, Math.min(6, Number(cell.dataset.d) + move[0])), h = Math.max(0, Math.min(23, Number(cell.dataset.h) + move[1]));
      const next = box.querySelector(`.cell[data-d="${d}"][data-h="${h}"]`);
      cell.tabIndex = -1; next.tabIndex = 0; next.focus();
    };
  }

  /* ------------------------------------------------------------ top customers and cohorts */
  function topPanel(rows) {
    const body = table([
      {label: 'Покупатель', cell: c => `<button class="subtle" type="button" data-customer="${esc(c.user_id)}">${esc(c.name || (c.username ? '@' + c.username : 'TG ' + c.user_id))}</button><small>${c.username ? '@' + esc(c.username) + ' · ' : ''}TG ${esc(c.user_id)}</small>`},
      {label: 'За период', className: 'nowrap num', cell: c => `${money(c.revenue)}<small>${number(c.orders)} ${plural(c.orders, 'заказ', 'заказа', 'заказов')}</small>`},
      {label: 'LTV', className: 'nowrap num', cell: c => `${money(c.ltv)}<small>всего ${number(c.lifetime_orders)}</small>`},
      {label: 'Последняя покупка', className: 'nowrap', cell: c => date(c.last_purchase)},
    ], rows) || empty('Покупок пока нет', 'За выбранный период нет оплаченных заказов.');
    return `<section class="panel"><div class="panel-heading"><div><h2>Топ-10 покупателей</h2><p class="muted">По выручке за период; LTV — за всё время</p></div></div>${body}</section>`;
  }
  function cohortPanel(cohorts) {
    const max = cohorts.months.length;
    const head = `<tr><th scope="col">Месяц первой покупки</th><th scope="col">Покупателей</th>${Array.from({length: max}, (_, i) => `<th scope="col">${i === 0 ? 'M0' : '+' + i}</th>`).join('')}</tr>`;
    const monthName = key => new Date(key + '-15T12:00:00Z').toLocaleDateString('ru-RU', {month: 'short', year: '2-digit', timeZone: 'UTC'});
    const rows = cohorts.rows.map(row => `<tr><th scope="row">${esc(monthName(row.month))}</th><td class="size">${number(row.customers)}</td>${
      Array.from({length: max}, (_, i) => {
        const cell = row.cells[i];
        if (!cell || cell.share == null) return `<td class="na" aria-label="нет данных">·</td>`;
        const v = Math.min(1, cell.share / 100);
        return `<td class="${v > 0.55 ? 'hot' : ''}" data-v="${v.toFixed(3)}" title="${esc(monthName(row.month))} · месяц +${i}: ${number(cell.customers)} из ${number(row.customers)}">${Math.round(cell.share)}%</td>`;
      }).join('')}</tr>`).join('');
    return `<section class="panel"><div class="panel-heading"><div><h2>Когорты</h2><p class="muted">Доля покупателей, купивших снова через N месяцев после первой покупки (12 месяцев)</p></div></div>
      <div class="tmx-body tmx-cohorts"><table><caption class="sr-only">Удержание покупателей по месяцам первой покупки</caption><thead>${head}</thead><tbody>${rows}</tbody></table></div></section>`;
  }

  /* ------------------------------------------------------------ view */
  const query = () => new URLSearchParams(filters.period === 'custom' ? {period: 'custom', start: filters.start, end: filters.end} : {period: filters.period});
  function toolbar() {
    const today = moscowDay();
    return `<div class="tmx-insights-toolbar"><div class="segmented" role="group" aria-label="Период">${periods.map(([key, label]) => `<button type="button" data-tmx-period="${key}" class="${filters.period === key ? 'active' : ''}" aria-pressed="${filters.period === key}">${label}</button>`).join('')}</div>
      <form class="tmx-custom" data-tmx-custom ${filters.period === 'custom' ? '' : 'hidden'}><label class="sr-only" for="tmx-start">С</label><input id="tmx-start" type="date" name="start" max="${today}" value="${esc(filters.start || today.slice(0, 8) + '01')}" required>
        <span class="muted">—</span><label class="sr-only" for="tmx-end">По</label><input id="tmx-end" type="date" name="end" max="${today}" value="${esc(filters.end || today)}" required><button class="action" type="submit">Показать</button></form>
      <span class="muted">${report ? `${esc(report.start)} — ${esc(report.end)} · ${esc(report.timezone)}` : ''}</span></div>`;
  }
  function draw(el) {
    el.innerHTML = toolbar() + goalPanel(report.goal) + `<div class="tmx-grid">${funnelPanel(report.funnel)}${heatmapPanel(report.heatmap)}</div>`
      + topPanel(report.top_customers) + cohortPanel(report.cohorts);
    bindHeatmap(el);
    // CSP (style-src 'self') forbids style attributes in markup; CSSOM properties are fine.
    el.querySelectorAll('[data-v]').forEach(cell => cell.style.setProperty('--v', cell.dataset.v));
    T.enhance?.(el);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const ring = el.querySelector('.tmx-ring .value');
      if (ring) ring.style.strokeDashoffset = ring.dataset.offset;
      el.querySelectorAll('.tmx-funnel-bar[data-w]').forEach(bar => bar.style.setProperty('--w', bar.dataset.w));
    }));
  }
  async function load(el) {
    report = await api('insights?' + query());
    draw(el);
  }

  T.view({
    id: 'insights', perm: ['analytics'], title: 'Инсайты', nav: 'Инсайты', skeleton: 'dashboard', auto: false,
    group: 'Финансы', after: 'analytics',
    subtitle: 'Цель месяца, воронка, время покупок, лучшие покупатели и удержание.',
    async render({el}) {
      await load(el);
      el.addEventListener('click', async event => {
        const b = event.target.closest('button');
        if (!b) return;
        if (b.dataset.tmxPeriod) {
          filters.period = b.dataset.tmxPeriod; prefs.set('insights', filters);
          if (filters.period === 'custom') { el.querySelector('[data-tmx-custom]').hidden = false; el.querySelectorAll('[data-tmx-period]').forEach(x => { x.classList.toggle('active', x === b); x.setAttribute('aria-pressed', String(x === b)); }); el.querySelector('#tmx-start').focus(); return; }
          try { await load(el); } catch (error) { toast(error.message, 'error'); }
        } else if (b.dataset.tmxMetric) {
          metric = b.dataset.tmxMetric;
          el.querySelector('#tmx-heatmap').innerHTML = heatmapSvg(report.heatmap);
          el.querySelectorAll('[data-tmx-metric]').forEach(x => { const on = x.dataset.tmxMetric === metric; x.classList.toggle('active', on); x.setAttribute('aria-pressed', String(on)); });
        } else if ('tmxGoal' in b.dataset) {
          const value = await T.prompt({title: 'Цель по выручке на месяц', text: `Сумма в ${T.usdActive() ? 'долларах' : 'Stars'}. 0 — убрать цель.`, ok: 'Сохранить',
            input: {label: 'Сумма', maxlength: 16, value: report.goal.goal ? T.amountInput(report.goal.goal) : ''}});
          if (value == null) return;
          try {
            await api('insights/goal', 'PUT', {amount: value.replace(',', '.').replace(/\s/g, '')});
            toast('Цель сохранена', 'success'); await load(el);
          } catch (error) { toast(error.message, 'error'); }
        }
      });
      el.addEventListener('submit', async event => {
        if (!event.target.matches('[data-tmx-custom]')) return;
        event.preventDefault();
        const form = event.target;
        filters = {period: 'custom', start: form.elements.start.value, end: form.elements.end.value};
        prefs.set('insights', filters);
        try { await load(el); } catch (error) { toast(error.message, 'error'); }
      });
    },
  });
  /* Navigation: registered with group 'Финансы' after «Аналитика»; the nav icon comes from core.js's iconPaths. */
})();
