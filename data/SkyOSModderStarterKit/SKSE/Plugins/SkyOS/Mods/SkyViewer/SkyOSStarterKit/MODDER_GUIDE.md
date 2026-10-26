# SkyOS modder guide

**Runtime requirement:** every app shown inside SkyOS depends on SkyOS Core (`SkyOS.dll`). An internal HTML app needs no app DLL of its own, while a native app needs its own loaded SKSE plugin. First-party SkyOS apps are packaged as optional DLLs with their own module and data; SkyDocuments and SkyViewer stay in the core package. See `FIRST_PARTY_APP_PACKAGING.md` for that package layout.

This guide explains how to add your mod's own app to SkyApps without editing SkyOS. You can make a web app that opens inside SkyOS, a native app window, a SkyViewer module, or a combination. Your Skyrim plugin, quest, and house files remain normal Skyrim mod content.

Third-party apps and modules can publish shortcuts in the **SkyApps tab only**. The Home page and side rail are reserved for SkyOS navigation and installed first-party SkyOS apps; app registration and `showInSkyApps` do not add entries to either place.

## 1. Choose the kind of app you need

### Internal app: easiest starting point

Choose this when you want your own pages, controls, styling, maps, dashboards, guide, or settings UI. It uses `index.html`, `style.css`, and `app.js`, opens in a SkyOS page, and needs no SkyOS source edits or DLL. Start with `InternalAppTemplate/`.

### External app window

Choose this when the app must be a separate native desktop window. It requires an SKSE plugin DLL that exports `SkyOS_App_Launch`. Start with `NativeAppTemplate/` and `NativeAppTemplate/SkyOSAPI.h`. A native window callback is only a launch contract; it does not itself expose Skyrim game state.

### SkyViewer module

Choose this to add settings to SkyViewer or a page that uses SkyOS's settings message bridge. Start with `StarterTemplate/`. The module UI alone does not apply settings to gameplay; your mod plugin must read the saved settings and implement them.

## 2. Make an internal app

1. Pick a unique app ID. Folder IDs may contain only letters, numbers, `_`, and `-`, and must not exceed 80 characters. A clear ID such as `NorthernLightsJournal` is a good choice.
2. In the installed kit, copy the **contents** of `InternalAppTemplate` into a new folder:

   ```text
   Data/SKSE/Plugins/SkyOS/Apps/NorthernLightsJournal/
   ```

3. Edit `app.ini`:

   ```ini
   [App]
   Name=Northern Lights Journal
   Description=Field notes and discoveries from my mod
   Mode=internal
   Logo=logo.png
   ```

   `Name` is required. `Description` and `Logo` are optional. Logo files must be PNG or JPG/JPEG, saved beside `app.ini`, and no larger than 1 MiB. If you do not have a logo, set `Logo=`.
4. Customize `index.html`, `style.css`, and `app.js`. You own the content and visual design within the app frame. The main HTML file must be no larger than 2 MiB; put styling, scripts, and other assets in their own files. Keep `skyos-bridge.js` beside `index.html` if you want host action-bar and status integration. Organize additional local CSS, JS, image, and data files in subfolders and reference them with relative URLs.
5. Keep the main `index.html` file at the app folder root. SkyOS lists the app when the SkyApps page requests its catalog. If you install it while Skyrim is open, leave and reopen SkyApps to refresh the list.
6. Include the full app folder in your mod archive and test it through your mod manager's virtual `Data` folder.

SkyOS does not require an app manifest, a SkyViewer module, a DLL, or edits to the SkyOS mod. A linked module is optional.

### Internal app files

```text
Data/
└── SKSE/Plugins/SkyOS/Apps/NorthernLightsJournal/
    ├── app.ini
    ├── index.html
    ├── style.css
    ├── app.js
    ├── skyos-bridge.js       (optional SkyOS host bridge helper)
    ├── logo.png             (optional)
    └── assets/              (optional; add your own files)
```

