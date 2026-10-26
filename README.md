# SkyOS

SkyOS is an in-game desktop for Skyrim Special Edition and Anniversary Edition. `SkyOS.dll` provides the shared SKSE/PrismaUI shell, Home page, SkyViewer, and SkyDocuments. The Home page keeps every first-party app shortcut visible: installed apps open in SkyOS, while a missing app reports its name and that it is not installed.

## Included in this repository

- SkyOS Core, built-in SkyViewer, and SkyDocuments sources and resources.
- The bundled PDF.js viewer under `data/PrismaUI/views/SkyOS/pdfjs/` and the pinned PDFium download and install rules in `CMakeLists.txt`.
- The Modder Starter Kit under `data/SkyOSModderStarterKit/`, including the internal-app and native-app templates.
- The SkyOS API Header, README, and guide under `data/SkyOSAPIHeader/`; the Starter Kit also includes the header in its native-app template.
- The native sources and data for the first-party app plugins linked by the core project.

## Core and optional apps

SkyDocuments and SkyViewer are included in **SkyOS Core**. The following apps are separately selectable packages, each with its own SKSE plugin DLL, SkyViewer module, SkyDocuments, and app data:

| App package | Plugin DLL | Additional dependency |
| --- | --- | --- |
| SkySearch | `SkySearch.dll` | SkyOS Core |
| SkyMonitor | `SkyMonitor.dll` | SkyOS Core |
| SkyRewrite | `SkyRewrite.dll` | SkyOS Core |
| SkyCollection | `SkyCollection.dll` | SkyOS Core |
| SkyCounter UI | `SkyCounterUI.dll` | SkyOS Core; SkyCollection supplies pickup and location events |
| SkyAchievements | `SkyAchievements.dll` | SkyOS Core; SkyRewrite and SkyCollection provide optional history data |

Every app package requires `SkyOS.dll`. Install SkyOS Core and any combination of app packages as separate mods in the same MO2/Vortex profile. SkyNet is an optional browser integration; it is not required by SkyOS or its built-in reader. PrismaUI is required for the in-game interface.

Each app package keeps its own files under `Data/SKSE/Plugins/SkyOS/Mods/<App>/` and `Data/SKSE/Plugins/SkyOS/Mods/SkyViewer/<App>/`. Module preferences are separate under `%LOCALAPPDATA%/SkyOS/SkyViewer/<ModuleId>/`. Each app's guide describes its other saved data, such as save-specific SkyCollection discoveries and SkyRewrite journal records. See `data/SKSE/Plugins/SkyOS/Mods/<App>/SkyDocuments/` for the app's Features, Changelog, Requirements, settings, and data details.

## PDF reader

SkyDocuments uses the PDFium DLL bundled in SkyOS Core to rasterize each PDF page as a complete image. This preserves the page layout, text, fonts, vector artwork, and image masks without repositioning extracted text. Source PDFs are rendered locally and are not uploaded.

## SkyViewer video banners

Each SkyViewer module may specify a video filename in its **Header video** setting and store that file in its own `Files/` folder. MP4 and WebM are supported, up to 24 MiB. SkyViewer does not reveal a video unless its metadata confirms a duration greater than zero and no more than 10 seconds. Longer, invalid, or unknown-duration videos are discarded. Playback is always muted and its volume remains zero.

## Requirements

- Skyrim Special Edition or Anniversary Edition with a matching SKSE build.
- PrismaUI compatible with the installed game runtime.
- For compiling: Visual Studio 2022, CMake 3.24 or newer, vcpkg with `VCPKG_ROOT` set, and network access during the first configure for the pinned PDFium package and CommonLibSSE-NG dependency.

The plugin targets Skyrim SE/AE and use the project's existing CommonLibSSE-NG configuration. Skyrim VR is not a target.

## Build separate install packages

Run these commands from the SkyOS source directory in PowerShell. CPack emits each install component as its own ZIP.

```powershell
cmake --preset release
cmake --build --preset release --parallel
cmake --build --preset release --target SkyOSStarterKitExample --parallel
cpack --config build/CPackConfig.cmake -G ZIP -C Release
```

CPack writes separate component archives in `build/`. Install the **SkyOS Core** archive and then only the app archives you want. The **SkyOS Modder Starter Kit** archive is optional. Its native example DLL is excluded from the normal all-target build, so the third command builds it before packaging.

## Modder Starter Kit

The optional kit is installed beneath `Data/SKSE/Plugins/SkyOS/Mods/SkyViewer/SkyOSStarterKit/`. It includes an internal HTML app template, a native app example, a SkyViewer module template, packaging guidance for app DLLs and data, and detailed instructions for distributing mod documentation and Skyrim content. SkyOS Core is required by all in-game apps/modules. See the kit's `README.md`, `MODDER_GUIDE.md`, and `FIRST_PARTY_APP_PACKAGING.md` for the full reference.
