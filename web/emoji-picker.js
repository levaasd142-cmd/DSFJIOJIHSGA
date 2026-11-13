/* Inline custom emoji: a floating picker (Ctrl+E / ⌘E / Ctrl+.) that inserts ⟦🔥|ID⟧ tokens at the caret
   of fields marked data-custom-emoji (product name/description/instruction, broadcast texts). */
(() => {
  const {esc, api, toast} = TM;
  const TOKEN = /⟦([^⟦⟧|\s<>&A-Za-zЀ-ӿ]{1,16})\|([0-9]{1,20})⟧/g;
  const RECENT_KEY = 'tm.emoji.recent';
  const image = (id, fallback) => TM.emojiImage ? TM.emojiImage(id, fallback) : esc(fallback);

  /** Text → HTML with custom emoji previews at their exact positions. */
  TM.emojiText = text => {
    let out = '', pos = 0;
    for (const m of String(text ?? '').matchAll(TOKEN)) {
      out += esc(text.slice(pos, m.index)) + `<span class="emoji-inline" title="${esc(m[2])}">${image(m[2], m[1])}</span>`;
      pos = m.index + m[0].length;
    }
    return out + esc(String(text ?? '').slice(pos));
  };
  TM.emojiPlain = text => String(text ?? '').replace(TOKEN, (_, fallback) => fallback);
  TM.emojiToken = (id, fallback) => `⟦${fallback}|${id}⟧`;

  let library = null, pop = null, target = null, range = [0, 0], tab = 'recent', active = 0, items = [];
  const recent = () => { try { return JSON.parse(localStorage.getItem(RECENT_KEY)) || []; } catch { return []; } };
  const remember = item => {
    const list = [item, ...recent().filter(x => x.id !== item.id)].slice(0, 24);
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(list)); } catch { /* private mode */ }
  };
  const allowed = el => el?.matches?.('input[data-custom-emoji],textarea[data-custom-emoji]') && !el.disabled && !el.readOnly;

  /** Caret coordinates (viewport) inside an input/textarea via a mirror element. */
  function caret(el) {
    const style = getComputedStyle(el), mirror = document.createElement('div'), rect = el.getBoundingClientRect();
    for (const p of ['font', 'letterSpacing', 'padding', 'border', 'boxSizing', 'lineHeight', 'textTransform', 'wordSpacing', 'tabSize'])
      mirror.style[p] = style[p];
    Object.assign(mirror.style, {position: 'fixed', visibility: 'hidden', top: rect.top + 'px', left: rect.left + 'px',
      width: rect.width + 'px', whiteSpace: el.tagName === 'TEXTAREA' ? 'pre-wrap' : 'pre', overflowWrap: 'break-word', overflow: 'hidden'});
    mirror.textContent = el.value.slice(0, el.selectionStart ?? el.value.length);
    const mark = document.createElement('span'); mark.textContent = '​'; mirror.append(mark);
    document.body.append(mirror);
    const m = mark.getBoundingClientRect(); mirror.remove();
    const x = Math.min(m.left - el.scrollLeft, rect.right - 8), y = Math.min(m.bottom - el.scrollTop, rect.bottom);
    return {x: Math.max(x, rect.left), y: Math.max(y, rect.top + 16)};
  }

  function packsItems() {
    if (tab === 'recent') return recent();
    const pack = library.packs.find(p => p.name === tab);
    return pack ? pack.items.map(item => ({...item, pack: pack.title})) : [];
  }
  function draw() {
    const query = pop.querySelector('.emoji-pop-search').value.trim().toLowerCase();
    const tabs = [['recent', 'Недавние'], ...library.packs.map(p => [p.name, p.title])];
    pop.querySelector('.emoji-pop-tabs').innerHTML = tabs.map(([name, title]) =>
      `<button type="button" role="tab" tabindex="-1" aria-selected="${name === tab}" data-emoji-tab="${esc(name)}">${esc(title)}</button>`).join('');
    const source = query ? library.packs.flatMap(p => p.items.map(item => ({...item, pack: p.title}))) : packsItems();
    items = source.filter(item => !query || (item.emoji + ' ' + item.id + ' ' + (item.pack || '')).toLowerCase().includes(query));
    active = Math.min(active, Math.max(0, items.length - 1));
    const grid = pop.querySelector('.emoji-pop-grid');
    grid.innerHTML = items.length ? items.map((item, i) =>
      `<button type="button" tabindex="-1" role="option" class="${i === active ? 'active' : ''}" aria-selected="${i === active}" data-emoji-index="${i}" title="${esc(item.emoji)} · ${esc(item.id)}">${image(item.id, item.emoji)}</button>`).join('')
      : `<p class="muted">${library.packs.length ? (tab === 'recent' && !query ? 'Недавних пока нет — выберите набор выше.' : 'Ничего не найдено') : 'Наборов нет. Загрузите набор: Товары → «Настроить эмодзи».'}</p>`;
    grid.querySelector('.active')?.scrollIntoView({block: 'nearest'});
  }
  function close(refocus = true) {
    if (!pop) return;
    pop.remove(); pop = null;
    if (refocus && target?.isConnected) { target.focus(); target.setSelectionRange(range[0], range[1]); }
  }
  function insert(item) {
    const el = target, token = TM.emojiToken(item.id, item.emoji);
    remember({id: item.id, emoji: item.emoji, pack: item.pack});
    close();
    el.focus(); el.setSelectionRange(range[0], range[1]);
    // execCommand keeps the native undo stack; setRangeText is the fallback.
    if (!document.execCommand('insertText', false, token) || el.value.slice(range[0], range[0] + token.length) !== token) {
      el.setRangeText(token, range[0], range[1], 'end');
      el.dispatchEvent(new Event('input', {bubbles: true}));
    }
  }
  async function open(el) {
    if (!allowed(el)) { toast('Кастомные эмодзи вставляются в название, описание и инструкцию товара и в текст рассылки', 'info'); return; }
    close(false);
    target = el; range = [el.selectionStart ?? el.value.length, el.selectionEnd ?? el.value.length];
    try { library = library || await api('emojis'); } catch (error) { toast(error.message, 'error'); return; }
    if (tab !== 'recent' && !library.packs.some(p => p.name === tab)) tab = 'recent';
    if (tab === 'recent' && !recent().length && library.packs[0]) tab = library.packs[0].name;
    pop = document.createElement('div');
    pop.className = 'emoji-pop'; pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', 'Кастомные эмодзи');
    pop.innerHTML = `<input class="emoji-pop-search" type="search" placeholder="Поиск: эмодзи, ID или набор" aria-label="Поиск эмодзи">
      <div class="emoji-pop-tabs" role="tablist"></div><div class="emoji-pop-grid" role="listbox"></div>
      <small class="muted">←↑↓→ выбор · Enter вставить · Esc закрыть</small>`;
    (el.closest('dialog[open]') || document.body).append(pop);
    const {x, y} = caret(el), w = Math.min(340, innerWidth - 16);
    pop.style.left = Math.max(8, Math.min(x, innerWidth - w - 8)) + 'px';
    pop.style.top = (y + 280 > innerHeight ? Math.max(8, y - 300) : y + 6) + 'px';
    active = 0; draw();
    const search = pop.querySelector('.emoji-pop-search');
    search.focus();
    search.addEventListener('input', () => { active = 0; draw(); });
    search.addEventListener('keydown', event => {
      const cols = Math.max(1, Math.round(pop.querySelector('.emoji-pop-grid').clientWidth / 40));
      const move = {ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols, ArrowUp: -cols}[event.key];
      if (move !== undefined && items.length) {
        event.preventDefault(); active = Math.max(0, Math.min(items.length - 1, active + move)); draw();
      } else if (event.key === 'Enter') { event.preventDefault(); if (items[active]) insert(items[active]); }
      else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
      else if (event.key === 'Tab') { event.preventDefault(); const names = ['recent', ...library.packs.map(p => p.name)];
        tab = names[(names.indexOf(tab) + (event.shiftKey ? names.length - 1 : 1)) % names.length]; active = 0; draw(); }
    });
    pop.addEventListener('mousedown', event => { if (!event.target.matches('.emoji-pop-search')) event.preventDefault(); });
    pop.addEventListener('click', event => {
      const t = event.target.closest('[data-emoji-tab]');
      if (t) { tab = t.dataset.emojiTab; active = 0; pop.querySelector('.emoji-pop-search').value = ''; draw(); return; }
      const b = event.target.closest('[data-emoji-index]');
      if (b) insert(items[Number(b.dataset.emojiIndex)]);
    });
  }
  TM.openEmojiPicker = open;
  TM.forgetEmojiLibrary = () => { library = null; };

  const isShortcut = e => (e.ctrlKey || e.metaKey) && !e.altKey && (e.code === 'KeyE' || e.code === 'Period');
  // Capture phase: works while typing in inputs/textareas, before the global "ignore while typing" rule.
  document.addEventListener('keydown', event => {
    if (!isShortcut(event)) return;
    event.preventDefault(); event.stopPropagation();
    if (pop) { close(); return; }
    open(pop ? target : document.activeElement);
  }, true);
  document.addEventListener('mousedown', event => { if (pop && !pop.contains(event.target)) close(false); }, true);
  window.addEventListener('resize', () => close(false));
  TM.shortcuts?.add({code: 'EmojiPicker', keys: ['Ctrl', 'E'], label: 'Вставить кастомный эмодзи в поле (также Ctrl + .)', run() {}});

  /** Mark emoji-capable fields and add a 😊 button; also re-applied when dialogs open. */
  const FIELDS = {'#product-form': {name: 2120, description: 3000, instruction: 2800}, '#news-form': {text: 6000, text_en: 6000}};
  function enhance() {
    for (const [selector, fields] of Object.entries(FIELDS)) {
      const form = document.querySelector(selector);
      if (!form) continue;
      for (const [name, max] of Object.entries(fields)) {
        const el = form.elements[name];
        if (!el || el.dataset.customEmoji !== undefined) continue;
        el.dataset.customEmoji = ''; el.maxLength = max;
        const button = document.createElement('button');
        button.type = 'button'; button.className = 'emoji-insert'; button.textContent = '😊';
        button.title = 'Вставить кастомный эмодзи (Ctrl+E)'; button.setAttribute('aria-label', button.title);
        button.addEventListener('mousedown', event => event.preventDefault());
        button.addEventListener('click', event => { event.preventDefault(); if (document.activeElement !== el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } open(el); });
        const wrap = document.createElement('span'); wrap.className = 'emoji-field';
        el.replaceWith(wrap); wrap.append(el, button);
      }
    }
  }
  enhance();
  new MutationObserver(() => enhance()).observe(document.body, {subtree: true, attributes: true, attributeFilter: ['open']});
  TM.on?.('view:rendered', enhance);
})();
