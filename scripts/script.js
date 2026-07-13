let map;
let AdvancedMarkerElement;
let markers = [];
let mapOverlays = [];
let currentInfoWindow = null;
let allMasterLocations = [];
let activeLocationPath = null;
let pendingDeepLink = null;
let selectedNavTarget = null;
let selectedNavMarker = null;
const loadedDetails = new Map();
const MAP_ID = '91655a72ee45e0e184bfe567';

async function loadMasterListData() {
  try {
    const res = await fetch('masterlist.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    allMasterLocations = data.locations || [];

    populateCategoryFilter();
    filterLocations();
    return true;
  } catch (e) {
    console.error('Failed to load masterlist.json', e);
    document.getElementById('location-list').innerHTML =
      '<li style="cursor:default;color:#ef4444;">Failed to load locations. Serve this folder over HTTP (not file://).</li>';
    return false;
  }
}

async function loadLocationDetails(filePath) {
  if (loadedDetails.has(filePath)) {
    return loadedDetails.get(filePath);
  }
  try {
    const res = await fetch(filePath);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const details = await res.json();
    loadedDetails.clear();
    loadedDetails.set(filePath, details);
    return details;
  } catch (e) {
    console.error('Failed to load', filePath, e);
    return null;
  }
}

function initMap() {
  map = new google.maps.Map(document.getElementById('map'), {
    mapId: MAP_ID,
    zoom: 12,
    center: { lat: 47.25, lng: -122.45 },
    mapTypeId: 'hybrid',
    gestureHandling: 'greedy',
    fullscreenControl: true,
    mapTypeControl: false
  });
}

function isMobileDevice() {
  return (
    /Android|iPhone|iPad|iPod|webOS|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
    navigator.userAgentData?.mobile === true
  );
}

function getDefaultNavigationTarget(master, details) {
  const entrance = details?.truckEntrances?.[0];
  if (entrance?.lat != null && entrance?.lng != null) {
    return {
      type: 'coords',
      lat: entrance.lat,
      lng: entrance.lng,
      label: 'entrance',
      name: entrance.label || 'Entrance'
    };
  }

  const addressParts = [master.address, master.city, master.state, master.zip].filter(Boolean);
  if (addressParts.length > 0) {
    return { type: 'address', query: addressParts.join(', '), label: 'address', name: 'Address' };
  }

  if (details?.latitude != null && details?.longitude != null) {
    return {
      type: 'coords',
      lat: details.latitude,
      lng: details.longitude,
      label: 'facility',
      name: 'Facility'
    };
  }

  return null;
}

function getNavTargetLabel(target) {
  if (!target) return 'location';
  if (target.name) return target.name;
  const labels = {
    entrance: 'Entrance',
    exit: 'Exit',
    dock: 'Dock',
    facility: 'Facility',
    address: 'Address'
  };
  return labels[target.label] || 'Location';
}

function selectNavigationTarget(target, marker = null) {
  selectedNavTarget = target;
  updateMarkerSelectionHighlight(marker);
  updateActiveNavTargetUI();
}

function updateMarkerSelectionHighlight(marker) {
  if (selectedNavMarker?.content) {
    selectedNavMarker.content.classList.remove('nav-target-selected');
  }

  selectedNavMarker = marker;

  if (marker?.content) {
    marker.content.classList.add('nav-target-selected');
  }
}

function updateActiveNavTargetUI() {
  const activeItem = document.querySelector('#location-list li.active');
  if (!activeItem) return;

  const label = getNavTargetLabel(selectedNavTarget);
  const navBtn = activeItem.querySelector('.nav-btn');
  if (navBtn) {
    navBtn.setAttribute('aria-label', `Navigate to ${label}`);
  }

  const info = activeItem.querySelector('.location-info');
  let hint = activeItem.querySelector('.nav-target-hint');

  if (selectedNavTarget && info) {
    if (!hint) {
      hint = document.createElement('small');
      hint.className = 'nav-target-hint';
      info.appendChild(hint);
    }
    hint.textContent = `Navigate target: ${label}`;
  } else if (hint) {
    hint.remove();
  }
}

function resetNavigationTarget() {
  selectedNavTarget = null;
  updateMarkerSelectionHighlight(null);
}

function buildNavigationUrl(target) {
  if (!target) return null;

  if (isMobileDevice()) {
    if (target.type === 'coords') {
      return `geo:${target.lat},${target.lng}`;
    }
    return `geo:0,0?q=${encodeURIComponent(target.query)}`;
  }

  if (target.type === 'coords') {
    return `https://www.google.com/maps/search/?api=1&query=${target.lat},${target.lng}`;
  }
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(target.query)}`;
}

function populateCategoryFilter() {
  const select = document.getElementById('filter-category');
  if (!select) return;

  const currentValue = select.value;
  const categories = [
    ...new Set(
      allMasterLocations
        .map((loc) => (typeof loc.category === 'string' ? loc.category.trim() : ''))
        .filter(Boolean)
    )
  ].sort();

  select.replaceChildren();
  select.appendChild(new Option('All Categories', ''));

  categories.forEach((category) => {
    select.appendChild(new Option(category, category));
  });

  if (currentValue && categories.includes(currentValue)) {
    select.value = currentValue;
  }
}

function getFilteredLocations() {
  const term = document.getElementById('search').value.toLowerCase().trim();
  const category = document.getElementById('filter-category').value;

  return allMasterLocations.filter((loc) => {
    if (category && loc.category !== category) return false;
    if (term && !locationMatchesSearch(loc, term)) return false;
    return true;
  });
}

function getLocationFromUrl() {
  const filePath = new URLSearchParams(window.location.search).get('loc');
  if (!filePath) return null;
  return allMasterLocations.find((loc) => loc.filePath === filePath) || null;
}

function getLocationShareUrl(loc) {
  const url = new URL(window.location.href);
  url.searchParams.set('loc', loc.filePath);
  url.hash = '';
  return url.toString();
}

function setLocationInUrl(loc) {
  const url = new URL(window.location.href);
  if (loc) {
    url.searchParams.set('loc', loc.filePath);
  } else {
    url.searchParams.delete('loc');
  }
  history.replaceState({ loc: loc?.filePath || null }, '', url);
}

async function openLocation(loc, { updateUrl = true } = {}) {
  if (!loc) return false;

  activeLocationPath = loc.filePath;
  if (updateUrl) setLocationInUrl(loc);

  const details = await loadLocationDetails(loc.filePath);
  if (!details) return false;

  if (!map || !AdvancedMarkerElement) {
    pendingDeepLink = loc;
    filterLocations();
    return false;
  }

  showLocationOnMap({ ...loc, ...details });
  filterLocations();

  const activeItem = document.querySelector('#location-list li.active');
  activeItem?.scrollIntoView({ block: 'nearest' });
  return true;
}

async function tryOpenPendingDeepLink() {
  const loc = pendingDeepLink || getLocationFromUrl();
  if (!loc || !map || !AdvancedMarkerElement) return;

  pendingDeepLink = null;
  await openLocation(loc, { updateUrl: false });
}

function showShareFeedback(button) {
  const originalLabel = button.getAttribute('aria-label');
  button.setAttribute('aria-label', 'Link copied!');
  button.classList.add('share-btn-copied');
  setTimeout(() => {
    button.setAttribute('aria-label', originalLabel);
    button.classList.remove('share-btn-copied');
  }, 2000);
}

async function handleShareClick(event, loc) {
  event.preventDefault();
  event.stopPropagation();

  const shareUrl = getLocationShareUrl(loc);
  const shareData = {
    title: loc.name,
    text: `${loc.name} — ${loc.city}, ${loc.state}`,
    url: shareUrl
  };

  if (navigator.share) {
    try {
      await navigator.share(shareData);
      return;
    } catch (error) {
      if (error.name === 'AbortError') return;
    }
  }

  try {
    await navigator.clipboard.writeText(shareUrl);
    showShareFeedback(event.currentTarget);
  } catch (error) {
    console.error('Failed to copy share link', error);
    window.prompt('Copy this link:', shareUrl);
  }
}

async function handleNavigateClick(event, loc) {
  event.preventDefault();
  event.stopPropagation();

  const details = await loadLocationDetails(loc.filePath);
  const target =
    loc.filePath === activeLocationPath && selectedNavTarget
      ? selectedNavTarget
      : getDefaultNavigationTarget(loc, details);
  const navUrl = buildNavigationUrl(target);
  if (!navUrl) return;

  if (isMobileDevice()) {
    window.location.href = navUrl;
  } else {
    window.open(navUrl, '_blank', 'noopener,noreferrer');
  }
}

function renderLocationList(locations) {
  const ul = document.getElementById('location-list');
  ul.innerHTML = '';

  if (locations.length === 0) {
    ul.innerHTML = '<li style="cursor:default;opacity:0.7;">No locations match your filters.</li>';
    return;
  }

  locations.forEach((loc) => {
    const li = document.createElement('li');
    if (loc.filePath === activeLocationPath) {
      li.classList.add('active');
    }

    li.innerHTML = `
      <div class="location-item">
        <div class="location-info">
          <strong>${loc.name}</strong><br>
          <small>${loc.city}, ${loc.state} &bull; ${loc.category}</small>
          ${loc.address ? `<br><small>${loc.address}</small>` : ''}
        </div>
        <div class="location-actions">
          <button type="button" class="icon-btn share-btn" aria-label="Share location">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7"></path>
              <path d="M12 16V4"></path>
              <path d="m8 8 4-4 4 4"></path>
            </svg>
          </button>
          <button type="button" class="icon-btn nav-btn" aria-label="Navigate to location">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <polygon points="3 11 22 2 13 21 11 13 3 11"></polygon>
            </svg>
          </button>
        </div>
      </div>
    `;

    li.querySelector('.share-btn').onclick = (event) => handleShareClick(event, loc);
    li.querySelector('.nav-btn').onclick = (event) => handleNavigateClick(event, loc);
    li.onclick = () => openLocation(loc);
    ul.appendChild(li);
  });
}

function locationMatchesSearch(loc, term) {
  const fields = [loc.name, loc.city, loc.state, loc.category, loc.address, loc.zip];
  return fields.some((field) => field && field.toLowerCase().includes(term));
}

function filterLocations() {
  renderLocationList(getFilteredLocations());
  updateActiveNavTargetUI();
}

function clearMapGraphics() {
  markers.forEach((m) => {
    m.map = null;
  });
  markers = [];
  mapOverlays.forEach((o) => o.setMap(null));
  mapOverlays = [];
  currentInfoWindow?.close();
  currentInfoWindow = null;
  resetNavigationTarget();
}

function getMarkerColor(type) {
  return MarkerIcons.MARKER_STYLES[type]?.color || '#6b7280';
}

function buildPointInfoContent(title, body, type) {
  const color = getMarkerColor(type);
  return `
    <div style="color:#111;min-width:160px;max-width:280px;font-family:system-ui,sans-serif;">
      <div style="font-weight:700;font-size:1rem;color:${color};margin-bottom:0.35rem;">${title}</div>
      ${body ? `<div style="font-size:0.9rem;line-height:1.4;color:#374151;">${body}</div>` : ''}
    </div>
  `;
}

function buildInfoContent(loc) {
  const address = [loc.address, loc.city, loc.state, loc.zip].filter(Boolean).join(', ');
  const dockList = loc.docks?.length
    ? `<ul style="margin:0.5rem 0 0;padding-left:1.25rem;">${loc.docks
        .map((d) => `<li><strong style="color:${getMarkerColor('dock')};">${d.name}</strong>${d.notes ? ` — ${d.notes}` : ''}</li>`)
        .join('')}</ul>`
    : '';

  return `
    <div style="color:#111;max-width:280px;font-family:system-ui,sans-serif;">
      <h3 style="margin:0 0 0.5rem;color:${getMarkerColor('facility')};">${loc.name}</h3>
      ${address ? `<p style="margin:0 0 0.5rem;color:#374151;">${address}</p>` : ''}
      <p style="margin:0;color:#374151;">${loc.notes || 'No driver notes.'}</p>
      ${dockList}
      <p style="margin:0.75rem 0 0;font-size:0.8rem;color:#6b7280;">Tap a pin to select it as the navigate target and view details.</p>
    </div>
  `;
}

function bindMarkerClick(marker, handler) {
  let lastFire = 0;

  const fire = () => {
    const now = Date.now();
    if (now - lastFire < 250) return;
    lastFire = now;
    handler();
  };

  marker.gmpClickable = true;
  marker.addEventListener('gmp-click', fire);

  const content = marker.content;
  if (content instanceof HTMLElement) {
    content.addEventListener('click', (event) => {
      event.stopPropagation();
      fire();
    });
  }
}

function openPointInfo(marker, title, body, type) {
  currentInfoWindow?.close();
  currentInfoWindow = new google.maps.InfoWindow({
    content: buildPointInfoContent(title, body, type)
  });
  currentInfoWindow.open({ anchor: marker, map });
}

function getAveragePoint(points) {
  const lat = points.reduce((sum, pt) => sum + pt.lat, 0) / points.length;
  const lng = points.reduce((sum, pt) => sum + pt.lng, 0) / points.length;
  return { lat, lng };
}

function getBoundsCenter(points) {
  const bounds = new google.maps.LatLngBounds();
  points.forEach((pt) => bounds.extend(pt));
  const center = bounds.getCenter();
  return { lat: center.lat(), lng: center.lng() };
}

function getPolygonCentroid(points) {
  let twiceArea = 0;
  let lat = 0;
  let lng = 0;

  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length;
    const cross = points[i].lng * points[j].lat - points[j].lng * points[i].lat;
    twiceArea += cross;
    lat += (points[i].lat + points[j].lat) * cross;
    lng += (points[i].lng + points[j].lng) * cross;
  }

  if (Math.abs(twiceArea) < 1e-10) {
    return getAveragePoint(points);
  }

  return {
    lat: lat / (3 * twiceArea),
    lng: lng / (3 * twiceArea)
  };
}

function getFacilityPosition(loc) {
  const boundary = loc.boundary;
  if (!boundary || boundary.length < 3) {
    return { lat: loc.latitude, lng: loc.longitude };
  }

  const polygon = new google.maps.Polygon({ paths: boundary });
  const candidates = [
    getPolygonCentroid(boundary),
    getBoundsCenter(boundary),
    getAveragePoint(boundary)
  ];

  for (const candidate of candidates) {
    const point = new google.maps.LatLng(candidate.lat, candidate.lng);
    if (google.maps.geometry.poly.containsLocation(point, polygon)) {
      return candidate;
    }
  }

  return candidates[0];
}

function getLocationBounds(loc) {
  const bounds = new google.maps.LatLngBounds();

  const extend = (lat, lng) => {
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      bounds.extend({ lat, lng });
    }
  };

  const facilityPosition = getFacilityPosition(loc);
  extend(loc.latitude, loc.longitude);
  extend(facilityPosition.lat, facilityPosition.lng);
  loc.boundary?.forEach((pt) => extend(pt.lat, pt.lng));
  loc.truckEntrances?.forEach((pt) => extend(pt.lat, pt.lng));
  loc.truckExits?.forEach((pt) => extend(pt.lat, pt.lng));
  loc.docks?.forEach((dock) => extend(dock.lat, dock.lng));
  loc.navigationPath?.forEach((pt) => extend(pt.lat, pt.lng));

  return bounds;
}

function fitMapToLocation(loc) {
  if (!map) return;

  const bounds = getLocationBounds(loc);
  if (bounds.isEmpty()) return;

  google.maps.event.trigger(map, 'resize');

  const padding = { top: 56, right: 56, bottom: 56, left: 56 };
  map.fitBounds(bounds, padding);

  google.maps.event.addListenerOnce(map, 'idle', () => {
    const zoom = map.getZoom();
    if (zoom == null) return;

    const ne = bounds.getNorthEast();
    const sw = bounds.getSouthWest();
    const latSpan = Math.abs(ne.lat() - sw.lat());
    const lngSpan = Math.abs(ne.lng() - sw.lng());
    const isCompactSite = latSpan < 0.01 && lngSpan < 0.01;

    if (isCompactSite && zoom > 18) {
      map.setZoom(18);
    }
  });
}

function scheduleFitMapToLocation(loc) {
  requestAnimationFrame(() => fitMapToLocation(loc));
}

function showLocationOnMap(loc) {
  clearMapGraphics();

  if (loc.boundary && loc.boundary.length > 2) {
    mapOverlays.push(
      new google.maps.Polygon({
        paths: loc.boundary,
        strokeColor: '#ef4444',
        strokeOpacity: 0.8,
        strokeWeight: 3,
        fillColor: '#ef4444',
        fillOpacity: 0.25,
        clickable: false,
        map
      })
    );
  }

  if (loc.navigationPath && loc.navigationPath.length > 1) {
    mapOverlays.push(
      new google.maps.Polyline({
        ...MarkerIcons.getNavigationPathOptions(),
        path: loc.navigationPath,
        clickable: false,
        map
      })
    );
  }

  const facilityPosition = getFacilityPosition(loc);
  const facilityMarker = new AdvancedMarkerElement({
    map,
    position: facilityPosition,
    title: loc.name,
    content: MarkerIcons.createMapPinElement('facility', 34)
  });
  bindMarkerClick(facilityMarker, () => {
    selectNavigationTarget(
      {
        type: 'coords',
        lat: facilityPosition.lat,
        lng: facilityPosition.lng,
        label: 'facility',
        name: loc.name
      },
      facilityMarker
    );
    currentInfoWindow?.close();
    currentInfoWindow = new google.maps.InfoWindow({ content: buildInfoContent(loc) });
    currentInfoWindow.open({ anchor: facilityMarker, map });
  });
  markers.push(facilityMarker);

  const entranceMarkers = [];
  loc.truckEntrances?.forEach((pt) => {
    entranceMarkers.push(
      addPointMarker(pt, pt.label || 'Entrance', 'entrance', pt.notes || '')
    );
  });
  loc.truckExits?.forEach((pt) => {
    addPointMarker(pt, pt.label || 'Exit', 'exit', pt.notes || '');
  });
  loc.docks?.forEach((dock) => {
    addPointMarker(
      { lat: dock.lat, lng: dock.lng },
      dock.name,
      'dock',
      dock.notes || 'No dock notes.'
    );
  });

  const master = {
    address: loc.address,
    city: loc.city,
    state: loc.state,
    zip: loc.zip
  };
  const defaultTarget = getDefaultNavigationTarget(master, loc);
  let defaultMarker = facilityMarker;

  if (defaultTarget?.label === 'entrance' && entranceMarkers.length > 0) {
    defaultMarker = entranceMarkers[0];
  }

  selectNavigationTarget(defaultTarget, defaultMarker);
  scheduleFitMapToLocation(loc);

  currentInfoWindow = new google.maps.InfoWindow({ content: buildInfoContent(loc) });
  currentInfoWindow.open({ anchor: facilityMarker, map });
}

function addPointMarker(pt, title, type, body = '') {
  const marker = new AdvancedMarkerElement({
    map,
    position: { lat: pt.lat, lng: pt.lng },
    title,
    content: MarkerIcons.createMapPinElement(type, 30)
  });
  bindMarkerClick(marker, () => {
    selectNavigationTarget(
      {
        type: 'coords',
        lat: pt.lat,
        lng: pt.lng,
        label: type,
        name: title
      },
      marker
    );
    openPointInfo(marker, title, body, type);
  });
  markers.push(marker);
  return marker;
}

async function initApp() {
  const { AdvancedMarkerElement: MarkerClass } = await google.maps.importLibrary('marker');
  AdvancedMarkerElement = MarkerClass;

  if (!allMasterLocations.length) {
    await loadMasterListData();
  }

  if (!map) {
    initMap();
  }

  await tryOpenPendingDeepLink();
}

async function bootstrapApp() {
  Theme.init();
  const loaded = await loadMasterListData();
  if (!loaded) return;

  const urlLocation = getLocationFromUrl();
  if (urlLocation) {
    pendingDeepLink = urlLocation;
    activeLocationPath = urlLocation.filePath;
    filterLocations();
  }
}

window.addEventListener('popstate', () => {
  const urlLocation = getLocationFromUrl();
  if (urlLocation) {
    openLocation(urlLocation, { updateUrl: false });
    return;
  }

  activeLocationPath = null;
  clearMapGraphics();
  filterLocations();
});

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrapApp);
} else {
  bootstrapApp();
}

window.initApp = initApp;
window.filterLocations = filterLocations;