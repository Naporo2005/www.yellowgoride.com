// =========================================================
// YellowRide — maps-utils.js
// Leaflet + Geoapify (map tiles, place search, reverse geocoding, road routes)
// Load AFTER supabase-config.js and AFTER the Leaflet CDN script/CSS in your HTML:
//   <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
//   <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
//
// The API key below is public by design (it sits in browser code), so lock it to
// your domain in the Geoapify dashboard: yellowgoride.netlify.app
// =========================================================

const GEOAPIFY_KEY = 'a5ffc7a3b15841d19da8b593564165dd';
const GEOAPIFY_BASE = 'https://api.geoapify.com';

const YR_MAP_DEFAULTS = {
  centerLat: 9.4008,   // Tamale, Ghana
  centerLng: -0.8393,
  zoom: 14,
};

/**
 * Create a Leaflet map inside the given container element ID.
 * Uses Geoapify tiles; if they keep failing (bad key, quota used up) it
 * quietly switches to the standard OpenStreetMap tiles so the map never goes blank.
 */
function createMap(containerId, opts = {}) {
  const lat = opts.centerLat ?? YR_MAP_DEFAULTS.centerLat;
  const lng = opts.centerLng ?? YR_MAP_DEFAULTS.centerLng;
  const zoom = opts.zoom ?? YR_MAP_DEFAULTS.zoom;

  const map = L.map(containerId, { zoomControl: true }).setView([lat, lng], zoom);

  const geoTiles = L.tileLayer(
    `https://maps.geoapify.com/v1/tile/osm-bright/{z}/{x}/{y}.png?apiKey=${GEOAPIFY_KEY}`,
    {
      attribution:
        'Powered by <a href="https://www.geoapify.com/" target="_blank" rel="noopener">Geoapify</a> | ' +
        '© <a href="https://openmaptiles.org/" target="_blank" rel="noopener">OpenMapTiles</a> ' +
        '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
      maxZoom: 19,
    }
  ).addTo(map);

  let tileErrors = 0;
  let fellBack = false;
  geoTiles.on('tileerror', () => {
    tileErrors++;
    if (fellBack || tileErrors < 6) return;
    fellBack = true;
    map.removeLayer(geoTiles);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map);
  });

  return map;
}

/**
 * Custom colored marker icons matching the YellowRide brand.
 * The visible dot is 16px, but the touch area is 36px so pins are easy to drag on a phone.
 */
function makeIcon(color) {
  return L.divIcon({
    className: 'yr-marker',
    html: `<div style="width:36px;height:36px;display:flex;align-items:center;justify-content:center;">
      <div style="
        width:16px;height:16px;border-radius:50%;
        background:${color};border:2.5px solid #161512;
        box-shadow:0 1px 4px rgba(0,0,0,0.3);
      "></div>
    </div>`,
    iconSize: [36, 36],
    iconAnchor: [18, 18],
  });
}

const YR_ICONS = {
  pickup: makeIcon('#FFC93C'),   // yellow
  dropoff: makeIcon('#0B6E4F'), // green
  driver: makeIcon('#C4432B'),  // rust — moving marker stands out from static pins
};

/**
 * Kept for compatibility (older Nominatim-style address objects).
 */
function buildShortAddress(addr) {
  if (!addr) return null;

  const place = addr.village || addr.suburb || addr.town || addr.neighbourhood || addr.hamlet || addr.road;
  const district = (addr.county || addr.municipality || addr.city_district || '')
    .replace(/\s*Municipal District\s*/i, '')
    .replace(/\s*District\s*/i, '')
    .trim();
  const region = (addr.state || '').trim();

  const parts = [place, district, region].filter(Boolean);
  const deduped = parts.filter((p, i) => i === 0 || p.toLowerCase() !== parts[i - 1].toLowerCase());

  return deduped.length ? deduped.join(', ') : null;
}

/**
 * Builds a short label like "Tamale Central Market, Sagnarigu, Northern Region"
 * from a Geoapify result object.
 */
