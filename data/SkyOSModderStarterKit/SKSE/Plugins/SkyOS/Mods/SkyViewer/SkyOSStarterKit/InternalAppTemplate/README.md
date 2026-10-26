# Internal SkyOS app template

This is the quickest way to make a custom SkyOS app. It uses normal HTML, CSS, and JavaScript, opens inside SkyOS, and does not require you to edit or rebuild SkyOS.

## Install it

1. Pick a unique folder ID using only letters, numbers, hyphens, or underscores. For example: `NorthernLightsJournal`.
2. Copy the **contents** of this template folder into:

   ```text
   Data/SKSE/Plugins/SkyOS/Apps/NorthernLightsJournal/
   ```

3. Edit `app.ini`. Set `Name` and `Description`; leave `Mode=internal`. `Logo` is optional and can name a `.png`, `.jpg`, or `.jpeg` image in the same folder.
4. Make your app by editing `index.html`, `style.css`, and `app.js`. You can add fonts, images, JSON, and other local files in this folder and reference them with relative paths.
5. Launch Skyrim with SkyOS and open SkyApps. The app is discovered when SkyApps refreshes. If you install files while the game is open, leave and reopen SkyApps to request the current app list.

For a direct local test, set `SKYRIM_ROOT` to your game folder and copy the template in PowerShell:

```powershell
$kit = Join-Path $env:SKYRIM_ROOT 'Data\SKSE\Plugins\SkyOS\Mods\SkyViewer\SkyOSStarterKit'
$app = Join-Path $env:SKYRIM_ROOT 'Data\SKSE\Plugins\SkyOS\Apps\MyCustomApp'
New-Item -ItemType Directory -Force -Path $app | Out-Null
Copy-Item -Path (Join-Path $kit 'InternalAppTemplate\*') -Destination $app -Recurse -Force
```

Rename `MyCustomApp` to your app ID and customize the copied files. For a release, put this same directory structure in your mod archive or mod-manager staging folder.

The ID is the folder name, not the app's display name. Keep it stable so future updates replace the same app.

## Files and custom design

- `index.html` is your app's page and loads the two files below.
- `style.css` belongs to your app. Replace it entirely or organize styles into multiple local CSS files.
- `app.js` belongs to your app. Add your own controls, views, logic, and local libraries.
- `app.ini` tells SkyOS what to display in the SkyApps list and that the app uses the internal window.

The app page controls its own layout and styling inside the available content area. The main `index.html` must be non-empty and no larger than 2 MiB; keep CSS, JavaScript, and assets in their own files. Use local assets to keep your package self-contained. Remote libraries can fail when the game is offline and are subject to WebView2 security policy.

SkyOS loads `index.html` in an iframe sandbox. The app can run scripts and submit forms, but it is isolated from the host page: it cannot inspect SkyOS, call `SkyOS` JavaScript, read the host's data, or directly change Skyrim gameplay. Browser features that require a persistent origin or broader permissions may be unavailable. If your app needs game state or gameplay actions, pair it with an SKSE plugin or use the native-app option described in `../NativeAppTemplate/README.md`.

## Optional SkyViewer module pairing

An internal app can be paired with a SkyViewer module to provide settings. Add the app ID as `nativeAppId` in the module's `module.json`, for example:

```json
{
  "showInSkyApps": true,
  "nativeAppId": "NorthernLightsJournal"
}
```

When both are installed, SkyApps uses the module's name, description, and icon and opens the internal app. Without a linked module, the internal app appears in SkyApps on its own.

## Packaging with a game plugin, quest, or house

Keep the app and game content as separate folders in the same mod package. Put an ESP/ESL/ESM and its BSA or loose assets in the usual Skyrim `Data` structure, and put the app under `Data/SKSE/Plugins/SkyOS/Apps/<AppId>/`. Do not place an ESP inside the `Apps` folder. A SkyOS app shortcut does not install, load, or implement a plugin, quest, or house; those are provided by your normal Skyrim mod files and load order.

See [`../MODDER_GUIDE.md`](../MODDER_GUIDE.md) for detailed package layouts and instructions for quest and house mods.
