# SkyOS Modder's Starter Kit

Build an app shortcut for SkyOS without editing SkyOS itself. The kit includes three integration paths: a self-contained HTML app that opens inside SkyOS, a native window opened by an SKSE plugin, and a SkyViewer settings module. SkyViewer is an in-game MCM-style menu built with PrismaUI; it lets supported mods expose settings without Papyrus scripts or Creation Kit forms. A mod still needs its own plugin code if a setting changes gameplay. You can combine these paths and publish shortcuts in SkyApps.

**Player requirement:** SkyOS Core (`SkyOS.dll`) must be installed for SkyOS apps, app shortcuts, and SkyViewer modules to run. Third-party web apps do not need their own DLL, but they still run inside the core. SkyDocuments and SkyViewer are part of the core package. For the first-party standalone-module layout, optional dependencies, app data locations, and optional custom-page media guidance, see [`FIRST_PARTY_APP_PACKAGING.md`](FIRST_PARTY_APP_PACKAGING.md).

Third-party app shortcuts appear in the **SkyApps tab only**. The Home page and side rail do not accept app registrations; they show SkyOS navigation and installed first-party SkyOS app shortcuts.

## Choose an integration

| You want to… | Start here | Needs an SKSE plugin of your own? |
| --- | --- | --- |
| Make a custom app with your own `index.html`, `style.css`, and `app.js` that opens inside SkyOS | `InternalAppTemplate/` | No |
| Open a separate Win32 or framework window outside the SkyOS page | `NativeAppTemplate/` and `SkyOSAPI.h` | Yes |
| Add settings and a custom page to SkyViewer | `StarterTemplate/` | Only if settings should change gameplay |

For full instructions, follow [`MODDER_GUIDE.md`](MODDER_GUIDE.md). It covers first setup, testing installation, logos, external and internal windows, app packaging with an ESP, quest mods and houses, and troubleshooting. The same quick overview is available in `Files/index.html` inside SkyViewer.

## Module manifest reference

`module.json` belongs in the root of the module folder. The folder name is its stable module ID. SkyViewer reads the manifest to build the module tab, controls, optional custom page, and optional SkyApps shortcut.

| Field | Purpose |
| --- | --- |
| `name` | Display name shown in SkyViewer. |
| `description` | Short explanation of the module. |
| `icon` and `accent` | Optional tab icon and accent color. |
| `settings` | Array of declared setting controls and defaults. |
| `showInSkyApps` | Optional shortcut for the module in SkyApps. |
| `nativeAppId` | Optional app folder ID to launch from that shortcut. |

Each setting needs a stable `id`, a `label`, a supported `type`, and a type-compatible `default`. Numeric settings should declare `min` and `max`; SkyViewer shows those values under the field. Users can type a value inside the limits. `step` can describe a convenient increment, but it does not round a typed value.

```json
{
  "name": "Northern Lights",
  "description": "Configure the mod's display behavior.",
  "settings": [
    { "id": "enabled", "label": "Enable effects", "type": "boolean", "default": true },
    { "id": "intensity", "label": "Intensity", "type": "number", "min": 0, "max": 100, "default": 50 },
    { "id": "quality", "label": "Quality", "type": "select", "default": "high", "options": ["low", "high"] }
  ]
}
```

SkyOS stores preferences per user in `%LOCALAPPDATA%/SkyOS/SkyViewer/<ModuleId>/settings.json`. A custom module page can listen for `{ type: 'skyos:settings', module, settings }` and request a change with `{ type: 'skyos:set-setting', id, value }`. The host ignores undeclared setting IDs and checks the type and range. Read [`StarterTemplate/README.md`](StarterTemplate/README.md) for the full message examples and code responsibilities.

## Quick start: internal app