The app runs inside a sandboxed iframe with scripts and forms enabled. The sandbox separates your app from SkyOS, and does not provide direct access to Skyrim gameplay or arbitrary files on the computer. Avoid assuming browser storage or permissions that require a normal website origin. Use local assets to keep the app dependable offline. `skyos-bridge.js` exposes `window.SkyOSApp` for shell integration. Its messages are scoped to the active app iframe and support `on('host-ready')`, `on('visibility')`, `on('action-clicked')`, `setTitle()`, `setDescription()`, `setStatus()`, `setActions()`, and `close()`. Actions are labels and IDs rendered by SkyOS; clicking one sends its ID back to the app. The bridge grants no gameplay, filesystem, or arbitrary shell-command access.

The app registration controls the integration mode. In `app.ini`, set `Mode=internal` to embed the app webpage, or `Mode=external` to open the native app window. The internal mode requires `index.html`; the external mode requires `Plugin=<loaded plugin DLL>` and the `SkyOS_App_Launch` export. The app folder ID and registration are discovered by SkyOS, so each new app is shipped as its own `Apps/<AppId>/` directory without adding app-specific entries to SkyOS.

## 3. Open a separate native window

1. Build your SKSE plugin with the Skyrim/CommonLib environment appropriate for your project.
2. Include the kit's `SkyOSAPI.h` in a source file in your DLL. Define `SKYOS_APP_IMPLEMENTATION` before including it, then implement the declared C ABI export:

   ```cpp
   #define SKYOS_APP_IMPLEMENTATION
   #include "SkyOSAPI.h"

   HWND WINAPI SkyOS_App_Launch(const wchar_t* argument)
   {
       // Create, show, or bring your app window to the foreground.
       // Return its valid HWND, or nullptr if you could not open it.
       return nullptr;
   }
   ```

   Replace the placeholder with your window creation and activation code. The argument is optional and comes from `Argument=` in `app.ini`. Return a visible, valid HWND. If your UI framework uses a separate message thread, marshal the request to that thread and return the handle according to its startup lifecycle.
3. Copy `NativeAppTemplate/app.ini` to `Data/SKSE/Plugins/SkyOS/Apps/<UniqueAppId>/app.ini` and edit `Name`, `Description`, `Plugin`, `Logo`, and `Argument`. `Plugin` must be the DLL basename, such as `NorthernLights.dll`, not a path.
4. Install the DLL through your normal SKSE mod package into `Data/SKSE/Plugins/`. Ensure it is enabled and loaded by Skyrim before launching the SkyApps shortcut.
5. Open SkyApps. It checks the already-loaded plugin for the export and enables the shortcut when both are present.

SkyOS never loads an arbitrary DLL or executable. Keep the callback brief and return a valid HWND for the visible window. The kit's `NativeAppTemplate/starterkit_example.cpp` is the small runnable Win32 implementation; `SkyOSAPI.h` is the export contract. It contains no import-library dependency and does not expose Skyrim gameplay functions.

### Optional gameplay APIs

Gameplay data and app launching use separate interfaces. The Starter Kit's `SkyOSAPI.h` only opens a native window. Install the **SkyRewrite API Header** to read world-history and bounty snapshots, the **SkyCounter UI API Header** to read pickup and location JSON snapshots, or the **SkyMissions API Header** to register event-driven missions and SkyStore offers. The SkyMissions API broadcasts completed purchases to the owning plugin; that plugin is responsible for granting its product. These are separate CPack components with their own runtime dependencies.

## 4. Pair an app with a SkyViewer module (optional)

A module can expose settings and branding while opening an internal or native app from its SkyApps card. Copy `StarterTemplate` to:

```text
Data/SKSE/Plugins/SkyOS/Mods/SkyViewer/<UniqueModuleId>/
```

Set `showInSkyApps` to `true` in `module.json`. Add `nativeAppId` matching the folder ID under `Apps`, for example:

```json
{
  "showInSkyApps": true,
  "nativeAppId": "NorthernLightsJournal"
}
```

