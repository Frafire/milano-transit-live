# Credits and data licenses

Milano Transit Live is an **unofficial fan project**. It is not affiliated with, endorsed by or connected to ATM (Azienda Trasporti Milanesi) or the Comune di Milano. It does not use the ATM company logo; it uses the metro line marks (M1–M5) only to name the lines. It is free, has no ads and nothing to buy.

| What | Source | License | What we must do |
|---|---|---|---|
| Code in this repository | Giovanni and contributors | GPL-3.0 (see `LICENSE`) | Copies and changes must stay open source under GPL-3.0 |
| Timetable (GTFS) | Comune di Milano open data portal, dataset "Orari del trasporto pubblico locale nel Comune di Milano in formato GTFS" | CC BY 4.0 (to be confirmed on the dataset page) | Credit the source. An M3-only extract is stored in `data/gtfs_m3/` (made with `tools/extract_gtfs.py`); the full feed is not stored |
| Metro track geometry (`data/osm_*.txt`) | OpenStreetMap contributors, via Overpass | ODbL 1.0 | Credit OpenStreetMap; these files and anything built from them stay open under ODbL |
| Track rules and signals (`data/rules_*.json`) | Giovanni, with the in-game track editor | ODbL 1.0 (drawn on top of OSM data) | Same as above |
| Satellite imagery | Esri World Imagery (Esri, Maxar, Earthstar Geographics) | Esri terms | Free ArcGIS Developer account, no ads or subscriptions, under 1 million tiles a month, visible credit |
| Street map | OpenStreetMap / CARTO | OSM tile policy / CARTO basemap terms | Visible credit; CARTO key for non-commercial use before going public |
| Rail overlay | OpenRailwayMap | CC BY-SA 2.0 | Visible credit |
| Map library | Leaflet 1.9.4 (`web/vendor/leaflet`) | BSD-2-Clause | Keep `web/vendor/leaflet/LICENSE` |
| Fonts | Google Fonts (Barlow, Barlow Condensed, Doto, VT323) | SIL Open Font License | Nothing extra |
| Metro line marks (`web/img/lines/`, `web/img/m3_logo.png`, `web/img/home/metro.png`) | Images chosen by Giovanni | Checked by Giovanni: no copyright | Used only to name the lines |
| Menu background photo (`web/img/home/sfondo.jpg`, tram 1503) | **Source to be confirmed** | **To be confirmed** | Credit the author before publishing; without the file the menu uses a plain background |
| Network diagram behind the metro menu (`web/img/home/rete.png`, from a schematic map of the Milan metro, text removed) | **Source to be confirmed** (likely Wikimedia Commons) | **To be confirmed** (likely CC BY-SA) | Credit the author and keep the same license for the derived image |

Fleet lists (M3 and M4 train numbers) were typed in by Giovanni from public sources.
