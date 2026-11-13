'use strict';
/* 3.1 enhancers for existing views (no edits to their files): customer tags/notes/ban, tag filter and
   row marks on «Покупатели», internal notes in the order card, reply templates in «Поддержка» and
   bulk selection on «Товары». They run after a view renders — via TM.on('view:rendered') when the
   shell emits it, and a MutationObserver on #view / #info-body otherwise — and are idempotent. */
(() => {
  const T = typeof TM !== 'undefined' ? TM : window.TM;
  if (!T) return;
  const {esc, api, toast, date} = T;
  const can = (...names) => T.can(...names);
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const screen = () => document.body.dataset.screen || '';

  /* ------------------------------------------------------------ plumbing */
  const enhancers = [];
  let pending = false;
  function schedule() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      for (const enhance of enhancers) {
        try { enhance(); } catch { /* an enhancer must never break the view it decorates */ }
      }
    });
  }
  const watch = target => { if (target) new MutationObserver(schedule).observe(target, {childList: true, subtree: true}); };
  watch(document.getElementById('view'));
  watch(document.getElementById('info-body'));
  T.on?.('view:rendered', schedule);
  const tag = (text, extra = '') => `<span class="tmx-tag ${extra}">${esc(text)}</span>`;
  const plural = (n, one, few, many) => { const a = n % 10, b = n % 100; return a === 1 && b !== 11 ? one : a >= 2 && a <= 4 && (b < 12 || b > 14) ? few : many; };

  /* ================================================================ customers: marks and tag filter */
  const marks = new Map();            // user_id → {tags, banned}
  let tagList = null, tagListAt = 0, filter = {tag: '', banned: false, page: 1};

  async function loadMarks(ids) {
    const missing = ids.filter(id => !marks.has(id));
    for (let i = 0; i < missing.length; i += 200) {
      const data = await api('customers/marks?ids=' + missing.slice(i, i + 200).join(','));
      for (const [id, value] of Object.entries(data.items)) marks.set(id, value);
    }
  }
  const markHtml = m => m && (m.tags.length || m.banned) ? `<span class="tmx-tags">${m.banned ? tag('Заблокирован', 'banned') : ''}${m.tags.map(t => tag(t)).join('')}</span>` : '';
  async function markRows(container) {
    const rows = $$('tbody tr', container).filter(tr => !tr.dataset.tmxMarked && $('[data-customer]', tr));
    if (!rows.length) return;
    rows.forEach(tr => { tr.dataset.tmxMarked = '1'; });
    const ids = rows.map(tr => $('[data-customer]', tr).dataset.customer);
    await loadMarks(ids);
    rows.forEach((tr, i) => {
      const cell = $('td .cell', tr), html = markHtml(marks.get(ids[i]));
      if (cell && html && !$('.tmx-tags', cell)) cell.insertAdjacentHTML('beforeend', html);
    });
  }
  async function tags() {
    if (!tagList || Date.now() - tagListAt > 30000) { tagList = (await api('customers/tags')).items; tagListAt = Date.now(); }
    return tagList;
  }
  function forgetCustomer(uid) { marks.delete(String(uid)); tagList = null; }

  async function drawTagBar(panel) {
    let bar = $('.tmx-tagbar', panel);
    if (!bar) {
      bar = document.createElement('div');
      bar.className = 'tmx-tagbar'; bar.setAttribute('role', 'group'); bar.setAttribute('aria-label', 'Фильтр по меткам');
      ($('.toolbar', panel) || panel.firstElementChild).after(bar);
      bar.addEventListener('click', event => {
        const b = event.target.closest('button');
        if (!b) return;
        if ('tmxBanned' in b.dataset) filter = {tag: '', banned: !filter.banned, page: 1};
        else filter = {tag: filter.tag === b.dataset.tmxTag ? '' : b.dataset.tmxTag, banned: false, page: 1};
        bar.dataset.key = '';
        schedule();
      });
    }
    const list = await tags();
    const key = JSON.stringify([list, filter.tag, filter.banned]);
    if (bar.dataset.key === key) return;
    bar.dataset.key = key;
    bar.innerHTML = `<span>Метки:</span>${list.map(t => `<button type="button" data-tmx-tag="${esc(t.tag)}" aria-pressed="${filter.tag === t.tag}">${esc(t.tag)} <b>${T.number(t.count)}</b></button>`).join('') || '<span class="muted">пока нет — добавьте в карточке покупателя</span>'}
      <button type="button" class="danger" data-tmx-banned aria-pressed="${filter.banned}">Заблокированные</button>`;
  }
  async function drawFiltered(panel) {
    const original = $('#customer-table', panel);
    let box = $('.tmx-tag-results', panel);
    const active = filter.tag || filter.banned;
    original?.classList.toggle('tmx-hidden', Boolean(active));
    if (!active) { box?.remove(); return; }
    const key = JSON.stringify(filter);
    if (box && box.dataset.key === key) return;
    if (!box) {
      box = document.createElement('div'); box.className = 'tmx-tag-results'; box.setAttribute('aria-live', 'polite');
      original.after(box);
      box.addEventListener('click', event => {
        const b = event.target.closest('[data-page]');
        if (b) { event.stopPropagation(); filter.page = Number(b.dataset.page); box.dataset.key = ''; schedule(); }
      });
    }
    box.dataset.key = key;
    const data = await api('customers?' + new URLSearchParams({tag: filter.tag, banned: String(filter.banned), page: String(filter.page)}));
    data.items.forEach(c => marks.set(String(c.user_id), {tags: c.tags || [], banned: Boolean(c.banned)}));
    const money = can('customers.balance');
    box.innerHTML = (T.table([
      {label: 'Покупатель', cell: c => `${esc([c.first_name, c.last_name].filter(Boolean).join(' ') || 'Без имени')}<small>${c.username ? '@' + esc(c.username) + ' · ' : ''}ID ${esc(c.user_id)}</small>`},
      money && {label: 'Покупки', className: 'nowrap', cell: c => T.money(c.spent)},
      {label: 'Заказов', cell: c => T.number(c.orders)},
      {label: 'Активность', cell: c => T.date(c.last_seen)},
      {label: 'Действия', className: 'actions', cell: c => `<div class="row-actions"><button class="action" type="button" data-customer="${esc(c.user_id)}">История</button></div>`},
    ].filter(Boolean), data.items) || T.empty('Никого не нашлось', filter.banned ? 'Заблокированных покупателей нет.' : 'Эту метку сейчас никто не носит.')) + T.pager(data);
    markRows(box);
  }
  enhancers.push(() => {
    if (screen() !== 'customers' || !can('customers.view')) return;
    const table = $('#view #customer-table');
    if (!table) return;
    const panel = table.closest('.panel');
    drawTagBar(panel).catch(() => {});
    drawFiltered(panel).catch(error => toast(error.message, 'error'));
    markRows(table).catch(() => {});
  });

  /* ================================================================ customer card: tags, note, ban */
  const infoTitle = () => $('#info-title')?.textContent || '';
  function crmHtml(meta) {
    const edit = can('orders.manage', 'support'), ban = can('customers.balance');
    const chips = meta.tags.map(t => `<span class="tmx-tag">${esc(t)}${edit ? `<button type="button" data-tmx-untag="${esc(t)}" aria-label="Убрать метку ${esc(t)}">×</button>` : ''}</span>`).join('');
    const banText = meta.banned ? `Заблокирован ${esc(date(meta.banned_at))}${meta.banned_by ? ' · ' + esc(meta.banned_by) : ''}: ${esc(meta.ban_reason)}` : 'Доступ к боту открыт.';
    return `<h3>CRM <small>видно только сотрудникам</small></h3>
      ${edit ? `<div class="tmx-tag-editor">${chips}<input type="text" maxlength="24" placeholder="${meta.tags.length >= 10 ? 'Не больше 10 меток' : 'Новая метка — Enter'}" aria-label="Добавить метку" data-tmx-newtag ${meta.tags.length >= 10 ? 'disabled' : ''}></div>`
        : `<div class="tmx-tags">${chips || '<span class="muted">Меток нет</span>'}</div>`}
      <label class="tmx-gap">Внутренняя заметка<textarea rows="3" maxlength="2000" data-tmx-note ${edit ? '' : 'readonly'} placeholder="${edit ? 'Например: покупает для команды, счёт на компанию' : 'Заметки нет'}">${esc(meta.note || '')}</textarea></label>
      ${edit ? '<div class="tmx-row-actions"><button class="action" type="button" data-tmx-save-note>Сохранить заметку</button><span class="tmx-saved" role="status"></span></div>' : ''}
      <div class="tmx-ban tmx-gap ${meta.banned ? 'on' : ''}"><span>${banText}</span>${ban ? (meta.banned
        ? '<button class="action" type="button" data-tmx-unban>Разблокировать</button>' : '<button class="action danger" type="button" data-tmx-ban>Заблокировать</button>') : ''}</div>`;
  }
  async function customerCard(body, uid) {
    const section = document.createElement('section');
    section.className = 'tmx-section tmx-crm'; section.dataset.uid = uid;
    section.innerHTML = '<p class="muted">Загрузка CRM…</p>';
    body.prepend(section);
    let meta = await api(`customers/${uid}/meta`);
    const draw = () => { section.innerHTML = crmHtml(meta); };
    const saveTags = async next => {
      try { meta = await api(`customers/${uid}/tags`, 'PUT', {tags: next}); forgetCustomer(uid); draw(); $('[data-tmx-newtag]', section)?.focus(); }
      catch (error) { toast(error.message, 'error'); }
    };
    section.addEventListener('keydown', event => {
      if (!event.target.matches('[data-tmx-newtag]')) return;
      if (event.key === 'Enter' || event.key === ',') {
        event.preventDefault();
        const value = event.target.value.trim();
        if (value) saveTags([...meta.tags, value]);
      } else if (event.key === 'Backspace' && !event.target.value && meta.tags.length) saveTags(meta.tags.slice(0, -1));
    });
    section.addEventListener('click', async event => {
      const b = event.target.closest('button');
      if (!b) return;
      if (b.dataset.tmxUntag) saveTags(meta.tags.filter(t => t !== b.dataset.tmxUntag));
      else if ('tmxSaveNote' in b.dataset) {
        b.disabled = true;
        try { meta = await api(`customers/${uid}/note`, 'PUT', {note: $('[data-tmx-note]', section).value}); $('.tmx-saved', section).textContent = 'Сохранено'; }
        catch (error) { toast(error.message, 'error'); } finally { b.disabled = false; }
      } else if ('tmxBan' in b.dataset) {
        const reason = await T.prompt({title: 'Заблокировать покупателя?', ok: 'Заблокировать', danger: true,
          text: 'Бот перестанет отвечать ему (раз в минуту покажет короткое сообщение). Поддержка и уже начатые оплаты продолжат работать.',
          input: {label: 'Причина (видна сотрудникам)', maxlength: 300}});
        if (!reason) return;
        try { meta = await api(`customers/${uid}/ban`, 'POST', {reason}); forgetCustomer(uid); draw(); toast('Покупатель заблокирован', 'success'); }
        catch (error) { toast(error.message, 'error'); }
      } else if ('tmxUnban' in b.dataset) {
        if (!await T.confirm({title: 'Разблокировать покупателя?', text: 'Бот снова будет отвечать ему как обычно.', ok: 'Разблокировать'})) return;
        try { meta = await api(`customers/${uid}/unban`, 'POST'); forgetCustomer(uid); draw(); toast('Блокировка снята', 'success'); }
        catch (error) { toast(error.message, 'error'); }
      }
    });
    draw();
  }

  /* ================================================================ order card: internal notes */
  let lastOrder = '';
  document.addEventListener('click', event => {
    const b = event.target.closest?.('[data-order],[data-resend]');
    if (b) lastOrder = b.dataset.order || b.dataset.resend;
  }, true);
  if (T.dialogs?.showOrder && !T.dialogs.showOrder.tmxWrapped) {
    const original = T.dialogs.showOrder;
    T.dialogs.showOrder = Object.assign(id => { lastOrder = String(id); return original(id); }, {tmxWrapped: true});
  }
  async function orderNotes(body, id) {
    const section = document.createElement('section');
    section.className = 'tmx-section tmx-order-notes'; section.dataset.order = id;
    section.innerHTML = '<p class="muted">Загрузка заметок…</p>';
    const timeline = $('.timeline', body);
    if (timeline) timeline.before(section); else body.append(section);
    const draw = items => {
      section.innerHTML = `<h3>Внутренние заметки <small>покупатель их не видит</small></h3>
        ${items.length ? `<ul class="tmx-notes">${items.map(n => `<li><p>${esc(n.text)}</p><small>${esc(n.author)} · ${esc(date(n.created))}</small></li>`).join('')}</ul>` : '<p class="muted">Заметок пока нет.</p>'}
        ${can('orders.manage') ? `<form class="tmx-note-form"><label class="sr-only" for="tmx-note-text">Новая заметка</label><textarea id="tmx-note-text" name="text" rows="2" maxlength="1000" required placeholder="Например: клиент просил выдать после 18:00"></textarea>
          <p class="form-error" role="alert"></p><div class="tmx-row-actions"><button class="action" type="submit">Добавить заметку</button></div></form>` : ''}`;
      const form = $('.tmx-note-form', section);
      if (form) T.bindForm(form, async f => {
        const note = await api(`orders/${encodeURIComponent(id)}/notes`, 'POST', {text: f.elements.text.value});
        items.push(note); draw(items); $('#tmx-note-text', section)?.focus();
        return false;
      });
    };
    draw((await api(`orders/${encodeURIComponent(id)}/notes`)).items);
  }
  enhancers.push(() => {
    const dialog = $('#info-dialog'), body = $('#info-body');
    if (!dialog?.open || !body) return;
    const title = infoTitle();
    if (title.startsWith('Покупатель ') && can('customers.view')) {
      const uid = title.slice('Покупатель '.length).trim();
      if (/^\d+$/.test(uid) && $('.tmx-crm', body)?.dataset.uid !== uid) {
        $('.tmx-crm', body)?.remove();
        customerCard(body, uid).catch(error => { $('.tmx-crm', body)?.remove(); toast(error.message, 'error'); });
      }
    } else if (title.startsWith('Заказ #') && can('orders.view')) {
      const short = title.slice('Заказ #'.length).trim();
      if (lastOrder && lastOrder.startsWith(short) && $('.tmx-order-notes', body)?.dataset.order !== lastOrder) {
        $('.tmx-order-notes', body)?.remove();
        orderNotes(body, lastOrder).catch(() => $('.tmx-order-notes', body)?.remove());
      }
    }
  });

  /* ================================================================ support: reply templates */
  let templates = null;
  const loadTemplates = async (force = false) => { if (force || !templates) templates = (await api('support/templates')).items; return templates; };
  const menu = document.createElement('div');
  menu.className = 'tmx-tpl-menu'; menu.hidden = true; menu.setAttribute('role', 'dialog'); menu.setAttribute('aria-label', 'Шаблоны ответов');
  menu.innerHTML = '<input type="search" placeholder="Найти шаблон" aria-label="Найти шаблон"><ul role="listbox" aria-label="Шаблоны"></ul><footer><button type="button" class="subtle" data-tmx-manage>Управлять шаблонами</button><button type="button" class="subtle" data-tmx-menu-close>Закрыть</button></footer>';
  document.body.append(menu);
  let menuButton = null;
  function drawMenu() {
    const needle = $('input', menu).value.trim().toLowerCase();
    const items = (templates || []).filter(t => (t.title + ' ' + t.text).toLowerCase().includes(needle));
    $('ul', menu).innerHTML = items.length ? items.map(t => `<li><button type="button" role="option" data-tmx-use="${t.id}"><b>${esc(t.title)}</b><small>${esc(t.text)}</small></button></li>`).join('')
      : `<li class="tmx-feed-empty">${templates?.length ? 'Ничего не найдено' : 'Шаблонов пока нет. Создайте первый.'}</li>`;
  }
  function closeMenu(focus = true) {
    if (menu.hidden) return;
    menu.hidden = true; menuButton?.setAttribute('aria-expanded', 'false');
    if (focus) menuButton?.focus();
  }
  async function openMenu(button) {
    menuButton = button;
    try { await loadTemplates(); } catch (error) { toast(error.message, 'error'); return; }
    $('input', menu).value = ''; drawMenu();
    menu.hidden = false; button.setAttribute('aria-expanded', 'true');
    const rect = button.getBoundingClientRect(), height = menu.offsetHeight;
    menu.style.left = Math.max(12, Math.min(window.innerWidth - menu.offsetWidth - 12, rect.right - menu.offsetWidth)) + 'px';
    menu.style.top = Math.max(12, rect.top - height - 8) + 'px';
    $('input', menu).focus();
  }
  async function fill(text) {
    const head = $('#view .thread-head');
    const name = $('h2', head)?.textContent.trim() || '';
    let order = '';
    if (text.includes('{order}')) {
      const uid = /TG (\d+)/.exec($('small', head)?.textContent || '')?.[1];
      if (uid && can('customers.view')) {
        try { const c = await api('customers/' + uid); order = c.orders?.[0] ? '#' + c.orders[0].id.slice(0, 8) : ''; } catch { /* leave it empty */ }
      }
    }
    return text.replaceAll('{name}', name).replaceAll('{order}', order);
  }
  menu.addEventListener('click', async event => {
    const b = event.target.closest('button');
    if (!b) return;
    if ('tmxMenuClose' in b.dataset) { closeMenu(); return; }
    if ('tmxManage' in b.dataset) { closeMenu(false); manage(); return; }
    const template = templates.find(t => String(t.id) === b.dataset.tmxUse);
    const area = $('#reply-text');
    if (!template || !area) return;
    const text = await fill(template.text);
    area.focus();
    area.setRangeText(text, area.selectionStart, area.selectionEnd, 'end');
    area.dispatchEvent(new Event('input', {bubbles: true}));
    closeMenu(false); area.focus();
  });
  menu.addEventListener('input', drawMenu);
  menu.addEventListener('keydown', event => {
    const options = $$('[data-tmx-use]', menu), index = options.indexOf(document.activeElement);
    if (event.key === 'Escape') { event.preventDefault(); closeMenu(); }
    else if (event.key === 'ArrowDown') { event.preventDefault(); options[Math.min(options.length - 1, index + 1)]?.focus(); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); (index <= 0 ? $('input', menu) : options[index - 1]).focus(); }
    else if (event.key === 'Enter' && event.target.matches('input')) { event.preventDefault(); options[0]?.click(); }
  });
  document.addEventListener('pointerdown', event => { if (!menu.hidden && !menu.contains(event.target) && event.target !== menuButton) closeMenu(false); });

  // Template manager: a dialog of its own (created once).
  const manager = document.createElement('dialog');
  manager.className = 'small-dialog tmx-tpl-dialog'; manager.setAttribute('aria-labelledby', 'tmx-tpl-title');
  manager.innerHTML = `<div class="dialog-heading"><h2 id="tmx-tpl-title">Шаблоны ответов</h2><button type="button" class="close" data-tmx-dialog-close aria-label="Закрыть окно">×</button></div>
    <ul class="tmx-tpl-list"></ul>
    <form class="tmx-tpl-form"><input type="hidden" name="id"><label>Название<input name="title" maxlength="60" required placeholder="Например: Ключ отправлен повторно"></label>
      <label>Текст<textarea name="text" rows="5" maxlength="3500" required placeholder="Здравствуйте, {name}! …"></textarea><small>Подстановки: {name} — имя покупателя, {order} — его последний заказ.</small></label>
      <p class="form-error" role="alert"></p><div class="dialog-actions"><button type="button" class="action" data-tmx-new>Новый шаблон</button><button class="primary" type="submit">Сохранить шаблон</button></div></form>`;
  document.body.append(manager);
  const managerForm = $('form', manager);
  function drawManager() {
    $('.tmx-tpl-list', manager).innerHTML = (templates || []).map(t => `<li><div><b>${esc(t.title)}</b><p>${esc(t.text)}</p></div><div class="row-actions"><button class="action" type="button" data-tmx-edit="${t.id}">Изменить</button>${T.iconButton('trash', 'Удалить шаблон', `data-tmx-delete="${t.id}"`, 'danger')}</div></li>`).join('')
      || '<li class="tmx-feed-empty">Шаблонов пока нет.</li>';
  }
  const resetForm = () => { managerForm.reset(); managerForm.elements.id.value = ''; T.formError(managerForm, null); };
  async function manage() {
    try { await loadTemplates(true); } catch (error) { toast(error.message, 'error'); return; }
    resetForm(); drawManager(); manager.showModal(); managerForm.elements.title.focus();
  }
  manager.addEventListener('click', async event => {
    const b = event.target.closest('button');
    if (!b) return;
    if ('tmxDialogClose' in b.dataset) manager.close();
    else if ('tmxNew' in b.dataset) { resetForm(); managerForm.elements.title.focus(); }
    else if (b.dataset.tmxEdit) {
      const t = templates.find(x => String(x.id) === b.dataset.tmxEdit);
      managerForm.elements.id.value = t.id; managerForm.elements.title.value = t.title; managerForm.elements.text.value = t.text;
      managerForm.elements.title.focus();
    } else if (b.dataset.tmxDelete) {
      const t = templates.find(x => String(x.id) === b.dataset.tmxDelete);
      if (!await T.confirm({title: `Удалить шаблон «${t.title}»?`, ok: 'Удалить', danger: true})) return;
      try { await api('support/templates/' + t.id, 'DELETE'); await loadTemplates(true); drawManager(); resetForm(); } catch (error) { toast(error.message, 'error'); }
    }
  });
  T.bindForm(managerForm, async form => {
    const id = form.elements.id.value, body = {title: form.elements.title.value, text: form.elements.text.value};
    await api('support/templates' + (id ? '/' + id : ''), id ? 'PUT' : 'POST', body);
    await loadTemplates(true); drawManager(); resetForm(); toast('Шаблон сохранён', 'success');
    return false;
  });
  enhancers.push(() => {
    if (screen() !== 'support' || !can('support')) return;
    const form = $('#view #reply-form');
    if (!form || $('.tmx-tpl-button', form)) return;
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'action tmx-tpl-button';
    button.setAttribute('aria-haspopup', 'dialog'); button.setAttribute('aria-expanded', 'false');
    button.textContent = 'Шаблоны';
    button.onclick = () => (menu.hidden ? openMenu(button) : closeMenu());
    form.classList.add('tmx-has-templates');
    $('.primary', form)?.before(button);
  });

  /* ================================================================ products: bulk selection */
  const selected = new Set();
  const productIds = () => new Set((T.state.products || []).map(p => String(p.id)));
  function syncBar(panel) {
    let bar = $('.tmx-bulkbar', panel);
    if (!bar) {
      bar = document.createElement('div');
      bar.className = 'tmx-bulkbar'; bar.hidden = true; bar.setAttribute('role', 'region'); bar.setAttribute('aria-label', 'Действия с выбранными товарами');
      bar.innerHTML = `<b aria-live="polite"></b><button class="subtle" type="button" data-tmx-bulk-all>Выбрать все на странице</button>
        <button class="action" type="button" data-tmx-bulk="show">Показать</button><button class="action" type="button" data-tmx-bulk="hide">Скрыть</button>
        <button class="action" type="button" data-tmx-bulk="category">Категория…</button><button class="action" type="button" data-tmx-bulk="price_percent">Цена ±%…</button>
        <button class="action danger" type="button" data-tmx-bulk="delete">Удалить</button><button class="subtle" type="button" data-tmx-bulk-clear>Снять выбор</button>`;
      panel.append(bar);
      bar.addEventListener('click', event => bulkClick(event, panel));
    }
    bar.hidden = !selected.size;
    $('b', bar).textContent = `Выбрано: ${selected.size} ${plural(selected.size, 'товар', 'товара', 'товаров')}`;
  }
  async function bulkClick(event, panel) {
    const b = event.target.closest('button');
    if (!b) return;
    if ('tmxBulkClear' in b.dataset) { selected.clear(); refreshChecks(panel); return; }
    if ('tmxBulkAll' in b.dataset) { $$('#product-table [data-tmx-pick]', panel).forEach(box => selected.add(box.dataset.tmxPick)); refreshChecks(panel); return; }
    const action = b.dataset.tmxBulk;
    if (!action) return;
    const count = selected.size, what = `${count} ${plural(count, 'товар', 'товара', 'товаров')}`;
    let value = null;
    if (action === 'category') {
      value = await T.prompt({title: 'Перенести в категорию', text: `Выбрано: ${what}.`, ok: 'Перенести', input: {label: 'Категория', maxlength: 80}});
      if (!value) return;
    } else if (action === 'price_percent') {
      const answer = await T.prompt({title: 'Изменить цены на процент', ok: 'Изменить цены',
        text: `Выбрано: ${what}. Например, 10 — поднять на 10 %, −15 — снизить на 15 % (от −90 до +500). Цены округляются до ${T.usdActive() ? 'цента' : 'целых Stars'}.`,
        input: {label: 'Процент', maxlength: 8}});
      if (!answer) return;
      value = Number(answer.replace(',', '.').replace('−', '-').replace('%', '').trim());
      if (!Number.isFinite(value)) { toast('Введите число, например 10 или -15', 'error'); return; }
    } else if (action === 'delete') {
      if (!await T.confirm({title: `Удалить ${what}?`, text: 'Товары исчезнут из панели и бота. История покупок и созданные заказы сохранятся.', ok: 'Удалить', danger: true})) return;
    }
    b.disabled = true;
    try {
      const result = await api('products/bulk', 'POST', {ids: [...selected].map(Number), action, value});
      toast(`Готово: изменено ${result.changed} из ${result.total}`, 'success');
      if (action === 'delete') selected.clear();
      T.emit('changed');
    } catch (error) { toast(error.message, 'error'); } finally { b.disabled = false; }
  }
  function refreshChecks(panel) {
    for (const box of $$('[data-tmx-pick]', panel)) {
      box.checked = selected.has(box.dataset.tmxPick);
      box.closest('tr')?.classList.toggle('tmx-selected', box.checked);
    }
    const all = $('[data-tmx-pick-all]', panel), boxes = $$('[data-tmx-pick]', panel), picked = boxes.filter(b => b.checked).length;
    if (all) { all.checked = boxes.length > 0 && picked === boxes.length; all.indeterminate = picked > 0 && picked < boxes.length; }
    syncBar(panel);
  }
  enhancers.push(() => {
    if (screen() !== 'products' || !can('products.manage')) return;
    const target = $('#view #product-table');
    if (!target) return;
    const panel = target.closest('.panel'), known = productIds();
    for (const id of [...selected]) if (!known.has(id)) selected.delete(id);
    const head = $('thead th', target);
    if (head && !$('[data-tmx-pick-all]', head)) {
      head.insertAdjacentHTML('afterbegin', '<input type="checkbox" class="tmx-check" data-tmx-pick-all aria-label="Выбрать все товары на странице"> ');
    }
    for (const row of $$('tbody tr', target)) {
      const id = $('[data-edit]', row)?.dataset.edit, name = $('.product-name', row);
      if (!id || !name || $('[data-tmx-pick]', name)) continue;
      const title = $('.product-name > div', row)?.firstChild?.textContent?.trim() || 'товар';
      name.insertAdjacentHTML('afterbegin', `<input type="checkbox" class="tmx-check" data-tmx-pick="${esc(id)}" aria-label="Выбрать «${esc(title)}»">`);
    }
    if (!panel.dataset.tmxBulk) {
      panel.dataset.tmxBulk = '1';
      panel.addEventListener('change', event => {
        const box = event.target;
        if (box.matches('[data-tmx-pick]')) { if (box.checked) selected.add(box.dataset.tmxPick); else selected.delete(box.dataset.tmxPick); refreshChecks(panel); }
        else if (box.matches('[data-tmx-pick-all]')) { $$('[data-tmx-pick]', panel).forEach(b => (box.checked ? selected.add(b.dataset.tmxPick) : selected.delete(b.dataset.tmxPick))); refreshChecks(panel); }
      });
    }
    // Only touch the DOM when something differs, so the observer settles.
    const stale = $$('[data-tmx-pick]', panel).some(box => box.checked !== selected.has(box.dataset.tmxPick));
    const bar = $('.tmx-bulkbar', panel);
    if (stale || !bar || bar.hidden !== !selected.size) refreshChecks(panel);
  });

  schedule();
})();
