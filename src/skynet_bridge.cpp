#include "skynet_bridge.h"

#include "documents.h"

#include <Windows.h>

#include <algorithm>
#include <string>
#include <string_view>

namespace SkyOS {
    namespace {
        using OpenFunction = BOOL(WINAPI*)(const wchar_t*, BOOL);
        using SetSplashFunction = BOOL(WINAPI*)(BOOL);

        HMODULE SkyNetModule()
        {
            return GetModuleHandleW(L"SkyNetBrowser.dll");
        }

        bool HasOpenExport(HMODULE module)
        {
            return module && GetProcAddress(module, "SkyNet_SkyOS_Open") != nullptr;
        }

        bool OpenSkyNet(const wchar_t* url, bool skipSplash)
        {
            const auto module = SkyNetModule();
            if (!module) return false;
            const auto open = reinterpret_cast<OpenFunction>(GetProcAddress(module, "SkyNet_SkyOS_Open"));
            return open && open(url, skipSplash ? TRUE : FALSE) != FALSE;
        }

        std::wstring FileUrl(const std::wstring& path)
        {
            constexpr wchar_t hex[] = L"0123456789ABCDEF";
            std::wstring slashPath = path;
            std::replace(slashPath.begin(), slashPath.end(), L'\\', L'/');
            const auto byteCount = WideCharToMultiByte(CP_UTF8, 0, slashPath.c_str(), -1, nullptr, 0, nullptr, nullptr);
            if (byteCount <= 1) return {};
            std::string utf8(static_cast<std::size_t>(byteCount), '\0');
            WideCharToMultiByte(CP_UTF8, 0, slashPath.c_str(), -1, utf8.data(), byteCount, nullptr, nullptr);
            utf8.resize(static_cast<std::size_t>(byteCount - 1));

            std::wstring url = L"file:///";
            for (const auto ch : utf8) {
                const auto byte = static_cast<unsigned char>(ch);
                if ((byte >= 'a' && byte <= 'z') || (byte >= 'A' && byte <= 'Z') ||
                    (byte >= '0' && byte <= '9') || byte == '/' || byte == ':' ||
                    byte == '-' || byte == '_' || byte == '.' || byte == '~') {
                    url += static_cast<wchar_t>(byte);
                } else {
                    url += L'%';
                    url += hex[byte >> 4];
                    url += hex[byte & 0x0F];
                }
            }
            return url;
        }
    }

    bool HasSkyNetIntegration()
    {
        const auto module = SkyNetModule();
        return HasOpenExport(module) &&
            GetProcAddress(module, "SkyNet_SkyOS_SetSplashEnabled") != nullptr;
    }

    bool LaunchSkyNet(bool showSplash)
    {
        if (!HasSkyNetIntegration()) return false;
        if (showSplash && !SetSkyNetSplashEnabled(true)) return false;
        return OpenSkyNet(L"", !showSplash);
    }

    bool OpenDocumentInSkyNet(const std::string& documentId, std::string& error)
    {
        error.clear();
        if (!HasSkyNetIntegration()) {
            error = "SkyNet compatibility bridge is missing. Install the SkyOS-patched SkyNetBrowser.dll and restart Skyrim.";
            return false;
        }
        const auto path = StageDocumentForExternalViewer(documentId);
        if (path.empty()) {
            error = "SkyOS could not prepare this file for SkyNet. Check that it is readable and below the staging size limit.";
            return false;
        }
        const auto url = FileUrl(path);
        if (url.empty()) {
            error = "SkyOS could not convert the document path to a SkyNet URL.";
            return false;
        }
        if (!OpenSkyNet(url.c_str(), true)) {
            error = "SkyNet rejected the document request. Restart Skyrim and confirm SkyNetBrowser.dll is the patched build.";
            return false;
        }
        return true;
    }

    bool SetSkyNetSplashEnabled(bool enabled)
    {
        if (!HasSkyNetIntegration()) return false;
        const auto module = SkyNetModule();
        if (!module) return false;
        const auto setSplash = reinterpret_cast<SetSplashFunction>(
            GetProcAddress(module, "SkyNet_SkyOS_SetSplashEnabled"));
        return setSplash && setSplash(enabled ? TRUE : FALSE) != FALSE;
    }
}
