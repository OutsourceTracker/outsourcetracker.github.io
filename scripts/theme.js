let currentTheme = null;

function initTheme() {
  const saved = localStorage.getItem('theme');
  if (saved === 'dark' || saved === 'light') {
    currentTheme = saved;
  } else if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
    currentTheme = 'dark';
  } else {
    currentTheme = 'light';
  }
  applyTheme();
}

function toggleTheme() {
  currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
  localStorage.setItem('theme', currentTheme);
  applyTheme();
}

function applyTheme() {
  const root = document.documentElement;
  const toggle = document.getElementById('theme-toggle');
  root.setAttribute('data-theme', currentTheme);
  if (toggle) {
    toggle.textContent = currentTheme === 'dark' ? '\u2600\ufe0f' : '\ud83c\udf19';
    toggle.setAttribute(
      'aria-label',
      currentTheme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'
    );
  }
}

window.Theme = { init: initTheme, toggle: toggleTheme };
window.toggleTheme = toggleTheme;