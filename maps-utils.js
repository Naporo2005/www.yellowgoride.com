// =========================================================
// YellowRide — maps-utils.js
// Leaflet + OpenStreetMap integration (free, no API key required)
// Load AFTER supabase-config.js and AFTER the Leaflet CDN script/CSS in your HTML:
//   <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
//   <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
// =========================================================

const YR_MAP_DEFAULTS = {
  centerLat: 9.4008,   // Tamale, Ghana
  centerLng: -0.8393,
  zoom: 14,
};

// Nominatim (OpenStreetMap's free geocoding service). Rate-limited to ~1 req/sec —
// debounce address search input before calling this.
const NOMINATIM_BASE = "https://nominatim.openstreetmap.org";

/**
 * Create a Leaflet map inside the given container element ID.
 * Returns the map instance.
 */
function createMap(containerId, opts = {}) {
  const lat = opts.centerLat ?? YR_MAP_DEFAULTS.centerLat;
  const lng = opts.centerLng ?? YR_MAP_DEFAULTS.centerLng;
  const zoom = opts.zoom ?? YR_MAP_DEFAULTS.zoom;

  const map = L.map(containerId, { zoomControl: true }).setView([lat, lng], zoom);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors',
    maxZoom: 19,
  }).addTo(map);

  return map;
}

/**
 * Custom colored marker icons matching the YellowRide brand.
 */
function makeIcon(color) {
  return L.divIcon({
    className: 'yr-marker',
    html: `<div style="
      width:16px;height:16px;border-radius:50%;
      background:${color};border:2.5px solid #161512;
      box-shadow:0 1px 4px rgba(0,0,0,0.3);
    "></div>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  });
}

const YR_ICONS = {
  pickup: makeIcon('#FFC93C'),   // yellow
  dropoff: makeIcon('#0B6E4F'), // green
  driver: makeIcon('#C4432B'),  // rust — moving marker stands out from static pins
};

/**
 * Builds a short, human-friendly address like "Zagyuli, Sagnarigu, Northern Region"
 * from Nominatim's structured address components — drops "Municipal District",
 * "Ghana", postal codes, etc. Shared by both reverse geocoding (pickup) and
 * forward geocoding (dropoff search), so the whole app shows consistent,
 * trimmed location names everywhere (ride history, driver request cards,
 * notifications all just display whatever gets stored/shown at this point).
 * @param {Object} addr - the `address` object from a Nominatim jsonv2 response
 * @returns {string|null}
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
  // Dedupe consecutive identical parts (e.g. place === district sometimes)
  const deduped = parts.filter((p, i) => i === 0 || p.toLowerCase() !== parts[i - 1].toLowerCase());

  return deduped.length ? deduped.join(', ') : null;
}

/**
 * Search for an address and return candidate matches with lat/lng.
 * Biased toward Ghana. Debounce calls to this by ~400ms in your input handler.
 * @param {string} query
 * @returns {Promise<Array<{label: string, lat: number, lng: number}>>}
 */
async function geocodeAddress(query) {
  if (!query || query.trim().length < 3) return [];

  const url = `${NOMINATIM_BASE}/search?format=jsonv2&addressdetails=1&limit=5&countrycodes=gh&q=${encodeURIComponent(query)}`;

  try {
    const res = await fetch(url, {
      headers: { 'Accept-Language': 'en' },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.map(r => ({
      label: buildShortAddress(r.address) || r.display_name,
      lat: parseFloat(r.lat),
      lng: parseFloat(r.lon),
    }));
  } catch (err) {
    console.error('Geocoding error:', err);
    return [];
  }
}

/**
 * Attach autocomplete behavior to a text input: shows a dropdown of
 * geocode matches, and calls onSelect({label, lat, lng}) when one is chosen.
 * @param {HTMLInputElement} inputEl
 * @param {HTMLElement} dropdownEl - an empty container positioned under the input
 * @param {(result: {label:string, lat:number, lng:number}) => void} onSelect
 */
function attachAddressAutocomplete(inputEl, dropdownEl, onSelect) {
  let debounceTimer = null;

  inputEl.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    const query = inputEl.value;
    debounceTimer = setTimeout(async () => {
      const results = await geocodeAddress(query);
      renderDropdown(results);
    }, 450);
  });

  function renderDropdown(results) {
    if (!results.length) {
      dropdownEl.style.display = 'none';
      dropdownEl.innerHTML = '';
      return;
    }
    dropdownEl.innerHTML = results.map((r, i) => `
      <div class="yr-autocomplete-item" data-idx="${i}">${r.label}</div>
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

  // Hide dropdown when clicking elsewhere
  document.addEventListener('click', (e) => {
    if (e.target !== inputEl && !dropdownEl.contains(e.target)) {
      dropdownEl.style.display = 'none';
    }
  });
}

/**
 * Haversine distance between two lat/lng points, in kilometers.
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
 * Falls back to sane defaults if settings can't be fetched.
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
 * Draw or update a route line between two points (straight line — for real
 * road-following routes you'd need a routing API like OSRM, which is out of
 * scope for the free Nominatim/Leaflet setup but can be added later).
 */
function drawRouteLine(map, existingLine, pickupLatLng, dropoffLatLng) {
  if (existingLine) map.removeLayer(existingLine);
  const line = L.polyline([pickupLatLng, dropoffLatLng], {
    color: '#0B6E4F',
    weight: 3,
    dashArray: '6 8',
  }).addTo(map);
  map.fitBounds(line.getBounds(), { padding: [40, 40] });
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
