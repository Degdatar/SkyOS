#include "skyview_modules.h"

#include <Windows.h>

#include <algorithm>
#include <cstdint>
#include <filesystem>
#include <fstream>
#include <iterator>
#include <initializer_list>
#include <limits>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

namespace fs = std::filesystem;

namespace SkyOS {
    namespace {
        constexpr std::string_view kModuleRoot = "Data/SKSE/Plugins/SkyOS/Mods/SkyViewer";
        constexpr std::uintmax_t kMaxManifestBytes = 256 * 1024;
        constexpr std::uintmax_t kMaxPageBytes = 1024 * 1024;

        fs::path GameRoot()
        {
            std::wstring buffer(32768, L'\0');
            const auto length = GetModuleFileNameW(nullptr, buffer.data(), static_cast<DWORD>(buffer.size()));
            if (!length || length >= buffer.size()) return {};
            buffer.resize(length);
            return fs::path(buffer).parent_path();
        }

        std::string ToUtf8(const std::wstring& value)
        {
            if (value.empty()) return {};
            const int count = WideCharToMultiByte(CP_UTF8, 0, value.data(), static_cast<int>(value.size()), nullptr, 0, nullptr, nullptr);
            if (count <= 0) return {};
            std::string result(static_cast<size_t>(count), '\0');
            WideCharToMultiByte(CP_UTF8, 0, value.data(), static_cast<int>(value.size()), result.data(), count, nullptr, nullptr);
            return result;
        }

        std::string JsonEscape(std::string_view text)
        {
            std::string out;
            for (const unsigned char ch : text) {
                switch (ch) {
                case '"': out += "\\\""; break;
                case '\\': out += "\\\\"; break;
                case '\n': out += "\\n"; break;
                case '\r': out += "\\r"; break;
                case '\t': out += "\\t"; break;
                default:
                    if (ch < 0x20) out += '?';
                    else out += static_cast<char>(ch);
                }
            }
            return out;
        }

        std::string ReadSmallFile(const fs::path& path, std::uintmax_t limit)
        {
            std::error_code error;
            if (!fs::is_regular_file(path, error)) return {};
            const auto size = fs::file_size(path, error);
            if (error || size == 0 || size > limit) return {};
            std::ifstream stream(path, std::ios::binary);
            if (!stream) return {};
            return std::string(std::istreambuf_iterator<char>(stream), std::istreambuf_iterator<char>());
        }

        fs::path UserSettingsDirectory()
        {
            std::wstring localAppData(32768, L'\0');
            const auto length = GetEnvironmentVariableW(L"LOCALAPPDATA", localAppData.data(),
                static_cast<DWORD>(localAppData.size()));
            if (!length || length >= localAppData.size()) return {};
            localAppData.resize(length);
            return fs::path(localAppData) / L"SkyOS" / L"SkyViewer";
        }

        std::string FileUrl(const fs::path& path)
        {
            auto wide = path.wstring();
            std::replace(wide.begin(), wide.end(), L'\\', L'/');
            if (wide.empty() || wide.size() > static_cast<std::size_t>((std::numeric_limits<int>::max)())) return {};
            const auto wideLength = static_cast<int>(wide.size());
            const auto byteLength = WideCharToMultiByte(CP_UTF8, 0, wide.data(), wideLength, nullptr, 0, nullptr, nullptr);
            if (byteLength <= 0) return {};
            std::string utf8(static_cast<std::size_t>(byteLength), '\0');
            if (WideCharToMultiByte(CP_UTF8, 0, wide.data(), wideLength, utf8.data(), byteLength, nullptr, nullptr) != byteLength) return {};
            std::string result = "file:///";
            constexpr char hex[] = "0123456789ABCDEF";
            for (const unsigned char ch : utf8) {
                if ((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') ||
                    (ch >= '0' && ch <= '9') || ch == '/' || ch == ':' || ch == '-' ||
                    ch == '_' || ch == '.' || ch == '~') {
                    result.push_back(static_cast<char>(ch));
                } else {
                    result.push_back('%');
                    result.push_back(hex[ch >> 4]);
                    result.push_back(hex[ch & 0x0F]);
                }
            }
            return result;
        }

        std::string ReadModuleImageFileUrl(const fs::path& filesDirectory, std::wstring_view baseName)
        {
            for (const auto& extension : { L".png", L".jpg", L".jpeg", L".webp" }) {
                const auto path = filesDirectory / (std::wstring(baseName) + extension);
                std::error_code error;
                if (!fs::is_regular_file(path, error)) continue;
                return FileUrl(path);
            }
            return {};
        }
    }

    std::string GetSkyViewModulesCatalog()
    {
        const auto gameRoot = GameRoot();
        if (gameRoot.empty()) return "[]";
        const auto root = gameRoot / fs::path(kModuleRoot);
        std::error_code error;
        if (!fs::is_directory(root, error)) return "[]";

        std::vector<std::string> entries;
        for (fs::directory_iterator it(root, fs::directory_options::skip_permission_denied, error), end;
             it != end; it.increment(error)) {
            if (error) { error.clear(); continue; }
            if (!it->is_directory(error)) { error.clear(); continue; }
            const auto id = ToUtf8(it->path().filename().wstring());
            if (id.empty()) continue;
            const auto manifest = ReadSmallFile(it->path() / L"module.json", kMaxManifestBytes);
            if (manifest.empty()) continue;
            const auto page = ReadSmallFile(it->path() / L"Files" / L"index.html", kMaxPageBytes);
            const auto logo = ReadModuleImageFileUrl(it->path() / L"Files", L"logo");
            const auto banner = ReadModuleImageFileUrl(it->path() / L"Files", L"banner");
            auto settings = ReadSmallFile(UserSettingsDirectory() / fs::path(id) / L"settings.json", kMaxManifestBytes);
            if (settings.empty()) settings = ReadSmallFile(it->path() / L"settings.json", kMaxManifestBytes);
            if (settings.empty()) settings = "{}";
            entries.push_back("{\"id\":\"" + JsonEscape(id) + "\",\"manifest\":\"" +
                              JsonEscape(manifest) + "\",\"settings\":\"" + JsonEscape(settings) +
                              "\",\"page\":\"" + JsonEscape(page) + "\",\"logo\":\"" +
                              logo + "\",\"banner\":\"" + banner + "\"}");
        }

        std::string result = "[";
        for (size_t i = 0; i < entries.size(); ++i) {
            if (i) result += ',';
            result += entries[i];
        }
        return result + "]";
    }

    bool SaveSkyViewModuleSettings(const std::string& moduleId, const std::string& json)
    {
        if (moduleId.empty() || json.empty() || json.size() > kMaxManifestBytes) return false;
        const auto gameRoot = GameRoot();
        if (gameRoot.empty()) return false;
        const auto root = gameRoot / fs::path(kModuleRoot);
        std::error_code error;
        for (fs::directory_iterator it(root, fs::directory_options::skip_permission_denied, error), end;
             it != end; it.increment(error)) {
            if (error) { error.clear(); continue; }
            if (!it->is_directory(error) || ToUtf8(it->path().filename().wstring()) != moduleId) { error.clear(); continue; }
            const auto userSettings = UserSettingsDirectory() / fs::path(moduleId) / L"settings.json";
            fs::create_directories(userSettings.parent_path(), error);
            if (error) return false;
            std::ofstream stream(userSettings, std::ios::binary | std::ios::trunc);
            if (!stream) return false;
            stream.write(json.data(), static_cast<std::streamsize>(json.size()));
            return static_cast<bool>(stream);
        }
        return false;
    }
}
