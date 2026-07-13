let map;
let AdvancedMarkerElement;
let boundaryPolygon = null;
const MAP_ID = '91655a72ee45e0e184bfe567';
let navigationPath = null;
let entranceMarkers = [];
let exitMarkers = [];
let dockMarkers = [];
let currentMode = null;
let drawingPoints = [];
let drawingPreview = null;
let mapClickListener = null;
let mapDblClickListener = null;
let currentEditingMarker = null;
let geocoder = null;
let geocodeTimer = null;
let lastGeocodedQuery = '';
let suppressAddressGeocode = false;
let masterLocations = [];
const MASTERLIST_URL = '../masterlist.json';

const POLYGON_OPTIONS = {
  strokeColor: '#ef4444',
  fillColor: '#ef4444',
  fillOpacity: 0.3,
  strokeWeight: 2,
  editable: true,
  draggable: true
};

const POLYLINE_OPTIONS = MarkerIcons.getNavigationPathOptions({
  editable: true,
  draggable: true
});

const PREVIEW_OPTIONS = {
  clickable: false,
  editable: false,
  draggable: false
};

function allMarkers() {
  return [...entranceMarkers, ...exitMarkers, ...dockMarkers];
}

function updateOverlayHitTargets(mode) {
  const allowDirectEdit = !mode;

  if (boundaryPolygon) {
    boundaryPolygon.setOptions({
      clickable: allowDirectEdit,
      editable: allowDirectEdit,
      draggable: allowDirectEdit
    });
  }

  if (navigationPath) {
    navigationPath.setOptions({
      clickable: allowDirectEdit,
      editable: allowDirectEdit,
      draggable: allowDirectEdit
    });
  }

  allMarkers().forEach((marker) => {
    marker.gmpClickable = allowDirectEdit;
    marker.gmpDraggable = allowDirectEdit;
  });
}

let appliedMapColorTheme = null;
let mapTypeChangeListener = null;
let reapplyingMapTheme = false;

function getMapViewState() {
  if (!map) {
    return {
      center: { lat: 47.25, lng: -122.45 },
      zoom: 16,
      mapTypeId: 'satellite'
    };
  }

  const center = map.getCenter();
  return {
    center: center
      ? {
          lat: typeof center.lat === 'function' ? center.lat() : center.lat,
          lng: typeof center.lng === 'function' ? center.lng() : center.lng
        }
      : { lat: 47.25, lng: -122.45 },
    zoom: map.getZoom() ?? 16,
    mapTypeId: map.getMapTypeId() || 'satellite'
  };
}

function bindMapTypeThemeSync() {
  if (!map) return;
  if (mapTypeChangeListener) {
    google.maps.event.removeListener(mapTypeChangeListener);
    mapTypeChangeListener = null;
  }

  mapTypeChangeListener = map.addListener('maptypeid_changed', () => {
    if (reapplyingMapTheme) return;
    const mapTypeId = map.getMapTypeId();
    if (
      Theme.mapTypeUsesColorScheme(mapTypeId) &&
      appliedMapColorTheme !== Theme.get()
    ) {
      reapplyMapTheme({ force: true });
    }
  });
}

function snapshotMapOverlays() {
  return {
    boundary: getLatLngArray(boundaryPolygon),
    navigationPath: getLatLngArray(navigationPath),
    truckEntrances: entranceMarkers.map((marker) => ({
      lat: getMarkerPosition(marker).lat,
      lng: getMarkerPosition(marker).lng,
      label: marker.__label || 'ENTRANCE',
      notes: marker.__notes || ''
    })),
    truckExits: exitMarkers.map((marker) => ({
      lat: getMarkerPosition(marker).lat,
      lng: getMarkerPosition(marker).lng,
      label: marker.__label || 'EXIT',
      notes: marker.__notes || ''
    })),
    docks: dockMarkers.map((marker, index) => ({
      lat: getMarkerPosition(marker).lat,
      lng: getMarkerPosition(marker).lng,
      name: marker.__label || `Dock ${index + 1}`,
      notes: marker.__notes || ''
    }))
  };
}

