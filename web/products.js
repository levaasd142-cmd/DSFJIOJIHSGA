'use strict';
/* Catalog: product list, product editor, stock import/view and custom emoji library. */
(() => {
  const {$, esc, api, state, number, money, usd, prefs, table, empty, pager, paginate, bindForm, toast, confirm,
    iconButton, firstChar, csvDownload, badge, date} = TM;
  let page = 1;
  const product = id => state.products.find(p => String(p.id) === String(id));

  /* ------------------------------------------------------------ emoji library */
  let emojiLibrary = {packs: [], assignments: {}, defaults: {}}, emojiLoad = null, selectedEmoji = '';
  function loadEmojis(force = false) {
    if (force || !emojiLoad) {
      emojiLoad = api('emojis').then(data => { emojiLibrary = data; return data; }).catch(error => { emojiLoad = null; throw error; });
    }
    return emojiLoad;
  }
  const emojiImage = (id, fallback = '◈') => `<span class="emoji-art"><span>${esc(fallback)}</span><img loading="lazy" src="/api/emojis/${encodeURIComponent(id)}/preview" alt="" data-emoji-image></span>`;
  document.addEventListener('error', event => { if (event.target.matches?.('[data-emoji-image]')) event.target.remove(); }, true);
  TM.emojiImage = emojiImage;
  const rich = text => TM.emojiText ? TM.emojiText(text) : esc(text);

  function chooser(container, onSelect) {
    container.innerHTML = `<form class="emoji-import"><label>Набор эмодзи<input name="name" required placeholder="https://t.me/addemoji/НазваниеНабора" maxlength="300"></label><button class="primary" type="submit">Загрузить набор</button></form>
      <p class="form-error" role="alert"></p>
      <div class="toolbar"><select class="emoji-pack-filter" aria-label="Набор"></select><input class="emoji-search" type="search" placeholder="Поиск по эмодзи или ID" aria-label="Поиск эмодзи"></div>
      <p class="muted emoji-count"></p><div class="emoji-grid"></div>`;
    const packFilter = container.querySelector('.emoji-pack-filter'), search = container.querySelector('.emoji-search'), grid = container.querySelector('.emoji-grid');
    function draw() {
      const query = search.value.trim();
      const items = emojiLibrary.packs.filter(pack => !packFilter.value || pack.name === packFilter.value)
        .flatMap(pack => pack.items.map(item => ({...item, pack: pack.title})))
        .filter(item => (item.id + ' ' + item.emoji).includes(query));
      container.querySelector('.emoji-count').textContent = 'Эмодзи в списке · ' + items.length;
      grid.innerHTML = items.length ? items.map(item => `<button type="button" class="emoji-tile ${item.id === selectedEmoji ? 'chosen' : ''}" data-emoji-select="${esc(item.id)}" title="${esc(item.pack)} · ${esc(item.id)}" aria-label="Выбрать ${esc(item.emoji)} ${esc(item.id)}">${emojiImage(item.id, item.emoji)}<small>${esc(item.emoji)}</small></button>`).join('')
        : empty('Набор пока не загружен', 'Вставьте ссылку на набор сверху.');
    }
    function updatePacks(preferred) {
      packFilter.innerHTML = '<option value="">Все наборы</option>' + emojiLibrary.packs.map(pack => `<option value="${esc(pack.name)}">${esc(pack.title)} · ${pack.items.length}</option>`).join('');
      if (preferred) packFilter.value = preferred;
      draw();
    }
    packFilter.onchange = draw; search.oninput = draw;
    grid.onclick = event => {
      const button = event.target.closest('[data-emoji-select]');
      if (!button) return;
      selectedEmoji = button.dataset.emojiSelect; draw(); onSelect(selectedEmoji);
    };
    const form = container.querySelector('form');
    form.onsubmit = async event => {
      event.preventDefault();
      const button = form.querySelector('button'), error = container.querySelector('.form-error');
      button.disabled = true; button.textContent = 'Загружаем…'; error.textContent = '';
      try {
        const response = await api('emojis/packs', 'POST', {name: form.elements.name.value});
        await loadEmojis(true); TM.forgetEmojiLibrary?.(); updatePacks(emojiLibrary.packs[0]?.name);
        toast('Набор загружен · ' + response.count + ' эмодзи', 'success');
      } catch (failure) { error.textContent = failure.message; } finally { button.disabled = false; button.textContent = 'Загрузить набор'; }
    };
    updatePacks();
  }

  $('#emoji-pick').onclick = async () => {
    try {
      await loadEmojis();
      const field = $('#product-form').elements.emoji_id;
      selectedEmoji = field.value;
      chooser($('#emoji-picker-body'), id => { field.value = id; $('#emoji-picker').close(); $('#emoji-pick').textContent = '◈ Выбран · ' + id; });
      $('#emoji-picker').showModal();
    } catch (error) { toast(error.message, 'error'); }
  };

  const menuTargets = {catalog: 'Каталог', wallet: 'Кошелёк', orders: 'Мои покупки', profile: 'Профиль', guide: 'Как купить',
    support: 'Поддержка', about: 'О магазине', terms: 'Условия', language: 'Язык'};
  async function openEmojiLibrary() {
    const body = $('#emoji-library-body');
    body.innerHTML = '<p class="muted">Загрузка библиотеки…</p>';
    $('#emoji-library-dialog').showModal();
    try {
      await loadEmojis(true);
      body.innerHTML = `<div class="emoji-placement">
        <label>Куда добавить<select id="emoji-target">
          <optgroup label="Товары">${state.products.map(p => `<option value="product:${p.id}">${esc(TM.emojiPlain ? TM.emojiPlain(p.name) : p.name)}</option>`).join('')}</optgroup>
          <optgroup label="Категории">${[...new Set(state.products.map(p => p.category))].map(name => `<option value="category:${esc(name)}">${esc(name)}</option>`).join('')}</optgroup>
          <optgroup label="Главное меню">${Object.entries(menuTargets).map(([key, label]) => `<option value="menu:${key}">${label}</option>`).join('')}</optgroup>
          <optgroup label="Приветствие"><option value="welcome:greeting">Перед «Привет»</option><option value="welcome:brand">Рядом с названием магазина</option><option value="welcome:actions">В конце приветствия</option></optgroup>
        </select></label>
        <div id="emoji-selection"></div>
        <button class="primary" type="button" id="emoji-apply" disabled>Применить</button>
        <button class="action" type="button" id="emoji-clear">Убрать иконку</button>
      </div><div class="emoji-chooser"></div>`;
      const target = $('#emoji-target');
      const showSelection = id => {
        selectedEmoji = id || '';
        $('#emoji-selection').innerHTML = id ? emojiImage(id) + `<small>${esc(id)}</small>` : '<span class="muted">Выберите эмодзи ниже</span>';
        $('#emoji-apply').disabled = !id;
      };
      const targetChanged = () => {
        const p = state.products.find(item => 'product:' + item.id === target.value);
        $('#emoji-clear').textContent = target.value.startsWith('welcome:') ? 'Обычный эмодзи' : 'Убрать иконку';
        showSelection(p ? p.emoji_id : emojiLibrary.assignments[target.value] ?? emojiLibrary.defaults?.[target.value]);
      };
      target.onchange = targetChanged;
      chooser(body.querySelector('.emoji-chooser'), showSelection);
      targetChanged();
      const assign = async id => {
        const destination = target.value;
        $('#emoji-apply').disabled = true; $('#emoji-clear').disabled = true;
        try {
          await api('emojis/assign', 'POST', {target: destination, emoji_id: id});
          const p = state.products.find(item => 'product:' + item.id === destination);
          if (p) p.emoji_id = id; else emojiLibrary.assignments[destination] = id;
          showSelection(id); toast(id ? 'Иконка назначена' : 'Иконка убрана', 'success');
        } catch (error) { toast(error.message, 'error'); $('#emoji-apply').disabled = !selectedEmoji; } finally { $('#emoji-clear').disabled = false; }
      };
      $('#emoji-apply').onclick = () => assign(selectedEmoji);
      $('#emoji-clear').onclick = () => assign('');
    } catch (error) { body.textContent = error.message; }
  }
  $('#emoji-library-dialog').addEventListener('close', () => { if (TM.state.loaded) TM.emit('changed'); });

  /* ------------------------------------------------------------ product editor with photo and live bot preview */
  const productForm = $('#product-form');
  const imageUrl = p => p?.image_path ? `/api/products/${p.id}/image?v=${encodeURIComponent(p.image_path)}` : '';
  let editing = null, pendingFile = null, pendingUrl = '';
  const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

  function priceText(value) {
    if (value === '' || value == null || Number.isNaN(Number(value))) return '—';
    return TM.usdActive() ? '$' + Number(value).toFixed(2) : number(Math.round(Number(value))) + ' ⭐';
  }
  /** Mimics the bot's product message: photo, bold title, description, price block and buttons. */
  function drawPreview() {
    const f = productForm.elements, image = pendingUrl || imageUrl(editing);
    const old = f.old_price.value && Number(f.old_price.value) > Number(f.price.value) ? `<s>${esc(priceText(f.old_price.value))}</s> ` : '';
    const auto = f.mode.value === 'auto', stock = editing?.available ?? 0;
    $('#tg-preview').innerHTML = `<div class="tg-chat"><div class="tg-bubble">
        ${image ? `<img class="tg-photo" src="${esc(image)}" alt="">` : ''}
        <div class="tg-text"><b>${f.badge.value.trim() ? `<span class="tg-badge">${esc(f.badge.value.trim())}</span> ` : ''}${rich(f.name.value.trim() || 'Название товара')}</b>
        ${f.description.value.trim() ? `<p>${rich(f.description.value.trim())}</p>` : '<p class="tg-placeholder">Описание товара появится здесь.</p>'}
        <p>💰 Цена: ${old}<b>${esc(priceText(f.price.value))}</b></p>
        <p>${auto ? (editing ? `📦 В наличии: ${number(stock)}` : '📦 Выдача сразу после оплаты') : '👤 Выполнит менеджер после оплаты'}</p></div>
        <span class="tg-time">${new Date().toLocaleTimeString('ru-RU', {hour: '2-digit', minute: '2-digit'})}</span></div>
      <div class="tg-buttons"><span>🛒 Купить</span><span class="half">➖ 1 ➕</span><span class="half">◀️ Назад</span></div></div>
      <p class="muted">Приблизительный вид карточки в Telegram. ${f.active.checked ? '' : 'Товар скрыт: покупатели его не увидят.'}</p>`;
  }
  function drawImage() {
    const url = pendingUrl || imageUrl(editing), img = $('#image-current');
    img.hidden = !url; if (url) img.src = url; else img.removeAttribute('src');
    $('#image-empty').hidden = Boolean(url);
    $('#image-remove').hidden = !url;
    const supported = state.features?.images;
    $('#image-box').hidden = !supported;
    $('#image-note').textContent = !editing?.id && pendingFile ? 'Фото загрузится после сохранения товара.' : '';
    drawPreview();
  }
  function clearPending() { if (pendingUrl) URL.revokeObjectURL(pendingUrl); pendingFile = null; pendingUrl = ''; }
  async function useFile(file) {
    if (!file) return;
    TM.formError(productForm, null);
    if (!IMAGE_TYPES.includes(file.type)) { TM.formError(productForm, {message: 'Загрузите фото в формате JPEG, PNG или WebP'}); return; }
    if (file.size > 5 * 1024 * 1024) { TM.formError(productForm, {message: 'Фото должно быть не больше 5 МБ'}); return; }
    if (!editing?.id) { clearPending(); pendingFile = file; pendingUrl = URL.createObjectURL(file); drawImage(); return; }
    const drop = $('#image-drop');
    drop.classList.add('busy'); drop.setAttribute('aria-busy', 'true');
    try {
      const result = await TM.upload('products/' + editing.id + '/image', file);
      editing = {...editing, image_path: result.image_path};
      toast(`Фото сохранено · ${result.width}×${result.height}`, 'success'); drawImage(); TM.emit('changed');
    } catch (error) { TM.formError(productForm, error); } finally { drop.classList.remove('busy'); drop.removeAttribute('aria-busy'); }
  }
  $('#image-file').onchange = event => { useFile(event.target.files[0]); event.target.value = ''; };
  const drop = $('#image-drop');
  drop.addEventListener('dragover', event => { event.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', event => { event.preventDefault(); drop.classList.remove('over'); useFile(event.dataTransfer.files[0]); });
  $('#image-remove').onclick = async () => {
    if (pendingFile) { clearPending(); drawImage(); return; }
    if (!await confirm({title: 'Убрать фото?', text: 'Карточка в боте будет показана без фотографии.', ok: 'Убрать', danger: true})) return;
    try { await api('products/' + editing.id + '/image', 'DELETE'); editing = {...editing, image_path: ''}; drawImage(); toast('Фото убрано', 'success'); TM.emit('changed'); }
    catch (error) { toast(error.message, 'error'); }
  };
  // The ID field accepts whatever the owner pastes (the bot's "ID эмодзи: …" reply, a token); the server extracts
  // the digits. A native pattern here used to block submit silently, so the product was never saved.
  const emojiField = productForm.elements.emoji_id;
  emojiField.removeAttribute('pattern'); emojiField.maxLength = 200;
  emojiField.addEventListener('change', () => {
    const m = emojiField.value.match(/\|([0-9]{1,20})⟧/) || emojiField.value.match(/[0-9]{5,20}/);
    if (m) emojiField.value = m[1] || m[0];
  });
  productForm.addEventListener('input', drawPreview);
  productForm.addEventListener('change', drawPreview);
  $('#product-dialog').addEventListener('close', () => { clearPending(); editing = null; });

  function productDialog(p, title) {
    productForm.reset(); TM.formError(productForm, null); clearPending();
    const isUsd = TM.usdActive(), existing = Boolean(p?.id);
    editing = existing ? p : null;
    $('#price-label').textContent = isUsd ? 'Цена, $' : 'Цена, Stars';
    $('#old-price-label').textContent = isUsd ? 'Старая цена, $' : 'Старая цена, Stars';
    for (const name of ['price', 'old_price']) { productForm.elements[name].step = isUsd ? '0.01' : '1'; productForm.elements[name].min = isUsd ? '0.01' : '1'; }
    $('#category-list').innerHTML = [...new Set(state.products.map(item => item.category))].map(c => `<option value="${esc(c)}"></option>`).join('');
    productForm.elements.id.value = existing ? p.id : '';
    if (p) {
      for (const key of ['name', 'category', 'mode', 'description', 'instruction', 'emoji_id', 'badge']) productForm.elements[key].value = p[key] ?? '';
      productForm.elements.price.value = TM.amountInput(p.price);
      productForm.elements.old_price.value = p.old_price ? TM.amountInput(p.old_price) : '';
      productForm.elements.cost_price.value = p.cost_price == null ? '' : (p.cost_price / 100).toFixed(2);
    }
    // Purchase prices are analytics data: hidden (and never sent) without that permission.
    $('#cost-price-field').hidden = $('#cost-price-note').hidden = !TM.can('analytics');
    productForm.elements.active.checked = p ? Boolean(p.active) : true;
    productForm.elements.mode.disabled = existing;
    $('#mode-note').hidden = !existing;
    $('#emoji-pick').textContent = '◈ Выбрать из набора';
    $('#product-dialog-title').textContent = title || (existing ? 'Изменить товар' : 'Новый товар');
    drawImage();
    $('#product-dialog').showModal();
  }
  bindForm(productForm, async form => {
    const data = {};
    for (const key of ['name', 'category', 'description', 'mode', 'instruction', 'emoji_id', 'badge']) data[key] = form.elements[key].value;
    data.price = form.elements.price.value;
    data.old_price = form.elements.old_price.value === '' ? null : form.elements.old_price.value;
    if (TM.can('analytics')) data.cost_price = form.elements.cost_price.value === '' ? null : form.elements.cost_price.value;
    data.active = form.elements.active.checked;
    const id = form.elements.id.value;
    const saved = await api('products' + (id ? '/' + id : ''), id ? 'PUT' : 'POST', data);
    if (!id && pendingFile) {
      try { await TM.upload('products/' + saved.id + '/image', pendingFile); }
      catch (error) { toast('Товар создан, но фото не загружено: ' + error.message, 'error'); TM.emit('changed'); return; }
    }
    toast('Товар сохранён', 'success'); TM.emit('changed');
  });
  $('#add-product').onclick = () => productDialog();
  TM.openProduct = id => { const p = product(id); if (p && TM.can('products.manage')) productDialog(p); };

  /* ------------------------------------------------------------ stock import */
  const stockForm = $('#stock-form');
  function openImport(p) {
    stockForm.reset(); TM.formError(stockForm, null);
    stockForm.elements.id.value = p.id;
    $('#stock-name').textContent = p.name;
    $('#stock-preview').textContent = '0 строк готово к импорту';
    $('#stock-dialog').showModal();
  }
  stockForm.elements.lines.oninput = event => {
    const lines = event.target.value.split(/\r?\n/).map(x => x.trim()).filter(Boolean), unique = new Set(lines).size;
    $('#stock-preview').textContent = `${number(unique)} уникальных строк · ${number(lines.length - unique)} дублей в загрузке`;
  };
  $('#stock-file').onchange = async event => {
    const file = event.target.files[0];
    if (!file) return;
    TM.formError(stockForm, null);
    try {
      if (file.size > 500000) throw new Error('Файл должен быть не больше 500 КБ');
      const text = await file.text();
      if (text.includes('\u0000')) throw new Error('Выберите обычный текстовый файл UTF-8');
      stockForm.elements.lines.value = text;
      stockForm.elements.lines.dispatchEvent(new Event('input', {bubbles: true}));
    } catch (error) { TM.formError(stockForm, error); }
  };
  bindForm(stockForm, async form => {
    const result = await api('products/' + form.elements.id.value + '/stock', 'POST',
      {lines: form.elements.lines.value, unit_cost: form.elements.unit_cost.value === '' ? null : form.elements.unit_cost.value});
    toast(`Добавлено: ${result.added}. Уже были в стоке: ${result.duplicates}.`, 'success'); TM.emit('changed');
  });

  /* ------------------------------------------------------------ stock view */
  let stockProduct = null, stockRequest = 0, stockPage = 1;
  async function loadStock(pageNumber = stockPage) {
    const pid = stockProduct, request = ++stockRequest;
    try {
      const data = await api('products/' + pid + '/stock?' + new URLSearchParams({page: String(pageNumber), status: $('#stock-view-status').value}));
      if (request !== stockRequest || !$('#stock-view-dialog').open) return;
      stockPage = data.page;
      $('#stock-view-title').textContent = data.name + ' · текущий сток';
      $('#stock-view-summary').textContent = 'Свободно: ' + data.free + ' · В резерве: ' + data.reserved;
      $('#stock-view-items').innerHTML = (data.items.length ? data.items.map(item => `<article class="stock-item"><div class="stock-item-head"><div><b>Позиция №${item.id}</b> ${badge(item.status === 'free' ? 'Свободна' : 'В резерве', item.status === 'free' ? 'green' : 'orange')}<small>Себестоимость: ${item.unit_cost == null ? 'не указана' : usd(item.unit_cost)}</small>${item.order_id ? `<small>Заказ #${esc(item.order_id.slice(0, 8))} · резерв до ${date(item.expires)}</small>` : ''}</div>${TM.can('stock.reveal') ? `<button class="action" type="button" data-stock-reveal="${item.id}">Показать содержимое</button>` : ''}</div><pre hidden data-stock-content="${item.id}"></pre></article>`).join('')
        : empty('Сток пуст', 'Загрузите новые позиции или измените фильтр.')) + pager(data);
    } catch (error) { if (request === stockRequest) $('#stock-view-items').textContent = error.message; }
  }
  function openStock(p) {
    stockProduct = p.id; stockPage = 1;
    $('#stock-view-title').textContent = p.name + ' · текущий сток';
    $('#stock-view-status').value = '';
    $('#stock-view-items').textContent = 'Загрузка…';
    $('#stock-cost-form').reset(); TM.formError($('#stock-cost-form'), null);
    $('#stock-view-dialog').showModal(); loadStock(1);
  }
  $('#stock-view-status').onchange = () => loadStock(1);
  $('#stock-view-refresh').onclick = () => loadStock();
  $('#stock-view-dialog').addEventListener('close', () => { $('#stock-view-items').replaceChildren(); stockRequest++; });
  $('#stock-view-items').addEventListener('click', async event => {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.dataset.page) { loadStock(Number(button.dataset.page)); return; }
    if (!button.dataset.stockReveal) return;
    const content = $(`[data-stock-content="${button.dataset.stockReveal}"]`);
    if (!content.hidden) { content.textContent = ''; content.hidden = true; button.textContent = 'Показать содержимое'; return; }
    const request = stockRequest;
    button.disabled = true;
    try {
      const data = await api('products/' + stockProduct + '/stock/' + button.dataset.stockReveal);
      if (!content.isConnected || request !== stockRequest) return;
      content.textContent = data.content; content.hidden = false; button.textContent = 'Скрыть содержимое';
    } catch (error) { toast(error.message, 'error'); } finally { button.disabled = false; }
  });
  bindForm($('#stock-cost-form'), async form => {
    const amount = form.elements.amount.value;
    if (!await confirm({title: 'Изменить себестоимость?', text: `Установить себестоимость $${amount} для каждой свободной позиции этого товара?`, ok: 'Применить'})) throw TM.cancelled();
    const result = await api('products/' + stockProduct + '/stock-cost', 'PUT', {amount});
    toast('Обновлено позиций: ' + result.updated, 'success'); loadStock();
    return false;
  });

  /* ------------------------------------------------------------ product card */
  function showProduct(p) {
    $('#info-title').textContent = p.name;
    $('#info-body').innerHTML = `${p.image_path ? `<img class="info-photo" src="${esc(imageUrl(p))}" alt="Фото товара">` : ''}<p class="info-meta">${esc(p.category)} · <b>${money(p.price)}</b></p>
      <p>${p.mode === 'auto' ? 'Автовыдача · ' + number(p.available) + ' в наличии' : 'Выполняет менеджер'} · ${p.active ? 'В каталоге' : 'Скрыт'}</p>
      <div class="field-block"><span>Описание</span><pre>${esc(p.description || 'Без описания')}</pre></div>
      <div class="field-block"><span>Инструкция покупателю</span><pre>${esc(p.instruction || 'Без инструкции')}</pre></div>`;
    $('#info-dialog').showModal();
  }

  /* ------------------------------------------------------------ list view */
  const defaults = {search: '', mode: '', category: '', visibility: '', stock: ''};
  function filtered(f) {
    const q = f.search.trim().toLowerCase();
    return state.products.filter(p => (p.name + ' ' + p.category).toLowerCase().includes(q) && (!f.mode || p.mode === f.mode) &&
      (!f.category || p.category === f.category) &&
      (!f.visibility || (f.visibility === 'active' ? p.active : !p.active)) &&
      (!f.stock || (p.mode === 'auto' && (f.stock === 'empty' ? p.available === 0 : f.stock === 'low' ? p.available < 5 : p.available > 0))));
  }
  /** Neighbours inside the category, in catalogue order (server sorts by category, sort, id). */
  function edges(p) {
    const siblings = state.products.filter(item => item.category === p.category), index = siblings.findIndex(item => item.id === p.id);
    return {first: index <= 0, last: index === siblings.length - 1};
  }
  const columns = [
    {label: 'Товар', cell: p => `<div class="product-name"><span class="product-icon ${p.image_path ? 'photo' : ''}">${p.image_path ? `<img src="${esc(imageUrl(p))}" alt="" loading="lazy">` : p.emoji_id ? emojiImage(p.emoji_id, firstChar(p.name)) : esc(firstChar(p.name))}</span><div>${rich(p.name)}${p.badge ? ' ' + badge(p.badge, 'blue') : ''}<small>${esc(p.category)}</small></div></div>`},
    {label: 'Цена', className: 'nowrap', cell: p => `${p.old_price ? `<s class="muted">${money(p.old_price)}</s> ` : ''}${money(p.price)}${TM.can('analytics') ? `<small>Себест.: ${p.cost_price == null ? 'не указана' : usd(p.cost_price)}</small>` : ''}`},
    {label: 'Выдача', cell: p => p.mode === 'auto' ? 'Автоматически' : 'Менеджер'},
    {label: 'Остаток', cell: p => p.mode === 'auto' ? `<span class="stock-count ${p.available < 5 ? 'low' : ''}">${number(p.available)}</span>` : '—'},
    {label: 'Видимость', cell: p => badge(p.active ? 'В каталоге' : 'Скрыт', p.active ? 'green' : '')},
    {label: 'Действия', className: 'actions', cell: p => `<div class="row-actions">
      ${'sort' in p && !sorting() ? '' : 'sort' in p ? (() => { const e = edges(p); return iconButton('up', 'Выше в категории', `data-move="${p.id}" data-direction="up" ${e.first ? 'disabled' : ''}`) + iconButton('down', 'Ниже в категории', `data-move="${p.id}" data-direction="down" ${e.last ? 'disabled' : ''}`); })() : ''}
      ${iconButton('eye', 'Просмотр', `data-product-view="${p.id}"`)}
      ${p.mode === 'auto' && TM.can('stock.manage') ? `<button class="action" type="button" data-stock-view="${p.id}">Остатки</button>` : ''}
      <button class="action" type="button" data-edit="${p.id}">Изменить</button>
      ${iconButton(p.active ? 'hide' : 'eye', p.active ? 'Скрыть' : 'Показать', `data-toggle="${p.id}"`)}
      ${iconButton('copy', 'Копия', `data-clone="${p.id}"`)}
      ${iconButton('trash', 'Удалить', `data-delete-product="${p.id}"`, 'danger')}
      ${p.mode === 'auto' && TM.can('stock.manage') ? `<button class="action" type="button" data-stock="${p.id}">+ Сток</button>` : ''}</div>`},
  ];

  // ↑/↓ only make sense when the list shows the catalogue order (no text search or stock filter).
  let sorting = () => true;

  TM.view({
    id: 'products', perm: ['products.manage'], title: 'Товары', subtitle: 'Каталог, остатки и загрузка стока — в одном разделе.', auto: true, addProduct: true,
    async render({el}) {
      const f = {...defaults, ...prefs.get('filters.products', {})};
      const categories = [...new Set(state.products.map(p => p.category))];
      const inStock = state.products.reduce((sum, p) => sum + (p.mode === 'auto' ? p.available : 0), 0);
      el.innerHTML = `<div class="workflow-help"><b>Товары и склад</b><span>В наличии: ${number(inStock)} шт.</span><span>Заканчиваются: ${number(state.products.filter(p => p.mode === 'auto' && p.available < 5).length)}</span><span>Для пополнения нажмите «+ Сток» у товара</span></div>
        <section class="panel"><div class="toolbar">
          <input data-filter="search" type="search" placeholder="Поиск по названию и категории" aria-label="Поиск товаров">
          <select data-filter="mode" aria-label="Способ выдачи"><option value="">Все способы выдачи</option><option value="auto">Автоматически</option><option value="manual">Менеджер</option></select>
          <select data-filter="category" aria-label="Категория"><option value="">Все категории</option>${categories.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('')}</select>
          <select data-filter="visibility" aria-label="Видимость"><option value="">Все товары</option><option value="active">В каталоге</option><option value="hidden">Скрытые</option></select>
          <select data-filter="stock" aria-label="Остатки"><option value="">Все остатки</option><option value="available">В наличии</option><option value="low">Меньше 5 единиц</option><option value="empty">Закончились</option></select>
          <button class="action" type="button" data-manage-emojis>Настроить эмодзи</button><button class="action" type="button" data-export>Экспорт CSV</button><button class="action" type="button" data-reset>Сбросить фильтры</button>
        </div><div id="product-table"></div></section>`;
      const inputs = [...el.querySelectorAll('[data-filter]')];
      for (const input of inputs) input.value = f[input.dataset.filter] ?? '';
      const read = () => Object.fromEntries(inputs.map(input => [input.dataset.filter, input.value]));
      const target = el.querySelector('#product-table');
      const draw = () => {
        const f = read(), data = paginate(filtered(f), page, 50);
        sorting = () => !f.search && !f.stock && !f.mode && !f.visibility;
        page = data.page;
        const filteredOut = Object.values(f).some(Boolean);
        target.innerHTML = (table(columns, data.items) || (filteredOut
          ? empty('Товары не найдены', 'Под фильтр не подходит ни один товар.', {label: 'Сбросить фильтры', attrs: 'data-reset'})
          : empty('Каталог пуст', 'Создайте первый товар — он сразу появится в боте.', {label: '+ Создать товар', attrs: 'data-new-product'}))) + pager(data);
      };
      for (const input of inputs) input.oninput = input.onchange = () => { prefs.set('filters.products', read()); page = 1; draw(); };
      el.querySelector('.panel').addEventListener('click', async event => {
        const b = event.target.closest('button');
        if (!b) return;
        const d = b.dataset;
        try {
          if (d.page) { page = Number(d.page); draw(); }
          else if ('reset' in d) { inputs.forEach(input => { input.value = ''; }); prefs.set('filters.products', {}); page = 1; draw(); }
          else if ('manageEmojis' in d) await openEmojiLibrary();
          else if ('export' in d) {
            const costs = TM.can('analytics');
            csvDownload([['ID', 'Товар', 'Категория', 'Цена', ...(costs ? ['Себестоимость USD'] : []), 'Выдача', 'Остаток', 'В каталоге'],
              ...filtered(read()).map(p => [p.id, p.name, p.category, money(p.price), ...(costs ? [p.cost_price == null ? '' : (p.cost_price / 100).toFixed(2)] : []),
                p.mode === 'auto' ? 'Автоматически' : 'Менеджер', p.mode === 'auto' ? p.available : '', p.active ? 'да' : 'нет'])],
            'themarket-products-' + new Date().toISOString().slice(0, 10) + '.csv');
          }
          else if (d.move) {
            b.disabled = true;
            await api('products/' + d.move + '/move', 'POST', {direction: d.direction});
            await TM.loadProducts(); draw();
            target.querySelector(`[data-move="${d.move}"][data-direction="${d.direction}"]:not(:disabled)`)?.focus();
          }
          else if (d.productView) showProduct(product(d.productView));
          else if (d.stockView) openStock(product(d.stockView));
          else if (d.stock) openImport(product(d.stock));
          else if (d.edit) productDialog(product(d.edit));
          else if (d.clone) {
            const copy = {...product(d.clone), id: null, active: false};
            copy.name = Array.from(copy.name + ' — копия').slice(0, 120).join('');
            productDialog(copy, 'Копия товара');
          } else if (d.toggle) {
            const p = product(d.toggle);
            b.disabled = true;
            const {cost_price: cost, ...rest} = p;
            await api('products/' + p.id, 'PUT', {...rest, price: TM.amountInput(p.price), ...(TM.can('analytics') ? {cost_price: cost == null ? null : (cost / 100).toFixed(2)} : {}), active: !p.active});
            toast(p.active ? 'Товар скрыт' : 'Товар показан в каталоге', 'success'); TM.emit('changed');
          } else if (d.deleteProduct) {
            const p = product(d.deleteProduct);
            if (!p || !await confirm({title: `Удалить «${p.name}»?`, text: 'Товар исчезнет из панели и бота. История покупок и уже созданные заказы сохранятся.', ok: 'Удалить', danger: true})) return;
            b.disabled = true;
            await api('products/' + p.id, 'DELETE');
            toast('Товар удалён', 'success'); TM.emit('changed');
          }
        } catch (error) { toast(error.message, 'error'); b.disabled = false; }
      });
      draw();
    },
  });
})();
