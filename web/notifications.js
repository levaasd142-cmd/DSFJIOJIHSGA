'use strict';
/* Staff notifications (notify.py): admin chats, event toggles, low-stock threshold, daily summary.
   A tracked form: it never re-renders on its own. "Test message" queues one message per chat. */
(() => {
  const {esc, api, toast, bindForm, number} = TM;
  const toggles = [
    ['new_paid_order', 'Новый оплаченный заказ', 'Товар, сумма и покупатель — сразу после оплаты.'],
    ['manual_order_details', 'Данные для ручного заказа', 'Покупатель прислал данные — заказ ждёт менеджера.'],
    ['support_message', 'Сообщение в поддержку', 'Новое обращение или ответ покупателя.'],
    ['low_stock', 'Заканчивается сток', 'Не чаще раза в 6 часов на товар.'],
    ['payment_issue', 'Проблемный платёж', 'Оплата не совпала с заказом или пополнением.'],
    ['errors', 'Ошибки бота и панели', 'Сбои доставки и внутренние ошибки.'],
    ['daily_summary', 'Ежедневная сводка', 'Выручка, заказы и новые покупатели за вчера.'],
  ];
  const parseChats = text => text.split(/[\s,;]+/).filter(Boolean);

  TM.view({
    id: 'notifications', perm: ['settings'], feature: 'notify', title: 'Уведомления', nav: 'Уведомления',
    subtitle: 'Что бот присылает команде в Telegram и куда.',
    async render({el}) {
      const s = await api('notify');
      el.innerHTML = `<form id="notify-form" class="notify-grid" data-track>
        <section class="panel"><div class="panel-heading"><div><h2>Куда отправлять</h2><p>Личные чаты или группы. Узнать свой ID можно у @userinfobot; ID групп начинается с минуса.</p></div></div>
          <div class="panel-body"><label>ID чатов через запятую<textarea name="admin_chat_ids" rows="2" placeholder="123456789, -1001234567890" spellcheck="false">${esc((s.admin_chat_ids || []).join(', '))}</textarea><small>До 20 чатов. Каждый должен один раз написать боту /start (для групп — добавить бота).</small></label>
          <div class="toolbar flat"><button class="action" type="button" data-notify-test>Отправить тестовое сообщение</button><span class="muted" id="notify-test-result" role="status"></span></div></div></section>
        <section class="panel"><div class="panel-heading"><div><h2>О чём сообщать</h2><p>Повторы одного события объединяются, чтобы чат не превращался в шум.</p></div></div>
          <div class="toggle-list">${toggles.map(([key, title, hint]) => `<label class="switch-row"><span><b>${title}</b><small>${hint}</small></span><input type="checkbox" role="switch" name="${key}" ${s[key] ? 'checked' : ''}></label>`).join('')}</div></section>
        <section class="panel"><div class="panel-heading"><div><h2>Пороги и время</h2></div></div>
          <div class="panel-body form-grid"><label>Порог «заканчивается», шт.<input name="low_stock_threshold" type="number" min="0" max="10000" required value="${esc(s.low_stock_threshold)}"><small>Уведомить, когда свободного стока товара осталось столько или меньше.${Object.keys(s.low_stock_overrides || {}).length ? ' Особые пороги: ' + number(Object.keys(s.low_stock_overrides).length) + ' товаров.' : ''}</small></label>
          <label>Время ежедневной сводки, МСК<input name="daily_summary_time" type="time" required value="${esc(s.daily_summary_time)}"></label></div></section>
        <div class="sticky-actions"><p class="form-error" role="alert"></p><button class="primary" type="submit">Сохранить настройки</button></div>
      </form>`;
      const form = el.querySelector('#notify-form');
      bindForm(form, async f => {
        const body = {admin_chat_ids: parseChats(f.elements.admin_chat_ids.value).map(Number), low_stock_threshold: Number(f.elements.low_stock_threshold.value),
          daily_summary_time: f.elements.daily_summary_time.value, low_stock_overrides: s.low_stock_overrides || {}};
        if (body.admin_chat_ids.some(n => !Number.isInteger(n) || n === 0)) throw new TM.ApiError('ID чатов — целые числа, например 123456789 или -1001234567890', 0, 'admin_chat_ids');
        for (const [key] of toggles) body[key] = f.elements[key].checked;
        const saved = await api('notify', 'PUT', body);
        f.elements.admin_chat_ids.value = saved.admin_chat_ids.join(', ');
        Object.assign(s, saved);
        toast('Настройки уведомлений сохранены', 'success');
      });
      el.querySelector('[data-notify-test]').onclick = async event => {
        const b = event.currentTarget, out = el.querySelector('#notify-test-result');
        if (form.dataset.dirty) { out.textContent = 'Сначала сохраните изменения.'; return; }
        b.disabled = true; out.textContent = '';
        try {
          const result = await api('notify/test', 'POST');
          out.textContent = `В очереди: ${number(result.queued)}. Запущенный бот отправит в течение минуты.`;
          toast('Тестовое сообщение поставлено в очередь', 'success');
        } catch (error) { out.textContent = error.message; } finally { b.disabled = false; }
      };
    },
  });
})();