function clearMapOverlays({ updateStatus = true } = {}) {
  cancelDrawing();
  hideMarkerContextMenu();
  closeMarkerEditModal();

  if (boundaryPolygon) {
    boundaryPolygon.setMap(null);
    boundaryPolygon = null;
  }
  if (navigationPath) {
    navigationPath.setMap(null);
    navigationPath = null;
  }
  allMarkers().forEach((marker) => {
    marker.map = null;
  });
  entranceMarkers = [];
  exitMarkers = [];
  dockMarkers = [];

  if (updateStatus) {
    setStatus('Map cleared.');
  }
}

async function initMap(viewState = null) {
  if (mapDblClickListener) {
    google.maps.event.removeListener(mapDblClickListener);
    mapDblClickListener = null;
  }
  if (mapTypeChangeListener) {
    google.maps.event.removeListener(mapTypeChangeListener);
    mapTypeChangeListener = null;
  }

  const view = viewState || getMapViewState();
  const themedOptions = await Theme.getMapOptions({
    mapId: MAP_ID,
    zoom: view.zoom,
    center: view.center,
    mapTypeId: view.mapTypeId || 'satellite',
    gestureHandling: 'greedy',
    disableDoubleClickZoom: true
  });

  map = new google.maps.Map(document.getElementById('map'), themedOptions);
  appliedMapColorTheme = Theme.get();
  mapDblClickListener = map.addListener('dblclick', finishDrawing);
  bindMapTypeThemeSync();
}

async function reapplyMapTheme({ force = false } = {}) {
  if (!document.getElementById('map') || !window.google?.maps || !map) return;

  const view = getMapViewState();
  const needsColorScheme = Theme.mapTypeUsesColorScheme(view.mapTypeId);
  if (!force && !needsColorScheme) return;
  if (!force && appliedMapColorTheme === Theme.get()) return;

  reapplyingMapTheme = true;
  const snapshot = snapshotMapOverlays();
  const previousStatus = document.getElementById('drawStatus')?.textContent;

  try {
    clearMapOverlays({ updateStatus: false });
    await initMap(view);
    restoreMapFromData(snapshot);

    if (previousStatus) {
      setStatus(previousStatus);
    }
  } finally {
    reapplyingMapTheme = false;
  }
}

function getMarkerPosition(marker) {
  const p = marker.position;
  return {
    lat: typeof p.lat === 'function' ? p.lat() : p.lat,
    lng: typeof p.lng === 'function' ? p.lng() : p.lng
  };
}

function refreshMarkerContent(marker) {
  marker.content = MarkerIcons.createEditorPinElement(marker.__label || '', marker.__type || 'dock');
  bindMarkerContentListeners(marker);
}

function createEditorMarker(position, label, type, notes = '') {
  const marker = new AdvancedMarkerElement({
    map,
    position,
    gmpDraggable: true,
    content: MarkerIcons.createEditorPinElement(label, type)
  });
  marker.__label = label;
  marker.__notes = notes;
  marker.__type = type;
  attachMarkerEditListener(marker);
  return marker;
}

function getMarkerCollection(type) {
  if (type === 'entrance') return entranceMarkers;
  if (type === 'exit') return exitMarkers;
  if (type === 'dock') return dockMarkers;
  return null;
}

function markerTypeLabel(type) {
  if (type === 'entrance') return 'entrance';
  if (type === 'exit') return 'exit';
  if (type === 'dock') return 'dock';
  return 'marker';
}

function removeMarker(marker) {
  if (!marker) return;

  const collection = getMarkerCollection(marker.__type);
  if (collection) {
    const index = collection.indexOf(marker);
    if (index !== -1) collection.splice(index, 1);
  }

  marker.map = null;
  hideMarkerContextMenu();

  if (currentEditingMarker === marker) {
    closeMarkerEditModal();
  }

  const label = marker.__label || markerTypeLabel(marker.__type);
  setStatus(`Removed ${label}.`);
  updateJsonPreview();
}

function bindMarkerContentListeners(marker) {
  const content = marker.content;
  if (!(content instanceof HTMLElement)) return;

  content.addEventListener('click', (event) => {
    event.stopPropagation();
    marker.__fireEdit?.();
  });

  content.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    event.stopPropagation();
    showMarkerContextMenu(event.clientX, event.clientY, marker);
  });
}

