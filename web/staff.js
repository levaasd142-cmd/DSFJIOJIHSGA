'use strict';
/* Staff accounts (owner only): list, create, change role, deactivate, reset password, end sessions. */
(() => {
  const {$, esc, api, state, number, date, ago, empty, toast, table, badge, bindForm, confirm, prompt} = TM;
  const roleNotes = {
    owner: 'Полный доступ, включая финансы, настройки, резервные копии и сотрудников.',
    manager: 'Заказы, товары и склад, покупатели (без изменения баланса), поддержка, просмотр промокодов.',
    support: 'Обращения покупателей, просмотр заказов и покупателей.',
  };
  const permissionLabels = {'orders.view': 'Заказы', 'orders.manage': 'Выполнение заказов', 'customers.view': 'Покупатели', 'customers.balance': 'Балансы',
    'products.manage': 'Товары', 'stock.manage': 'Склад', 'stock.reveal': 'Содержимое стока', support: 'Поддержка', 'promo.view': 'Промокоды: просмотр',
    'promo.manage': 'Промокоды: управление', analytics: 'Аналитика', payments: 'Платежи', settings: 'Настройки', broadcasts: 'Рассылки',
    backups: 'Резервные копии', staff: 'Сотрудники', audit: 'Журнал'};
  let data = null;

  function generate() {
    const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789', bytes = crypto.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, b => alphabet[b % alphabet.length]).join('').replace(/(.{4})(?!$)/g, '$1-');
  }
  const form = $('#staff-form');
  const syncRole = () => { $('#staff-role-note').textContent = roleNotes[form.elements.role.value]; };
  form.elements.role.onchange = syncRole;
  $('#staff-generate').onclick = () => { form.elements.password.value = generate(); };
  bindForm(form, async f => {
    const member = await api('staff', 'POST', {username: f.elements.username.value.trim(), password: f.elements.password.value, role: f.elements.role.value});
    toast(`Сотрудник ${member.username} создан. Передайте ему логин и пароль лично.`, 'success');
    TM.emit('changed');
  });

  const columns = () => [
    {label: 'Сотрудник', cell: m => `<div class="product-name"><span class="avatar small" aria-hidden="true">${esc(TM.firstChar(m.username).toUpperCase())}</span><div><b>${esc(m.username)}</b>${m.id === data.me ? ' <span class="muted">(вы)</span>' : ''}<small>${m.env_owner ? 'Владелец из настроек запуска' : 'Создан ' + date(m.created)}</small></div></div>`},
    {label: 'Роль', cell: m => m.env_owner || m.id === data.me ? badge(data.roles[m.role] || m.role, 'blue')
      : `<select class="inline-select" data-staff-role="${m.id}" aria-label="Роль ${esc(m.username)}">${Object.entries(data.roles).map(([k, v]) => `<option value="${k}" ${k === m.role ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select>`},
    {label: 'Доступ', cell: m => `${m.active ? badge('Активен', 'green') : badge('Отключён', 'red')}<small>Сессий: ${number(m.sessions || 0)} · вход ${esc(ago(m.last_login))}</small>`},
    {label: 'Действия', className: 'actions', cell: m => `<div class="row-actions"><button class="action" type="button" data-staff-password="${m.id}">Сменить пароль</button>${m.sessions ? `<button class="action" type="button" data-staff-revoke="${m.id}">Завершить сессии</button>` : ''}${
      m.env_owner || m.id === data.me ? '' : `<button class="action ${m.active ? 'danger' : ''}" type="button" data-staff-active="${m.id}">${m.active ? 'Отключить' : 'Включить'}</button>`}</div>`},
  ];
  const member = id => data.items.find(m => m.id === Number(id));

  TM.view({
    id: 'staff', perm: ['staff'], feature: 'staff', title: 'Сотрудники', subtitle: 'Учётные записи команды и их права. У каждого свой логин — журнал покажет, кто что сделал.',
    auto: true,
    async render({el}) {
      data = await api('staff');
      el.innerHTML = `<section class="panel"><div class="panel-heading"><div><h2>Команда · ${number(data.total)}</h2><p>Смена роли, пароля или отключение сразу завершает сессии сотрудника.</p></div><button class="primary" type="button" data-staff-new>+ Добавить сотрудника</button></div>
        ${table(columns(), data.items) || empty('Сотрудников нет', 'Добавьте первого сотрудника.')}</section>
        <section class="panel"><div class="panel-heading"><div><h2>Что может каждая роль</h2></div></div><div class="role-grid">${Object.entries(data.roles).map(([role, label]) => `<article><h3>${esc(label)}</h3><p>${esc(roleNotes[role] || '')}</p><div class="chips">${(data.permissions[role] || []).map(p => `<span>${esc(permissionLabels[p] || p)}</span>`).join('')}</div></article>`).join('')}</div></section>`;
      el.addEventListener('change', async event => {
        const select = event.target.closest('[data-staff-role]');
        if (!select) return;
        const m = member(select.dataset.staffRole);
        if (!await confirm({title: `Сменить роль ${m.username}?`, text: `Новая роль: ${data.roles[select.value]}. Сотруднику нужно будет войти заново.`, ok: 'Сменить роль'})) { select.value = m.role; return; }
        try { await api('staff/' + m.id, 'PUT', {role: select.value}); toast('Роль изменена', 'success'); TM.emit('changed'); }
        catch (error) { toast(error.message, 'error'); select.value = m.role; }
      });
      el.addEventListener('click', async event => {
        const b = event.target.closest('button');
        if (!b) return;
        try {
          if ('staffNew' in b.dataset) { form.reset(); TM.formError(form, null); form.elements.password.value = generate(); syncRole(); $('#staff-dialog').showModal(); }
          else if (b.dataset.staffPassword) {
            const m = member(b.dataset.staffPassword), suggestion = generate();
            const value = await prompt({title: 'Новый пароль для ' + m.username, text: m.id === data.me ? 'После смены вы выйдете из панели на всех устройствах.' : 'Все сессии сотрудника завершатся. Передайте пароль лично.', ok: 'Сменить пароль', input: {label: 'Пароль (не меньше 10 символов)', value: suggestion, maxlength: 256}});
            if (!value) return;
            await api('staff/' + m.id, 'PUT', {password: value});
            toast('Пароль изменён', 'success');
            if (m.id === data.me) location.replace('/login'); else TM.emit('changed');
          } else if (b.dataset.staffRevoke) {
            const m = member(b.dataset.staffRevoke);
            if (!await confirm({title: 'Завершить сессии?', text: `${m.username} выйдет из панели на всех устройствах.`, ok: 'Завершить', danger: true})) return;
            await api(`staff/${m.id}/revoke`, 'POST');
            toast('Сессии завершены', 'success');
            if (m.id === data.me) location.replace('/login'); else TM.emit('changed');
          } else if (b.dataset.staffActive) {
            const m = member(b.dataset.staffActive);
            if (m.active && !await confirm({title: `Отключить ${m.username}?`, text: 'Сотрудник сразу потеряет доступ. Историю действий журнал сохранит.', ok: 'Отключить', danger: true})) return;
            b.disabled = true;
            await api('staff/' + m.id, 'PUT', {active: !m.active});
            toast(m.active ? 'Сотрудник отключён' : 'Доступ восстановлен', 'success'); TM.emit('changed');
          }
        } catch (error) { toast(error.message, 'error'); b.disabled = false; }
      });
    },
  });
})();