The field name `nativeAppId` is retained for both launch modes. If the registered app uses `Mode=internal`, SkyOS opens its `index.html`; if it is external, SkyOS calls the plugin export. If the app is missing, the linked module can still open its SkyViewer page. For a module-only shortcut, omit `nativeAppId`.

SkyViewer settings are saved in `settings.json`. Your plugin must read that file and apply the values to the game. See `StarterTemplate/README.md` for the supported setting schema and message format.

### Build an MCM-style settings module

SkyViewer is an in-game MCM-style menu built with PrismaUI. It lets a mod present configuration controls without Papyrus scripts or Creation Kit forms. A module can consist of only a manifest and branded page assets; add an SKSE plugin only when the settings need to change game behavior or communicate with Skyrim.

Use this package layout:

```text
Data/SKSE/Plugins/SkyOS/Mods/SkyViewer/<ModuleId>/
├── module.json
└── Files/
    ├── index.html       (optional custom page)
    ├── logo.png         (optional tab and heading logo)
    └── banner.jpg       (optional page art)
```

The folder name is the module ID. Keep it unique and stable between releases. `module.json` declares the module name, description, accent, optional app shortcut, and settings. Each setting needs a stable `id`, a visible `label`, a supported `type`, and a compatible `default`. Number settings should declare `min` and `max`; SkyViewer displays those limits under the input and saves typed values within that range. Use a select setting for a fixed set of choices rather than documenting magic values in free text.

For example:

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

SkyOS writes user preferences to `%LOCALAPPDATA%/SkyOS/SkyViewer/<ModuleId>/settings.json`; the module directory is used as a read fallback for older installs. A custom `Files/index.html` is sandboxed and owns its page design. It can receive the current settings with `{ type: 'skyos:settings', module, settings }` and request a change with `{ type: 'skyos:set-setting', id, value }`. The host accepts only IDs declared by the manifest and validates value types and numeric bounds. The module does not automatically change gameplay: the owning plugin reads the saved file and applies the values. Keep the app UI in its own app package and use the module only for settings and its optional module page.

### Optional video in a custom module page

Video is page content controlled by the mod author, not a SkyViewer setting. Add a `<video>` element and its duration/mute checks to your custom `Files/index.html`; use a local page asset from that module's own `Files/` folder. Reject unknown duration and anything longer than 10 seconds, set `muted`, `defaultMuted`, and `volume = 0`, and re-apply mute on playback and volume changes. The complete copyable example is in `FIRST_PARTY_APP_PACKAGING.md`.

## 5. Add an ESP/ESL/ESM, quest, or house

An app is an optional user interface. Plugin records and assets are installed in their normal Skyrim locations; do not put an ESP, BSA, script, mesh, or texture inside `SkyOS/Apps/<AppId>/` unless it is merely a UI asset loaded by your page.

### Mod with an ESP/ESL/ESM

1. Build the plugin and its assets in Creation Kit or your usual toolchain.
2. Put the plugin at the `Data` root and assets at their normal paths. Example archive layout:

   ```text
   MyModPackage/
   └── Data/
       ├── MyMod.esp
       ├── MyMod.bsa                 (optional)
       ├── meshes/                   (if loose assets are used)
       ├── textures/
       ├── scripts/                  (compiled Papyrus scripts, if used)
       └── SKSE/Plugins/SkyOS/Apps/MyModApp/
           ├── app.ini
           ├── index.html
           ├── style.css
           └── app.js
   ```

3. Install/enable the archive as a normal Skyrim mod. Ensure the plugin is enabled in the load order, and keep the app folder enabled in the same mod manager profile.
4. Add an SKSE DLL only if your app needs runtime native code. Put it at `Data/SKSE/Plugins/`, and register it as an external app with `Mode=external` (or omit `Mode`) and `Plugin=MyMod.dll`.

### Quest mod

