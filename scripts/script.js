let map;
let AdvancedMarkerElement;
let markers = [];
let mapOverlays = [];
let currentInfoWindow = null;
let allMasterLocations = [];
let locationIndex = [];
const loadedDetails = new Map();
const MAP_ID = '91655a72ee45e0e184bfe567';

async function loadMasterList() {
  try {
    const res = await fetch('masterlist.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    allMasterLocations = data.locations || [];
    locationIndex = [];

    await Promise.all(
      allMasterLocations.map(async (loc) => {
        const details = await loadLocationDetails(loc.filePath);
        locationIndex.push({ master: loc, details });
      })
    );

    renderLocationList(allMasterLocations);
    initMap();
    Theme.init();
  } catch (e) {
    console.error('Failed to load masterlist.json', e);
    document.getElementById('location-list').innerHTML =
      '<li style="cursor:default;color:#ef4444;">Failed to load locations. Serve this folder over HTTP (not file://).</li>';
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

function renderLocationList(locations) {
  const ul = document.getElementById('location-list');
  ul.innerHTML = '';

  if (locations.length === 0) {
    ul.innerHTML = '<li style="cursor:default;opacity:0.7;">No locations match your search.</li>';
    return;
  }

  locations.forEach((loc) => {
    const li = document.createElement('li');
    li.innerHTML = `
      <strong>${loc.name}</strong><br>
      <small>${loc.city}, ${loc.state} &bull; ${loc.category}</small>
      ${loc.address ? `<br><small>${loc.address}</small>` : ''}
    `;
    li.onclick = async () => {
      document.querySelectorAll('#location-list li').forEach((l) => l.classList.remove('active'));
      li.classList.add('active');

      const details = await loadLocationDetails(loc.filePath);
      if (details) {
        showLocationOnMap({ ...loc, ...details });
      }
    };
    ul.appendChild(li);
  });
}

function locationMatchesSearch(master, details, term) {
  const fields = [
    master.name,
    master.city,
    master.state,
    master.category,
    master.address,
    master.zip,
    details?.notes
  ];

  if (fields.some((f) => f && f.toLowerCase().includes(term))) return true;

  return (
    details?.docks?.some(
      (d) =>
        d.name?.toLowerCase().includes(term) || d.notes?.toLowerCase().includes(term)
    ) ||
    details?.truckEntrances?.some((e) => e.label?.toLowerCase().includes(term)) ||
    details?.truckExits?.some((e) => e.label?.toLowerCase().includes(term))
  );
}

function filterLocations() {
  const term = document.getElementById('search').value.toLowerCase().trim();
  if (!term) {
    renderLocationList(allMasterLocations);
    return;
  }

  const filtered = locationIndex
    .filter(({ master, details }) => locationMatchesSearch(master, details, term))
    .map(({ master }) => master);

  renderLocationList(filtered);
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
      <p style="margin:0.75rem 0 0;font-size:0.8rem;color:#6b7280;">Tap map pins to see entrance, exit, and dock labels.</p>
    </div>
  `;
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

function fitMapToLocation(loc) {
  const bounds = new google.maps.LatLngBounds();
  bounds.extend(getFacilityPosition(loc));

  const extendPoints = (points) => {
    points?.forEach((pt) => bounds.extend({ lat: pt.lat, lng: pt.lng }));
  };

  extendPoints(loc.boundary);
  extendPoints(loc.truckEntrances);
  extendPoints(loc.truckExits);
  extendPoints(loc.docks);
  extendPoints(loc.navigationPath);

  map.fitBounds(bounds);
  google.maps.event.addListenerOnce(map, 'bounds_changed', () => {
    if (map.getZoom() > 18) map.setZoom(18);
  });
}

function showLocationOnMap(loc) {
  clearMapGraphics();
  fitMapToLocation(loc);

  const facilityPosition = getFacilityPosition(loc);
  const facilityMarker = new AdvancedMarkerElement({
    map,
    position: facilityPosition,
    title: loc.name,
    content: MarkerIcons.createMapPinElement('facility', 34)
  });
  facilityMarker.addEventListener('gmp-click', () => {
    currentInfoWindow?.close();
    currentInfoWindow = new google.maps.InfoWindow({ content: buildInfoContent(loc) });
    currentInfoWindow.open({ anchor: facilityMarker, map });
  });
  markers.push(facilityMarker);

  if (loc.boundary && loc.boundary.length > 2) {
    mapOverlays.push(
      new google.maps.Polygon({
        paths: loc.boundary,
        strokeColor: '#ef4444',
        strokeOpacity: 0.8,
        strokeWeight: 3,
        fillColor: '#ef4444',
        fillOpacity: 0.25,
        map
      })
    );
  }

  loc.truckEntrances?.forEach((pt) => {
    addPointMarker(pt, pt.label || 'Entrance', 'entrance');
  });
  loc.truckExits?.forEach((pt) => {
    addPointMarker(pt, pt.label || 'Exit', 'exit');
  });

  loc.docks?.forEach((dock) => {
    addPointMarker(
      { lat: dock.lat, lng: dock.lng },
      dock.name,
      'dock',
      dock.notes || 'No dock notes.'
    );
  });

  if (loc.navigationPath && loc.navigationPath.length > 1) {
    mapOverlays.push(
      new google.maps.Polyline({
        path: loc.navigationPath,
        strokeColor: '#22c55e',
        strokeOpacity: 1,
        strokeWeight: 6,
        map
      })
    );
  }

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
  marker.addEventListener('gmp-click', () => openPointInfo(marker, title, body, type));
  markers.push(marker);
}

async function initApp() {
  const { AdvancedMarkerElement: MarkerClass } = await google.maps.importLibrary('marker');
  AdvancedMarkerElement = MarkerClass;
  await loadMasterList();
}

window.initApp = initApp;
window.filterLocations = filterLocations;