function attachMarkerEditListener(marker) {
  let lastFire = 0;

  const fireEdit = () => {
    if (currentMode) return;
    const now = Date.now();
    if (now - lastFire < 250) return;
    lastFire = now;
    openMarkerEditModal(marker);
  };

  marker.__fireEdit = fireEdit;
  marker.gmpClickable = true;
  marker.addEventListener('gmp-click', fireEdit);
  bindMarkerContentListeners(marker);
}

function showMarkerContextMenu(clientX, clientY, marker) {
  const menu = document.getElementById('markerContextMenu');
  if (!menu) return;

  menu.__targetMarker = marker;
  menu.hidden = false;
  menu.setAttribute('aria-hidden', 'false');

  const menuWidth = menu.offsetWidth;
  const menuHeight = menu.offsetHeight;
  const maxX = window.innerWidth - menuWidth - 8;
  const maxY = window.innerHeight - menuHeight - 8;
  const left = Math.max(8, Math.min(clientX, maxX));
  const top = Math.max(8, Math.min(clientY, maxY));

  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
}

function hideMarkerContextMenu() {
  const menu = document.getElementById('markerContextMenu');
  if (!menu) return;
  menu.hidden = true;
  menu.setAttribute('aria-hidden', 'true');
  menu.__targetMarker = null;
}

function openMarkerEditModal(marker) {
  hideMarkerContextMenu();
  currentEditingMarker = marker;
  document.getElementById('modalLabel').value = marker.__label || '';
  document.getElementById('modalNotes').value = marker.__notes || '';

  const modal = document.getElementById('markerEditModal');
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
}

function closeMarkerEditModal() {
  const modal = document.getElementById('markerEditModal');
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
  currentEditingMarker = null;
}

function deleteCurrentMarker() {
  if (!currentEditingMarker) return;
  const marker = currentEditingMarker;
  const label = marker.__label || markerTypeLabel(marker.__type);
  if (!confirm(`Remove ${label}?`)) return;
  removeMarker(marker);
}

function setDrawingMode(mode) {
  if (currentMode === mode) {
    cancelDrawing();
    return;
  }

  cancelDrawing();
  currentMode = mode;
  drawingPoints = [];

  document.querySelectorAll('.tools button[data-mode]').forEach((button) => {
    button.classList.toggle('mode-active', button.dataset.mode === mode);
  });

  if (mode === 'polygon' || mode === 'polyline') {
    mapClickListener = map.addListener('click', handleShapeClick);
    updateDrawingPreview();
    setStatus(
      mode === 'polygon'
        ? 'Click map corners for boundary. Double-click or press Finish to close.'
        : 'Click map points for route. Double-click or press Finish when done.'
    );
  } else {
    mapClickListener = map.addListener('click', handleMarkerClick);
    setStatus(`Click the map to place an ${mode}.`);
  }

  updateOverlayHitTargets(mode);
}

function handleShapeClick(event) {
  drawingPoints.push(event.latLng);
  updateDrawingPreview();
}

function handleMarkerClick(event) {
  const position = event.latLng;
  let label;
  let collection;

  if (currentMode === 'entrance') {
    label = 'ENTRANCE';
    collection = entranceMarkers;
  } else if (currentMode === 'exit') {
    label = 'EXIT';
    collection = exitMarkers;
  } else if (currentMode === 'dock') {
    label = `Dock ${dockMarkers.length + 1}`;
    collection = dockMarkers;
  } else {
    return;
  }

  const marker = createEditorMarker(position, label, currentMode);
  collection.push(marker);
  setStatus(`${label} placed. Click again to add more, or choose another tool.`);
}

function updateDrawingPreview() {
  clearDrawingPreview();
  if (drawingPoints.length === 0) return;

  if (currentMode === 'polygon' && drawingPoints.length >= 3) {
    drawingPreview = new google.maps.Polygon({
      ...POLYGON_OPTIONS,
      ...PREVIEW_OPTIONS,
      paths: drawingPoints,
      fillOpacity: 0.15,
      map
    });
  } else if (currentMode === 'polyline' && drawingPoints.length >= 2) {
    drawingPreview = new google.maps.Polyline({
      ...POLYLINE_OPTIONS,
      ...PREVIEW_OPTIONS,
      path: drawingPoints,
      map
    });
  } else if (drawingPoints.length >= 1) {
    drawingPreview = new google.maps.Polyline({
      ...PREVIEW_OPTIONS,
      strokeColor: currentMode === 'polygon' ? '#ef4444' : '#22c55e',
      strokeOpacity: 0.8,
      strokeWeight: 3,
      path: drawingPoints,
      map
    });
  }
}

