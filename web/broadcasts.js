'use strict';
/* Broadcasts: audience, automatic notifications (a tracked form) and campaign history.
   Auto-refresh only reloads the history table, never the settings form. */
(() => {
  const {$, esc, api, state, number, date, empty, toast, confirm, table} = TM;
  const states = {draft: 'Черновик', scheduled: 'Запланирована', queued: 'В очереди', running: 'Отправляется', paused: 'На паузе', completed: 'Завершена', cancelled: 'Отменена'};
  const kinds = {custom: 'Своя рассылка', new_product: 'Новый товар', restock: 'Пополнение стока'};
  let page = 1, audience = 0;
  const segmentLabels = {all: 'Все получатели', buyers: 'Покупатели', non_buyers: 'Ещё не покупали', language: 'Язык', product: 'Купили товар', inactive: 'Давно не заходили'};
  function segmentText(segment) {
    if (!segment || segment.type === 'all') return segmentLabels.all;
    if (segment.type === 'language') return 'Язык: ' + (segment.language === 'en' ? 'English' : 'русский');
    if (segment.type === 'product') return 'Купили: ' + (state.products.find(p => p.id === segment.product_id)?.name || '#' + segment.product_id);
    if (segment.type === 'inactive') return 'Не заходили ' + number(segment.days) + '+ дн.';
    return segmentLabels[segment.type] || segment.type;
  }

  function actions(item) {
    const id = esc(item.id), status = item.status;
    return `<div class="row-actions"><button class="action" type="button" data-news-detail="${id}">${status === 'draft' ? 'Предпросмотр' : 'Подробнее'}</button>` +
      (['queued', 'running'].includes(status) ? `<button class="action" type="button" data-news-action="pause" data-news-id="${id}">Пауза</button>` : '') +
      (status === 'paused' ? `<button class="action" type="button" data-news-action="resume" data-news-id="${id}">Продолжить</button>` : '') +
      (['draft', 'scheduled', 'queued', 'running', 'paused'].includes(status) ? `<button class="action danger" type="button" data-news-action="cancel" data-news-id="${id}">Отменить</button>` : '') + '</div>';
  }
  function history(data) {
    const rows = table([
      {label: 'Рассылка', cell: item => `${esc(item.title)}<small>${esc(kinds[item.kind] || item.kind)} · ${esc(segmentText(item.segment))}${item.scheduled_at ? ' · ' + date(item.scheduled_at) : ''}</small>`},
      {label: 'Статус', cell: item => TM.badge(states[item.status] || item.status, item.status === 'completed' ? 'green' : item.status === 'cancelled' ? 'red' : item.status === 'scheduled' ? 'orange' : 'blue')},
      {label: 'Доставка', cell: item => `${number(item.counts.sent)} / ${number(item.counts.total)}<small>${item.counts.failed + item.counts.uncertain ? 'Ошибок: ' + number(item.counts.failed + item.counts.uncertain) + ' · ' : ''}Пропущено: ${number(item.counts.blocked + item.counts.skipped)}</small>`},
      {label: 'Создана', cell: item => date(item.created)},
      {label: 'Действия', className: 'actions', cell: actions},
    ], data.items);
    return `<div class="panel-heading"><div><h2>История рассылок</h2><p>Отправлено — Telegram принял сообщение. Счётчика прочтений нет.</p></div><span class="muted">${number(data.total)} всего</span></div>` +
      (rows ? rows + TM.pager(data) : empty('Пока нет рассылок', 'Добавьте сток или подготовьте своё сообщение.'));
  }
  async function load() {
    const data = await api('broadcasts?page=' + page);
    page = data.page; audience = data.audience;
    return data;
  }

  TM.view({
    id: 'broadcasts', perm: ['broadcasts'], title: 'Рассылки', subtitle: 'Новости магазина и сообщения покупателям.',
    async render({el}) {
      const data = await load();
      el.innerHTML = `<div class="news-summary"><div><span class="eyebrow">НА СВЯЗИ С ПОКУПАТЕЛЯМИ</span><h2>${number(data.audience)} <small>получателей</small></h2><p>Пользователи магазина, которые не отключили новости и не заблокировали бота.</p></div><button class="primary" type="button" data-news-new>+ Создать рассылку</button></div>
        <div class="workflow-help">Сообщения отправляет запущенный бот. Пока он выключен, рассылки ждут в очереди.${!state.bot_configured ? ' Токен бота ещё не настроен.' : ''}</div>
        <section class="panel"><div class="panel-heading"><div><h2>Автоматические уведомления</h2><p>Отправляются всем получателям на выбранном в боте языке.</p></div></div>
          <form id="news-settings" class="news-settings" data-track><label class="checkbox"><input type="checkbox" name="new_product" ${data.settings.new_product ? 'checked' : ''}><span><b>Новый товар</b><small>Когда опубликованный товар становится доступен для покупки.</small></span></label><label class="checkbox"><input type="checkbox" name="restock" ${data.settings.restock ? 'checked' : ''}><span><b>Пополнение стока</b><small>После добавления новых единиц. Дубли пропускаются.</small></span></label><p class="form-error" role="alert"></p><button class="action" type="submit">Сохранить настройки</button></form>
          <div class="workflow-help">Первые 30 секунд загрузки одного товара объединяются. Уже созданные рассылки управляются отдельно в истории.</div></section>
        <section class="panel" id="news-history">${history(data)}</section>`;
      TM.bindForm(el.querySelector('#news-settings'), async form => {
        await api('broadcasts/settings', 'PUT', {new_product: form.elements.new_product.checked, restock: form.elements.restock.checked});
        toast('Настройки рассылок сохранены', 'success');
      });
    },
    async refresh(root) {
      const box = root?.querySelector('#news-history');
      if (box) box.innerHTML = history(await load());
    },
  });

  /* ------------------------------------------------------------ compose & preview */
  const form = $('#news-form');
  const plainLen = text => (TM.emojiPlain ? TM.emojiPlain(text) : text).length;
  function compose(draft) {
    form.reset(); TM.formError(form, null);
    form.elements.reference.value = crypto.randomUUID();
    form.elements.product_id.innerHTML = state.products.filter(p => p.active).map(p => `<option value="${p.id}">${esc(TM.emojiPlain ? TM.emojiPlain(p.name) : p.name)}</option>`).join('');
    form.elements.segment_product.innerHTML = state.products.map(p => `<option value="${p.id}">${esc(p.category)} · ${esc(TM.emojiPlain ? TM.emojiPlain(p.name) : p.name)}</option>`).join('');
    form.querySelector('.segment-box').hidden = !state.features?.segments;
    form.dataset.edit = draft?.id || '';
    $('#news-compose-title').textContent = draft ? 'Изменить черновик' : 'Новая рассылка';
    if (draft) {
      form.elements.reference.value = draft.id; form.elements.title.value = draft.title;
      for (const key of ['text', 'text_en', 'button_text', 'target', 'url', 'product_id']) form.elements[key].value = draft.content[key] ?? '';
      form.elements.with_banner.checked = draft.content.with_banner;
      const segment = draft.segment || {type: 'all'};
      form.elements.segment_kind.value = segment.type;
      if (segment.language) form.elements.segment_language.value = segment.language;
      if (segment.product_id) form.elements.segment_product.value = segment.product_id;
      if (segment.days) form.elements.segment_days.value = segment.days;
      form.elements.scheduled_at.value = TM.moscowInput.toLocal(draft.scheduled_at);
    }
    lastSegment = '';
    formState(); $('#news-compose').showModal();
  }
  let lastSegment = '', countRequest = 0;
  function segment() {
    const kind = form.elements.segment_kind.value, result = {type: kind};
    if (kind === 'language') result.language = form.elements.segment_language.value;
    if (kind === 'product') result.product_id = Number(form.elements.segment_product.value);
    if (kind === 'inactive') result.days = Number(form.elements.segment_days.value);
    return result;
  }
  const countAudience = TM.debounce(async () => {
    const s = segment(), key = JSON.stringify(s), mine = ++countRequest, out = $('#audience-count');
    if (key === lastSegment) return;
    lastSegment = key;
    if (s.type === 'inactive' && !(s.days >= 1)) { out.textContent = 'Укажите число дней от 1 до 3650'; return; }
    out.textContent = 'Считаем получателей…';
    try {
      const params = new URLSearchParams({type: s.type, language: s.language || '', product_id: String(s.product_id || 0), days: String(s.days || 0)});
      const result = await api('broadcasts/audience?' + params);
      if (mine !== countRequest) return;
      out.innerHTML = result.count == null ? 'Размер аудитории станет доступен после обновления модуля рассылок'
        : `Получат: <b>${number(result.count)}</b>${result.total != null && s.type !== 'all' ? ` из ${number(result.total)}` : ''} · без отписавшихся и заблокировавших бота`;
    } catch (error) { if (mine === countRequest) { out.textContent = error.message; lastSegment = ''; } }
  }, 250);
  function formState() {
    const kind = form.elements.segment_kind.value;
    $('#segment-language-label').hidden = kind !== 'language'; $('#segment-product-label').hidden = kind !== 'product'; $('#segment-days-label').hidden = kind !== 'inactive';
    if (!form.querySelector('.segment-box').hidden) countAudience();
    const target = form.elements.target.value, limit = form.elements.with_banner.checked ? 1024 : 3500;
    $('#news-product-label').hidden = target !== 'product'; $('#news-url-label').hidden = target !== 'url'; $('#news-button-label').hidden = target === 'none';
    form.elements.url.required = target === 'url'; form.elements.product_id.required = target === 'product';
    form.elements.url.disabled = target !== 'url'; form.elements.product_id.disabled = target !== 'product';
    $('#news-counter').textContent = `${plainLen(form.elements.text.value)} / ${limit} · английская версия: ${plainLen(form.elements.text_en.value)} / ${limit}`;
    for (const key of ['text', 'text_en']) form.elements[key].setCustomValidity(form.elements[key].value.length > limit ? 'Текст превышает лимит ' + limit + ' символов' : '');
  }
  form.addEventListener('input', formState); form.addEventListener('change', formState);
  TM.bindForm(form, async f => {
    const raw = Object.fromEntries(new FormData(f)), data = {};
    for (const key of ['reference', 'title', 'text', 'text_en', 'button_text', 'target', 'url']) data[key] = raw[key] ?? '';
    data.product_id = data.target === 'product' ? Number(raw.product_id) : null;
    data.with_banner = f.elements.with_banner.checked;
    if (state.features?.segments) {
      data.segment = segment();
      data.scheduled_at = TM.moscowInput.fromLocal(f.elements.scheduled_at.value);
      if (data.scheduled_at && data.scheduled_at < Date.now() / 1000) throw new TM.ApiError('Время запуска уже прошло', 0, 'scheduled_at');
    }
    const result = await api('broadcasts' + (f.dataset.edit ? '/' + encodeURIComponent(f.dataset.edit) : ''), f.dataset.edit ? 'PUT' : 'POST', data);
    $('#news-compose').close();
    await preview(result.id);
    TM.emit('changed');
  });

  function previewText(p) {
    let cursor = 0, html = '';
    for (const entity of (p.entities || []).filter(e => e.type === 'custom_emoji').sort((a, b) => a.offset - b.offset)) {
      if (!/^[0-9]{1,20}$/.test(entity.custom_emoji_id) || !Number.isInteger(entity.offset) || !Number.isInteger(entity.length) ||
        entity.offset < cursor || entity.length <= 0 || entity.offset + entity.length > p.text.length) continue;
      html += esc(p.text.slice(cursor, entity.offset)) + TM.emojiImage(entity.custom_emoji_id, p.text.slice(entity.offset, entity.offset + entity.length));
      cursor = entity.offset + entity.length;
    }
    return html + esc(p.text.slice(cursor));
  }
  async function preview(id) {
    const data = await api('broadcasts/' + encodeURIComponent(id)), body = $('#news-preview-body');
    $('#news-preview-title').textContent = data.title;
    body.innerHTML = `<div class="news-preview-tabs segmented"><button type="button" data-news-language="ru">Русский</button><button type="button" data-news-language="en">English</button><span class="muted">${esc(states[data.status] || data.status)}</span></div>
      <div class="news-message"><img id="news-preview-banner" src="/api/broadcasts/banner" alt="Баннер TheMarket" hidden><div id="news-preview-text"></div><div id="news-preview-buttons"></div></div>
      <p class="muted" id="news-preview-destination"></p>
      <p class="muted">${data.status === 'draft' ? `Аудитория: ${esc(segmentText(data.segment))} · сейчас ${number(data.audience ?? audience)}. Получатели фиксируются при запуске${data.scheduled_at ? ` · запуск ${date(data.scheduled_at)} (после нажатия «Запланировать»)` : ''}.` : `Отправлено: ${number(data.counts.sent)} из ${number(data.counts.total)} · ошибок: ${number(data.counts.failed)} · блокировок: ${number(data.counts.blocked)} · пропущено: ${number(data.counts.skipped)} · неизвестный результат: ${number(data.counts.uncertain)}.`}</p>
      ${data.counts.uncertain ? '<p class="muted">После обрыва связи результат отправки может быть неизвестен. Такие сообщения не повторяются автоматически, чтобы не присылать дубли.</p>' : ''}
      <p class="form-error" role="alert"></p>
      <div class="dialog-actions">${data.status === 'draft' ? `<button class="action" type="button" data-news-edit="${esc(id)}">Изменить</button><button class="primary" type="button" data-news-action="start" data-news-id="${esc(id)}">${data.scheduled_at ? 'Запланировать' : 'Начать рассылку'} · ${number(data.audience ?? audience)} получателей</button>` : ''}<button class="action" type="button" data-close>Закрыть</button></div>`;
    const show = language => {
      const p = data.previews[language];
      $('#news-preview-text').innerHTML = previewText(p);
      $('#news-preview-banner').hidden = !p.banner;
      $('#news-preview-buttons').innerHTML = p.keyboard.inline_keyboard.map(row => `<div>${row.map(b => `<span>${b.icon_custom_emoji_id ? TM.emojiImage(b.icon_custom_emoji_id, '📦') + ' ' : ''}${esc(b.text)}</span>`).join('')}</div>`).join('');
      const primary = p.keyboard.inline_keyboard.flat()[0];
      let destination = 'Без основной кнопки';
      if (primary?.url) destination = 'Ссылка кнопки: ' + primary.url;
      else if (primary?.callback_data === 'catalog') destination = 'Кнопка открывает каталог магазина';
      else if (primary?.callback_data?.startsWith('product:')) {
        const pid = Number(primary.callback_data.slice(8));
        destination = 'Товар по кнопке: ' + (state.products.find(item => item.id === pid)?.name || '#' + pid);
      }
      $('#news-preview-destination').textContent = destination;
      body.querySelectorAll('[data-news-language]').forEach(b => b.classList.toggle('active', b.dataset.newsLanguage === language));
    };
    body.querySelectorAll('[data-news-language]').forEach(b => { b.onclick = () => show(b.dataset.newsLanguage); });
    show('ru');
    if (!$('#news-preview').open) $('#news-preview').showModal();
  }

  document.addEventListener('click', async event => {
    const button = event.target.closest('[data-news-new],[data-news-detail],[data-news-action],[data-news-edit],#news-history [data-page]');
    if (!button) return;
    if ('newsNew' in button.dataset) { compose(); return; }
    button.disabled = true;
    try {
      if (button.dataset.newsEdit) {
        const draft = await api('broadcasts/' + encodeURIComponent(button.dataset.newsEdit));
        if (draft.status !== 'draft') throw new Error('Изменить можно только черновик');
        $('#news-preview').close(); compose(draft);
      } else if (button.dataset.newsDetail) await preview(button.dataset.newsDetail);
      else if (button.dataset.page) { page = Number(button.dataset.page); await TM.views.get('broadcasts').refresh($('#view .view-root')); }
      else {
        const action = button.dataset.newsAction;
        if (action === 'cancel' && !await confirm({title: 'Отменить рассылку?', text: 'Оставшиеся сообщения не будут отправлены. Уже доставленные сообщения останутся у покупателей.', ok: 'Отменить рассылку', danger: true})) return;
        await api('broadcasts/' + encodeURIComponent(button.dataset.newsId) + '/' + action, 'POST');
        if ($('#news-preview').open) $('#news-preview').close();
        toast(action === 'start' ? 'Рассылка запущена или запланирована' : 'Статус рассылки изменён', 'success');
        TM.emit('changed');
      }
    } catch (error) {
      const box = $('#news-preview[open] .form-error');
      if (box) box.textContent = error.message; else toast(error.message, 'error');
    } finally { button.disabled = false; }
  });
})();
