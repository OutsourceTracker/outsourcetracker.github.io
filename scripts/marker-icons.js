const MARKER_STYLES = {
  facility: { color: '#eab308', name: 'Facility' },
  entrance: { color: '#16a34a', name: 'Entrance' },
  exit: { color: '#dc2626', name: 'Exit' },
  dock: { color: '#2563eb', name: 'Dock' }
};

const MARKER_ICONS = {
  facility: `
    <path d="M4 19h16v-9.5L12 4.5 4 9.5V19z" fill="none" stroke="#ffffff" stroke-width="2" stroke-linejoin="round"/>
    <path d="M8.5 19v-5.5h7v5.5" fill="none" stroke="#ffffff" stroke-width="1.8" stroke-linejoin="round"/>
    <path d="M10 13.5h1.8M12.1 13.5h1.8" stroke="#ffffff" stroke-width="1.6" stroke-linecap="round"/>
  `,
  entrance: `
    <path d="M4.5 5.5h7.5v13H4.5z" fill="none" stroke="#ffffff" stroke-width="2" stroke-linejoin="round"/>
    <path d="M12 12h7.5M16.2 8.8 19.5 12l-3.3 3.2" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  `,
  exit: `
    <path d="M12 5.5h7.5v13H12z" fill="none" stroke="#ffffff" stroke-width="2" stroke-linejoin="round"/>
    <path d="M4.5 12H12M8.3 8.8 4.5 12l3.8 3.2" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  `,
  dock: `
    <path d="M3.5 8.5h12.5v8.5H3.5z" fill="none" stroke="#ffffff" stroke-width="2" stroke-linejoin="round"/>
    <path d="M3.5 12h12.5" stroke="#ffffff" stroke-width="1.6"/>
    <path d="M16 11.2h3.8l2.2 2.1v4.7H16z" fill="none" stroke="#ffffff" stroke-width="1.8" stroke-linejoin="round"/>
    <circle cx="7.2" cy="17.2" r="1.3" fill="#ffffff"/>
    <circle cx="18.8" cy="17.2" r="1.3" fill="#ffffff"/>
  `
};

function buildPinSvg(type, size = 32) {
  const style = MARKER_STYLES[type] || { color: '#6b7280' };
  const icon = MARKER_ICONS[type] || '';
  const height = Math.round(size * 1.2);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${height}" viewBox="0 0 40 48" role="img" aria-label="${style.name || type}">
    <path d="M20 0C9.5 0 1.5 8 1.5 18.5c0 13.5 18.5 29.5 18.5 29.5s18.5-16 18.5-29.5C38.5 8 30.5 0 20 0z" fill="${style.color}" stroke="#ffffff" stroke-width="2.5"/>
    <g transform="translate(8, 7) scale(1)">${icon}</g>
  </svg>`;
}

function createMapPinElement(type, size = 32) {
  const pin = document.createElement('div');
  pin.className = `map-marker-pin map-marker-${type}`;
  pin.style.cursor = 'pointer';
  pin.style.lineHeight = '0';
  pin.style.filter = 'drop-shadow(0 2px 4px rgba(0,0,0,0.45))';
  pin.innerHTML = buildPinSvg(type, size);
  return pin;
}

function createEditorPinElement(label, type) {
  const wrap = document.createElement('div');
  wrap.className = 'map-marker-editor';
  wrap.style.display = 'flex';
  wrap.style.flexDirection = 'column';
  wrap.style.alignItems = 'center';
  wrap.style.cursor = 'grab';

  const pin = createMapPinElement(type, 30);
  pin.style.cursor = 'grab';
  wrap.appendChild(pin);

  const text = document.createElement('div');
  text.textContent = label;
  text.style.marginTop = '2px';
  text.style.padding = '2px 6px';
  text.style.background = 'rgba(0,0,0,0.82)';
  text.style.color = '#ffffff';
  text.style.fontSize = '10px';
  text.style.fontWeight = '600';
  text.style.borderRadius = '4px';
  text.style.whiteSpace = 'nowrap';
  text.style.boxShadow = '0 1px 3px rgba(0,0,0,0.35)';
  wrap.appendChild(text);

  return wrap;
}

window.MarkerIcons = {
  MARKER_STYLES,
  createMapPinElement,
  createEditorPinElement
};