'use strict';
/* Login page: exchanges login + password for an HttpOnly session cookie, then opens the panel. */
(() => {
  try {
    const theme = JSON.parse(localStorage.getItem('themarket.theme'));
    if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
  } catch { /* storage unavailable */ }
  const form = document.getElementById('login-form');
  const error = form.querySelector('.form-error');
  const reveal = document.getElementById('login-reveal');
  const card = document.querySelector('.login-card');
  // A short horizontal shake on a failed attempt (transform only; skipped with reduced motion).
  const shake = () => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    card.classList.remove('shake'); void card.offsetWidth; card.classList.add('shake');
  };
  card.addEventListener('animationend', () => card.classList.remove('shake'));
  reveal.onclick = () => {
    const field = form.elements.password, shown = field.type === 'text';
    field.type = shown ? 'password' : 'text';
    reveal.textContent = shown ? 'Показать' : 'Скрыть';
    reveal.setAttribute('aria-pressed', String(!shown));
  };
  form.addEventListener('submit', async event => {
    event.preventDefault();
    error.textContent = '';
    for (const name of ['username', 'password']) {
      const field = form.elements[name];
      field.removeAttribute('aria-invalid');
      if (!field.value.trim()) {
        field.setAttribute('aria-invalid', 'true');
        error.textContent = name === 'username' ? 'Введите логин' : 'Введите пароль';
        field.focus();
        shake();
        return;
      }
    }
    const button = form.querySelector('[type=submit]');
    button.disabled = true; button.textContent = 'Проверяем…';
    try {
      const response = await fetch('/api/login', {method: 'POST', credentials: 'same-origin',
        headers: {'Content-Type': 'application/json', 'X-TheMarket': '1'},
        body: JSON.stringify({username: form.elements.username.value.trim(), password: form.elements.password.value})});
      if (response.ok) { card.classList.add('leaving'); location.replace('/' + location.hash); return; }
      let detail = '';
      try { detail = (await response.json()).detail; } catch { /* not JSON */ }
      error.textContent = typeof detail === 'string' && detail ? detail
        : response.status === 429 ? 'Слишком много неудачных входов. Повторите позже.' : 'Не удалось войти. Повторите попытку.';
      shake();
      form.elements.password.value = '';
      form.elements.password.focus();
    } catch {
      error.textContent = 'Нет связи с панелью. Проверьте, что сервер запущен.';
    } finally { button.disabled = false; button.textContent = 'Войти'; }
  });
})();
