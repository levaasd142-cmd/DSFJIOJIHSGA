'use strict';
/* Dialogs shared by several views: order card, manual completion, customer history, wallet. */
(() => {
  const {$, esc, api, money, usd, date, toast, orderBadge, orderTable, bindForm, confirm, cancelled} = TM;

  document.addEventListener('click', event => {
    const close = event.target.closest('[data-close]');
    if (close) close.closest('dialog')?.close();
  });
  // Clicking the dark backdrop closes a dialog, as Escape does.
  document.addEventListener('mousedown', event => {
    if (event.target.tagName === 'DIALOG' && event.target.open) {
      const r = event.target.getBoundingClientRect();
      if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) event.target.close();
    }
  });

  /* ------------------------------------------------------------ audit event formatting */
  const categories = {orders: 'Покупки и выдача', payments: 'Платежи', balance: 'Баланс', products: 'Товары и склад',
    finance: 'Финансы', system: 'Работа бота', settings: 'Настройки'};
  const levels = {info: 'Информация', warning: 'Требует внимания', error: 'Ошибка'};
  const legacy = {'product.save': 'Товар сохранён', 'product.delete': 'Товар удалён', 'stock.import': 'Загружен сток',
    'payment.accepted': 'Оплата получена', 'wallet.adjust': 'Баланс скорректирован', 'wallet.set': 'Установлен баланс',
    'wallet.credit': 'Зачислено пополнение Stars', 'wallet.credit_usdt': 'Зачислено пополнение USDT',
    'order.view': 'Открыта карточка заказа', 'order.details.view': 'Просмотрены данные заказа', 'order.claim': 'Заказ взят в работу',
    'order.complete': 'Заказ выполнен', 'order.resend': 'Повторная выдача', 'currency.rate': 'Изменён курс',
    'emoji.pack.import': 'Загружен набор эмодзи', 'emoji.assign': 'Назначен эмодзи', 'crypto.retry': 'Запрошена проверка платежа'};
  function eventDetails(event) {
    let d = {};
    try { d = JSON.parse(event.details || '{}'); } catch { /* old rows */ }
    const parts = [];
    if (d.title) parts.push(d.title);
    if (d.quantity) parts.push('Количество: ' + d.quantity);
    if (d.price !== undefined) parts.push('Сумма: ' + money(d.price));
    if (d.amount !== undefined) parts.push('Зачислено: ' + money(d.amount));
    if (d.before !== undefined) parts.push(money(d.before) + ' → ' + money(d.after));
    if (d.reason) parts.push('Причина: ' + d.reason);
    if (d.added !== undefined) parts.push('Добавлено: ' + d.added + ' · дублей: ' + d.duplicates);
    if (d.attempt) parts.push('Попытка: ' + d.attempt);
    if (d.method) parts.push('Оплата: ' + ({balance: 'Баланс', Stars: 'Stars'}[d.method] || d.method));
    return parts.map(esc).join(' · ');
  }
  const eventEntry = event => `<b>${esc(event.summary || legacy[event.action.split(':')[0]] || event.action)}</b><small>${eventDetails(event)}</small>`;
  TM.events = {categories, levels, entry: eventEntry};

  /* ------------------------------------------------------------ order card */
  async function showOrder(id) {
    const o = await api('orders/' + encodeURIComponent(id));
    const d = o.delivery;
    $('#info-title').textContent = 'Заказ #' + o.id.slice(0, 8);
    $('#info-body').innerHTML = `
      <p class="info-meta">${orderBadge(o)} <span>${date(o.created)}</span></p>
      <h3>${esc(o.title)} × ${o.quantity || 1}</h3>
      <dl class="facts">
        <dt>Покупатель</dt><dd>Telegram ID ${esc(o.user_id)}</dd>
        <dt>Сумма</dt><dd>${money(o.price)}</dd>
        <dt>Выдача</dt><dd>${o.mode === 'auto' ? 'Автовыдача' : 'Менеджер'}</dd>
        <dt>Ответственный</dt><dd>${esc(o.manager || 'Не назначен')}</dd>
        <dt>Доставка</dt><dd>${d ? (d.sent ? 'Отправлено' : 'Ожидает отправки') + ' · попыток ' + d.attempts : 'Не сформирована'}</dd>
      </dl>
      <div class="field-block"><span>Данные покупателя</span><pre>${esc(o.details || 'Не указаны')}</pre></div>
      <div class="field-block"><span>Результат выдачи</span><pre>${o.result_hidden ? 'Скрыто: нужно право stock.reveal' : esc(o.result || 'Ещё не выдан')}</pre></div>
      ${o.instruction ? `<p class="muted">${esc(o.instruction)}</p>` : ''}
      <div class="toolbar">${o.status === 'fulfilled' && TM.can('orders.manage') ? `<button class="action" type="button" data-resend="${esc(o.id)}">Повторить отправку результата</button>` : ''}<button class="action" type="button" data-customer="${esc(o.user_id)}">История покупателя</button></div>
      ${o.charge && TM.can('analytics') ? `<form id="order-cost-form" class="subform"><h3>Себестоимость заказа</h3><p class="muted">Заказ: <code>${esc(o.id)}</code> · Общая сумма за ${o.quantity || 1} шт. Исправление сохранится в журнале.</p>
        <div class="form-grid"><label>Общая себестоимость, $<input name="amount" type="number" min="0" max="10000000000" step="0.01" required value="${o.cost_total == null ? '' : (o.cost_total / 100).toFixed(2)}" placeholder="Не указана"></label><label>Причина исправления<input name="reason" required maxlength="300"></label></div>
        <p class="form-error" role="alert"></p><div class="toolbar"><button class="action" type="submit">Сохранить себестоимость</button><button class="subtle" type="button" data-finance-order="${esc(o.id)}">Записать возврат / замену</button></div></form>` : ''}
      <section class="timeline"><h3>История заказа</h3>${(o.events || []).map(event => `<div class="event-step"><small>${date(event.at)} · ${esc(event.actor)}</small>${eventEntry(event)}</div>`).join('') || '<p class="muted">События до обновления могут отсутствовать.</p>'}</section>`;
    const costForm = $('#order-cost-form');
    if (costForm) bindForm(costForm, async form => {
      await api('orders/' + encodeURIComponent(o.id) + '/cost', 'PUT', {amount: form.elements.amount.value, reason: form.elements.reason.value});
      toast('Себестоимость исправлена'); TM.emit('changed'); await showOrder(o.id);
      return false;
    });
    if (!$('#info-dialog').open) $('#info-dialog').showModal();
    return o;
  }

  async function showCustomer(uid) {
    const c = await api('customers/' + encodeURIComponent(uid));
    $('#info-title').textContent = 'Покупатель ' + c.user_id;
    // The wallet comes only with 'customers.balance'.
    const w = c.wallet;
    $('#info-body').innerHTML = (w ? `<p class="info-meta">Баланс: <b>${money(w.balance)}</b> ${TM.can('customers.balance') ? `<button class="action" type="button" data-wallet="${esc(c.user_id)}" data-balance="${esc(w.balance)}">Изменить баланс</button>` : ''}</p>
      <h3>Последние операции</h3>${w.history.length ? `<ul class="plain-list">${w.history.map(h => `<li><span>${date(h.created)}</span><b class="${h.delta < 0 ? 'negative' : 'positive'}">${h.delta > 0 ? '+' : ''}${money(h.delta)}</b></li>`).join('')}</ul>` : '<p class="muted">Нет операций</p>'}` : '')
      + `<h3>Заказы</h3>${orderTable(c.orders, false)}`;
    if (!$('#info-dialog').open) $('#info-dialog').showModal();
  }

  /* ------------------------------------------------------------ wallet */
  const walletForm = $('#wallet-form');
  function walletMode() {
    const set = walletForm.elements.mode.value === 'set', field = walletForm.elements.amount, isUsd = TM.usdActive();
    $('#wallet-amount-label').textContent = (set ? 'Новый баланс' : 'Изменение (минус — списание)') + ', ' + (isUsd ? '$' : 'Stars');
    field.step = isUsd ? '0.01' : '1';
    field.min = set ? '0' : '-100000';
    field.max = set ? '10000000000' : '100000';
    field.placeholder = isUsd ? 'Например: 125.50' : 'Например: 500';
  }
  walletForm.elements.mode.onchange = () => { walletForm.elements.amount.value = ''; walletMode(); };
  function openWallet(uid = '', balance = null) {
    walletForm.reset(); TM.formError(walletForm, null);
    walletForm.elements.uid.value = uid;
    walletForm.elements.reference.value = crypto.randomUUID();
    walletMode();
    walletForm.elements.amount.value = balance == null || balance === '' ? '' : TM.amountInput(Number(balance));
    $('#wallet-dialog').showModal();
  }
  bindForm(walletForm, async form => {
    const uid = form.elements.uid.value, value = form.elements.amount.value, reason = form.elements.reason.value.trim();
    const set = form.elements.mode.value === 'set', shown = TM.usdActive() ? usd(Math.round(Number(value) * 100)) : value + ' Stars';
    const ok = await confirm({title: 'Изменить баланс?', ok: 'Изменить баланс',
      text: `Покупатель ${uid}: ${set ? 'установить баланс' : 'изменить баланс на'} ${shown}. Причина: ${reason}.`});
    if (!ok) throw cancelled();
    const body = {reason, reference: form.elements.reference.value, [set ? 'amount' : 'delta']: value};
    const result = await api('customers/' + uid + (set ? '/balance' : '/wallet'), 'POST', body);
    if ($('#info-dialog').open) $('#info-dialog').close();
    toast('Баланс изменён: ' + money(result.wallet.balance), 'success');
    TM.emit('changed');
  });

  /* ------------------------------------------------------------ manual completion */
  const completeForm = $('#complete-form');
  async function openComplete(id) {
    const details = await api('orders/' + encodeURIComponent(id) + '/details');
    completeForm.reset(); TM.formError(completeForm, null);
    completeForm.elements.id.value = id;
    $('#complete-details').textContent = details.details || 'Данные отсутствуют';
    $('#complete-dialog').showModal();
  }
  bindForm(completeForm, async form => {
    await api('orders/' + encodeURIComponent(form.elements.id.value) + '/complete', 'POST', {result: form.elements.result.value});
    toast('Заказ выполнен. Результат в очереди отправки.', 'success');
    TM.emit('changed');
  });

  document.addEventListener('click', async event => {
    const button = event.target.closest('button');
    if (!button) return;
    const data = button.dataset;
    if (!(data.order || data.claim || data.complete || data.customer || data.resend || 'wallet' in data)) return;
    try {
      if (data.order) await showOrder(data.order);
      else if (data.customer) await showCustomer(data.customer);
      else if ('wallet' in data) openWallet(data.wallet, data.balance);
      else if (data.complete) await openComplete(data.complete);
      else if (data.claim) {
        button.disabled = true;
        await api('orders/' + encodeURIComponent(data.claim) + '/claim', 'POST');
        toast('Заказ взят в работу', 'success'); TM.emit('changed');
      } else if (data.resend) {
        if (!await confirm({title: 'Отправить результат повторно?', text: 'Покупатель снова получит ранее выданный результат. Новая единица стока не списывается.', ok: 'Отправить'})) return;
        button.disabled = true;
        await api('orders/' + encodeURIComponent(data.resend) + '/resend', 'POST');
        toast('Результат поставлен в очередь доставки', 'success'); await showOrder(data.resend);
      }
    } catch (error) {
      toast(error.message, 'error');
    } finally { button.disabled = false; }
  });

  TM.dialogs = {showOrder, showCustomer, openWallet};
})();
