#pragma once

#include <string>

namespace SkyOS {
    // SkyNet must be installed with the SkyOS compatibility exports.
    [[nodiscard]] bool HasSkyNetIntegration();
    [[nodiscard]] bool LaunchSkyNet(bool a_showSplash);
    [[nodiscard]] bool OpenDocumentInSkyNet(const std::string& a_documentId, std::string& a_error);
    [[nodiscard]] bool SetSkyNetSplashEnabled(bool a_enabled);
}