function finishDrawing() {
  if (currentMode !== 'polygon' && currentMode !== 'polyline') return;
  if (currentMode === 'polygon' && drawingPoints.length < 3) {
    setStatus('Boundary needs at least 3 points.');
    return;
  }
  if (currentMode === 'polyline' && drawingPoints.length < 2) {
    setStatus('Navigation path needs at least 2 points.');
    return;
  }

  const path = drawingPoints.map((p) => ({ lat: p.lat(), lng: p.lng() }));

  if (currentMode === 'polygon') {
    if (boundaryPolygon) boundaryPolygon.setMap(null);
    boundaryPolygon = new google.maps.Polygon({ ...POLYGON_OPTIONS, paths: path, map });
    setStatus('Boundary saved. Choose another tool or edit the shape on the map.');
  } else {
    if (navigationPath) navigationPath.setMap(null);
    navigationPath = new google.maps.Polyline({ ...POLYLINE_OPTIONS, path, map });
    setStatus('Navigation path saved. Choose another tool or edit the shape on the map.');
  }

  cancelDrawing();
}

function cancelDrawing() {
  if (mapClickListener) {
    google.maps.event.removeListener(mapClickListener);
    mapClickListener = null;
  }

  clearDrawingPreview();
  drawingPoints = [];
  currentMode = null;
  document.querySelectorAll('.tools button[data-mode]').forEach((button) => {
    button.classList.remove('mode-active');
  });
  updateOverlayHitTargets(null);
}

function clearDrawingPreview() {
  if (drawingPreview) {
    drawingPreview.setMap(null);
    drawingPreview = null;
  }
}

function setStatus(message) {
  const el = document.getElementById('drawStatus');
  if (el) el.textContent = message;
}

function getAddressQuery() {
  const parts = [
    document.getElementById('address').value.trim(),
    document.getElementById('city').value.trim(),
    document.getElementById('state').value.trim().toUpperCase(),
    document.getElementById('zip').value.trim()
  ].filter(Boolean);

  return parts.join(', ');
}

function hasEnoughAddressForGeocode() {
  const address = document.getElementById('address').value.trim();
  const city = document.getElementById('city').value.trim();
  const state = document.getElementById('state').value.trim();
  const zip = document.getElementById('zip').value.trim();

  if (city && state) return true;
  if (/^\d{5}(-\d{4})?$/.test(zip)) return true;
  return Boolean(address && (city || state));
}

function getAddressComponent(components, type, useShortName = false) {
  const component = components.find((entry) => entry.types.includes(type));
  if (!component) return '';
  return useShortName ? component.short_name : component.long_name;
}

function parseGeocoderResult(result) {
  const components = result.address_components || [];
  const zip = getAddressComponent(components, 'postal_code');
  const zipSuffix = getAddressComponent(components, 'postal_code_suffix');

  return {
    city:
      getAddressComponent(components, 'locality') ||
      getAddressComponent(components, 'sublocality') ||
      getAddressComponent(components, 'sublocality_level_1') ||
      getAddressComponent(components, 'administrative_area_level_2'),
    state: getAddressComponent(components, 'administrative_area_level_1', true).toUpperCase(),
    zip: zipSuffix ? `${zip}-${zipSuffix}` : zip
  };
}

function applyGeocodedAddressFields(parsed) {
  const filledFields = [];

  suppressAddressGeocode = true;

  const fieldMap = [
    ['city', parsed.city],
    ['state', parsed.state],
    ['zip', parsed.zip]
  ];

  fieldMap.forEach(([id, value]) => {
    const field = document.getElementById(id);
    if (!field.value.trim() && value) {
      field.value = value;
      filledFields.push(id);
    }
  });

  lastGeocodedQuery = getAddressQuery();
  suppressAddressGeocode = false;

  return filledFields;
}

