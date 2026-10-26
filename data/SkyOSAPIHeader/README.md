# SkyOS API Header and app integration

This package documents and provides `SkyOSAPI.h` for native app launchers, plus the SkyOS iframe bridge contract for embedded web apps. Apps register themselves beneath `Data/SKSE/Plugins/SkyOS/Apps/<AppId>/app.ini`; SkyOS discovers those folders when SkyApps is opened. Adding a new app does not require an app-specific SkyOS code change.

## Choose an app mode

- `Mode=internal` embeds the app's `index.html` in a sandboxed SkyOS iframe. Include `index.html`, `style.css`, and `app.js`; `skyos-bridge.js` is an optional helper for host title/status, action-bar buttons, close, and visibility messages. No app DLL is needed.
- `Mode=external` opens a separate native window. The already-loaded SKSE DLL named by `Plugin=` exports `SkyOS_App_Launch` using `SkyOSAPI.h`.

## Contents

- `include/SkyOSAPI.h` — native C ABI export contract, included with the SkyOS Starter Kit.
- `Data/SKSE/Plugins/SkyOS/Mods/SkyOSAPIHeader/SkyDocuments/SkyOS API Guide.html` — complete registration, bridge, native export, packaging, and troubleshooting guide, included with the SkyOS Starter Kit.
- `Data/SKSE/Plugins/SkyOS/Mods/SkyViewer/SkyOSStarterKit/` — ready-to-copy internal, native, and SkyViewer templates.

The header is not a game API and has no import library. The SkyOS Modder Starter Kit includes this app-launch contract and iframe bridge guide. Gameplay integrations are separate optional packages: SkyRewrite API Header exposes the world-history and bounty snapshots, SkyCounter UI API Header exposes recent pickup and location JSON snapshots, and SkyMissions API Header registers event-driven missions and SkyStore offers. Each package has its own runtime dependency.
