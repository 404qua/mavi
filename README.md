# Mavi — Interplanetary Survival Guide: Martian Map

**Team Antilae · NASA Space Apps Challenge 2026**

## What we are making

Could microbial life exist on Mars? It is an exciting possibility, but it has not been confirmed. Scientists look for places and conditions that could help life survive, including evidence of water and protection from harsh surface conditions. Exploring those places—and planning for people to safely work there—requires bringing many kinds of Martian data together.

Mavi is an interactive map that combines Martian imagery, terrain, climate, ice, and other planetary data in one place. It is designed to support early mission planning and make Mars easier for anyone to explore and learn about.

## Meet the team

- **Taseen Ahnaf** — Frontend Engineer
- **Konal Debnath** — Backend Engineer
- **Farhan-A-Mohammad** — Researcher
- **Shawkatur Rahman** — Researcher
- **Mirana Mustary** — Designer

Together, we bring research, development, and design to the challenge of making a large collection of Martian data easier to use.

## Features

- **Interactive 3D Mars globe:** Explore the planet on a CesiumJS globe with global imagery and terrain.
- **Named-feature markers and search:** Find Martian features, inspect their locations, descriptions, and images.
- **Mission sites and local views:** Zoom in to candidate landing areas AP-1, AP-8, and AP-9 with high-resolution imagery and mapped terrain features.
- **Data layers:** Compare surface imagery with ice, modeled climate, mineral, and elemental data where available. Climate layers can be explored by season, time, and modeled condition.
- **Terrain and weather-aware Pathfinder:** Choose start and end points to calculate a traversable route using the Pathfinder's terrain and weather data.
- **First-person exploration:** View the terrain from closer to the surface.
- **Mission catalogue:** Browse information and images from past Mars missions to learn from their outcomes.

## Why AP-1, AP-8, and AP-9?

Arcadia Planitia and nearby northern lowland areas are of interest for future exploration because they combine relatively flat terrain with evidence that subsurface ice may be accessible. The AP-1, AP-8, and AP-9 candidate sites have been studied for their geology and possible near-surface ice. We use them as promising examples to explore—not as confirmed safe landing sites.

## Challenges and how we approached them

- **Martian datasets come in different formats, projections, and resolutions.** We built custom tools to prepare, combine, and tile imagery and terrain so they can be displayed on the globe.
- **Finding useful climate data for exploration.** We used Mars Climate Database data to prepare climate layers that can be browsed by season, time, and modeled condition.
- **Serving large datasets within our project resources.** We prepared static imagery and data tiles and hosted them with Cloudflare Pages.
- **Making route planning practical.** We preprocess traversability data into a tiled graph, then use a Web Worker, bidirectional search, and a corridor that can widen when needed. This keeps the interactive map responsive while routes are calculated.
- **Choosing useful candidate locations.** We reviewed site-selection research and compared practical considerations such as terrain, ice evidence, and exploration potential before focusing on AP-1, AP-8, and AP-9.

## How we used AI

We used AI as an assistant during research and development: to help explore possible datasets and tools, troubleshoot and review code, identify issues, and monitor long-running data-processing tasks. AI supported our work; it was not treated as a scientific source or a substitute for checking the underlying research and data.

## Data sources

### NASA data

- [Viking Mars Digital Image Model (MDIM) 2.1](https://astrogeology.usgs.gov/search/map/mars-viking-global-products) — global surface imagery used as the globe's base map.
- [Mars Global Surveyor MOLA](https://astrogeology.usgs.gov/search/map/Mars/Topography/HRSC_MOLA_Blend/Mars_HRSC_MOLA_BlendShade_Global_200mp_v2.lbl.xml) — elevation measurements included in the global blended terrain model.
- [Mars Reconnaissance Orbiter HiRISE](https://hirise.lpl.arizona.edu/ESP_060811_2205) — high-resolution imagery for the candidate-site local views (products ESP_052490_2200, ESP_043220_2210, and ESP_060811_2205).

### Other space agency data

- [Mars Express HRSC](https://pds-geosciences.wustl.edu/missions/mars_express/hrsc.htm) — stereo-camera elevation data used with MOLA for global terrain and for regional terrain detail.

### Other datasets

- [SWIM4IMIM ice-consistency products](https://swim.psi.edu/SWIM4MIMProducts.php) — ice-related map layers.
- [Mars Climate Database v6.2](https://www.lmd.ipsl.fr/en/bases-de-donnees/mcd-en/) — modeled climate data used to prepare climate layers; these are not live weather observations.
- [USGS/IAU Gazetteer of Planetary Nomenclature](https://www.usgs.gov/tools/gazetteer-planetary-nomenclature) — names, types, and locations for Martian features.
- [Geomorphological study of AP-1, AP-8, and AP-9](https://doi.org/10.1029/2024JE008724) — research source for the mapped terrain units and contacts at the candidate sites.
- [azmth.space Mars mission catalogue](https://azmth.space/data/mars-missions.json) — mission catalogue and links to mission sources.
- [azmth.space rover traverses](https://azmth.space/data/mars-traverses/) — rover traverse data used in the Pathfinder traversability graph.
- [Wikidata](https://www.wikidata.org/) and [Wikimedia Commons](https://commons.wikimedia.org/) — linked feature images and related information.

## Learning and impact

Mavi brings surface imagery, terrain, ice indicators, and modeled climate data together so users can compare regions, notice patterns, and explore candidate sites. The local views and feature markers help learners connect what they see on Mars with the conditions and challenges a mission may face. The mission catalogue adds historical context, while the Pathfinder demonstrates how terrain and weather information can support route planning.

Mavi is an educational and early-planning tool. Its maps do not prove that life exists, and its routes are not a guarantee of operational safety.

## Run locally

```bash
cd website
npm install
npm run dev
```

The website loads several imagery, terrain, and data layers from hosted services, so an internet connection is needed to explore the full map.

## Built with

- [CesiumJS](https://cesium.com/platform/cesiumjs/) for the interactive globe
- JavaScript modules and Web Workers for the web app and route calculation
- Python and C++ tools for data preparation and graph building
- Cloudflare Pages for hosted static data and imagery tiles