function buildShortAddressGeo(r) {
  if (!r) return null;

  const clean = (s) => (s || '')
    .replace(/\s*Municipal District\s*/i, '')
    .replace(/\s*Municipality\s*/i, '')
    .replace(/\s*District\s*/i, '')
    .trim();

  const first = r.name || r.street || r.suburb || r.address_line1;
  const second = clean(r.suburb || r.district || r.city || r.county);
  const third = (r.state || '').trim();

  const seen = new Set();
  const parts = [first, second, third].filter((p) => {
    if (!p) return false;
    const k = p.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  return parts.length ? parts.join(', ') : (r.formatted || null);
}

// Remember recent searches so repeat typing doesn't use up the daily free limit.
const _geoSearchCache = new Map();

function _escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

function _formatDist(km) {
  if (km == null) return '';
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`;
}

/**
 * Search for a place and return candidate matches with lat/lng.
 * Limited to Ghana and ranked closer to `near` ({lat, lng}, e.g. the passenger's
 * pickup) or to Tamale if not given. Matches more than 100 km away are hidden
 * unless nothing closer exists. Each result also carries distKm so the
 * dropdown can show how far away it is.
 * @returns {Promise<Array<{label: string, lat: number, lng: number, distKm: number}>>}
 */
async function geocodeAddress(query, near) {
  const q = (query || '').trim();
  if (q.length < 3) return [];

  const ref = near && typeof near.lat === 'number' && typeof near.lng === 'number'
    ? near
    : { lat: YR_MAP_DEFAULTS.centerLat, lng: YR_MAP_DEFAULTS.centerLng };

  const cacheKey = `${q.toLowerCase()}|${ref.lat.toFixed(2)},${ref.lng.toFixed(2)}`;
  if (_geoSearchCache.has(cacheKey)) return _geoSearchCache.get(cacheKey);

  const url =
    `${GEOAPIFY_BASE}/v1/geocode/autocomplete?text=${encodeURIComponent(q)}` +
    `&filter=countrycode:gh` +
    `&bias=proximity:${ref.lng},${ref.lat}` +
    `&limit=8&lang=en&format=json&apiKey=${GEOAPIFY_KEY}`;

  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    const all = (data.results || [])
      .filter((r) => typeof r.lat === 'number' && typeof r.lon === 'number')
      .map((r) => ({
        label: buildShortAddressGeo(r) || r.formatted,
        lat: r.lat,
        lng: r.lon,
        distKm: distanceKm(ref.lat, ref.lng, r.lat, r.lon),
      }));
    const close = all.filter((r) => r.distKm <= 100);
    const results = (close.length ? close : all).slice(0, 5);
    if (results.length) _geoSearchCache.set(cacheKey, results);
    return results;
  } catch (err) {
    console.error('Geocoding error:', err);
    return [];
  }
}

/**
 * Turn a lat/lng (for example a dragged pin) into a short address label.
 * @returns {Promise<string|null>}
 */
async function reverseGeocodeGeo(lat, lng) {
  const url =
    `${GEOAPIFY_BASE}/v1/geocode/reverse?lat=${lat}&lon=${lng}` +
    `&lang=en&format=json&apiKey=${GEOAPIFY_KEY}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    return buildShortAddressGeo((data.results || [])[0]);
  } catch (err) {
    console.warn('Reverse geocode failed', err);
    return null;
  }
}

/**
 * Attach autocomplete behavior to a text input: shows a dropdown of
 * geocode matches, and calls onSelect({label, lat, lng}) when one is chosen.
 */
function attachAddressAutocomplete(inputEl, dropdownEl, onSelect, getNear) {
  let debounceTimer = null;

  inputEl.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    const query = inputEl.value;
    debounceTimer = setTimeout(async () => {
      const results = await geocodeAddress(query, getNear ? getNear() : null);
      renderDropdown(results);
    }, 500);
  });

  function renderDropdown(results) {
    if (!results.length) {
      dropdownEl.style.display = 'none';
      dropdownEl.innerHTML = '';
      return;
    }
    dropdownEl.innerHTML = results.map((r, i) => `
      <div class="yr-autocomplete-item" data-idx="${i}">${_escapeHtml(r.label)}<span style="color:#8a8577;font-size:11px;margin-left:8px;">${_formatDist(r.distKm)}</span></div>
    `).join('');
    dropdownEl.style.display = 'block';

    dropdownEl.querySelectorAll('.yr-autocomplete-item').forEach((el, i) => {
      el.addEventListener('click', () => {
        inputEl.value = results[i].label;
        dropdownEl.style.display = 'none';
        dropdownEl.innerHTML = '';
        onSelect(results[i]);
      });
    });
  }

  document.addEventListener('click', (e) => {
    if (e.target !== inputEl && !dropdownEl.contains(e.target)) {
      dropdownEl.style.display = 'none';
    }
  });
}

/**
 * Haversine (straight-line) distance between two lat/lng points, in kilometers.
 */
function distanceKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Calculate an estimated fare from distance, using live rates from platform_settings.
 * (Unchanged. The app currently doesn't show fares.)
 */
async function estimateFare(distanceKmValue) {
  let baseFare = 5.0;
  let perKmRate = 1.5;

  try {
    const { data } = await window.YellowRide.supabaseClient
      .from('platform_settings')
      .select('key, value')
      .in('key', ['base_fare', 'per_km_rate']);

    if (data) {
      const base = data.find(s => s.key === 'base_fare');
      const perKm = data.find(s => s.key === 'per_km_rate');
      if (base?.value?.amount) baseFare = parseFloat(base.value.amount);
      if (perKm?.value?.amount) perKmRate = parseFloat(perKm.value.amount);
    }
  } catch (err) {
    console.warn('Could not fetch live fare rates, using defaults.', err);
  }

  const fare = baseFare + perKmRate * distanceKmValue;
  return Math.round(fare * 100) / 100;
}

/**
 * Ask Geoapify for the road route between two [lat, lng] points.
 * Returns { coords: [[lat,lng],...], km, minutes } or null if it fails.
 */
async function fetchRoadRoute(fromLatLng, toLatLng) {
  const url =
    `${GEOAPIFY_BASE}/v1/routing?waypoints=${fromLatLng[0]},${fromLatLng[1]}|${toLatLng[0]},${toLatLng[1]}` +
    `&mode=drive&apiKey=${GEOAPIFY_KEY}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const feature = data.features && data.features[0];
    if (!feature || !feature.geometry) return null;

    const g = feature.geometry;
    const lonLat = g.type === 'MultiLineString' ? g.coordinates.flat() : g.coordinates;
    const coords = lonLat.map(([lng, lat]) => [lat, lng]);
    if (coords.length < 2) return null;

    return {
      coords,
      km: (feature.properties.distance || 0) / 1000,
      minutes: Math.max(1, Math.round((feature.properties.time || 0) / 60)),
    };
  } catch (err) {
    console.warn('Road routing failed, keeping straight line.', err);
    return null;
  }
}

function _applyRoadRoute(map, line, route, from, to, onRoute, refit) {
  line.setLatLngs([from, ...route.coords, to]);
  line.setStyle({ dashArray: null, weight: 4 });
  if (refit) map.fitBounds(line.getBounds(), { padding: [40, 40] });
  if (onRoute) onRoute({ km: route.km, minutes: route.minutes });
}

/**
 * Draw or update a route line between two points.
 * Shows a straight dashed line right away, then swaps it for the real road
 * route when it arrives. If routing fails, the straight line simply stays.
 * Same signature as before; the optional 5th argument onRoute({km, minutes})
 * is called when the road route is ready.
 *
 * To protect the free daily limit, a moving driver re-uses the last road route
 * for up to 20 seconds unless they have moved more than 100 m.
 */
function drawRouteLine(map, existingLine, pickupLatLng, dropoffLatLng, onRoute) {
  if (existingLine) map.removeLayer(existingLine);
  const line = L.polyline([pickupLatLng, dropoffLatLng], {
    color: '#0B6E4F',
    weight: 3,
    dashArray: '6 8',
  }).addTo(map);
  map.fitBounds(line.getBounds(), { padding: [40, 40] });

  const last = map._yrLastRoute;
  const sameDestination =
    last &&
    Math.abs(last.to[0] - dropoffLatLng[0]) < 1e-5 &&
    Math.abs(last.to[1] - dropoffLatLng[1]) < 1e-5;
  const movedKm = last
    ? distanceKm(last.from[0], last.from[1], pickupLatLng[0], pickupLatLng[1])
    : Infinity;

  if (sameDestination && movedKm < 0.1 && Date.now() - last.time < 20000) {
    _applyRoadRoute(map, line, last.route, pickupLatLng, dropoffLatLng, onRoute, false);
    return line;
  }

  fetchRoadRoute(pickupLatLng, dropoffLatLng).then((route) => {
    if (!route) return;
    map._yrLastRoute = { from: pickupLatLng, to: dropoffLatLng, time: Date.now(), route };
    if (map.hasLayer(line)) {
      _applyRoadRoute(map, line, route, pickupLatLng, dropoffLatLng, onRoute, true);
    }
  });

  return line;
}

// Minimal CSS for the autocomplete dropdown — injected once so pages don't need to hand-add it.
(function injectAutocompleteStyles() {
  if (document.getElementById('yr-autocomplete-styles')) return;
  const style = document.createElement('style');
  style.id = 'yr-autocomplete-styles';
  style.textContent = `
    .yr-autocomplete-dropdown{
      position:absolute; z-index:1000; background:#fff; border:1.5px solid #E8E1CF;
      border-radius:10px; margin-top:4px; max-height:220px; overflow-y:auto;
      box-shadow:0 8px 20px rgba(0,0,0,0.08); display:none; width:100%;
    }
    .yr-autocomplete-item{
      padding:10px 14px; font-size:13px; cursor:pointer; border-bottom:1px solid #F1EDE0;
    }
    .yr-autocomplete-item:last-child{border-bottom:none;}
    .yr-autocomplete-item:hover{background:#F8F6EE;}
    @media (prefers-color-scheme: dark){
      .yr-autocomplete-dropdown{background:#1B1A16; border-color:#2A2820;}
      .yr-autocomplete-item{border-color:#2A2820; color:#F1EDE0;}
      .yr-autocomplete-item:hover{background:#242219;}
    }
  `;
  document.head.appendChild(style);
})();
