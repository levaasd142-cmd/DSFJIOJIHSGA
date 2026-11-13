'use strict';
/* Support inbox: ticket list + chat-style thread. Polls every 10 s only while this view is open and
   the tab is visible; the list is a server-side page, the thread loads the newest 50 messages. */
(() => {
  const {esc, api, state, number, date, ago, empty, toast, prefs, pager, debounce, can} = TM;
  const POLL_MS = 10000;
  const statuses = [['open', 'Открытые'], ['closed', 'Закрытые'], ['all', 'Все']];
  let filters = {status: 'open', query: '', page: 1, ...prefs.get('filters.support', {})};
  let openId = null, thread = null, timer = null, root = null, busy = false;

  const name = t => [t.first_name, t.last_name].filter(Boolean).join(' ') || (t.username ? '@' + t.username : 'TG ' + t.user_id);
  const delivery = {sent: 'Доставлено', pending: 'В очереди бота', failed: 'Не доставлено'};

  function ticketRow(t) {
    return `<button type="button" class="ticket ${t.id === openId ? 'selected' : ''} ${t.unread_for_staff ? 'unread' : ''}" data-open-ticket="${t.id}" aria-current="${t.id === openId}">
      <span class="avatar small" aria-hidden="true">${esc(TM.firstChar(name(t)).toUpperCase())}</span>
      <span class="ticket-main"><span class="ticket-top"><b>${esc(name(t))}</b><small>${esc(ago(t.last_message_at))}</small></span>
      <small class="ticket-text">${t.last_author === 'staff' ? 'Вы: ' : ''}${esc(t.last_kind === 'photo' && !t.last_text ? '📷 Фото' : t.last_text || '')}</small>
      <span class="ticket-meta">#${t.id}${t.assignee ? ' · ' + esc(t.assignee) : ''}${t.status === 'closed' ? ' · закрыто' : ''}</span></span>
      ${t.unread_for_staff ? `<span class="count-dot" aria-label="Непрочитанных: ${t.unread_for_staff}">${number(t.unread_for_staff)}</span>` : ''}</button>`;
  }
  function message(m) {
    const staff = m.author === 'staff';
    return `<div class="bubble-row ${staff ? 'out' : 'in'}"><div class="bubble">${m.kind === 'photo' ? '<span class="bubble-photo">📷 Фото из Telegram</span>' : ''}${m.text ? `<p>${esc(m.text)}</p>` : ''}
      <small>${staff ? esc(m.actor || 'Сотрудник') + ' · ' : ''}${esc(date(m.created))}${staff && m.delivery ? ' · ' + esc(delivery[m.delivery] || m.delivery) : ''}</small></div></div>`;
  }
  function threadHtml() {
    if (!thread) {
      return `<div class="thread-empty">${empty('Выберите обращение', 'Слева — список диалогов. Новые сообщения подсвечиваются и поднимаются наверх.')}</div>`;
    }
    const t = thread.ticket, closed = t.status === 'closed';
    return `<header class="thread-head"><button type="button" class="icon-action thread-back" data-thread-back aria-label="К списку обращений">${TM.icon('arrow')}</button>
        <div><h2>${esc(name(t))}</h2><small>TG ${esc(t.user_id)}${t.username ? ' · @' + esc(t.username) : ''} · обращение #${t.id} · обращений всего: ${number(t.tickets_total || 1)}</small></div>
        <div class="row-actions">${t.assignee === state.me.username ? `<button class="action" type="button" data-ticket-action="unassign">Снять с себя</button>`
          : `<button class="action" type="button" data-ticket-action="assign">${t.assignee ? 'Забрать себе' : 'Взять себе'}</button>`}
          ${closed ? '<button class="action" type="button" data-ticket-action="reopen">Открыть снова</button>' : '<button class="action" type="button" data-ticket-action="close">Закрыть</button>'}
          ${can('customers.view') ? `<button class="action" type="button" data-customer="${esc(t.user_id)}">Покупатель</button>` : ''}</div></header>
      <div class="thread-body" id="thread-body" tabindex="0" aria-label="Переписка">${thread.has_more ? '<button type="button" class="subtle load-older" data-older>Показать предыдущие сообщения</button>' : ''}${thread.messages.map(message).join('')}</div>
      ${closed ? '<p class="thread-closed">Обращение закрыто. Новое сообщение покупателя откроет его снова; можно открыть и вручную.</p>' : `<form class="reply-box" id="reply-form">
        <label class="sr-only" for="reply-text">Ответ покупателю</label>
        <textarea id="reply-text" name="text" rows="2" maxlength="3500" required placeholder="Ответ покупателю… (Ctrl+Enter — отправить)"></textarea>
        <button class="primary" type="submit" aria-label="Отправить ответ">${TM.icon('send', 'icon')}<span>Отправить</span></button>
        <p class="form-error" role="alert"></p></form>`}`;
  }
  function drawThread(keepDraft = true) {
    const box = root?.querySelector('#thread');
    if (!box) return;
    const draft = keepDraft ? box.querySelector('#reply-text')?.value : '';
    const body = box.querySelector('#thread-body'), atBottom = !body || body.scrollHeight - body.scrollTop - body.clientHeight < 40;
    box.innerHTML = threadHtml();
    root.querySelector('.support-layout').classList.toggle('has-thread', Boolean(thread));
    const text = box.querySelector('#reply-text');
    if (text && draft) text.value = draft;
    const fresh = box.querySelector('#thread-body');
    if (fresh && atBottom) fresh.scrollTop = fresh.scrollHeight;
    const form = box.querySelector('#reply-form');
    if (form) {
      text.addEventListener('keydown', event => {
        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); form.requestSubmit(); }
      });
      TM.bindForm(form, async f => {
        const value = f.elements.text.value.trim();
        if (!value) throw new TM.ApiError('Введите текст ответа', 0, 'text');
        const sent = await api('support/' + thread.ticket.id + '/reply', 'POST', {text: value});
        thread.messages.push(sent);
        f.elements.text.value = '';
        drawThread(false);
        root.querySelector('#reply-text')?.focus();
        await loadList();
        return false;
      });
    }
  }
  async function loadList() {
    const data = await api('support?' + new URLSearchParams({status: filters.status, query: filters.query, page: String(filters.page)}));
    filters.page = data.page;
    state.support_unread = data.unread;
    TM.navBadges?.();
    const box = root?.querySelector('#ticket-list');
    if (!box) return data;
    box.innerHTML = data.items.length ? data.items.map(ticketRow).join('') + pager(data)
      : empty(filters.query ? 'Ничего не найдено' : filters.status === 'open' ? 'Открытых обращений нет' : 'Обращений пока нет',
        filters.query ? 'Проверьте Telegram ID, @username или номер обращения.' : 'Когда покупатель напишет в поддержку из бота, диалог появится здесь.',
        filters.query ? {label: 'Сбросить поиск', attrs: 'data-clear-support'} : null);
    root.querySelectorAll('[data-support-status]').forEach(b => { const on = b.dataset.supportStatus === filters.status; b.classList.toggle('active', on); b.setAttribute('aria-pressed', String(on)); });
    return data;
  }
  async function openTicket(id, focus = true) {
    openId = id; prefs.set('support.open', id);
    thread = await api('support/' + id);
    drawThread(false);
    root.querySelectorAll('[data-open-ticket]').forEach(b => { const on = Number(b.dataset.openTicket) === id; b.classList.toggle('selected', on); b.setAttribute('aria-current', String(on)); if (on) b.classList.remove('unread'); });
    root.querySelector(`[data-open-ticket="${id}"] .count-dot`)?.remove();
    if (focus) root.querySelector('#reply-text')?.focus({preventScroll: true});
  }
  async function poll() {
    if (busy || document.hidden || !root?.isConnected) return;
    busy = true;
    try {
      await loadList();
      if (openId && !root.querySelector('#reply-form[data-sending]')) {
        const fresh = await api('support/' + openId);
        const last = thread?.messages.at(-1)?.id, lastFresh = fresh.messages.at(-1)?.id;
        if (lastFresh !== last || fresh.ticket.status !== thread?.ticket.status || fresh.ticket.assignee !== thread?.ticket.assignee ||
          fresh.messages.some((m, i) => m.delivery !== thread.messages.at(i - fresh.messages.length)?.delivery)) {
          const older = thread && thread.messages.length > fresh.messages.length;
          thread = older ? {...fresh, has_more: thread.has_more, messages: [...thread.messages.filter(m => m.id < fresh.messages[0]?.id), ...fresh.messages]} : fresh;
          drawThread();
        }
      }
    } catch (error) { if (error.status === 404) { openId = null; thread = null; drawThread(); } }
    finally { busy = false; }
  }
  function startPolling() { stopPolling(); timer = setInterval(poll, POLL_MS); }
  function stopPolling() { clearInterval(timer); timer = null; }
  document.addEventListener('visibilitychange', () => { if (!document.hidden && root?.isConnected) poll(); });

  TM.view({
    id: 'support', perm: ['support'], feature: 'support', title: 'Поддержка', subtitle: 'Сообщения покупателей из бота. Ответы бот доставит в тот же чат.',
    badge: () => state.support_unread || 0,
    async render({el}) {
      root = el;
      el.innerHTML = `<div class="support-layout">
        <section class="panel ticket-pane" aria-label="Обращения">
          <div class="toolbar"><input id="support-search" type="search" placeholder="TG ID, @username или #номер" aria-label="Поиск обращений" value="${esc(filters.query)}">
          <div class="segmented" role="group" aria-label="Статус обращений">${statuses.map(([k, v]) => `<button type="button" data-support-status="${k}">${v}</button>`).join('')}</div></div>
          <div id="ticket-list" class="ticket-list"></div></section>
        <section class="panel thread-pane" id="thread" aria-label="Переписка"></section></div>`;
      await loadList();
      const wanted = prefs.get('support.open', null);
      thread = null;
      if (wanted) { try { await openTicket(Number(wanted), false); } catch { openId = null; prefs.set('support.open', null); } }
      drawThread(false);
      el.querySelector('#support-search').oninput = debounce(event => {
        filters.query = event.target.value; filters.page = 1; prefs.set('filters.support', {status: filters.status, query: filters.query}); loadList().catch(e => toast(e.message, 'error'));
      }, 300);
      el.addEventListener('click', async event => {
        const b = event.target.closest('button');
        if (!b) return;
        try {
          if (b.dataset.openTicket) await openTicket(Number(b.dataset.openTicket));
          else if (b.dataset.supportStatus) { filters.status = b.dataset.supportStatus; filters.page = 1; prefs.set('filters.support', {status: filters.status, query: filters.query}); await loadList(); }
          else if (b.dataset.page && b.closest('#ticket-list')) { filters.page = Number(b.dataset.page); await loadList(); }
          else if ('clearSupport' in b.dataset) { filters.query = ''; el.querySelector('#support-search').value = ''; await loadList(); }
          else if ('threadBack' in b.dataset) { openId = null; thread = null; prefs.set('support.open', null); drawThread(false); el.querySelector('.selected[data-open-ticket]')?.classList.remove('selected'); }
          else if ('older' in b.dataset) {
            b.disabled = true;
            const older = await api(`support/${openId}?before=${thread.messages[0].id}`);
            const body = el.querySelector('#thread-body'), height = body.scrollHeight;
            thread = {...thread, has_more: older.has_more, messages: [...older.messages, ...thread.messages]};
            drawThread();
            const fresh = el.querySelector('#thread-body'); fresh.scrollTop = fresh.scrollHeight - height;
          } else if (b.dataset.ticketAction) {
            b.disabled = true;
            const action = b.dataset.ticketAction;
            thread.ticket = {...thread.ticket, ...await api(`support/${openId}/${action}`, 'POST')};
            toast({close: 'Обращение закрыто', reopen: 'Обращение снова открыто', assign: 'Обращение назначено на вас', unassign: 'Вы сняты с обращения'}[action], 'success');
            drawThread(); await loadList();
          }
        } catch (error) { toast(error.message, 'error'); b.disabled = false; }
      });
    },
    mounted() { startPolling(); const body = root.querySelector('#thread-body'); if (body) body.scrollTop = body.scrollHeight; },
    leave() { stopPolling(); },
    async refresh() { await poll(); },
  });
})();
