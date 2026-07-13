# YellowRide

A web-based ride-hailing platform built for tricycle transport in Ghanaian cities (Tamale, Accra, Kumasi). Built with vanilla HTML/CSS/JS, Supabase, and Leaflet/OpenStreetMap.

## Overview

YellowRide connects passengers with tricycle drivers. Drivers pay a daily platform fee to go online; fares are negotiated directly between passenger and driver off-platform — no fare amounts are shown anywhere in the UI.

## Tech Stack

- **Frontend:** Vanilla HTML/CSS/JavaScript (no framework/build step)
- **Backend:** Supabase (auth, database, realtime subscriptions)
- **Maps:** Leaflet.js + OpenStreetMap
- **Fonts/Icons:** Google Fonts (Sora, Inter, JetBrains Mono), Font Awesome 6.5.1

## Project Structure

```
/
├── login.html                 # Auth entry point
├── passenger-dashboard.html   # Main passenger interface (request ride, history, favorites, live map)
├── driver-dashboard.html      # Driver interface (assumed — not yet reviewed in this session)
├── admin-dashboard.html       # Admin panel (nav responsiveness in progress)
├── rate-trip.html             # Post-trip rating & issue reporting
├── supabase-config.js         # Supabase client init + shared helpers (window.YellowRide)
├── maps-utils.js              # Leaflet map helpers, geocoding, marker icons, route drawing
└── ...
```

## Core Concepts

- **`window.YellowRide`** — a shared global namespace (from `supabase-config.js`) exposing:
  - `supabaseClient` — the initialized Supabase client
  - `requireRole(role)` — guards a page to a specific role (`'passenger'`, `'driver'`, `'admin'`), redirects/returns `null` if unauthorized
  - `subscribeToRide(rideId, callback)` — realtime ride status updates
  - `subscribeToDriverLocation(driverId, callback)` — realtime driver GPS updates
  - `logoutUser()`

- **Ride lifecycle (`rides.status`):**
  `requested` → `accepted` → `driver_arriving` → `in_progress` → `completed`
  (or `cancelled` / `no_driver_found` at various points)

- **No fares in UI** — this was a deliberate architectural pivot. Passengers and drivers agree pricing verbally/in person; the platform only facilitates matching and daily driver access via a platform fee.

## Key Database Tables (Supabase)

- `profiles` — user identity (`full_name`, `phone_number`, role)
- `drivers` — driver-specific data (`driver_code`, `rating_avg`)
- `rides` — ride requests/trips (pickup/dropoff coords + addresses, `distance_km`, `status`, timestamps)
- `ratings` — post-trip star ratings + comments (`ride_id`, `rated_by`, `rated_user`, `stars`, `comment`)
- `reports` — driver issue reports (`ride_id`, `reported_by`, `reported_user`, `reason`, `details`, `status`)
- `favorite_locations` — saved passenger addresses (`label`, `address`, `lat`, `lng`)

## Pages

### `passenger-dashboard.html`
Three-tab side panel (Request / History / Favorites) next to a live Leaflet map.
- Address autocomplete with a curated `POPULAR_PLACES` chip list for common Tamale landmarks
- Distance estimate shown before requesting
- Realtime ride status card with driver code, call/message actions, and live driver location on map
- Polling fallback (every 6s) in case realtime WebSocket events are missed
- Cancel-ride modal with reason selection
- On `completed` status, auto-redirects to `rate-trip.html?ride={id}` after 1.2s

### `rate-trip.html`
Post-trip flow with two views toggled via CSS class (`.panel-view.active`):
- **Rating view:** 1–5 star rating + optional comment, upserts into `ratings`, recalculates and writes the driver's `rating_avg`
- **Report view:** reason selection (unsafe driving, rude behavior, fare disagreement, vehicle condition, navigation, other) + details, inserts into `reports`
- Requires `?ride={id}` in the URL and validates the ride belongs to the logged-in passenger

## Known Outstanding Items

- [ ] Re-upload corrected file versions to resolve a file-hosting mismatch (some pages showing blank — likely stale/incorrect files at deployed paths, not code bugs)
- [ ] Add freeform address input as a fallback beyond autocomplete-only entry
- [ ] Complete admin dashboard navigation responsiveness (mobile breakpoints)

## Local Development Notes

- No build step — open HTML files directly or serve via any static file server.
- Requires `supabase-config.js` (and `maps-utils.js` where used) to be present **in the same directory** as each page — a missing or misplaced copy is a common cause of a page failing to initialize.
- Realtime features (ride status, driver location) depend on Supabase Realtime being enabled on the relevant tables.

## Design System

- **Colors:** Charcoal `#161512`, Off-white `#FFFCF5`, Yellow `#FFC93C`, Green `#0B6E4F`, Rust `#C4432B`
- **Fonts:** Sora (headings), Inter (body), JetBrains Mono (codes/meta data)
- Dark mode supported via `prefers-color-scheme` media queries throughout