Package the quest plugin, scripts, voice, interface assets, and other files as you normally would. Quest records and scripts run because Skyrim loads the plugin; SkyOS does not create quests, start quest stages, or grant rewards. Add an internal app to provide a journal, configuration page, map, or companion UI, and add a SkyViewer module if players need persistent settings. Use a plugin integration only for actions that your game-side code actually supports.

When you link the app to a module, use the app folder ID in `nativeAppId`. Keep quest dependencies and requirements documented in your mod's normal description and load-order instructions.

### Player house or location mod

Package the world/cell records in the ESP/ESL/ESM and the house's meshes, textures, navmesh, lighting, and scripts in their normal paths or BSA. Install and enable it like a normal location mod. The SkyOS app can provide a house guide, feature list, or configuration UI; it does not place a house in the world or change ownership by itself.

### Archive and mod-manager notes

Structure your archive so a mod manager can map the `Data` contents to Skyrim's virtual `Data` directory. MO2 and Vortex users should install the archive as a normal mod and enable it in the same profile as SkyOS. Do not ask users to overwrite SkyOS files. The app's unique folder under `SkyOS/Apps/` is the extension point that keeps your files separate from SkyOS updates.

## 6. Add a SkyDocuments guide (optional)

Put guides under:

```text
Data/SKSE/Plugins/SkyOS/Mods/<YourModName>/SkyDocuments/
```

PDF, HTML/HTM, TXT, and Markdown documents are supported. Add `logo.png` or another supported logo at `<YourModName>/` and an optional wide `banner.jpg` (or PNG/JPEG/WebP) beside it. Keep each branding image under 1 MiB. Preserve relative resources alongside local HTML guides.

## 7. Troubleshooting

- **Internal app not in SkyApps:** Confirm that `app.ini` is inside the direct child folder `Apps/<AppId>/`, `Name` is present, `Mode=internal`, and `index.html` is present and non-empty at that same level. Reopen SkyApps to refresh the list.
- **App appears disabled or blank:** Check spelling and file names, use plain UTF-8 web files, verify that the scripts and stylesheets use relative paths, and open the browser console/logs available in your SkyOS development setup.
- **Logo is missing:** Use a `.png`, `.jpg`, or `.jpeg` file no larger than 1 MiB, beside `app.ini`; set `Logo` to its exact file name.
- **Native app is disabled:** Enable its SKSE plugin, check its DLL basename in `Plugin=`, and verify that the DLL exports the exact unmangled name `SkyOS_App_Launch` with the header's calling convention.
- **The internal UI cannot affect the game:** That is expected: the web app is isolated from the game. Implement the behavior through your mod's plugin/scripts or use the native integration for supported game-side operations.
- **ESP or house content does not appear:** Verify that the plugin, assets, and dependencies were installed as normal Skyrim mod files, are enabled in the current profile, and load in the correct order. The SkyOS app registration does not load them.

## 8. Build the included example

From the SkyOS source repository, the optional native example can be built and installed separately from the main plugin:

```powershell
cmake --build --preset release --target SkyOSStarterKitExample --parallel
cmake --install build --config Release --prefix $env:SKYRIM_ROOT --component SkyOSStarterKit
cpack --config build/CPackConfig.cmake -G 7Z -C Release
```

To use the new internal-app launcher code, build and install SkyOS too:

```powershell
cmake --build --preset release --target SkyOS --parallel
cmake --install build --config Release --prefix $env:SKYRIM_ROOT --component SkyOS
```

Set `SKYRIM_ROOT` to the game root. With a mod manager, install the generated component into its staging directory/profile instead of copying files into a different game installation.

## 9. Install requirements and app documentation

SkyOS Core requires Skyrim Special Edition/Anniversary Edition, a matching SKSE build, and compatible PrismaUI. Every SkyOS app/module requires the core; native add-ons also require their own plugin to be enabled in the same game profile. First-party apps have app-specific guides in each `Mods/<App>/SkyDocuments/` folder. Those guides list their features, changelog, runtime requirements, settings, data locations, and optional integrations.
