# Native SkyOS app template

Use this option when your mod needs a separate native window or an SKSE plugin callback. For a no-DLL app that opens inside SkyOS, use the sibling `../InternalAppTemplate/` instead.

## Registration

Copy this folder's contents to:

```text
Data/SKSE/Plugins/SkyOS/Apps/<UniqueAppId>/
```

Edit `app.ini`:

```ini
[App]
Name=Your Native App
Description=Standalone app provided by Your Mod
Mode=external
Plugin=YourMod.dll
Logo=logo.png
Argument=
```

`Plugin` is the basename of your SKSE plugin DLL installed under `Data/SKSE/Plugins/`. The DLL must be loaded by Skyrim. `Logo` is optional (PNG or JPG/JPEG, at most 1 MiB) and is named relative to this folder. `Argument` is optional text sent to your callback. The app ID is the folder name and may use letters, numbers, `_`, or `-`.

## Export the launch function

Include `SkyOSAPI.h` in your SKSE plugin and implement the declared C ABI export:

```cpp
#define SKYOS_APP_IMPLEMENTATION
#include "SkyOSAPI.h"

HWND WINAPI SkyOS_App_Launch(const wchar_t* argument)
{
    // Create, show, or activate your native application window.
    // Return its valid visible HWND. Return nullptr on failure.
    return nullptr;
}
```

The `nullptr` body is a placeholder. `starterkit_example.cpp` is a working small Win32 example and uses the same `SkyOSAPI.h` declaration. Keep this callback brief and return a valid window handle; this launch contract does not provide a game-state API.

SkyOS invokes the export only when the app is selected and only if the plugin is already loaded. It does not load DLLs or launch executables. On a missing plugin or export, the SkyApps shortcut is disabled with an availability message.

## Pair a SkyViewer page (optional)

To show settings/branding in SkyViewer and keep the shortcut available when your native app is missing, install a module under `Mods/SkyViewer/<ModuleId>/` and add both properties to `module.json`:

```json
{
  "showInSkyApps": true,
  "nativeAppId": "YourUniqueAppId"
}
```

The app registration ID must match its `Apps/<UniqueAppId>/` folder. When the plugin and export are available, SkyApps launches your window. When not available, the linked SkyViewer module page is used instead.

## Build the included example

From the SkyOS source repository:

```powershell
cmake --build --preset release --target SkyOSStarterKitExample --parallel
cmake --install build --config Release --prefix $env:SKYRIM_ROOT --component SkyOSStarterKit
cpack --config build/CPackConfig.cmake -G 7Z -C Release
```

The component installs the example DLL, app registration, header, source, and kit docs. Enable the example plugin in your mod manager's current profile and launch Skyrim; its SkyApps shortcut then opens the sample window.
