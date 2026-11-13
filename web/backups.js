'use strict';
(() => {
  const {esc, api, number, date, empty, toast, download, table} = TM;
  let busy = false, lastReport = '';

  const pruned = r => Array.isArray(r.pruned) ? r.pruned.length : Number(r.pruned) || 0;
  const report = r => r.tables
    ? `Восстановление проверено · ${date(r.verified_at)}. Товаров: ${r.tables.products}, заказов: ${r.tables.orders}, выполненных покупок: ${r.purchases}, единиц стока: ${r.tables.stock}, кошельков: ${r.wallets}. Все зашифрованные данные прочитаны, данные таблиц и балансы совпали.`
    : `Восстановление проверено · ${date(r.verified_at || Date.now() / 1000)}.`;

  TM.view({
    id: 'backups', perm: ['backups'], title: 'Резервные копии', subtitle: 'Защищённые копии базы и ключа стока.', auto: true,
    async render({el}) {
      const data = await api('backups');
      el.innerHTML = `<div class="notice"><h2>Два файла для восстановления</h2><p>Скачайте зашифрованную копию и отдельный ключ восстановления. Сохраните их вне компьютера магазина, отдельно друг от друга. В копии находятся база, покупки, балансы, сток и ключ стока.</p><div class="toolbar"><button class="primary" type="button" data-backup-create>Создать и проверить копию</button><button class="action" type="button" data-backup-key>Скачать ключ восстановления</button></div></div>
        <div class="workflow-help"><b>${data.interval_hours ? 'Автоматически каждые ' + esc(data.interval_hours) + ' ч' : 'Автоматическое копирование выключено'}</b><span>Пока запущена панель. Проверка выполняется при создании каждой копии.</span><span>${data.keep ? 'Хранятся последние ' + esc(data.keep) + ' копий, старые удаляются автоматически.' : 'Копии сохраняются на этом компьютере до ручного удаления.'}</span></div>
        ${!data.key_available && data.items.length ? '<p class="form-error">Ключ восстановления не найден. Верните сохранённый файл ключа в магазин.</p>' : ''}
        ${data.last_error ? `<p class="form-error">${esc(data.last_error)}</p>` : ''}
        <p id="backup-result" class="backup-result" role="status">${esc(lastReport)}</p>
        <section class="panel"><div class="panel-heading"><div><h2>Сохранённые копии · ${number(data.items.length)}</h2><p>Перед скачиванием архив проходит повторную проверку восстановления.</p></div></div>
        ${table([
          {label: 'Создана', cell: item => date(item.created) + ('verified' in item ? `<small>${item.verified ? 'Проверена' + (item.verified_at ? ' ' + date(item.verified_at) : '') : 'Ещё не проверена'}</small>` : '')},
          {label: 'Архив', cell: item => `<span class="mono">${esc(item.name)}</span>`},
          {label: 'Размер', className: 'nowrap', cell: item => number(Math.ceil(item.size / 1024)) + ' КБ'},
          {label: 'Действия', className: 'actions', cell: item => `<div class="row-actions"><button class="action" type="button" data-backup-verify="${esc(item.name)}">Проверить восстановление</button><button class="action" type="button" data-backup-download="${esc(item.name)}">Скачать копию</button></div>`},
        ], data.items) || empty('Копий пока нет', 'Создайте первую копию кнопкой выше.')}</section>
        <section class="panel backup-help"><h2>Как устроена проверка</h2><p>Архив расшифровывается в отдельную временную папку. Проверяются целостность базы, связи между таблицами, все балансы, покупки, сток и расшифровка сохранённых секретов. Рабочая база продолжает работать.</p><p>Восстановление выполняется в новую папку командой из README. Переключение магазина на восстановленную базу выполняется после остановки панели и бота.</p></section>`;
      el.addEventListener('click', async event => {
        const b = event.target.closest('[data-backup-create],[data-backup-verify],[data-backup-key],[data-backup-download]');
        if (!b || busy) return;
        const d = b.dataset, status = el.querySelector('#backup-result');
        busy = true; b.disabled = true;
        try {
          if ('backupKey' in d) await download('backups/recovery-key', 'POST', 'themarket-recovery.key');
          else if (d.backupDownload) {
            status.textContent = 'Проверяем копию перед скачиванием…';
            await download('backups/' + encodeURIComponent(d.backupDownload) + '/download', 'POST', d.backupDownload);
            status.textContent = lastReport;
          } else {
            status.textContent = 'Создание временной базы и проверка восстановления…';
            const result = await api(d.backupVerify ? 'backups/' + encodeURIComponent(d.backupVerify) + '/verify' : 'backups', 'POST');
            lastReport = report(result) + (pruned(result) ? ` Удалены старые копии: ${pruned(result)}.` : ''); toast('Копия восстановлена и проверена', 'success');
            busy = false; await TM.rerender();
          }
        } catch (error) {
          lastReport = 'Ошибка: ' + error.message; status.textContent = lastReport; toast(error.message, 'error');
        } finally { busy = false; b.disabled = false; }
      });
    },
    async refresh() { if (!busy) await TM.rerender(); },
  });
})();
