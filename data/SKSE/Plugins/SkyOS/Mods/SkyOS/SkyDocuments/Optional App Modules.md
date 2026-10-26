# SkyOS app modules

## Features

- SkyOS Core (`SkyOS.dll`) provides the in-game shell, Home page, SkyViewer, SkyDocuments, shared UI, and bridge used by SkyOS app modules.
- SkyViewer is the PrismaUI-built in-game MCM-style menu for supported mod settings. Authors can expose preferences without Papyrus scripts or Creation Kit forms; gameplay changes remain the owning mod's responsibility.
- SkySearch, SkyMonitor, SkyRewrite, SkyCollection, SkyCounter UI, SkyAchievements, and SkyMissions ship as optional SKSE DLLs with their own module manifests, pages/assets, documents, and app-specific data.
- SkyMissions requires SkyOS Core and SkyRewrite for gameplay-event mission tracking. SkyCollection is optional. SkyOS Core itself does not require SkyRewrite.
- The Home page keeps each app shortcut available. An installed app opens in the SkyOS window; a missing app shows its name and “is not installed.”
- SkyDocuments and SkyViewer remain built into SkyOS Core and are not separate app DLLs.

## Changelog

- **Separate app packages:** moved optional app implementations to individual DLLs and installable CPack components while keeping the shared in-game shell in `SkyOS.dll`.
- **Missing-app feedback:** Home shortcuts now report module availability without preventing SkyOS Core from opening.

## Requirements

- Skyrim Special Edition / Anniversary Edition Latest Version (supported runtime).
- SKSE Latest Version.
- PrismaUI Latest Version.
- SkyOS Latest Version.

## Data and documents

Each app's `Data/SKSE/Plugins/SkyOS/Mods/<App>/` folder contains that app's documents and assets. SkyViewer module pages live in `Data/SKSE/Plugins/SkyOS/Mods/SkyViewer/<App>/`. Per-user module settings are written to `%LOCALAPPDATA%/SkyOS/SkyViewer/<App>/settings.json`; game-specific state remains in that app's own save/co-save or cache location, as described in the app's guide.