async function geocodeAddressAndPan() {
  if (!map || suppressAddressGeocode) return;

  const query = getAddressQuery();
  if (!query || !hasEnoughAddressForGeocode()) return;
  if (query === lastGeocodedQuery) return;

  if (!geocoder) {
    geocoder = new google.maps.Geocoder();
  }

  try {
    const results = await new Promise((resolve, reject) => {
      geocoder.geocode({ address: query }, (response, status) => {
        if (status === 'OK') resolve(response);
        else reject(new Error(status));
      });
    });

    const result = results[0];
    const location = result?.geometry?.location;
    if (!location) {
      setStatus('Could not find that address on the map.');
      return;
    }

    map.panTo(location);
    if (map.getZoom() < 17) {
      map.setZoom(17);
    }

    const filledFields = applyGeocodedAddressFields(parseGeocoderResult(result));
    const resolvedQuery = getAddressQuery();

    let statusMessage = `Map moved to ${resolvedQuery}.`;
    if (filledFields.length > 0) {
      statusMessage += ' Empty city, state, or zip fields auto-filled.';
    }

    setStatus(statusMessage);
  } catch (error) {
    console.error('Geocoding failed', error);
    setStatus('Could not find that address on the map.');
  }
}

function scheduleAddressGeocode() {
  clearTimeout(geocodeTimer);
  geocodeTimer = setTimeout(geocodeAddressAndPan, 700);
}

function clearAll() {
  clearMapOverlays({ updateStatus: true });
}

function getLatLngArray(overlay) {
  if (!overlay) return [];
  return overlay.getPath().getArray().map((p) => ({ lat: p.lat(), lng: p.lng() }));
}

function restoreMapFromData(data) {
  clearMapOverlays({ updateStatus: false });

  if (data.boundary?.length > 2) {
    boundaryPolygon = new google.maps.Polygon({ ...POLYGON_OPTIONS, paths: data.boundary, map });
  }
  if (data.navigationPath?.length > 1) {
    navigationPath = new google.maps.Polyline({ ...POLYLINE_OPTIONS, path: data.navigationPath, map });
  }

  data.truckEntrances?.forEach((pt) => {
    entranceMarkers.push(
      createEditorMarker(
        { lat: pt.lat, lng: pt.lng },
        pt.label || 'ENTRANCE',
        'entrance',
        pt.notes || ''
      )
    );
  });
  data.truckExits?.forEach((pt) => {
    exitMarkers.push(
      createEditorMarker(
        { lat: pt.lat, lng: pt.lng },
        pt.label || 'EXIT',
        'exit',
        pt.notes || ''
      )
    );
  });
  data.docks?.forEach((dock, i) => {
    dockMarkers.push(
      createEditorMarker(
        { lat: dock.lat, lng: dock.lng },
        dock.name || `Dock ${i + 1}`,
        'dock',
        dock.notes || ''
      )
    );
  });

  updateOverlayHitTargets(null);
}

function buildLocationData() {
  const name = document.getElementById('name').value.trim() || 'Unnamed Location';

  return {
    $schema: '../../schemas/location-detail.schema.json',
    name,
    address: document.getElementById('address').value.trim(),
    city: document.getElementById('city').value.trim(),
    state: document.getElementById('state').value.trim().toUpperCase(),
    zip: document.getElementById('zip').value.trim(),
    category: document.getElementById('category').value,
    latitude: map ? map.getCenter().lat() : 47.25,
    longitude: map ? map.getCenter().lng() : -122.45,
    notes: document.getElementById('notes').value.trim(),
    boundary: getLatLngArray(boundaryPolygon),
    truckEntrances: entranceMarkers.map((m) => ({
      lat: getMarkerPosition(m).lat,
      lng: getMarkerPosition(m).lng,
      label: m.__label || 'ENTRANCE',
      notes: m.__notes || ''
    })),
    truckExits: exitMarkers.map((m) => ({
      lat: getMarkerPosition(m).lat,
      lng: getMarkerPosition(m).lng,
      label: m.__label || 'EXIT',
      notes: m.__notes || ''
    })),
    docks: dockMarkers.map((m, i) => ({
      lat: getMarkerPosition(m).lat,
      lng: getMarkerPosition(m).lng,
      name: m.__label || `Dock ${i + 1}`,
      notes: m.__notes || ''
    })),
    navigationPath: getLatLngArray(navigationPath)
  };
}

function updateJsonPreview() {
  const detailData = buildLocationData();
  document.getElementById('jsonOutput').textContent = JSON.stringify(detailData, null, 2);
  return detailData;
}

