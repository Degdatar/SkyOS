# SkyOS app module packaging and installation

This guide explains the first-party app package layout and the requirements for apps that run inside the game. It complements `MODDER_GUIDE.md`, which covers third-party internal pages and native windows.

## Core and optional app packages

Install **SkyOS Core** first. `SkyOS.dll` provides the Skyrim in-game window, Home page, SkyViewer, SkyDocuments, shared PrismaUI views, and bridge used by all SkyOS app plugins. Each optional first-party app is a separate SKSE plugin, but it does not run as a standalone replacement for the core.

The core package contains SkyDocuments and SkyViewer. These are intentionally built into `SkyOS.dll`. Optional first-party app packages are:

| Package | SKSE plugin | App folder | SkyViewer module folder | Additional dependency |
| --- | --- | --- | --- | --- |
| SkySearch | `SkySearch.dll` | `Mods/SkySearch/` | `Mods/SkyViewer/SkySearch/` | SkyOS Core |
| SkyMonitor | `SkyMonitor.dll` | `Mods/SkyMonitor/` | `Mods/SkyViewer/SkyMonitor/` | SkyOS Core |
| SkyRewrite | `SkyRewrite.dll` | `Mods/SkyRewrite/` | `Mods/SkyViewer/SkyRewrite/` | SkyOS Core |
| SkyCollection | `SkyCollection.dll` | `Mods/SkyCollection/` | `Mods/SkyViewer/SkyCollection/` | SkyOS Core and SkyCounter UI for item icon rendering |
| SkyCounter UI | `SkyCounterUI.dll` | `Mods/SkyCounterUI/` | `Mods/SkyViewer/SkyCounterUI/` | SkyOS Core; SkyCollection optionally supplies live pickup/location events |
| SkyAchievements | `SkyAchievements.dll` | `Mods/SkyAchievements/` | `Mods/SkyViewer/SkyAchievements/` | SkyOS Core; SkyRewrite/SkyCollection supply optional history |

Optional app shortcuts appear on the Home page and side rail only when their app DLL is installed. SkyNet remains visible on Home when unavailable and reports its install status; it is a separate compatibility integration, not one of these app packages.

## Package contents and per-app data

Install an app package as a normal mod in the same MO2/Vortex profile as SkyOS Core. Keep its DLL, module folder, and app data folder together. An app's own documents belong under `Data/SKSE/Plugins/SkyOS/Mods/<App>/SkyDocuments/`. Its SkyViewer module belongs under `Data/SKSE/Plugins/SkyOS/Mods/SkyViewer/<App>/`, including its `module.json` and `Files/` assets.

Module preferences are stored independently by module ID under `%LOCALAPPDATA%/SkyOS/SkyViewer/<ModuleId>/settings.json`. App-owned runtime state may be saved in its own save/co-save or cache location; consult that app's `SkyDocuments` guide. Collection discoveries are attached to the active save. SkyCounter UI owns item-icon rendering and caches icons at `Data/SKSE/Plugins/SkyOS/Mods/SkyCounterUI/Icons/`; it also owns location screenshot capture and its `Data/SKSE/Plugins/SkyOS/Mods/SkyCounterUI/Locations/` cache. SkyCollection reads and displays those saved images. Do not merge one app's settings or cache into another app's folder.

## Optional video inside a custom SkyViewer page

A mod author can add a short looping video directly to their own `Files/index.html`. There is no video setting in the SkyViewer menu: include the video markup and validation in the custom page itself. Keep the file under 10 seconds, reject unknown duration, and force mute before playback and whenever volume changes.

```html
<section class="hero" hidden>
  <video id="hero-loop" muted autoplay loop playsinline preload="metadata">
    <source src="header-loop.webm" type="video/webm">
  </video>
</section>
<script>
  const hero = document.querySelector('.hero');
  const video = document.getElementById('hero-loop');
  const mute = () => { video.muted = true; video.defaultMuted = true; video.volume = 0; };
  const reject = () => { video.pause(); hero.remove(); };
  video.addEventListener('loadedmetadata', () => {
    mute();
    if (!Number.isFinite(video.duration) || video.duration <= 0 || video.duration > 10) return reject();
    hero.hidden = false;
    video.play().catch(() => {});
  });
  video.addEventListener('durationchange', () => { if (video.duration > 10) reject(); });
  video.addEventListener('volumechange', mute);
  video.addEventListener('play', mute);
  video.addEventListener('error', reject);
  mute();
</script>
```

Style the video within the custom page's banner, for example with `width:100%;height:100%;object-fit:cover`. Keep `header-loop.webm` in the module's `Files/` directory and ship it as an ordinary page asset.
## Build and distribute

Use the matching CMake preset from the SkyOS source directory. `SkyOSStarterKitExample` is an optional native-window example and is separate from the first-party app plugin targets. Package components are emitted separately so users can install only the core, the app modules they want, or the Starter Kit. The separate `SkyMissionsAPIHeader` component provides the mission registration and SkyStore purchase interface for native plugins.

```powershell
cmake --preset release
cmake --build --preset release --parallel
cmake --build --preset release --target SkyOSStarterKitExample --parallel
cpack --config build/CPackConfig.cmake -G 7Z -C Release
```

The separate Starter Kit target is excluded from the default all-target build, so build it explicitly before creating its package. CPack creates one 7Z archive per selected component in `build/`.

Do not ship a first-party app DLL without its matching module/data folder. Do not ship the app package without SkyOS Core as its required dependency. The app DLLs are built for Skyrim SE/AE CommonLibSSE-NG; Skyrim VR is not supported by these packages.
