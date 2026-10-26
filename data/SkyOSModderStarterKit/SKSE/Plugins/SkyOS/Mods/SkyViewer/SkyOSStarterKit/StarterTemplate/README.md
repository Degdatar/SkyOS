# SkyOS module starter template

SkyOS Core (`SkyOS.dll`) is required for every module. Installing a module by itself does not provide the in-game window or settings bridge.

Copy this folder into:

```text
Data/SKSE/Plugins/SkyOS/Mods/SkyViewer/<YourUniqueModuleId>/
```

Then edit `module.json` and `Files/index.html`. Replace the example `Files/logo.png` with your own `logo.png`, `logo.jpg`, `logo.jpeg`, or `logo.webp`.

Keep `"showInSkyApps": true` to publish this module as a SkyApps shortcut. By default, the shortcut opens this module's SkyViewer tab and custom menu. To pair it with an internal HTML app or a native window, set the optional `"nativeAppId"` field to the app ID registered under `Data/SKSE/Plugins/SkyOS/Apps/<AppId>/app.ini`. An internal app uses `Mode=internal` and opens its `index.html` inside SkyOS without a DLL. A native app uses `Mode=external` and opens when its SKSE plugin and launch export are available. If a linked app is missing, SkyOS opens this module's SkyViewer page instead. Set `showInSkyApps` to `false` or remove it if the module should only appear in the SkyViewer module list. See the sibling `../InternalAppTemplate/README.md` for the no-DLL web app workflow and `../MODDER_GUIDE.md` for package layouts.

SkyViewer is SkyOS's in-game MCM-style settings menu, built with PrismaUI. Mod authors can expose settings without writing Papyrus scripts or creating forms in the Creation Kit. A settings module defines the controls and stores the user's choices; if those choices change gameplay, the mod's own plugin must read and apply them.

SkyOS discovers each direct child folder of `Mods/SkyViewer` that contains a valid `module.json`. The folder name is the stable module ID. Keep it unique and do not change it after release, because settings are stored under that ID. The manifest supports these setting types:

- `boolean`: `default` is `true` or `false`.
- `number`: set `min` and `max` so users see the allowed range below the field. Users can type any value inside those limits; `step` is only a suggested increment for controls that use it.
- `text`: `default` is a string.
- `select`: provide a string array in `options`; `default` must match one option.

For example, a module can declare settings like this:

```json
{
  "name": "Northern Lights",
  "description": "Configure the mod's display behavior.",
  "accent": "#69d6df",
  "settings": [
    { "id": "enabled", "label": "Enable effects", "type": "boolean", "default": true },
    { "id": "intensity", "label": "Intensity", "type": "number", "min": 0, "max": 100, "default": 50 },
    { "id": "quality", "label": "Quality", "type": "select", "default": "high", "options": ["low", "high"] }
  ]
}
```

Settings are saved per user at `%LOCALAPPDATA%/SkyOS/SkyViewer/<ModuleId>/settings.json`. SkyOS can read an older module-local `settings.json` as a migration fallback. SkyOS sends the current settings object to the custom page with `postMessage`:

```js
{ type: 'skyos:settings', module: 'YourUniqueModuleId', settings: { enabled: true } }
```

To request a setting update from `Files/index.html`, send a declared setting ID and a value of the correct type:

```js
parent.postMessage({ type: 'skyos:set-setting', id: 'enabled', value: false }, '*');
```

The host validates the setting ID, type, and numeric limits against `module.json` before saving. A custom page should send the declared setting ID and value type, then update its display from the next `skyos:settings` message. The sandboxed page owns its own layout and styling; it cannot directly call SkyOS internals or access Skyrim gameplay. A mod plugin still needs to read `settings.json` and apply values to game behavior; SkyViewer provides the MCM interface and persistence, not the gameplay implementation.

For a module that also launches an app, set `showInSkyApps` to `true`. To link a registered internal or native app, set `nativeAppId` to the app folder ID. The module remains a separate feature from the app: the module owns settings, while the app owns its screens and interactions.

## Optional video in a custom page

There is no SkyViewer video setting. If you want a moving banner in a custom tab, add the `<video>` element directly to `Files/index.html` and keep its media beside that page. Validate `loadedmetadata`, discard unknown or over-10-second clips, and set `muted`, `defaultMuted`, and `volume = 0`; reapply mute on `play` and `volumechange`. The exact snippet is in `../FIRST_PARTY_APP_PACKAGING.md`.
A module page can provide an app-like menu inside SkyViewer. SkyApps only creates shortcuts for module pages with `showInSkyApps: true`. For a separate native window, see the sibling `../NativeAppTemplate/` folder for SkyOS's shared native-app registration contract. Example pairing:

```json
{
  "showInSkyApps": true,
  "nativeAppId": "YourNativeAppId"
}
```

## SkyDocuments

Place a guide or webpage at:

```text
Data/SKSE/Plugins/SkyOS/Mods/<YourModName>/SkyDocuments/
```

Supported files are PDF, HTML/HTM, TXT, and Markdown. Put a `logo.png` at `<YourModName>/logo.png` to brand the Documents list.
