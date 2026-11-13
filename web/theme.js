'use strict';
/* Runs before the stylesheet paints: an explicit light/dark choice wins over the system setting. */
(() => {
  try {
    const theme = JSON.parse(localStorage.getItem('themarket.theme'));
    if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
  } catch { /* storage unavailable: follow prefers-color-scheme */ }
})();
