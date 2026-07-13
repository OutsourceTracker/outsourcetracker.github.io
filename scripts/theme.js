let currentTheme = null;
const themeListeners = new Set();

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

function getTheme() {
  return currentTheme;
}

function onThemeChange(listener) {
  if (typeof listener !== 'function') return () => {};
  themeListeners.add(listener);
  return () => themeListeners.delete(listener);
}

function updateThemeColorMeta() {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) return;
  meta.setAttribute('content', currentTheme === 'dark' ? '#0f172a' : '#f8fafc');
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
  updateThemeColorMeta();
  themeListeners.forEach((listener) => {
    try {
      listener(currentTheme);
    } catch (error) {
      console.error('Theme listener failed', error);
    }
  });
}

function mapTypeUsesColorScheme(mapTypeId) {
  return mapTypeId === 'roadmap' || mapTypeId === 'terrain';
}

/**
 * Build Google Map options for the current UI theme.
 * colorScheme only affects roadmap/terrain (set at map creation).
 * Default basemap is satellite; callers can override mapTypeId.
 */
async function getMapOptions(overrides = {}) {
  const isDark = currentTheme === 'dark';
  let colorScheme = isDark ? 'DARK' : 'LIGHT';

  try {
    if (window.google?.maps?.importLibrary) {
      const { ColorScheme } = await google.maps.importLibrary('core');
      if (ColorScheme) {
        colorScheme = isDark ? ColorScheme.DARK : ColorScheme.LIGHT;
      }
    }
  } catch (error) {
    console.warn('Could not load Maps ColorScheme; using string fallback.', error);
  }

  const mapTypeControlStyle =
    window.google?.maps?.MapTypeControlStyle?.DROPDOWN_MENU ?? undefined;

  const {
    mapTypeControlOptions: overrideControlOptions,
    ...restOverrides
  } = overrides;

  return {
    colorScheme,
    mapTypeId: 'satellite',
    backgroundColor: isDark ? '#0f172a' : '#e2e8f0',
    mapTypeControl: true,
    mapTypeControlOptions: {
      style: mapTypeControlStyle,
      mapTypeIds: ['roadmap', 'satellite', 'hybrid', 'terrain'],
      ...overrideControlOptions
    },
    ...restOverrides
  };
}

window.Theme = {
  init: initTheme,
  toggle: toggleTheme,
  get: getTheme,
  onChange: onThemeChange,
  getMapOptions,
  mapTypeUsesColorScheme
};
window.toggleTheme = toggleTheme;