function generateJSON() {
  const detailData = updateJsonPreview();
  const safeName = detailData.name.replace(/[^a-z0-9]/gi, '_');
  downloadJson(JSON.stringify(detailData, null, 2), `${safeName}.json`);
}

function downloadJson(jsonStr, fileName) {
  const blob = new Blob([jsonStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

function copyJSON() {
  updateJsonPreview();
  const output = document.getElementById('jsonOutput').textContent;
  navigator.clipboard.writeText(output).then(() => setStatus('JSON copied to clipboard.'));
}

function resolveLocationFilePath(filePath) {
  if (!filePath) return '';
  if (/^https?:\/\//i.test(filePath) || filePath.startsWith('../') || filePath.startsWith('/')) {
    return filePath;
  }
  return `../${filePath}`;
}

function populateMasterlistSelect() {
  const select = document.getElementById('masterlistSelect');
  if (!select) return;

  select.innerHTML = '';

  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = masterLocations.length
    ? 'Select a location…'
    : 'No locations in masterlist';
  select.appendChild(placeholder);

  masterLocations.forEach((loc) => {
    const option = document.createElement('option');
    option.value = loc.filePath || '';
    const place = [loc.city, loc.state].filter(Boolean).join(', ');
    option.textContent = place ? `${loc.name} (${place})` : loc.name || loc.filePath || 'Unnamed';
    select.appendChild(option);
  });
}

async function loadMasterList() {
  const select = document.getElementById('masterlistSelect');
  const loadBtn = document.getElementById('loadMasterlistBtn');
  if (loadBtn) loadBtn.disabled = true;

  try {
    const res = await fetch(MASTERLIST_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    masterLocations = (data.locations || [])
      .filter((loc) => loc?.filePath)
      .slice()
      .sort((a, b) => (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' }));

    populateMasterlistSelect();
    if (loadBtn) loadBtn.disabled = masterLocations.length === 0;
  } catch (error) {
    console.error('Failed to load masterlist.json', error);
    masterLocations = [];
    if (select) {
      select.innerHTML = '<option value="">Failed to load masterlist</option>';
    }
    if (loadBtn) loadBtn.disabled = true;
    setStatus('Could not load masterlist.json. Serve this site over HTTP (not file://).');
  }
}

function applyLocationData(data, statusMessage) {
  suppressAddressGeocode = true;
  document.getElementById('name').value = data.name || '';
  document.getElementById('address').value = data.address || '';
  document.getElementById('city').value = data.city || '';
  document.getElementById('state').value = data.state || '';
  document.getElementById('zip').value = data.zip || '';
  document.getElementById('category').value = data.category || 'Warehouse';
  document.getElementById('notes').value = data.notes || '';
  lastGeocodedQuery = getAddressQuery();
  suppressAddressGeocode = false;

  if (data.latitude && data.longitude && map) {
    map.setCenter({ lat: data.latitude, lng: data.longitude });
    map.setZoom(17);
  }

  restoreMapFromData(data);
  updateJsonPreview();
  setStatus(statusMessage || 'Location loaded. Shapes restored on map.');
}

async function loadFromMasterlist() {
  const select = document.getElementById('masterlistSelect');
  const filePath = select?.value;
  if (!filePath) {
    setStatus('Select a location from the masterlist first.');
    return;
  }

  if (!map) {
    setStatus('Map is still loading. Try again in a moment.');
    return;
  }

  const entry = masterLocations.find((loc) => loc.filePath === filePath);
  const label = entry?.name || filePath;
  const loadBtn = document.getElementById('loadMasterlistBtn');
  if (loadBtn) loadBtn.disabled = true;
  setStatus(`Loading ${label}…`);

  try {
    const res = await fetch(resolveLocationFilePath(filePath));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    applyLocationData(data, `Loaded ${data.name || label} from masterlist.`);
  } catch (error) {
    console.error('Failed to load location from masterlist', error);
    alert('Could not load that location. Check that the file exists and you are serving over HTTP.');
    setStatus(`Failed to load ${label} from masterlist.`);
  } finally {
    if (loadBtn) loadBtn.disabled = masterLocations.length === 0;
  }
}

async function loadExistingJSON(e) {
  const file = e.target.files[0];
  if (!file) return;

  try {
    const data = JSON.parse(await file.text());
    applyLocationData(data, `Loaded ${data.name || file.name} from file.`);
  } catch (err) {
    alert('Could not load JSON file. Check the file format.');
    console.error(err);
  }

  e.target.value = '';
}

function saveMarkerEdit() {
  if (!currentEditingMarker) return;

  currentEditingMarker.__label = document.getElementById('modalLabel').value.trim();
  currentEditingMarker.__notes = document.getElementById('modalNotes').value.trim();
  refreshMarkerContent(currentEditingMarker);
  closeMarkerEditModal();
  updateJsonPreview();
}

function wireEditorControls() {
  document.querySelectorAll('.tools button[data-mode]').forEach((button) => {
    button.addEventListener('click', () => setDrawingMode(button.dataset.mode));
  });

  document.getElementById('finishDrawingBtn').addEventListener('click', finishDrawing);
  document.getElementById('cancelDrawingBtn').addEventListener('click', cancelDrawing);
  document.getElementById('clearAllBtn').addEventListener('click', clearAll);
  document.getElementById('loadMasterlistBtn').addEventListener('click', loadFromMasterlist);
  document.getElementById('masterlistSelect').addEventListener('change', () => {
    const select = document.getElementById('masterlistSelect');
    if (select?.value) {
      setStatus(`Selected ${select.options[select.selectedIndex].text}. Click Load to open it.`);
    }
  });
  document.getElementById('masterlistSelect').addEventListener('dblclick', () => {
    if (document.getElementById('masterlistSelect')?.value) {
      loadFromMasterlist();
    }
  });

  const modal = document.getElementById('markerEditModal');
  modal.addEventListener('click', (event) => {
    if (event.target === modal) closeMarkerEditModal();
  });

  const contextMenu = document.getElementById('markerContextMenu');
  contextMenu.addEventListener('click', (event) => {
    const actionButton = event.target.closest('[data-action]');
    if (!actionButton) return;

    const marker = contextMenu.__targetMarker;
    if (!marker) {
      hideMarkerContextMenu();
      return;
    }

    const action = actionButton.dataset.action;
    if (action === 'edit') {
      hideMarkerContextMenu();
      if (!currentMode) openMarkerEditModal(marker);
    } else if (action === 'remove') {
      const label = marker.__label || markerTypeLabel(marker.__type);
      hideMarkerContextMenu();
      if (confirm(`Remove ${label}?`)) {
        removeMarker(marker);
      }
    }
  });

  document.addEventListener('click', (event) => {
    const menu = document.getElementById('markerContextMenu');
    if (!menu || menu.hidden) return;
    if (menu.contains(event.target)) return;
    hideMarkerContextMenu();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      hideMarkerContextMenu();
      closeMarkerEditModal();
    }
  });

  window.addEventListener('resize', hideMarkerContextMenu);
  window.addEventListener('scroll', hideMarkerContextMenu, true);

  ['address', 'city', 'state', 'zip'].forEach((id) => {
    const field = document.getElementById(id);
    field.addEventListener('input', scheduleAddressGeocode);
    field.addEventListener('blur', geocodeAddressAndPan);
  });
}

async function initEditor() {
  Theme.init();
  Theme.onChange(() => {
    reapplyMapTheme();
  });
  wireEditorControls();
  const masterlistPromise = loadMasterList();

  const { AdvancedMarkerElement: MarkerClass } = await google.maps.importLibrary('marker');
  AdvancedMarkerElement = MarkerClass;
  await initMap();
  await masterlistPromise;
  setStatus(
    masterLocations.length
      ? 'Load a location from masterlist, or choose a drawing tool to begin.'
      : 'Choose a drawing tool to begin.'
  );
}

window.initEditor = initEditor;
window.setDrawingMode = setDrawingMode;
window.finishDrawing = finishDrawing;
window.cancelDrawing = cancelDrawing;
window.clearAll = clearAll;
window.generateJSON = generateJSON;
window.copyJSON = copyJSON;
window.loadExistingJSON = loadExistingJSON;
window.loadFromMasterlist = loadFromMasterlist;
window.saveMarkerEdit = saveMarkerEdit;
window.closeMarkerEditModal = closeMarkerEditModal;
window.deleteCurrentMarker = deleteCurrentMarker;