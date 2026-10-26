#pragma once

#include <string>

namespace SkyOS {
    // SkyViewer app modules installed under Mods/SkyViewer/<ModuleName>/.
    [[nodiscard]] std::string GetSkyViewModulesCatalog();
    [[nodiscard]] bool SaveSkyViewModuleSettings(const std::string& moduleId, const std::string& json);
}
