#pragma once

#include <string>
#include <cstdint>

namespace SkyOS {
    // Native apps register with app.ini beneath Data/SKSE/Plugins/SkyOS/Apps/<AppId>/.
    [[nodiscard]] std::string GetNativeAppsCatalog();
    // Returns the standalone app window handle. Apps must export
    // HWND WINAPI SkyOS_App_Launch(const wchar_t* argument).
    [[nodiscard]] std::uintptr_t LaunchNativeApp(const std::string& appId, std::string& error);
}
