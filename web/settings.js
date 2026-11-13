'use strict';
/* Settings screens: currency & payment methods, bot channel gate.
   These views never auto-refresh: forms are tracked (data-track) and only re-render on user action. */
(() => {
  const {esc, api, state, date, toast, confirm, bindForm, cancelled} = TM;

  function methodForm(method) {
    if (method.network === 'stars') {
      return `<form class="method-form" data-track data-method="stars"><h3>Telegram Stars</h3><label class="checkbox"><input name="enabled" type="checkbox" ${method.enabled ? 'checked' : ''}> Доступен покупателям</label><p class="form-error" role="alert"></p><button class="primary" type="submit">Сохранить</button></form>`;
    }
    const keyed = ['ton', 'tron'].includes(method.network);
    return `<form class="method-form" data-track data-method="${esc(method.network)}"><h3>USDT · ${esc(method.label)}</h3>
      <label class="checkbox"><input name="enabled" type="checkbox" ${method.enabled ? 'checked' : ''}> Доступен покупателям</label>
      <label>Адрес получения в сети ${esc(method.label)}<input name="wallet" maxlength="150" value="${esc(method.wallet)}" placeholder="Адрес вашего кошелька" autocomplete="off"></label>
      ${keyed ? `<label>API-ключ ${method.network === 'ton' ? 'Toncenter' : 'TronGrid'} (необязательно)<input name="api_key" type="password" autocomplete="new-password" maxlength="500" placeholder="${method.has_api_key ? 'Ключ сохранён. Оставьте пустым, чтобы сохранить' : 'Без ключа действуют лимиты публичного API'}"></label><label class="checkbox"><input name="clear_key" type="checkbox"> Удалить сохранённый API-ключ</label>` : ''}
      <small class="muted method-token">Официальный токен: ${esc(method.token)} · ${esc(method.decimals)} знаков. Только mainnet.</small>
      <p class="form-error" role="alert"></p><button class="primary" type="submit">Сохранить ${esc(method.label)}</button></form>`;
  }

  TM.view({
    id: 'currency', perm: ['settings'], title: 'Оплата и валюта', subtitle: 'Курс Stars, способы оплаты и кошельки USDT.',
    async render({el}) {
      const methods = await api('payment-methods'), active = TM.usdActive();
      el.innerHTML = `<div class="notice"><h2>${active ? 'USD · доллары магазина' : 'Сейчас цены и балансы в Stars'}</h2><p>${active
        ? '100 центов = $1.00. Пополнение: Stars и включённые сети USDT. Курс фиксируется при создании счёта. Изменение курса влияет на новые счета; долларовые цены и балансы повторно не пересчитываются.'
        : 'Укажите курс, чтобы перевести магазин в доллары. Существующие цены и балансы будут пересчитаны, перед этим создаётся резервная копия.'}</p></div>
        <section class="panel"><form id="currency-form" class="inline-form" data-track><label>Stars за $1<input name="stars_per_usd" type="number" min="0.01" step="0.01" max="1000000" required value="${esc(state.currency?.stars_per_usd || '100')}"></label><button class="primary" type="submit">${active ? 'Сохранить курс' : 'Перейти на доллары'}</button><p class="form-error" role="alert"></p></form></section>
        <section class="panel payment-methods"><div class="panel-heading"><div><h2>Способы оплаты</h2><p>USDT зачисляется в доллары магазина по курсу 1:1. Срок оплаты — 15 минут.</p></div></div>
        <div class="method-grid">${methodForm({network: 'stars', enabled: methods.stars})}${methods.networks.map(methodForm).join('')}</div></section>`;
      bindForm(el.querySelector('#currency-form'), async form => {
        const rate = form.elements.stars_per_usd.value;
        const ok = await confirm({title: `Установить ${rate} Stars за $1?`, ok: 'Сохранить курс',
          text: active ? 'Старые счета сохранят свои суммы.' : 'Существующие цены и балансы будут переведены в доллары. Будет создана резервная копия.'});
        if (!ok) throw cancelled();
        await api('currency', 'POST', {stars_per_usd: rate});
        toast('Курс сохранён', 'success');
        delete form.dataset.dirty;
        TM.emit('changed');
      });
      for (const form of el.querySelectorAll('.method-form')) {
        bindForm(form, async () => {
          const body = {enabled: form.elements.enabled.checked};
          if (form.dataset.method !== 'stars') {
            Object.assign(body, {wallet: form.elements.wallet.value, api_key: form.elements.api_key?.value || '', clear_key: form.elements.clear_key?.checked || false});
          }
          await api('payment-methods/' + form.dataset.method, 'PUT', body);
          if (form.elements.api_key) { form.elements.api_key.value = ''; form.elements.api_key.placeholder = body.clear_key ? 'Ключ удалён' : 'Настройки ключа сохранены'; }
          if (form.elements.clear_key) form.elements.clear_key.checked = false;
          toast('Способ оплаты сохранён. Новые счета используют эти настройки.', 'success');
        });
      }
    },
  });

  TM.view({
    id: 'bot-settings', perm: ['settings'], title: 'Настройки бота', subtitle: 'Канал магазина и первый вход покупателей.',
    async render({el}) {
      const data = await api('channel-gate'), privateChannel = data.channel_ref.startsWith('-');
      el.innerHTML = `<section class="panel channel-panel"><div class="panel-heading"><div><h2>Подписка на канал при первом входе</h2><p>Новый покупатель выбирает язык, подписывается на канал и открывает магазин.</p></div><span id="channel-state" class="badge ${data.enabled ? 'green' : 'orange'}">${data.enabled ? 'Включена' : 'Выключена'}</span></div>
        <form id="channel-form" data-track><label class="checkbox"><input name="enabled" type="checkbox" ${data.enabled ? 'checked' : ''}> Обязательная подписка для новых покупателей</label>
        <label>Канал магазина<input name="channel" maxlength="100" value="${esc(data.channel_ref)}" placeholder="@TheMarketFresh или https://t.me/TheMarketFresh" autocomplete="off"></label>
        <p class="muted">Для публичного канала достаточно @username. Для закрытого — ID вида -100… и пригласительная ссылка ниже.</p>
        <details data-key="private-channel" ${privateChannel ? 'open' : ''}><summary>Закрытый канал</summary><label>Пригласительная ссылка<input name="join_url" type="url" maxlength="250" value="${privateChannel ? esc(data.join_url) : ''}" placeholder="https://t.me/+…" autocomplete="off"></label><p class="muted">Скопируйте действующую ссылку именно из этого канала. Если вход по заявкам, покупатель должен дождаться одобрения перед проверкой.</p></details>
        <div class="channel-steps"><b>Подключение канала</b><ol><li>Добавьте бота магазина в администраторы канала. Права публикации для проверки подписки не требуются.</li><li>Укажите канал и нажмите «Проверить канал».</li><li>Включите обязательную подписку и сохраните настройки.</li></ol></div>
        <p id="channel-check-result" class="muted" role="status">${data.checked_at ? 'Последняя успешная проверка: ' + date(data.checked_at) + '. Канал: ' + esc(data.title) : 'Канал ещё не проверен.'}</p>
        <p class="form-error" role="alert"></p><div class="toolbar"><button class="action" type="button" data-channel-check>Проверить канал</button><button class="primary" type="submit">Сохранить настройки</button></div>
        <p class="muted">При включении канал и права бота проверяются повторно. Старые покупатели продолжают пользоваться магазином. Успешная подписка запоминается: проверять её при каждом переходе не нужно.</p></form></section>
        <div class="workflow-help"><b>Один раз перед входом</b><span>До подтверждения подписки доступны выбор языка и поддержка. Перезапуск бота не сбрасывает результат проверки.</span></div>`;
      const form = el.querySelector('#channel-form'), status = el.querySelector('#channel-check-result');
      const input = () => ({enabled: form.elements.enabled.checked, channel: form.elements.channel.value, join_url: form.elements.join_url.disabled ? '' : form.elements.join_url.value});
      const sync = () => {
        const isPrivate = form.elements.channel.value.trim().startsWith('-');
        form.elements.join_url.disabled = !isPrivate;
        form.elements.join_url.required = isPrivate && form.elements.enabled.checked;
      };
      form.addEventListener('input', sync); sync();
      async function run(checkOnly) {
        TM.formError(form, null);
        if (!form.reportValidity()) return;
        form.querySelectorAll('button').forEach(b => { b.disabled = true; });
        status.textContent = checkOnly ? 'Проверяем канал и права бота…' : 'Сохраняем настройки…';
        const body = input();
        try {
          const result = await api(checkOnly ? 'channel-gate/check' : 'channel-gate', checkOnly ? 'POST' : 'PUT', body);
          if (checkOnly) status.textContent = 'Канал «' + result.title + '» доступен. Бот — администратор. Проверка успешна; настройки ещё не сохранены.';
          else {
            delete form.dataset.dirty;
            status.textContent = body.enabled ? 'Обязательная подписка включена для новых покупателей.' : 'Обязательная подписка выключена.';
            const stateBadge = el.querySelector('#channel-state');
            stateBadge.textContent = body.enabled ? 'Включена' : 'Выключена'; stateBadge.className = 'badge ' + (body.enabled ? 'green' : 'orange');
            toast('Настройки бота сохранены', 'success');
          }
        } catch (failure) {
          TM.formError(form, failure);
          status.textContent = 'Проверка не завершена. Сохранённые настройки не изменены.';
        } finally { form.querySelectorAll('button').forEach(b => { b.disabled = false; }); }
      }
      form.onsubmit = event => { event.preventDefault(); run(false); };
      form.querySelector('[data-channel-check]').onclick = () => run(true);
    },
  });
})();
