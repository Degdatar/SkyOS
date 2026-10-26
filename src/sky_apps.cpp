#include "sky_apps.h"

#include <Windows.h>

#include <filesystem>
#include <fstream>
#include <iterator>
#include <string>
#include <string_view>
#include <vector>

namespace fs = std::filesystem;

namespace SkyOS {
    namespace {
        constexpr wchar_t kAppsDirectory[] = L"Data/SKSE/Plugins/SkyOS/Apps";
        constexpr std::uintmax_t kMaxLogoBytes = 1024 * 1024;
        constexpr std::uintmax_t kMaxWebAppBytes = 2 * 1024 * 1024;
        using LaunchFunction = HWND(WINAPI*)(const wchar_t*);

        fs::path GameRoot()
        {
            std::wstring buffer(32768, L'\0');
            const auto length = GetModuleFileNameW(nullptr, buffer.data(), static_cast<DWORD>(buffer.size()));
            if (!length || length >= buffer.size()) return {};
            buffer.resize(length);
            return fs::path(buffer).parent_path();
        }

        std::string Utf8(const std::wstring& value)
        {
            if (value.empty()) return {};
            const auto length = WideCharToMultiByte(CP_UTF8, 0, value.data(), static_cast<int>(value.size()), nullptr, 0, nullptr, nullptr);
            if (length <= 0) return {};
            std::string result(static_cast<size_t>(length), '\0');
            WideCharToMultiByte(CP_UTF8, 0, value.data(), static_cast<int>(value.size()), result.data(), length, nullptr, nullptr);
            return result;
        }

