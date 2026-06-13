# Surf Floripa Forecast Prototype

A static browser prototype for checking day-window surf conditions around Florianopolis.

## Run

Open `index.html` directly, or serve the folder locally:

```bash
python3 -m http.server 4173
```

Then visit `http://localhost:4173`.

## Data

The app calls Open-Meteo directly from the browser:

- Forecast API: air temperature, cloud cover, precipitation probability, wind speed, wind direction, and gusts.
- Marine API: wave height, swell height, wave direction, swell period, sea level height, and sea surface temperature.

## Scoring Model

Each beach has prototype metadata in `app.js`:

- approximate coordinates
- spot profile, exposure, and plain-language traits
- coastal cues such as beach axis, shelter, and nearshore-depth feel
- preferred swell direction
- preferred offshore wind direction
- ideal wave-height range
- rough tide preference

The displayed score is a weighted heuristic:

- 44% swell quality: height, period, and swell direction
- 27% wind quality: offshore/cross/onshore direction, wind speed, and gust penalty
- 12% coastal fit: beach angle, shelter, and coarse nearshore-depth response
- 9% tide fit: sea level against that beach's rough preferred tide
- 8% weather comfort: rain and cloud penalty

Forecast confidence is shown separately because it should reduce trust in the prediction, not necessarily the surf quality itself.

## Interpretation Layer

The selected beach panel now explains the forecast in surf terms:

- what kind of beachbreak the spot is
- why nearby beaches can differ despite being close
- what the current swell, wind, tide, and weather imply for that beach
- how the closest beaches compare at the selected hour

These explanations are still heuristic. They combine the live Open-Meteo values with rough spot metadata, not live human surf reports.

## Open Data Upgrade Layer

The dashboard now includes an "Open data upgrades" panel. It also uses a lightweight precomputed coastal profile for each beach so beach angle, shelter, and coarse depth response influence the score before a heavier ingestion pipeline exists.

Highest-value sources to add next:

- GEBCO or NOAA ETOPO bathymetry: coarse depth profiles and nearshore slope.
- OpenStreetMap Overpass coastline data: beach angle, headlands, lagoon mouths, and shelter.
- Copernicus Marine wave forecasts: primary swell, secondary swell, and wind-wave partitions.
- CHM/BNDO tide and maregraphic data: Brazil-specific tide predictions and observations.
- PNBOIA/CHM buoy data: model bias checks against observed waves, wind, and sea state.
- Copernicus Sentinel-2 imagery: sandbar and shoreline change checks for long beachbreaks.

The practical next implementation would be a small preprocessing script that writes a local `data/spot_profiles.json` file with coastline angle, coarse bathymetry slope, and source metadata. The browser app can stay static while the heavier data work happens offline.

## Next Calibration Pass

The useful next step is to tune `BEACHES` from local knowledge:

- which swell directions each beach really likes
- which tides work best
- which beaches close out when size increases
- whether protected corners should be scored separately
- session feedback such as "Praia Mole, 2026-06-14 08:00, actual 4/5"