1. Copy `InternalAppTemplate` to `Data/SKSE/Plugins/SkyOS/Apps/<YourUniqueAppId>/`.
2. Edit `app.ini` and give your app a unique name and description.
3. Customize `index.html`, `style.css`, and `app.js`. The page is opened in an isolated iframe. `skyos-bridge.js` is an optional helper for the SkyOS action bar, title, status, visibility, and close messages; copy it with the page if you use those features. Add images and other local assets beside them and reference them with relative paths.
4. Start Skyrim with SkyOS installed and open SkyApps. SkyOS discovers app folders when the SkyApps page is opened; no SkyOS source changes or DLL are needed.

For a direct local test install, set `SKYRIM_ROOT` to your Skyrim folder and run this in PowerShell from any directory:

```powershell
$kit = Join-Path $env:SKYRIM_ROOT 'Data\SKSE\Plugins\SkyOS\Mods\SkyViewer\SkyOSStarterKit'
$app = Join-Path $env:SKYRIM_ROOT 'Data\SKSE\Plugins\SkyOS\Apps\MyCustomApp'
New-Item -ItemType Directory -Force -Path $app | Out-Null
Copy-Item -Path (Join-Path $kit 'InternalAppTemplate\*') -Destination $app -Recurse -Force
```

Change `MyCustomApp` to your unique app ID, then edit the copied `app.ini` and app files. For MO2/Vortex, put the same resulting folder structure in the mod's staging folder instead.

The template app is regular HTML/CSS/JavaScript. It owns its page contents and design. `Mode=internal` selects the sandboxed iframe and `Mode=external` selects the native-window callback; both are discovered from the app's own `app.ini`. Installing another app does not require adding app-specific code to SkyOS. The optional iframe bridge can update the host heading/status, populate up to five action-bar buttons, and receive action clicks and visibility changes. It cannot directly control gameplay.

## Quick start: native window

Copy `NativeAppTemplate/` to `Data/SKSE/Plugins/SkyOS/Apps/<YourUniqueAppId>/`, then follow its README. Include `SkyOSAPI.h` and export `SkyOS_App_Launch` from your already-loaded SKSE DLL. SkyOS never loads arbitrary DLLs or executables.

## Optional gameplay APIs

The Starter Kit's `SkyOSAPI.h` only launches native app windows; it does not expose Skyrim gameplay state. Install the separate **SkyRewrite API Header**, **SkyCounter UI API Header**, or **SkyMissions API Header** component for those app-specific interfaces. The SkyMissions API lets native plugins register event-driven missions and SkyStore offers, then receive the public purchase message payload.

## Quick start: SkyViewer module

Copy `StarterTemplate/` to `Data/SKSE/Plugins/SkyOS/Mods/SkyViewer/<YourUniqueModuleId>/`. Edit `module.json` and its optional `Files/index.html`. A module can publish a SkyApps shortcut with `showInSkyApps: true`; set `nativeAppId` to pair that shortcut with an installed native app.

## Documents and branding

Place a document guide beneath `Data/SKSE/Plugins/SkyOS/Mods/<YourModName>/SkyDocuments/`. Put `logo.png` and an optional wide `banner.jpg` at the `<YourModName>` folder level. Supported image formats and size guidance are in `MODDER_GUIDE.md`.

## Build and install this kit

From the SkyOS source folder, build the example native plugin and install the optional component. The `SkyMissions API Header` is a separate CPack component; select it when you want the mission and SkyStore registration interface:

```powershell
cmake --build --preset release --target SkyOSStarterKitExample --parallel
cmake --install build --config Release --prefix $env:SKYRIM_ROOT --component SkyOSStarterKit
cpack --config build/CPackConfig.cmake -G 7Z -C Release
```

The API header component can be installed independently with `--component SkyMissionsAPIHeader` or included in the 7Z component archives created by CPack.

If you changed SkyOS's internal-app launcher code too, also build/install the main SkyOS component:

```powershell
cmake --build --preset release --target SkyOS --parallel
cmake --install build --config Release --prefix $env:SKYRIM_ROOT --component SkyOS
```

`SKYRIM_ROOT` should point to the game's root folder. With Mod Organizer 2 or Vortex, install the resulting files as a mod or copy them into the manager's staging folder so the virtual Data tree sees them.