        std::wstring Wide(const std::string& value)
        {
            if (value.empty()) return {};
            const auto length = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, value.data(), static_cast<int>(value.size()), nullptr, 0);
            if (length <= 0) return {};
            std::wstring result(static_cast<size_t>(length), L'\0');
            MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, value.data(), static_cast<int>(value.size()), result.data(), length);
            return result;
        }

        std::string Escape(std::string_view text)
        {
            std::string out;
            for (const unsigned char ch : text) {
                switch (ch) {
                case '"': out += "\\\""; break;
                case '\\': out += "\\\\"; break;
                case '\n': out += "\\n"; break;
                case '\r': out += "\\r"; break;
                case '\t': out += "\\t"; break;
                default: if (ch >= 0x20) out += static_cast<char>(ch); else out += '?';
                }
            }
            return out;
        }

        std::string FileUrl(const fs::path& path)
        {
            const auto widePath = path.generic_wstring();
            const auto utf8Path = Utf8(widePath);
            constexpr char hex[] = "0123456789ABCDEF";
            std::string url = "file:///";
            for (const auto byte : utf8Path) {
                const auto ch = static_cast<unsigned char>(byte);
                if ((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') ||
                    (ch >= '0' && ch <= '9') || ch == '-' || ch == '_' || ch == '.' ||
                    ch == '~' || ch == '/' || ch == ':') {
                    url.push_back(static_cast<char>(ch));
                } else {
                    url.push_back('%');
                    url.push_back(hex[(ch >> 4) & 0x0F]);
                    url.push_back(hex[ch & 0x0F]);
                }
            }
            return url;
        }

        std::wstring IniValue(const fs::path& file, const wchar_t* key)
        {
            std::wstring value(2048, L'\0');
            const auto length = GetPrivateProfileStringW(L"App", key, L"", value.data(), static_cast<DWORD>(value.size()), file.c_str());
            value.resize(length);
            return value;
        }

        bool SafeId(const std::wstring& id)
        {
            if (id.empty() || id.size() > 80 || id == L"." || id == L"..") return false;
            for (const auto ch : id) {
                if (!((ch >= L'a' && ch <= L'z') || (ch >= L'A' && ch <= L'Z') ||
                      (ch >= L'0' && ch <= L'9') || ch == L'-' || ch == L'_')) return false;
            }
            return true;
        }

        std::string LogoDataUri(const fs::path& appDirectory, const std::wstring& logoName)
        {
            if (logoName.empty() || logoName.find_first_of(L"\\/:") != std::wstring::npos || logoName == L"." || logoName == L"..") return {};
            const auto extension = fs::path(logoName).extension().wstring();
            const char* mime = extension == L".png" ? "image/png" : (extension == L".jpg" || extension == L".jpeg") ? "image/jpeg" : nullptr;
            if (!mime) return {};
            const auto path = appDirectory / logoName;
            std::error_code error;
            const auto size = fs::file_size(path, error);
            if (error || !size || size > kMaxLogoBytes) return {};
            std::ifstream stream(path, std::ios::binary);
            if (!stream) return {};
            const std::string bytes(std::istreambuf_iterator<char>(stream), {});
            if (bytes.size() != size) return {};
            constexpr char alphabet[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
            std::string encoded;
            encoded.reserve(((bytes.size() + 2) / 3) * 4);
            for (size_t i = 0; i < bytes.size(); i += 3) {
                const unsigned a = static_cast<unsigned char>(bytes[i]);
                const unsigned b = i + 1 < bytes.size() ? static_cast<unsigned char>(bytes[i + 1]) : 0;
                const unsigned c = i + 2 < bytes.size() ? static_cast<unsigned char>(bytes[i + 2]) : 0;
                const unsigned value = (a << 16) | (b << 8) | c;
                encoded += alphabet[(value >> 18) & 63]; encoded += alphabet[(value >> 12) & 63];
                encoded += i + 1 < bytes.size() ? alphabet[(value >> 6) & 63] : '=';
                encoded += i + 2 < bytes.size() ? alphabet[value & 63] : '=';
            }
            return std::string("data:") + mime + ";base64," + encoded;
        }

        fs::path AppPath(const std::wstring& id)
        {
            if (!SafeId(id)) return {};
            const auto root = GameRoot();
            return root.empty() ? fs::path{} : root / kAppsDirectory / id;
        }
    }

    std::string GetNativeAppsCatalog()
    {
        const auto gameRoot = GameRoot();
        if (gameRoot.empty()) return "[]";
        const auto root = gameRoot / kAppsDirectory;
        std::error_code error;
        if (root.empty() || !fs::is_directory(root, error)) return "[]";
        std::vector<std::string> entries;
        for (fs::directory_iterator it(root, fs::directory_options::skip_permission_denied, error), end; it != end; it.increment(error)) {
            if (error) { error.clear(); continue; }
            if (!it->is_directory(error)) { error.clear(); continue; }
            const auto idWide = it->path().filename().wstring();
            if (!SafeId(idWide)) continue;
            const auto ini = it->path() / L"app.ini";
            const auto name = IniValue(ini, L"Name");
            auto mode = IniValue(ini, L"Mode");
            if (mode.empty()) mode = L"external";  // Backward-compatible native app registrations.
            const bool internal = mode == L"internal";
            const auto plugin = IniValue(ini, L"Plugin");
            if (name.empty() || (internal ? mode != L"internal" : (mode != L"external" || plugin.empty() || plugin.find_first_of(L"\\/:\t\r\n") != std::wstring::npos))) continue;
            const auto description = IniValue(ini, L"Description");
            bool available = false;
            std::string pageUrl;
            if (internal) {
                const auto page = it->path() / L"index.html";
                const auto size = fs::file_size(page, error);
                available = !error && fs::is_regular_file(page, error) && !error && size > 0 && size <= kMaxWebAppBytes;
                error.clear();
                if (available) pageUrl = FileUrl(page);
            } else {
                const auto loadedModule = GetModuleHandleW(plugin.c_str());
                available = loadedModule && GetProcAddress(loadedModule, "SkyOS_App_Launch");
            }
            const auto logo = LogoDataUri(it->path(), IniValue(ini, L"Logo"));
            entries.push_back("{\"id\":\"" + Escape(Utf8(idWide)) + "\",\"name\":\"" + Escape(Utf8(name)) +
                              "\",\"description\":\"" + Escape(Utf8(description)) + "\",\"logo\":\"" + logo +
                              "\",\"mode\":\"" + (internal ? "internal" : "external") + "\",\"url\":\"" + Escape(pageUrl) +
                              "\",\"available\":" + (available ? "true" : "false") + "}");
        }
        std::string result = "[";
        for (size_t i = 0; i < entries.size(); ++i) { if (i) result += ','; result += entries[i]; }
        return result + "]";
    }

    std::uintptr_t LaunchNativeApp(const std::string& appId, std::string& error)
    {
        error.clear();
        const auto id = Wide(appId);
        const auto directory = AppPath(id);
        if (directory.empty()) { error = "Invalid SkyOS app ID"; return 0; }
        const auto ini = directory / L"app.ini";
        const auto pluginName = IniValue(ini, L"Plugin");
        if (IniValue(ini, L"Name").empty() || IniValue(ini, L"Mode") == L"internal" || pluginName.empty() || pluginName.find_first_of(L"\\/:\t\r\n") != std::wstring::npos) {
            error = "SkyOS app registration is missing a valid name or plugin DLL";
            return 0;
        }
        const auto plugin = GetModuleHandleW(pluginName.c_str());
        if (!plugin) { error = "The registered app plugin is not loaded"; return 0; }
        const auto launch = reinterpret_cast<LaunchFunction>(GetProcAddress(plugin, "SkyOS_App_Launch"));
        if (!launch) { error = "The plugin does not export SkyOS_App_Launch"; return 0; }
        const auto argument = IniValue(ini, L"Argument");
        const auto window = launch(argument.c_str());
        if (!window || !IsWindow(window)) { error = "The app did not return a valid native window"; return 0; }
        return reinterpret_cast<std::uintptr_t>(window);
    }
}
