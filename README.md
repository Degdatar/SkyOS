# SkyOS

SkyOS is the shared in-game desktop for Skyrim Special Edition and Anniversary Edition. This repository contains the SkyOS Core source, its built-in **SkyViewer** and **SkyDocuments** features, the PDF reader, and the optional **SkyOS Modder Starter Kit**.

## Scope

The other SkyOS apps remain separate projects. This repository contains only their bridge declarations under `include/bridges/`; it does not include their plugin implementations, app pages, artwork, or docs. SkyOS Core connects to those independently installed modules at runtime.

The Starter Kit and the SkyOS API Header are included here. The kit has internal-app and native-app templates, a sample plugin, packaging guidance, and the `SkyOSAPI.h` native launch contract.

## Features

- Shared SKSE and PrismaUI desktop shell, app discovery, and native-app launch bridge.
- Built-in SkyViewer for browsing SkyOS app modules and their settings.
- Built-in SkyDocuments library for HTML and text documents.
- Built-in PDF reader: PDFium renders document pages in the native plugin; the source PDF remains local.
- Optional bridges to SkySearch, SkyMonitor, SkyRewrite, SkyCollection, SkyCounter UI, SkyAchievements, and SkyMissions.
- Optional SkyNet browser integration through its SkyOS compatibility exports.

## Requirements

- Windows x64, Skyrim Special Edition or Anniversary Edition, a matching SKSE build, and PrismaUI.
- Visual Studio 2022 with the C++ desktop workload, CMake 3.24 or newer, Git, and vcpkg with `VCPKG_ROOT` set.
- The `x64-windows-static-md` vcpkg triplet.
- The seven separately built app import libraries: `SkySearch.lib`, `SkyMonitor.lib`, `SkyRewrite.lib`, `SkyCollection.lib`, `SkyCounterUI.lib`, `SkyAchievements.lib`, and `SkyMissions.lib`.
- Network access on the first configure to fetch CommonLibSSE-NG and the pinned PDFium NuGet package.

The separate app projects produce their import libraries when built. Place all seven `.lib` files in one directory, or set `SKYOS_APP_IMPORT_LIB_DIR` to the directory that contains them. The app DLLs themselves are delivered by their own projects and are loaded separately at runtime.

## Configure and build

From this repository directory, configure with the directory containing the app import libraries:

```powershell
cmake --preset release -DSKYOS_APP_IMPORT_LIB_DIR="D:/path/to/app-import-libraries"
cmake --build --preset release --parallel
```

To build the sample native app plugin included in the Starter Kit:

```powershell
cmake --build build --config Release --target SkyOSStarterKitExample --parallel
```

Create the separate SkyOS Core and Starter Kit ZIP packages with:

```powershell
cpack --config build/CPackConfig.cmake -G ZIP -C Release
```

The Core package installs SkyOS, SkyViewer, SkyDocuments, its PDFium runtime, and core metadata under Skyrim's `Data` directory. The separate Starter Kit package includes the templates, guides, API header, and sample plugin.

## Repository layout

```text
src/                                                        SkyOS Core, document reader, viewer, and native-app bridge sources
include/PrismaUI_API.h                                      PrismaUI interface header used by the core
include/bridges/                                            Header-only interfaces for separately released SkyOS apps
data/PrismaUI/views/SkyOS/                                  SkyOS shell, SkyViewer, and SkyDocuments UI
data/SKSE/Plugins/SkyOS/Mods/SkyViewer/SkyOS/               Built-in SkyViewer module metadata and settings page
data/SKSE/Plugins/SkyOS/Mods/SkyViewer/SkyDocuments/        SkyViewer documentation
data/SkyOSModderStarterKit/                                 Internal/native templates, sample registration, and guides
data/SkyOSAPIHeader/                                        Native app launch API header and guide
```

## SkyOS API Header

The public header and guide are in `data/SkyOSAPIHeader/`. The Starter Kit also includes `SkyOSAPI.h` in its native-app template. Native apps export `SkyOS_App_Launch` from an already-loaded SKSE plugin; internal apps use SkyOS's iframe bridge and do not need a native DLL.
