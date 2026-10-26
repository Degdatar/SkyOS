#include <SKSE/SKSE.h>
#include <RE/B/BGSSaveLoadManager.h>
#include <RE/B/BSInputDeviceManager.h>
#include <RE/B/ButtonEvent.h>
#include <RE/C/ControlMap.h>
#include <RE/I/InputEvent.h>
#include <RE/T/TESFile.h>

#include <Windows.h>

#include "PrismaUI_API.h"
#include "documents.h"
#include "skyview_modules.h"
#include "sky_apps.h"
#include "skynet_bridge.h"
#include "skysearch.h"
#include "monitor.h"
#include "skyrewrite.h"
#include "skycollection.h"
#include "skyitemicons.h"
#include "skycounter_ui.h"
#include "skyachievements.h"
#include "skymissions.h"
#include <SkyMissionsAPI.h>

#include <array>
#include <memory>
#include <filesystem>
#include <deque>
#include <string>
#include <string_view>
#include <charconv>
#include <cstdio>
#include <exception>
#include <atomic>
#include <mutex>
#include <unordered_map>
#include <unordered_set>
#include <algorithm>
#include <cctype>
#include <vector>

namespace {
    PRISMA_UI_API::IVPrismaUI1* g_prisma = nullptr;
    PrismaView g_view = 0;
    PrismaView g_skyMissionNoticeView = 0;
    PrismaView g_skyAchievementNoticeView = 0;
    bool g_ready = false;
    std::mutex g_skyMissionNoticeMutex;
    std::deque<std::string> g_pendingSkyMissionNotices;
    bool g_skyMissionNoticeReady = false;
    std::mutex g_skyAchievementNoticeMutex;
    std::deque<std::string> g_pendingSkyAchievementNotices;
    bool g_skyAchievementNoticeReady = false;
    std::mutex g_pendingCounterEventsMutex;
    std::deque<std::string> g_pendingCounterEvents;
    bool g_flushingCounterEvents{};
    bool g_skySearchAvailable{};
    bool g_skyMonitorAvailable{};
    bool g_skyRewriteAvailable{};
    bool g_skyCollectionAvailable{};
    bool g_skyCounterUIAvailable{};
    bool g_skyAchievementsAvailable{};
    bool g_skyMissionsAvailable{};
    constexpr std::uint8_t kHotkeyCtrl = 1u << 0;
    constexpr std::uint8_t kHotkeyShift = 1u << 1;
    constexpr std::uint8_t kHotkeyAlt = 1u << 2;
    struct AppHotkey {
        std::string moduleId;
        std::string settingId;
        std::uint32_t keyCode{};
        std::uint8_t modifiers{};
    };
    std::mutex g_appHotkeysMutex;
    std::unordered_map<std::string, AppHotkey> g_appHotkeys;
    std::unordered_set<std::uint32_t> g_suppressedHotkeyKeyUps;
    std::unordered_set<std::uint32_t> g_pendingCloseKeyUps;
    std::mutex g_heldHotkeyModifierMutex;
    std::unordered_set<std::uint32_t> g_heldHotkeyModifierKeys;
    bool g_unfocusAfterHotkeyChordRelease = false;
    bool g_savedSkyOSControlState = false;
    std::uint32_t g_savedEnabledControls{};
    std::uint32_t g_savedStoredControls{};
    std::mutex g_captureMutex;
    bool g_searchOpen = false;
    bool g_skyNetShowSplash = false;
    bool g_skyNetLaunchPending = false;
    bool g_skyNetWindowObserved = false;
    std::atomic<bool> g_skyCollectionNewGamePending{ false };
    std::atomic<bool> g_skyCounterUIIconCapturePreference{ true };
    ULONGLONG g_skyNetLaunchDeadline = 0;
    HWND g_externalAppWindow = nullptr;
    std::string g_captureTarget;

    void SendToUI(std::string script);
    void SendOrQueueCounterEvent(std::string script, bool clearOlderEvents = false);
    void FlushPendingCounterEvents();
    std::string JsString(const char* text);
    void HideSkyOSView();
    void ReleaseSkyOSFocusForSkyNet();
    void FocusSkyOSView();
    void OnSkyViewModulesRequest(const char*);

    std::string FirstPartyAppStatusJSON()
    {
        return std::string("{\"skysearch\":") + (g_skySearchAvailable ? "true" : "false") +
            ",\"skymonitor\":" + (g_skyMonitorAvailable ? "true" : "false") +
            ",\"skyrewrite\":" + (g_skyRewriteAvailable ? "true" : "false") +
            ",\"skycollection\":" + (g_skyCollectionAvailable ? "true" : "false") +
            ",\"skycounter\":" + (g_skyCounterUIAvailable ? "true" : "false") +
            ",\"skyachievements\":" + (g_skyAchievementsAvailable ? "true" : "false") +
            ",\"skymissions\":" + (g_skyMissionsAvailable ? "true" : "false") + "}";
    }

    void OnFirstPartyAppStatusRequest(const char*)
    {
        SendToUI("SkyOS.setFirstPartyApps(" + FirstPartyAppStatusJSON() + ")");
    }

    std::uint8_t HotkeyModifierFlagForKey(std::uint32_t keyCode)
    {
        if (keyCode == 0x1D || keyCode == 0x9D) return kHotkeyCtrl;
        if (keyCode == 0x2A || keyCode == 0x36) return kHotkeyShift;
        if (keyCode == 0x38 || keyCode == 0xB8) return kHotkeyAlt;
        return 0;
    }

    void SuppressHotkeyChordKeyUps(std::uint32_t keyCode, std::unordered_set<std::uint32_t>* chordKeyUps = nullptr)
    {
        // Only consume the shortcut's main key. Modifier keys remain visible
        // to Skyrim so the user can keep their normal Ctrl/Alt/Shift bindings.
        g_suppressedHotkeyKeyUps.insert(keyCode);
        if (chordKeyUps) chordKeyUps->insert(keyCode);
    }

    void ConsumeHotkeyButtonEvent(RE::ButtonEvent* button)
    {
        if (!button) return;
        // A stopped SKSE event sink does not reliably prevent Skyrim's
        // ControlMap from seeing an already-mapped event. Neutralize the
        // event itself as well, so the chord key cannot trigger a game action.
        button->SetIDCode(RE::ControlMap::kInvalid);
        button->SetUserEvent(RE::BSFixedString{});
        auto& runtime = button->GetRuntimeData();
        runtime.value = 0.0F;
        runtime.heldDownSecs = 0.0F;
    }

    void DisableSkyrimControlsForSkyOS()
    {
        if (g_savedSkyOSControlState) return;
        if (auto* controlMap = RE::ControlMap::GetSingleton()) {
            controlMap->GetControlsState(g_savedEnabledControls, g_savedStoredControls);
            // SkyOS receives its own raw keyboard events. Disable Skyrim's
            // mapped actions while the view owns focus, including menus.
            controlMap->SetControlsState(0, g_savedStoredControls);
            g_savedSkyOSControlState = true;
        }
    }

    void RestoreSkyrimControlsAfterSkyOS()
    {
        if (!g_savedSkyOSControlState) return;
        auto* controlMap = RE::ControlMap::GetSingleton();
        if (!controlMap) return;
        controlMap->SetControlsState(g_savedEnabledControls, g_savedStoredControls);
        g_savedSkyOSControlState = false;
    }

    void BeginSkyOSCloseAfterHotkeyRelease(std::uint32_t keyCode)
    {
        g_pendingCloseKeyUps.clear();
        SuppressHotkeyChordKeyUps(keyCode, &g_pendingCloseKeyUps);
        g_unfocusAfterHotkeyChordRelease = true;
        g_searchOpen = false;
    }

    void CloseSkyOSAfterHotkeyChord()
    {
        if (!g_unfocusAfterHotkeyChordRelease || !g_pendingCloseKeyUps.empty()) return;
        g_unfocusAfterHotkeyChordRelease = false;
        if (g_prisma && g_view && g_prisma->IsValid(g_view)) {
            // Keep the view focused until the base key-up has been consumed.
            // Hiding on key-down can drop focus and let Skyrim interpret that
            // key as a separate menu shortcut.
            g_prisma->Unfocus(g_view);
            HideSkyOSView();
        }
        RestoreSkyrimControlsAfterSkyOS();
        SendToUI("SkyOS.onHide()");
    }

    std::string CurrentPhysicalSavePath(RE::BGSSaveLoadManager* saveManager)
    {
        if (!saveManager) return {};
        const auto* fullName = saveManager->lastFileFullName;
        std::size_t length = 0;
        while (length < sizeof(saveManager->lastFileFullName) && fullName[length] != '\0') ++length;
        return length ? std::string(fullName, length) : std::string{};
    }

    void HideSkyOSView()
    {
        // Keep SkyCollection's background icon queue enabled while the
        // interface is hidden; only save transitions suspend capture.
        if (g_prisma && g_view && g_prisma->IsValid(g_view)) g_prisma->Hide(g_view);
        RestoreSkyrimControlsAfterSkyOS();
    }

    void ShowSkyOSView()
    {
        if (g_prisma && g_view && g_prisma->IsValid(g_view)) {
            g_prisma->Show(g_view);
        }
    }

    void FocusSkyOSView()
    {
        if (g_prisma && g_view && g_prisma->IsValid(g_view)) {
            DisableSkyrimControlsForSkyOS();
            g_prisma->Focus(g_view, true, false);
        }
    }

    void OnSkyCollectionPickup(const std::string& payload)
    {
        if (g_prisma && g_ready && g_prisma->IsValid(g_view)) {
            g_prisma->Invoke(g_view, ("SkyOS.setSkyCollectionPickup(" + payload + ")").c_str());
        }
    }

    void OnSkyCounterUIPickup(const std::string& payload)
    {
        const bool clearOlderEvents = payload.find("\"clearStream\":true") != std::string::npos;
        SendOrQueueCounterEvent("SkyOS.setSkyCounterUIPickup(" + payload + ")", clearOlderEvents);
    }

    void OnSkyCollectionIconUpdated(const std::string& payload)
    {
        if (g_prisma && g_ready && g_view && g_prisma->IsValid(g_view)) {
            g_prisma->Invoke(g_view, ("SkyOS.setSkyCollectionIcon(" + payload + ")").c_str());
        }
        if (g_skyCounterUIAvailable) SkyOS::UpdateSkyCounterUIIcon(payload.c_str());
    }

    void OnSkyCollectionLocationUpdated(const std::string& payload, bool discoveredNow)
    {
        if (g_prisma && g_ready && g_view && g_prisma->IsValid(g_view)) {
            g_prisma->Invoke(g_view, ("SkyOS.setSkyCollectionLocation(" + payload + ")").c_str());
        }
        if (g_skyCounterUIAvailable) SkyOS::UpdateSkyCounterUILocation(payload.c_str());
        (void)discoveredNow;  // SkyCounterUI owns location discovery notices.
    }

    void OnSkyCounterUILocationUpdated(const std::string& payload, const std::string& imagePath, bool discoveredNow)
    {
        const bool clearOlderEvents = payload.find("\"clearStream\":true") != std::string::npos;
        SendOrQueueCounterEvent("SkyOS.setSkyCounterUILocation(" + payload + ")", clearOlderEvents);
        if (g_skyCollectionAvailable && !discoveredNow && !imagePath.empty()) {
            // CounterUI owns screenshot capture. Collection only records the
            // resulting shared cache path in its save-backed location entry.
            const auto keyPos = payload.find("\"key\":\"");
            if (keyPos != std::string::npos) {
                const auto keyStart = keyPos + 7;
                const auto keyEnd = payload.find('"', keyStart);
                if (keyEnd != std::string::npos) {
                    SkyOS::UpdateSkyCollectionLocationScreenshot(
                        payload.substr(keyStart, keyEnd - keyStart),
                        imagePath);
                }
            }
        }
        if (g_skyCounterUIAvailable) SkyOS::UpdateSkyCounterUILocation(payload.c_str());
        (void)discoveredNow;
    }

    void OnSkyCounterUIIconRendered(std::uint32_t formID, const std::string& iconUrl)
    {
        SKSE::log::info("SkyCounterUI icon-ready callback reached SkyOS: formID={:08X}, iconUrl='{}', counterModuleAvailable={}",
            formID, iconUrl, g_skyCounterUIAvailable);
        std::array<char, 9> formIDText{};
        std::snprintf(formIDText.data(), formIDText.size(), "%08X", formID);
        const auto payload = std::string("{\"formID\":\"") + formIDText.data() +
            "\",\"icon\":\"" + iconUrl + "\"}";
        if (g_skyCounterUIAvailable) {
            SkyOS::UpdateSkyCounterUIIcon(payload.c_str());
            SendOrQueueCounterEvent("SkyOS.setSkyCounterUIIcon(" + payload + ")");
        }
        if (g_skyCollectionAvailable) SkyOS::UpdateSkyCollectionIcon(formID, iconUrl);
        if (g_skyMissionsAvailable) {
            auto storeIconUpdate = SkyOS::GetSkyMissionsStoreItemIconUpdateScript(formID, iconUrl);
            if (!storeIconUpdate.empty()) SendToUI(std::move(storeIconUpdate));
        }
    }

    std::filesystem::path SkyMissionsStoreIconPath(const RE::TESForm* form)
    {
        if (!form) return {};
        std::wstring executable(32768, L'\0');
        const auto length = GetModuleFileNameW(nullptr, executable.data(), static_cast<DWORD>(executable.size()));
        if (!length || length >= executable.size()) return {};
        executable.resize(length);

        std::string plugin;
        if (const auto* file = form->GetFile(); file && !file->GetFilename().empty()) plugin = file->GetFilename();
        std::string safePlugin;
        safePlugin.reserve(plugin.size());
        for (const unsigned char ch : plugin) {
            if ((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') ||
                (ch >= '0' && ch <= '9') || ch == '-' || ch == '_') {
                safePlugin.push_back(static_cast<char>(ch));
            } else if (ch == '.') {
                safePlugin.push_back('_');
            }
        }
        if (safePlugin.empty()) safePlugin = "UnknownPlugin";

        std::array<char, 9> localFormID{};
        std::snprintf(localFormID.data(), localFormID.size(), "%08X", form->GetLocalFormID());
        const auto gameRoot = std::filesystem::path(executable).parent_path();
        return gameRoot / L"Data" / L"SKSE" / L"Plugins" / L"SkyOS" / L"Mods" / L"SkyCounterUI" /
            L"Icons" / safePlugin / (std::string(localFormID.data()) + ".png");
    }

    void QueueSkyMissionsStoreIcon(std::uint32_t formID)
    {
        if (!g_skyCounterUIAvailable) {
            SKSE::log::warn("SkyMissions SkyStore cannot render item icon {:08X}: SkyCounterUI is not loaded", formID);
            return;
        }
        const auto* form = RE::TESForm::LookupByID(formID);
        const auto iconPath = SkyMissionsStoreIconPath(form);
        if (!form || iconPath.empty()) {
            SKSE::log::warn("SkyMissions SkyStore cannot resolve icon request: formID={:08X}, formFound={}, pathEmpty={}",
                formID, form != nullptr, iconPath.empty());
            return;
        }
        SKSE::log::info("SkyMissions SkyStore requesting rendered item icon: formID={:08X}, name='{}', path='{}'",
            formID, form->GetName() ? form->GetName() : "Unknown item", iconPath.string());
        SkyOS::QueueSkyCounterUIIconRender(formID, iconPath, form);
    }

    void OnSkyCollectionCaptureStatus(
        std::uint32_t formID, SkyOS::SkyCounterUICaptureStatus status)
    {
        if (!g_skyCollectionAvailable) return;
        const auto* form = RE::TESForm::LookupByID(formID);
        const char* formName = form ? form->GetName() : nullptr;
        const std::string name = formName && *formName ? formName : "item";
        std::string message;
        switch (status) {
        case SkyOS::SkyCounterUICaptureStatus::Rendering:
            message = "Rendering icon: " + name + "…";
            break;
        case SkyOS::SkyCounterUICaptureStatus::Ready:
            message = "Icon ready: " + name;
            break;
        case SkyOS::SkyCounterUICaptureStatus::Failed:
            message = "Icon render failed: " + name;
            break;
        }
        const char* active = status == SkyOS::SkyCounterUICaptureStatus::Rendering ? "true" : "false";
        SendToUI("SkyOS.setSkyCollectionCaptureStatus(" + JsString(message.c_str()) + "," + active + ")");
    }

    void OnSkyCollectionRequest(const char*)
    {
        if (!g_skyCollectionAvailable) { SendToUI("SkyOS.setActionStatus('SkyCollection is not installed')"); return; }
        auto* tasks = SKSE::GetTaskInterface();
        if (!tasks) return;
        tasks->AddTask([] {
            if (!g_prisma || !g_view || !g_prisma->IsValid(g_view)) return;
            const auto catalog = SkyOS::GetSkyCollectionCatalogJSON();
            g_prisma->Invoke(g_view, ("SkyOS.setSkyCollectionCatalog(" + catalog + ")").c_str());
            const auto locations = SkyOS::GetSkyCollectionLocationsJSON();
            g_prisma->Invoke(g_view, ("SkyOS.setSkyCollectionLocations(" + locations + ")").c_str());
        });
    }

    void OnSkyCollectionReset(const char*)
    {
        if (!g_skyCollectionAvailable) { SendToUI("SkyOS.setActionStatus('SkyCollection is not installed')"); return; }
        auto* tasks = SKSE::GetTaskInterface();
        if (!tasks) {
            SendToUI("SkyOS.setStatus('Skyrim task interface is unavailable')");
            return;
        }
        tasks->AddTask([] {
            const bool saved = SkyOS::ClearSkyCollectionForActiveSave();
            SendToUI("SkyOS.setSkyCollectionCatalog([])");
            SendToUI("SkyOS.setSkyCollectionLocations([])");
            SendToUI(saved
                ? "SkyOS.setActionStatus('Collection reset. Save the game to keep the reset in this save; cached icons and location screenshots were kept.')"
                : "SkyOS.setActionStatus('Collection cleared for this session, but the legacy catalog could not be updated.')");
        });
    }

    void PublishSkyCollectionCatalog()
    {
        if (!g_skyCollectionAvailable) return;
        if (!g_prisma || !g_ready || !g_view || !g_prisma->IsValid(g_view)) return;
        const auto catalog = SkyOS::GetSkyCollectionCatalogJSON();
        g_prisma->Invoke(g_view, ("SkyOS.setSkyCollectionCatalog(" + catalog + ")").c_str());
        const auto locations = SkyOS::GetSkyCollectionLocationsJSON();
        g_prisma->Invoke(g_view, ("SkyOS.setSkyCollectionLocations(" + locations + ")").c_str());
    }

    HWND SkyNetWindow()
    {
        const auto window = FindWindowW(nullptr, L"SkyNet");
        return window && IsWindowVisible(window) ? window : nullptr;
    }

    void MarkSkyNetLaunchAccepted()
    {
        g_skyNetLaunchPending = true;
        g_skyNetWindowObserved = SkyNetWindow() != nullptr;
        // Give SkyNet time to create its native window without letting the
        // unfocused game accept world input during startup.
        g_skyNetLaunchDeadline = GetTickCount64() + 1500;
    }

    bool RestoreSkyOSFocusAfterSkyNet()
    {
        if (g_externalAppWindow && IsWindow(g_externalAppWindow) && IsWindowVisible(g_externalAppWindow)) {
            g_skyNetWindowObserved = true;
            return false;
        }
        g_externalAppWindow = nullptr;
        if (SkyNetWindow()) {
            g_skyNetWindowObserved = true;
            return false;
        }
        if (!g_skyNetLaunchPending) return true;
        if (!g_skyNetWindowObserved && GetTickCount64() < g_skyNetLaunchDeadline) return false;
        g_skyNetLaunchPending = false;
        g_skyNetWindowObserved = false;
        return true;
    }

    std::filesystem::path SettingsPath()
    {
        std::wstring executable(32768, L'\0');
        const auto length = GetModuleFileNameW(nullptr, executable.data(), static_cast<DWORD>(executable.size()));
        if (!length || length >= executable.size()) return {};
        executable.resize(length);
        return std::filesystem::path(executable).parent_path() / L"Data/SKSE/Plugins/SkyOS.ini";
    }

    std::string NormalizeHotkeyPart(std::string_view value)
    {
        auto first = value.find_first_not_of(" \t\r\n");
        if (first == std::string_view::npos) return {};
        auto last = value.find_last_not_of(" \t\r\n");
        std::string result(value.substr(first, last - first + 1));
        std::transform(result.begin(), result.end(), result.begin(), [](unsigned char ch) { return static_cast<char>(std::tolower(ch)); });
        return result;
    }

    std::string HotkeyMapKey(std::string_view moduleId, std::string_view settingId)
    {
        return NormalizeHotkeyPart(moduleId) + "\n" + NormalizeHotkeyPart(settingId);
    }

    bool HotkeyKeyCode(std::string_view name, std::uint32_t& code)
    {
        const auto key = NormalizeHotkeyPart(name);
        if (key.size() == 1) {
            constexpr std::uint8_t letterCodes[] = { 0x1E, 0x30, 0x2E, 0x20, 0x12, 0x21, 0x22, 0x23, 0x17, 0x24, 0x25, 0x26, 0x32, 0x31, 0x18, 0x19, 0x10, 0x13, 0x1F, 0x14, 0x16, 0x2F, 0x11, 0x2D, 0x15, 0x2C };
            constexpr std::uint8_t digitCodes[] = { 0x0B, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0A };
            const char ch = key.front();
            if (ch >= 'a' && ch <= 'z') { code = letterCodes[ch - 'a']; return true; }
            if (ch >= '0' && ch <= '9') { code = digitCodes[ch - '0']; return true; }
            constexpr std::string_view punctuation = "-=[];'`\\,./";
            constexpr std::uint8_t punctuationCodes[] = { 0x0C, 0x0D, 0x1A, 0x1B, 0x27, 0x28, 0x29, 0x2B, 0x33, 0x34, 0x35 };
            if (const auto index = punctuation.find(ch); index != std::string_view::npos) { code = punctuationCodes[index]; return true; }
        }
        if (key.size() >= 2 && key.front() == 'f') {
            unsigned int number{};
            const auto parsed = std::from_chars(key.data() + 1, key.data() + key.size(), number);
            if (parsed.ec == std::errc{} && parsed.ptr == key.data() + key.size() && number >= 1 && number <= 12) {
                code = number <= 10 ? 0x3A + number : (number == 11 ? 0x57 : 0x58);
                return true;
            }
        }
        if (key == "escape" || key == "esc") code = 0x01;
        else if (key == "backspace") code = 0x0E;
        else if (key == "tab") code = 0x0F;
        else if (key == "enter" || key == "return") code = 0x1C;
        else if (key == "space") code = 0x39;
        else if (key == "capslock") code = 0x3A;
        else if (key == "numlock") code = 0x45;
        else if (key == "scroll lock" || key == "scrolllock") code = 0x46;
        else if (key == "numpad 0" || key == "numpad0") code = 0x52;
        else if (key == "numpad 1" || key == "numpad1") code = 0x4F;
        else if (key == "numpad 2" || key == "numpad2") code = 0x50;
        else if (key == "numpad 3" || key == "numpad3") code = 0x51;
        else if (key == "numpad 4" || key == "numpad4") code = 0x4B;
        else if (key == "numpad 5" || key == "numpad5") code = 0x4C;
        else if (key == "numpad 6" || key == "numpad6") code = 0x4D;
        else if (key == "numpad 7" || key == "numpad7") code = 0x47;
        else if (key == "numpad 8" || key == "numpad8") code = 0x48;
        else if (key == "numpad 9" || key == "numpad9") code = 0x49;
        else if (key == "numpad ." || key == "numpad decimal") code = 0x53;
        else if (key == "numpad *" || key == "numpadmultiply") code = 0x37;
        else if (key == "numpad -" || key == "numpadminus") code = 0x4A;
        else if (key == "numpad +" || key == "numpadplus") code = 0x4E;
        else if (key == "home") code = 0xC7;
        else if (key == "up") code = 0xC8;
        else if (key == "page up" || key == "pageup") code = 0xC9;
        else if (key == "left") code = 0xCB;
        else if (key == "right") code = 0xCD;
        else if (key == "end") code = 0xCF;
        else if (key == "down") code = 0xD0;
        else if (key == "page down" || key == "pagedown") code = 0xD1;
        else if (key == "insert") code = 0xD2;
        else if (key == "delete") code = 0xD3;
        else if (key.starts_with("key 0x")) {
            unsigned int rawCode{};
            const auto parsed = std::from_chars(key.data() + 6, key.data() + key.size(), rawCode, 16);
            if (parsed.ec != std::errc{} || parsed.ptr != key.data() + key.size() || rawCode == 0) return false;
            code = rawCode;
        }
        else return false;
        return true;
    }

    std::string HotkeyKeyName(std::uint32_t code)
    {
        if (code == 0x01) return "Escape";
        if (code == 0x0E) return "Backspace";
        if (code == 0x0F) return "Tab";
        if (code == 0x1C) return "Enter";
        if (code == 0x39) return "Space";
        if (code == 0x3A) return "Caps Lock";
        if (code == 0x45) return "Num Lock";
        if (code == 0x46) return "Scroll Lock";
        if (code >= 0x3B && code <= 0x44) return "F" + std::to_string(code - 0x3A);
        if (code == 0x57) return "F11";
        if (code == 0x58) return "F12";
        if (code == 0x37) return "Numpad *";
        if (code == 0x4A) return "Numpad -";
        if (code == 0x4E) return "Numpad +";
        if (code == 0x53) return "Numpad .";
        if (code == 0xC7) return "Home";
        if (code == 0xC8) return "Up";
        if (code == 0xC9) return "Page Up";
        if (code == 0xCB) return "Left";
        if (code == 0xCD) return "Right";
        if (code == 0xCF) return "End";
        if (code == 0xD0) return "Down";
        if (code == 0xD1) return "Page Down";
        if (code == 0xD2) return "Insert";
        if (code == 0xD3) return "Delete";
        constexpr std::uint8_t numpadCodes[] = { 0x52, 0x4F, 0x50, 0x51, 0x4B, 0x4C, 0x4D, 0x47, 0x48, 0x49 };
        for (std::size_t i = 0; i < sizeof(numpadCodes); ++i) if (numpadCodes[i] == code) return "Numpad " + std::string(1, "0123456789"[i]);
        constexpr char letters[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
        constexpr std::uint8_t letterCodes[] = { 0x1E, 0x30, 0x2E, 0x20, 0x12, 0x21, 0x22, 0x23, 0x17, 0x24, 0x25, 0x26, 0x32, 0x31, 0x18, 0x19, 0x10, 0x13, 0x1F, 0x14, 0x16, 0x2F, 0x11, 0x2D, 0x15, 0x2C };
        for (std::size_t i = 0; i < sizeof(letterCodes); ++i) if (letterCodes[i] == code) return std::string(1, letters[i]);
        constexpr std::uint8_t digitCodes[] = { 0x0B, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0A };
        for (std::size_t i = 0; i < sizeof(digitCodes); ++i) if (digitCodes[i] == code) return std::string(1, "0123456789"[i]);
        constexpr std::string_view punctuation = "-=[];'`\\,./";
        constexpr std::uint8_t punctuationCodes[] = { 0x0C, 0x0D, 0x1A, 0x1B, 0x27, 0x28, 0x29, 0x2B, 0x33, 0x34, 0x35 };
        for (std::size_t i = 0; i < sizeof(punctuationCodes); ++i) if (punctuationCodes[i] == code) return std::string(1, punctuation[i]);
        char fallback[16]{};
        std::snprintf(fallback, sizeof(fallback), "Key 0x%02X", static_cast<unsigned int>(code));
        return fallback;
    }

    bool ParseHotkey(std::string_view value, AppHotkey& binding)
    {
        std::string_view keyPart;
        std::uint8_t modifiers{};
        std::size_t start = 0;
        while (start <= value.size()) {
            const auto separator = value.find('+', start);
            const auto end = separator == std::string_view::npos ? value.size() : separator;
            const auto tokenView = value.substr(start, end - start);
            const auto token = NormalizeHotkeyPart(tokenView);
            if (token.empty()) return false;
            if (token == "ctrl" || token == "control") modifiers |= kHotkeyCtrl;
            else if (token == "shift") modifiers |= kHotkeyShift;
            else if (token == "alt") modifiers |= kHotkeyAlt;
            else {
                if (!keyPart.empty()) return false;
                keyPart = tokenView;
            }
            if (separator == std::string_view::npos) break;
            start = separator + 1;
        }
        std::uint32_t code{};
        if (keyPart.empty() || !HotkeyKeyCode(keyPart, code)) return false;
        binding.keyCode = code;
        binding.modifiers = modifiers;
        return true;
    }

    void SeedCoreHotkeyFallbacks()
    {
        AppHotkey openBinding;
        openBinding.moduleId = "SkyOS";
        openBinding.settingId = "openHotkey";
        AppHotkey closeBinding;
        closeBinding.moduleId = "SkyOS";
        closeBinding.settingId = "closeHotkey";
        if (!ParseHotkey("F11", openBinding) || !ParseHotkey("Escape", closeBinding)) return;

        std::scoped_lock lock(g_appHotkeysMutex);
        // The UI replaces these with persisted settings when its module catalog
        // arrives. This covers the startup gap before that asynchronous sync.
        g_appHotkeys.try_emplace(HotkeyMapKey(openBinding.moduleId, openBinding.settingId), std::move(openBinding));
        g_appHotkeys.try_emplace(HotkeyMapKey(closeBinding.moduleId, closeBinding.settingId), std::move(closeBinding));
    }

    std::string FormatHotkey(std::uint32_t keyCode, std::uint8_t modifiers)
    {
        std::string result;
        if (modifiers & kHotkeyCtrl) result += "Ctrl+";
        if (modifiers & kHotkeyShift) result += "Shift+";
        if (modifiers & kHotkeyAlt) result += "Alt+";
        result += HotkeyKeyName(keyCode);
        return result;
    }

    std::uint8_t CurrentHotkeyModifiers()
    {
        std::uint8_t modifiers{};
        // Use only the high bit: it reflects whether a modifier is physically
        // down now. Event-stream state may stick if focus changes before a
        // key-up arrives, making a plain key appear as Ctrl+key.
        if ((GetAsyncKeyState(VK_CONTROL) & 0x8000) != 0) modifiers |= kHotkeyCtrl;
        if ((GetAsyncKeyState(VK_SHIFT) & 0x8000) != 0) modifiers |= kHotkeyShift;
        if ((GetAsyncKeyState(VK_MENU) & 0x8000) != 0) modifiers |= kHotkeyAlt;
        return modifiers;
    }

    bool IsHotkeyModifierKey(std::uint32_t keyCode)
    {
        return keyCode == 0x1D || keyCode == 0x9D || keyCode == 0x2A || keyCode == 0x36 || keyCode == 0x38 || keyCode == 0xB8;
    }

    bool FindAppHotkey(std::string_view moduleId, std::string_view settingId, std::uint32_t keyCode, std::uint8_t modifiers, AppHotkey& result)
    {
        std::scoped_lock lock(g_appHotkeysMutex);
        const auto found = g_appHotkeys.find(HotkeyMapKey(moduleId, settingId));
        if (found == g_appHotkeys.end() || found->second.keyCode != keyCode || found->second.modifiers != modifiers) return false;
        result = found->second;
        return true;
    }

    bool FindAnyAppHotkey(std::uint32_t keyCode, std::uint8_t modifiers, AppHotkey& result)
    {
        std::scoped_lock lock(g_appHotkeysMutex);
        for (const auto& [_, binding] : g_appHotkeys) {
            if (binding.keyCode == keyCode && binding.modifiers == modifiers && NormalizeHotkeyPart(binding.settingId) != "closehotkey") { result = binding; return true; }
        }
        return false;
    }

    void SendToUI(std::string script)
    {
        if (g_prisma && g_ready && g_prisma->IsValid(g_view)) {
            g_prisma->Invoke(g_view, script.c_str());
        }
    }

    void SendOrQueueCounterEvent(std::string script, bool clearOlderEvents)
    {
        std::scoped_lock lock(g_pendingCounterEventsMutex);
        if (clearOlderEvents) g_pendingCounterEvents.clear();
        if (!g_ready || g_flushingCounterEvents || !g_prisma || !g_view || !g_prisma->IsValid(g_view)) {
            constexpr std::size_t kPendingCounterEventLimit = 64;
            if (g_pendingCounterEvents.size() == kPendingCounterEventLimit) {
                g_pendingCounterEvents.pop_front();
            }
            g_pendingCounterEvents.push_back(std::move(script));
            return;
        }
        g_prisma->Invoke(g_view, script.c_str());
    }

    void FlushPendingCounterEvents()
    {
        for (;;) {
            std::string script;
            {
                std::scoped_lock lock(g_pendingCounterEventsMutex);
                if (g_pendingCounterEvents.empty()) {
                    g_flushingCounterEvents = false;
                    return;
                }
                script = std::move(g_pendingCounterEvents.front());
                g_pendingCounterEvents.pop_front();
            }
            SendToUI(std::move(script));
        }
    }

    void OnDomReady(PrismaView view)
    {
        {
            std::scoped_lock lock(g_pendingCounterEventsMutex);
            g_view = view;
            g_ready = true;
            g_flushingCounterEvents = true;
        }
        SendToUI("SkyOS.setStatus('SkyOS ready')");
        SendToUI(std::string("SkyOS.setSkyNetStatus(") + (SkyOS::HasSkyNetIntegration() ? "true" : "false") + ")");
        OnFirstPartyAppStatusRequest(nullptr);
        SendToUI("SkyOS.setNativeApps(" + SkyOS::GetNativeAppsCatalog() + ")");
        OnSkyViewModulesRequest(nullptr);
        if (g_skyCollectionAvailable) {
            SendToUI("SkyOS.setSkyCollectionCatalog(" + SkyOS::GetSkyCollectionCatalogJSON() + ")");
            SendToUI("SkyOS.setSkyCollectionLocations(" + SkyOS::GetSkyCollectionLocationsJSON() + ")");
        }
        FlushPendingCounterEvents();
    }

    void OnCatalogRequest(const char*)
    {
        if (g_prisma && g_view && !g_prisma->IsHidden(g_view) && !g_prisma->HasFocus(g_view)) {
            FocusSkyOSView();
        }
        SendToUI("SkyOS.setDocuments(" + SkyOS::GetDocumentsCatalog() + ")");
    }

    void OnSkyViewModulesRequest(const char*)
    {
        SendToUI("SkyOS.setModules(" + SkyOS::GetSkyViewModulesCatalog() + ")");
        SendToUI("SkyOS.setNativeApps(" + SkyOS::GetNativeAppsCatalog() + ")");
    }

    bool JsonBooleanOption(std::string_view json, std::string_view key, bool fallback)
    {
        const auto keyToken = "\"" + std::string(key) + "\"";
        const auto keyPosition = json.find(keyToken);
        if (keyPosition == std::string_view::npos) return fallback;
        const auto colon = json.find(':', keyPosition + keyToken.size());
        if (colon == std::string_view::npos) return fallback;
        const auto value = json.find_first_not_of(" \t\r\n", colon + 1);
        if (value == std::string_view::npos) return fallback;
        if (json.compare(value, 4, "true") == 0) return true;
        if (json.compare(value, 5, "false") == 0) return false;
        return fallback;
    }

    void OnSkyCounterOptions(const char* json)
    {
        if (!json || !g_skyCounterUIAvailable) return;
        g_skyCounterUIIconCapturePreference.store(
            JsonBooleanOption(json, "renderIcons", true), std::memory_order_release);
        SkyOS::SetSkyCounterUISettings(json);
    }

    void OnNativeAppsRequest(const char*)
    {
        SendToUI("SkyOS.setNativeApps(" + SkyOS::GetNativeAppsCatalog() + ")");
    }

    void OnMonitorSnapshotRequest(const char* requestedTab)
    {
        if (!g_skyMonitorAvailable) { SendToUI("SkyOS.setActionStatus('SkyMonitor is not installed')"); return; }
        if (!g_prisma || !g_view || g_prisma->IsHidden(g_view)) return;
        const std::string tab = requestedTab ? requestedTab : "";
        const bool includePlugins = tab == "plugins";
        const bool includeProfiler = tab == "profiler";
        auto* tasks = SKSE::GetTaskInterface();
        if (!tasks) return;
        tasks->AddTask([includePlugins, includeProfiler] {
            if (!g_prisma || !g_view || g_prisma->IsHidden(g_view)) return;
            SendToUI("SkyOS.setMonitorSnapshot(" + SkyOS::GetMonitorSnapshot(includePlugins, includeProfiler) + ")");
        });
    }

    void OnSkyAchievementsRequest(const char*)
    {
        if (!g_skyAchievementsAvailable) { SendToUI("SkyOS.setActionStatus('SkyAchievements is not installed')"); return; }
        if (!g_prisma || !g_view || g_prisma->IsHidden(g_view)) return;
        auto* tasks = SKSE::GetTaskInterface();
        if (!tasks) return;
        tasks->AddTask([] {
            if (!g_prisma || !g_view || g_prisma->IsHidden(g_view)) return;
            SendToUI(SkyOS::GetSkyAchievementsPlayerUpdateScript());
            if (g_skyCollectionAvailable) {
                SendToUI("SkyOS.setSkyCollectionCatalog(" + SkyOS::GetSkyCollectionCatalogJSON() + ")");
                SendToUI("SkyOS.setSkyCollectionLocations(" + SkyOS::GetSkyCollectionLocationsJSON() + ")");
            } else {
                SendToUI("SkyOS.setSkyCollectionCatalog([])");
                SendToUI("SkyOS.setSkyCollectionLocations([])");
            }
            if (g_skyRewriteAvailable) {
                SendToUI("SkyOS.setSkyAchievementsHistory(" + SkyOS::GetSkyRewriteHistoryJSON() + ")");
            } else {
                SendToUI("SkyOS.setSkyAchievementsHistory({events:[]})");
            }
        });
    }

    void OnSkyMissionsRequest(const char*)
    {
        if (!g_skyMissionsAvailable) { SendToUI("SkyOS.setActionStatus('SkyMissions is not installed')"); return; }
        if (!g_prisma || !g_view || g_prisma->IsHidden(g_view)) return;
        auto* tasks = SKSE::GetTaskInterface();
        if (!tasks) return;
        tasks->AddTask([] {
            if (!g_prisma || !g_view || g_prisma->IsHidden(g_view)) return;
            SendToUI(SkyOS::GetSkyMissionsPlayerUpdateScript());
            if (g_skyCollectionAvailable) {
                SendToUI("SkyOS.setSkyCollectionCatalog(" + SkyOS::GetSkyCollectionCatalogJSON() + ")");
                SendToUI("SkyOS.setSkyCollectionLocations(" + SkyOS::GetSkyCollectionLocationsJSON() + ")");
            }
            if (g_skyRewriteAvailable) {
                SendToUI("SkyOS.setSkyMissionsHistory(" + SkyOS::GetSkyRewriteHistoryJSON() + ")");
            } else {
                SendToUI("SkyOS.setSkyMissionsHistory({events:[]})");
            }
            SKSE::log::info("SkyMissions initial page data sent; SkyRewrite={}, SkyCollection={}",
                g_skyRewriteAvailable, g_skyCollectionAvailable);
        });
    }

    void OnSkyMissionsStoreStockRequest(const char* reason)
    {
        if (!g_skyMissionsAvailable || !g_prisma || !g_view) return;
        const std::string requestReason = reason ? std::string(reason).substr(0, 40) : "unknown";
        auto* tasks = SKSE::GetTaskInterface();
        if (!tasks) {
            SKSE::log::warn("SkyMissions SkyStore stock request ignored: task interface unavailable");
            SendToUI("SkyOS.setSkyMissionsStoreItems({items:[]})");
            return;
        }
        SKSE::log::info("SkyMissions SkyStore stock request queued: reason='{}'", requestReason);
        tasks->AddTask([requestReason] {
            if (!g_skyMissionsAvailable || !g_prisma || !g_view || !g_prisma->IsValid(g_view)) return;
            SendToUI(SkyOS::GetSkyMissionsStoreItemsUpdateScript());
            SkyOS::RequestSkyMissionsStoreItemIcons(QueueSkyMissionsStoreIcon);
            SKSE::log::info("SkyMissions SkyStore stock update sent: reason='{}'", requestReason);
        });
    }

    void OnSkyMissionsStoreIconsRequest(const char* payload)
    {
        if (!g_skyMissionsAvailable || !g_prisma || !g_view) return;
        std::vector<std::uint32_t> formIDs;
        if (payload) {
            std::string_view remaining(payload);
            while (!remaining.empty() && formIDs.size() < 10) {
                const auto separator = remaining.find(',');
                const auto token = remaining.substr(0, separator);
                if (token.size() == 8) {
                    std::uint32_t formID{};
                    const auto parsed = std::from_chars(token.data(), token.data() + token.size(), formID, 16);
                    if (parsed.ec == std::errc{} && parsed.ptr == token.data() + token.size() && formID != 0) {
                        formIDs.push_back(formID);
                    }
                }
                if (separator == std::string_view::npos) break;
                remaining.remove_prefix(separator + 1);
            }
        }
        if (formIDs.empty()) {
            SKSE::log::warn("SkyMissions SkyStore icon request ignored: no valid form IDs supplied");
            return;
        }
        auto* tasks = SKSE::GetTaskInterface();
        if (!tasks) {
            SKSE::log::warn("SkyMissions SkyStore icon request ignored: task interface unavailable");
            return;
        }
        SKSE::log::info("SkyMissions SkyStore persisted-stock icon request queued: itemCount={}", formIDs.size());
        tasks->AddTask([formIDs = std::move(formIDs)] {
            if (!g_skyMissionsAvailable || !g_prisma || !g_view || !g_prisma->IsValid(g_view)) return;
            SkyOS::RequestSkyMissionsStoreItemIconsForForms(
                formIDs.data(), formIDs.size(), QueueSkyMissionsStoreIcon);
        });
    }

    void OnSkyMissionsEventSnapshotRequest(const char*)
    {
        if (!g_skyMissionsAvailable || !g_skyRewriteAvailable || !g_prisma || !g_view) return;
        auto* tasks = SKSE::GetTaskInterface();
        if (!tasks) return;
        tasks->AddTask([] {
            if (!g_skyMissionsAvailable || !g_skyRewriteAvailable || !g_prisma || !g_view) return;
            SendToUI("SkyOS.setSkyMissionsHistory(" + SkyOS::GetSkyRewriteHistoryJSON() + ")");
        });
    }

    void OnSkyAchievementsDiagnostic(const char* message)
    {
        if (!message) return;
        std::string detail(message);
        std::replace_if(detail.begin(), detail.end(), [](unsigned char ch) {
            return ch == '\r' || ch == '\n' || ch == '\t';
        }, ' ');
        if (detail.size() > 240) detail.resize(240);
        SKSE::log::info("SkyAchievements iframe: {}", detail);
    }

    void OnSkyAchievementNoticeDomReady(PrismaView view)
    {
        if (!g_prisma || !view || !g_prisma->IsValid(view)) return;
        g_prisma->Hide(view);
        std::deque<std::string> pending;
        {
            std::scoped_lock lock(g_skyAchievementNoticeMutex);
            g_skyAchievementNoticeView = view;
            g_skyAchievementNoticeReady = true;
            pending.swap(g_pendingSkyAchievementNotices);
        }
        SKSE::log::info("SkyAchievements notice view DOM-ready; pendingNotices={}", pending.size());
        for (const auto& script : pending) {
            g_prisma->Show(view);
            g_prisma->Invoke(view, script.c_str());
        }
    }

    void DispatchSkyAchievementNotice(std::string script)
    {
        PrismaView view{};
        {
            std::scoped_lock lock(g_skyAchievementNoticeMutex);
            if (!g_skyAchievementNoticeReady) {
                if (g_pendingSkyAchievementNotices.size() == 8) g_pendingSkyAchievementNotices.pop_front();
                g_pendingSkyAchievementNotices.push_back(std::move(script));
                return;
            }
            view = g_skyAchievementNoticeView;
        }
        if (!g_prisma || !view || !g_prisma->IsValid(view)) {
            SKSE::log::warn("SkyAchievements could not display an unlock notice because its PrismaUI overlay is unavailable");
            return;
        }
        g_prisma->Show(view);
        g_prisma->Invoke(view, script.c_str());
        SKSE::log::info("SkyAchievements dispatched unlock notice to PrismaUI");
    }

    void OnSkyAchievementNoticeHide(const char*)
    {
        if (g_prisma && g_skyAchievementNoticeView && g_prisma->IsValid(g_skyAchievementNoticeView)) {
            g_prisma->Hide(g_skyAchievementNoticeView);
        }
    }

    void OnSkyAchievementsUnlocked(const char* payload)
    {
        if (!payload || !g_skyAchievementsAvailable) return;
        const std::string_view value(payload);
        const auto first = value.find('\n');
        const auto second = first == std::string_view::npos ? first : value.find('\n', first + 1);
        if (first == std::string_view::npos || second == std::string_view::npos || first == 0) {
            SKSE::log::warn("SkyAchievements rejected a malformed achievement unlock notice");
            return;
        }
        const auto name = value.substr(0, first).substr(0, 160);
        const auto requirements = value.substr(first + 1, second - first - 1).substr(0, 400);
        const auto iconUrl = value.substr(second + 1).substr(0, 2048);
        const auto script = SkyOS::GetSkyAchievementsAchievementNoticeScript(name, requirements, iconUrl);
        if (script.empty()) {
            SKSE::log::info("SkyAchievements unlock notice suppressed by SkyViewer settings: name='{}'", name);
            return;
        }
        SKSE::log::info("SkyAchievements unlock notice queued: name='{}'", name);
        DispatchSkyAchievementNotice(script);
    }

    void OnSkyMissionsDiagnostic(const char* message)
    {
        if (!message) return;
        std::string detail(message);
        std::replace_if(detail.begin(), detail.end(), [](unsigned char ch) {
            return ch == '\r' || ch == '\n' || ch == '\t';
        }, ' ');
        if (detail.size() > 240) detail.resize(240);
        SKSE::log::info("SkyMissions iframe: {}", detail);
    }

    void OnSkyMissionNoticeDomReady(PrismaView view)
    {
        if (!g_prisma || !view || !g_prisma->IsValid(view)) return;
        g_prisma->Hide(view);
        std::deque<std::string> pending;
        {
            std::scoped_lock lock(g_skyMissionNoticeMutex);
            g_skyMissionNoticeView = view;
            g_skyMissionNoticeReady = true;
            pending.swap(g_pendingSkyMissionNotices);
        }
        SKSE::log::info("SkyMissions notice view DOM-ready; pendingNotices={}", pending.size());
        for (const auto& script : pending) {
            g_prisma->Show(view);
            g_prisma->Invoke(view, script.c_str());
        }
    }

    void DispatchSkyMissionNotice(std::string script)
    {
        PrismaView view{};
        {
            std::scoped_lock lock(g_skyMissionNoticeMutex);
            if (!g_skyMissionNoticeReady) {
                if (g_pendingSkyMissionNotices.size() == 8) g_pendingSkyMissionNotices.pop_front();
                g_pendingSkyMissionNotices.push_back(std::move(script));
                return;
            }
            view = g_skyMissionNoticeView;
        }
        if (!g_prisma || !view || !g_prisma->IsValid(view)) {
            SKSE::log::warn("SkyMissions could not display a completion notice because its PrismaUI overlay is unavailable");
            return;
        }
        g_prisma->Show(view);
        g_prisma->Invoke(view, script.c_str());
        SKSE::log::info("SkyMissions dispatched completion notice to PrismaUI");
    }

    void OnSkyMissionNoticeHide(const char*)
    {
        if (g_prisma && g_skyMissionNoticeView && g_prisma->IsValid(g_skyMissionNoticeView)) {
            g_prisma->Hide(g_skyMissionNoticeView);
        }
    }

    void OnSkyMissionsMissionCompleted(const char* payload)
    {
        if (!payload) return;
        const std::string_view value(payload);
        const auto separator = value.rfind('\n');
        if (separator == std::string_view::npos || separator == 0 || separator + 1 >= value.size()) {
            SKSE::log::warn("SkyMissions rejected a malformed completion notice payload");
            return;
        }
        const auto titleView = value.substr(0, separator);
        const auto rewardView = value.substr(separator + 1);
        std::uint32_t reward{};
        const auto parsed = std::from_chars(rewardView.data(), rewardView.data() + rewardView.size(), reward);
        if (parsed.ec != std::errc{} || parsed.ptr != rewardView.data() + rewardView.size() || reward > 1000000) {
            SKSE::log::warn("SkyMissions rejected a completion notice with an invalid SkyPoints reward");
            return;
        }
        const std::string title(titleView.substr(0, 160));
        const auto script = SkyOS::GetSkyMissionsMissionNoticeScript(title, reward);
        if (script.empty()) {
            SKSE::log::info("SkyMissions completion notice suppressed by SkyViewer settings: mission='{}', skyPoints={}", title, reward);
            return;
        }
        SKSE::log::info("SkyMissions completion notice queued: mission='{}', skyPoints={}", title, reward);
        DispatchSkyMissionNotice(script);
    }

    void OnSkyMissionsStorePurchase(const char* payload)
    {
        if (!payload) return;
        const std::string_view value(payload);
        const auto first = value.find('\n');
        const auto second = first == std::string_view::npos ? first : value.find('\n', first + 1);
        const auto third = second == std::string_view::npos ? second : value.find('\n', second + 1);
        if (first == std::string_view::npos || second == std::string_view::npos || third == std::string_view::npos) {
            SKSE::log::warn("SkyMissions rejected a malformed SkyStore purchase payload");
            return;
        }
        const auto moduleId = value.substr(0, first).substr(0, 80);
        const auto offerId = value.substr(first + 1, second - first - 1).substr(0, 100);
        const auto priceText = value.substr(second + 1, third - second - 1);
        const auto name = value.substr(third + 1).substr(0, 100);
        std::uint32_t price{};
        const auto parsed = std::from_chars(priceText.data(), priceText.data() + priceText.size(), price);
        if (moduleId.empty() || offerId.empty() || parsed.ec != std::errc{} ||
            parsed.ptr != priceText.data() + priceText.size()) {
            SKSE::log::warn("SkyMissions rejected a SkyStore purchase with invalid fields");
            return;
        }

        if (moduleId == "SkyMissions" && offerId.starts_with("game-item:")) {
            const std::string offerIdText(offerId);
            const bool queued = SkyOS::QueueSkyMissionsStorePurchase(offerId, price);
            SendToUI("SkyOS.setSkyMissionsStorePurchaseResult(" + JsString(offerIdText.c_str()) + "," + (queued ? "true" : "false") + ")");
            if (queued) {
                SKSE::log::info("SkyMissions accepted random-item purchase: offer='{}', price={} SkyPoints", offerId, price);
            } else {
                SKSE::log::warn("SkyMissions rejected random-item purchase: offer='{}', price={} SkyPoints", offerId, price);
            }
            return;
        }

        SkyMissionsStorePurchaseV1 notice{};
        notice.version = 1;
        notice.price = price;
        std::copy(moduleId.begin(), moduleId.end(), notice.moduleId);
        std::copy(offerId.begin(), offerId.end(), notice.offerId);
        std::copy(name.begin(), name.end(), notice.name);
        if (auto* messaging = SKSE::GetMessagingInterface()) {
            if (messaging->Dispatch(SKYMISSIONS_STORE_PURCHASE_MESSAGE, &notice,
                    static_cast<std::uint32_t>(sizeof(notice)), nullptr)) {
                SKSE::log::info("SkyMissions broadcast SkyStore purchase: module='{}', offer='{}', price={} SkyPoints",
                    notice.moduleId, notice.offerId, notice.price);
                return;
            }
        }
        SKSE::log::info("SkyMissions recorded SkyStore purchase without a listening app: module='{}', offer='{}', price={} SkyPoints",
            notice.moduleId, notice.offerId, notice.price);
    }

    void OnMonitorDeepProfileStart(const char*)
    {
        if (!g_skyMonitorAvailable) { SendToUI("SkyOS.setActionStatus('SkyMonitor is not installed')"); return; }
        SkyOS::StartMonitorDeepProfile();
        SendToUI("SkyOS.setActionStatus('Starting SkyMonitor deep profile…')");
    }

    void OnMonitorDeepProfileStop(const char*)
    {
        if (!g_skyMonitorAvailable) { SendToUI("SkyOS.setActionStatus('SkyMonitor is not installed')"); return; }
        SkyOS::StopMonitorDeepProfile();
        SendToUI("SkyOS.setActionStatus('Stopping SkyMonitor deep profile…')");
    }

    void OnLaunchNativeApp(const char* appId)
    {
        const std::string payload = appId ? appId : "";
        const auto separator = payload.find('\n');
        const std::string id = payload.substr(0, separator);
        const std::string fallbackModuleId = separator == std::string::npos ? std::string{} : payload.substr(separator + 1);
        auto* tasks = SKSE::GetTaskInterface();
        if (!tasks) {
            SendToUI("SkyOS.nativeAppLaunchFailed('Skyrim task interface is unavailable'," + JsString(fallbackModuleId.c_str()) + ")");
            return;
        }
        MarkSkyNetLaunchAccepted();
        ReleaseSkyOSFocusForSkyNet();
        tasks->AddTask([id, fallbackModuleId] {
            std::string error;
            const auto window = SkyOS::LaunchNativeApp(id, error);
            if (!window) {
                g_skyNetLaunchPending = false;
                g_skyNetWindowObserved = false;
                g_externalAppWindow = nullptr;
                if (g_prisma && g_view && g_prisma->IsValid(g_view) && !g_prisma->IsHidden(g_view)) FocusSkyOSView();
                SendToUI("SkyOS.nativeAppLaunchFailed(" + JsString(error.c_str()) + "," + JsString(fallbackModuleId.c_str()) + ")");
                return;
            }
            const auto appWindow = reinterpret_cast<HWND>(window);
            const auto skyrimWindow = FindWindowW(L"Skyrim", nullptr);
            // Native apps own the screen while open. Hide SkyOS for both
            // embedded overlays and separate windows; users can reopen it
            // with its configured hotkey after returning to the game.
            g_externalAppWindow = nullptr;
            g_skyNetLaunchPending = false;
            g_skyNetWindowObserved = false;
            g_skyNetLaunchDeadline = 0;
            if (g_prisma && g_view && g_prisma->IsValid(g_view) && !g_prisma->IsHidden(g_view)) {
                g_prisma->Unfocus(g_view);
                HideSkyOSView();
                SendToUI("SkyOS.onHide()");
            }
            if (skyrimWindow && appWindow == skyrimWindow) {
                SKSE::log::info("Native app '{}' uses Skyrim's game window; SkyOS overlay closed", id);
                SendToUI("SkyOS.setStatus('In-game app opened')");
                return;
            }
            SKSE::log::info("Native app '{}' launched; SkyOS overlay closed", id);
            SendToUI("SkyOS.setStatus('App launched')");
        });
    }

    void OnSearchRequest(const char* query)
    {
        if (!g_skySearchAvailable) { SendToUI("SkyOS.setActionStatus('SkySearch is not installed')"); return; }
        const std::string payload = query ? query : "";
        const auto separator = payload.find('\n');
        const auto category = separator == std::string::npos ? std::string("all") : payload.substr(0, separator);
        const auto queryEnd = separator == std::string::npos ? separator : payload.find('\n', separator + 1);
        const auto text = separator == std::string::npos ? payload : payload.substr(separator + 1, queryEnd == std::string::npos ? std::string::npos : queryEnd - separator - 1);
        const auto modEnd = queryEnd == std::string::npos ? queryEnd : payload.find('\n', queryEnd + 1);
        const auto modName = queryEnd == std::string::npos ? std::string{} : payload.substr(queryEnd + 1, modEnd == std::string::npos ? std::string::npos : modEnd - queryEnd - 1);
        std::size_t maxResults = 500;
        if (modEnd != std::string::npos) {
            const auto limitText = payload.substr(modEnd + 1);
            std::from_chars(limitText.data(), limitText.data() + limitText.size(), maxResults);
        }
        auto* tasks = SKSE::GetTaskInterface();
        if (!tasks) { SendToUI("SkyOS.setStatus('Skyrim task interface is unavailable')"); return; }
        tasks->AddTask([text, category, modName, maxResults] {
            try {
                SendToUI("SkyOS.setSearchResults(" + SkyOS::SearchSkyrim(text, category, modName, maxResults) + ")");
                SendToUI("SkyOS.setStatus('Search complete')");
            } catch (const std::exception& error) {
                SKSE::log::error("SkySearch query failed safely: {}", error.what());
                SendToUI("SkyOS.setStatus('Search failed while reading Skyrim records')");
            }
        });
    }

    void OnSearchAction(const char* argument)
    {
        if (!g_skySearchAvailable) { SendToUI("SkyOS.setActionStatus('SkySearch is not installed')"); return; }
        if (!argument) return;
        const std::string payload(argument);
        const auto a = payload.find('\n');
        const auto b = a == std::string::npos ? a : payload.find('\n', a + 1);
        if (a == std::string::npos || b == std::string::npos) return;
        const auto action = payload.substr(0, a);
        std::uint32_t formId{};
        std::int32_t count{1};
        const auto idText = payload.substr(a + 1, b - a - 1);
        const auto countText = payload.substr(b + 1);
        const auto idParsed = std::from_chars(idText.data(), idText.data() + idText.size(), formId, 16);
        const auto countParsed = std::from_chars(countText.data(), countText.data() + countText.size(), count);
        if (idParsed.ec != std::errc{} || countParsed.ec != std::errc{}) return;
        auto* tasks = SKSE::GetTaskInterface();
        if (!tasks) { SendToUI("SkyOS.setStatus('Skyrim task interface is unavailable')"); return; }
        const bool closesSkyOS = action == "teleport-player" || action == "teleport-actor" || action == "teleport-cell";
        if (closesSkyOS) {
            // Hide synchronously before the game task changes the player's cell;
            // this prevents the visible UI from surviving the loading transition.
            g_searchOpen = false;
            if (g_prisma && g_view && g_prisma->IsValid(g_view)) {
                g_prisma->Unfocus(g_view);
                HideSkyOSView();
            }
            SendToUI("SkyOS.onHide()");
        }
        tasks->AddTask([action, formId, count] {
            try {
                std::string error;
                std::string feedback;
                if (!SkyOS::ExecuteSkySearchAction(action, formId, count, error, feedback)) {
                    SendToUI("SkyOS.setStatus(" + JsString(error.c_str()) + ")");
                } else {
                    SendToUI("SkyOS.refreshSearchAfter(450)");
                    SendToUI("SkyOS.setActionStatus(" + JsString(feedback.empty() ? "SkySearch action complete" : feedback.c_str()) + ")");
                }
            } catch (const std::exception& error) {
                SKSE::log::error("SkySearch action failed safely: {}", error.what());
                SendToUI("SkyOS.setStatus('SkySearch action failed safely')");
            }
        });
    }

    void OnSearchOpened(const char*) { g_searchOpen = true; }
    void OnSearchClosed(const char*) { g_searchOpen = false; }

    void OnSaveModuleSettings(const char* argument)
    {
        if (!argument) return;
        const std::string payload(argument);
        const auto separator = payload.find('\n');
        if (separator == std::string::npos) return;
        const auto moduleId = payload.substr(0, separator);
        const auto settings = payload.substr(separator + 1);
        if (!SkyOS::SaveSkyViewModuleSettings(moduleId, settings)) {
            SKSE::log::warn("Could not persist settings for SkyViewer module {}", moduleId);
        }
    }

    void OnSetSkyNetSplash(const char* enabled)
    {
        g_skyNetShowSplash = enabled && (std::string_view(enabled) == "1" || std::string_view(enabled) == "true");
        const auto path = SettingsPath();
        const auto value = g_skyNetShowSplash ? L"1" : L"0";
        if (!path.empty()) WritePrivateProfileStringW(L"SkyNet", L"ShowSplash", value, path.c_str());
        if (!SkyOS::SetSkyNetSplashEnabled(g_skyNetShowSplash)) {
            SKSE::log::warn("SkyNet splash preference saved; the SkyNet compatibility patch is unavailable.");
        }
    }

    void ReleaseSkyOSFocusForSkyNet()
    {
        if (g_prisma && g_view && g_prisma->IsValid(g_view)) {
            g_prisma->Unfocus(g_view);
        }
        RestoreSkyrimControlsAfterSkyOS();
    }

    void OnLaunchSkyNet(const char*)
    {
        g_externalAppWindow = nullptr;
        MarkSkyNetLaunchAccepted();
        ReleaseSkyOSFocusForSkyNet();
        if (!SkyOS::LaunchSkyNet(g_skyNetShowSplash)) {
            g_skyNetLaunchPending = false;
            g_skyNetWindowObserved = false;
            if (g_prisma && g_view && g_prisma->IsValid(g_view) && !g_prisma->IsHidden(g_view)) {
                FocusSkyOSView();
            }
            SendToUI("SkyOS.setStatus('SkyNet with the SkyOS compatibility patch is required')");
            return;
        }
    }

    void OnHideRequest(const char*)
    {
        g_searchOpen = false;
        if (g_prisma && g_view && g_prisma->IsValid(g_view)) {
            g_prisma->Unfocus(g_view);
            HideSkyOSView();
        }
    }

    void OnSetAppHotkey(const char* argument)
    {
        if (!argument) return;
        const std::string_view payload(argument);
        const auto first = payload.find('\n');
        const auto second = first == std::string_view::npos ? first : payload.find('\n', first + 1);
        if (first == std::string_view::npos || second == std::string_view::npos) return;
        AppHotkey binding;
        binding.moduleId = std::string(payload.substr(0, first));
        binding.settingId = std::string(payload.substr(first + 1, second - first - 1));
        const auto shortcut = payload.substr(second + 1);
        if (binding.moduleId.empty() || binding.settingId.empty()) return;
        const auto mapKey = HotkeyMapKey(binding.moduleId, binding.settingId);
        if (shortcut.empty()) {
            std::scoped_lock lock(g_appHotkeysMutex);
            g_appHotkeys.erase(mapKey);
            return;
        }
        if (!ParseHotkey(shortcut, binding)) {
            SKSE::log::warn("Ignoring invalid hotkey '{}' for {} / {}", shortcut, binding.moduleId, binding.settingId);
            return;
        }
        std::scoped_lock lock(g_appHotkeysMutex);
        g_appHotkeys.insert_or_assign(mapKey, std::move(binding));
    }

    void OnBeginHotkeyCapture(const char* target)
    {
        if (!target) return;
        const std::string_view value(target);
        const auto separator = value.find('\n');
        if (separator == std::string_view::npos || separator == 0 || separator + 1 >= value.size()) return;
        {
            std::scoped_lock lock(g_heldHotkeyModifierMutex);
            g_heldHotkeyModifierKeys.clear();
        }
        {
            std::scoped_lock lock(g_captureMutex);
            g_captureTarget.assign(value);
        }
        const auto moduleId = std::string(value.substr(0, separator));
        const auto settingId = std::string(value.substr(separator + 1));
        SendToUI("SkyOS.captureStarted(" + JsString(moduleId.c_str()) + "," + JsString(settingId.c_str()) + ")");
    }

    std::string JsString(const char* text)
    {
        std::string result = "'";
        if (text) {
            for (const char* p = text; *p; ++p) {
                if (*p == '\\' || *p == '\'') result += '\\';
                if (*p == '\n') { result += "\\n"; continue; }
                if (*p == '\r') { result += "\\r"; continue; }
                result += *p;
            }
        }
        return result + "'";
    }

    void OnOpenDocument(const char* id)
    {
        g_externalAppWindow = nullptr;
        MarkSkyNetLaunchAccepted();
        ReleaseSkyOSFocusForSkyNet();
        std::string error;
        if (!SkyOS::OpenDocumentInSkyNet(id ? id : "", error)) {
            g_skyNetLaunchPending = false;
            g_skyNetWindowObserved = false;
            if (g_prisma && g_view && g_prisma->IsValid(g_view) && !g_prisma->IsHidden(g_view)) {
                FocusSkyOSView();
            }
            SKSE::log::error("SkyOS document launch failed: {}", error);
            SendToUI("SkyOS.setStatus(" + JsString(error.c_str()) + ")");
            return;
        }
    }

    void OnReadDocument(const char* id)
    {
        const std::string_view request = id ? id : "";
        const auto separator = request.find('\n');
        std::uint64_t readerRequestId{};
        std::string documentId;
        if (separator != std::string_view::npos) {
            const auto parsed = std::from_chars(request.data(), request.data() + separator, readerRequestId);
            if (parsed.ec == std::errc{} && parsed.ptr == request.data() + separator) {
                documentId.assign(request.substr(separator + 1));
            } else {
                documentId.assign(request);
            }
        } else {
            documentId.assign(request);
        }
        if (SkyOS::IsPdfDocument(documentId)) {
            SkyOS::OpenPdfDocumentAsync(documentId, [readerRequestId](std::string result) {
                auto* tasks = SKSE::GetTaskInterface();
                if (!tasks) {
                    SKSE::log::error("Could not return the PDFium open result: Skyrim task interface is unavailable");
                    return;
                }
                tasks->AddTask([readerRequestId, result = std::move(result)] {
                    SendToUI("SkyOS.openDocumentResult(" + JsString(result.c_str()) + "," +
                             std::to_string(readerRequestId) + ")");
                });
            });
            return;
        }
        auto* tasks = SKSE::GetTaskInterface();
        if (!tasks) {
            const std::string error = "{\"error\":\"Skyrim task interface is unavailable\"}";
            SendToUI("SkyOS.openDocumentResult(" + JsString(error.c_str()) + "," +
                     std::to_string(readerRequestId) + ")");
            return;
        }
        tasks->AddTask([documentId, readerRequestId] {
            const auto result = SkyOS::OpenDocument(documentId);
            SendToUI("SkyOS.openDocumentResult(" + JsString(result.c_str()) + "," +
                     std::to_string(readerRequestId) + ")");
        });
    }

    template <class T>
    bool ParsePdfInteger(std::string_view text, T& output)
    {
        if (text.empty()) return false;
        const auto parsed = std::from_chars(text.data(), text.data() + text.size(), output);
        return parsed.ec == std::errc{} && parsed.ptr == text.data() + text.size();
    }

    void OnRenderPdfPage(const char* argument)
    {
        const std::string_view request = argument ? argument : "";
        const auto firstSeparator = request.find('\n');
        const auto secondSeparator = firstSeparator == std::string_view::npos
            ? std::string_view::npos : request.find('\n', firstSeparator + 1);
        std::uint64_t session{};
        std::uint64_t requestId{};
        std::uint32_t pageNumber{};
        if (firstSeparator == std::string_view::npos || secondSeparator == std::string_view::npos ||
            !ParsePdfInteger(request.substr(0, firstSeparator), session) ||
            !ParsePdfInteger(request.substr(firstSeparator + 1, secondSeparator - firstSeparator - 1), pageNumber) ||
            !ParsePdfInteger(request.substr(secondSeparator + 1), requestId)) return;

        SkyOS::RenderPdfPageAsync(session, requestId, pageNumber,
            [](std::uint64_t callbackSession, std::uint64_t callbackRequestId,
               std::uint32_t callbackPage, std::string result) {
                auto* tasks = SKSE::GetTaskInterface();
                if (!tasks) return;
                tasks->AddTask([callbackSession, callbackRequestId, callbackPage, result = std::move(result)] {
                    SendToUI("SkyOS.pdfPageResult(" + std::to_string(callbackSession) + "," +
                             std::to_string(callbackRequestId) + "," + std::to_string(callbackPage) + "," +
                             JsString(result.c_str()) + ")");
                });
            });
    }

    void OnClosePdfDocument(const char* argument)
    {
        std::uint64_t session{};
        const std::string_view value = argument ? argument : "";
        if (ParsePdfInteger(value, session)) SkyOS::ClosePdfDocumentAsync(session);
    }

    class InputSink final : public RE::BSTEventSink<RE::InputEvent*>
    {
    public:
        RE::BSEventNotifyControl ProcessEvent(RE::InputEvent* const* events, RE::BSTEventSource<RE::InputEvent*>*) override
        {
            if (!events || !g_prisma || !g_view) return RE::BSEventNotifyControl::kContinue;
            for (auto* event = *events; event; event = event->next) {
                auto* button = event->AsButtonEvent();
                if (!button || button->GetDevice() != RE::INPUT_DEVICE::kKeyboard) continue;
                const auto pressedKey = button->GetIDCode();
                const auto pendingClose = g_pendingCloseKeyUps.find(pressedKey);
                const bool isPendingCloseKey = pendingClose != g_pendingCloseKeyUps.end();
                const auto suppressed = g_suppressedHotkeyKeyUps.find(pressedKey);
                const bool isSuppressedKey = suppressed != g_suppressedHotkeyKeyUps.end();
                bool isTrackedModifier = false;
                if (IsHotkeyModifierKey(pressedKey)) {
                    std::scoped_lock lock(g_heldHotkeyModifierMutex);
                    isTrackedModifier = g_heldHotkeyModifierKeys.contains(pressedKey);
                }
                // Some short taps arrive with a zero value and zero held time,
                // which CommonLib's IsUp() does not classify as a release.
                const bool isRelease = button->IsUp() || (button->Value() == 0.0F && (isPendingCloseKey || isSuppressedKey || isTrackedModifier));
                if (isRelease) {
                    if (isPendingCloseKey) g_pendingCloseKeyUps.erase(pendingClose);
                    if (isSuppressedKey) g_suppressedHotkeyKeyUps.erase(suppressed);
                    if (IsHotkeyModifierKey(pressedKey)) {
                        std::scoped_lock lock(g_heldHotkeyModifierMutex);
                        g_heldHotkeyModifierKeys.erase(pressedKey);
                    }
                    if (isSuppressedKey || isPendingCloseKey) {
                        ConsumeHotkeyButtonEvent(button);
                        CloseSkyOSAfterHotkeyChord();
                        return RE::BSEventNotifyControl::kStop;
                    }
                }
                if (IsHotkeyModifierKey(pressedKey)) {
                    if (button->IsDown()) {
                        std::scoped_lock lock(g_heldHotkeyModifierMutex);
                        g_heldHotkeyModifierKeys.insert(pressedKey);
                    }
                    if (isRelease) {
                        std::scoped_lock lock(g_heldHotkeyModifierMutex);
                        g_heldHotkeyModifierKeys.erase(pressedKey);
                    }
                    continue;
                }
                if (!button->IsDown()) continue;
                const auto activeModifiers = CurrentHotkeyModifiers();

                if (!g_prisma->IsHidden(g_view) && !g_prisma->HasFocus(g_view)) {
                    if (RestoreSkyOSFocusAfterSkyNet()) {
                        // Reclaim the UI and pause Skyrim before forwarding the first
                        // input after the separate SkyNet window closes.
                        FocusSkyOSView();
                    }
                    // Never let an unfocused, visible SkyOS/SkyNet session pass an
                    // attack or activation input into the Skyrim world.
                    SuppressHotkeyChordKeyUps(pressedKey);
                    ConsumeHotkeyButtonEvent(button);
                    return RE::BSEventNotifyControl::kStop;
                }

                std::string target;
                {
                    std::scoped_lock lock(g_captureMutex);
                    target.swap(g_captureTarget);
                }
                if (!target.empty()) {
                    SuppressHotkeyChordKeyUps(pressedKey);
                    ConsumeHotkeyButtonEvent(button);
                    const auto separator = target.find('\n');
                    if (separator == std::string::npos) return RE::BSEventNotifyControl::kStop;
                    const auto moduleId = target.substr(0, separator);
                    const auto settingId = target.substr(separator + 1);
                    if (pressedKey == 0x01 && activeModifiers == 0 && settingId != "closeHotkey") {
                        SendToUI("SkyOS.captureCancelled()");
                    } else {
                        const auto shortcut = FormatHotkey(pressedKey, activeModifiers);
                        const auto payload = moduleId + "\n" + settingId + "\n" + shortcut;
                        OnSetAppHotkey(payload.c_str());
                        SendToUI("SkyOS.hotkeyCaptured(" + JsString(moduleId.c_str()) + "," + JsString(settingId.c_str()) + "," + JsString(shortcut.c_str()) + ")");
                    }
                    return RE::BSEventNotifyControl::kStop;
                }

                const bool visible = !g_prisma->IsHidden(g_view);
                const bool focused = g_prisma->HasFocus(g_view);
                AppHotkey binding;
                if (visible && focused && g_searchOpen && FindAppHotkey("SkySearch", "closeHotkey", pressedKey, activeModifiers, binding)) {
                    SuppressHotkeyChordKeyUps(pressedKey);
                    ConsumeHotkeyButtonEvent(button);
                    SendToUI("SkyOS.hotkeyAction(" + JsString(binding.moduleId.c_str()) + "," + JsString(binding.settingId.c_str()) + ")");
                    return RE::BSEventNotifyControl::kStop;
                }
                // Escape remains a direct way out of SkyOS even if its saved
                // close binding is missing or stale. A search window handles
                // Escape above so its own close behavior remains intact.
                if (visible && focused && pressedKey == 0x01) {
                    BeginSkyOSCloseAfterHotkeyRelease(pressedKey);
                    ConsumeHotkeyButtonEvent(button);
                    return RE::BSEventNotifyControl::kStop;
                }
                if (visible && focused && FindAppHotkey("SkyOS", "closeHotkey", pressedKey, activeModifiers, binding)) {
                    // Keep controls disabled until the base key-up is consumed.
                    BeginSkyOSCloseAfterHotkeyRelease(pressedKey);
                    ConsumeHotkeyButtonEvent(button);
                    return RE::BSEventNotifyControl::kStop;
                }
                if (FindAppHotkey("SkyOS", "openHotkey", pressedKey, activeModifiers, binding)) {
                    SKSE::log::debug("SkyOS open shortcut matched: {}", FormatHotkey(pressedKey, activeModifiers));
                    SuppressHotkeyChordKeyUps(pressedKey);
                    ConsumeHotkeyButtonEvent(button);
                    if (g_prisma->IsHidden(g_view)) {
                        ShowSkyOSView();
                        FocusSkyOSView();
                        SendToUI("SkyOS.onShow()");
                    } else if (!focused) {
                        FocusSkyOSView();
                    } else {
                        BeginSkyOSCloseAfterHotkeyRelease(pressedKey);
                    }
                    return RE::BSEventNotifyControl::kStop;
                }

                if (!FindAnyAppHotkey(pressedKey, activeModifiers, binding)) {
                    // While SkyOS owns input, a modified key that is not one
                    // of its configured chords must not fall through as a
                    // plain Skyrim menu/action key.
                    if (visible && focused && activeModifiers != 0) {
                        SuppressHotkeyChordKeyUps(pressedKey);
                        ConsumeHotkeyButtonEvent(button);
                        return RE::BSEventNotifyControl::kStop;
                    }
                    continue;
                }
                const auto module = NormalizeHotkeyPart(binding.moduleId);
                const auto setting = NormalizeHotkeyPart(binding.settingId);
                if (setting == "closehotkey" && !(visible && focused && g_searchOpen && module == "skysearch")) continue;
                SuppressHotkeyChordKeyUps(pressedKey);
                ConsumeHotkeyButtonEvent(button);
                if (g_prisma->IsHidden(g_view)) {
                    ShowSkyOSView();
                    FocusSkyOSView();
                    SendToUI("SkyOS.onShow()");
                } else if (!focused) {
                    FocusSkyOSView();
                }
                if (module == "skyos" && setting == "documentshotkey") {
                    SendToUI("SkyOS.openHotkeyPage('documents')");
                } else if (module == "skyos" && setting == "skyviewerhotkey") {
                    SendToUI("SkyOS.openHotkeyPage('skyview')");
                } else if (module == "skyos" && setting == "closehotkey") {
                    BeginSkyOSCloseAfterHotkeyRelease(pressedKey);
                } else {
                    SendToUI("SkyOS.openHotkeyApp(" + JsString(binding.moduleId.c_str()) + ")");
                }
                return RE::BSEventNotifyControl::kStop;
            }
            return RE::BSEventNotifyControl::kContinue;
        }
    };
    InputSink g_inputSink;

    void OnMessage(SKSE::MessagingInterface::Message* message)
    {
        if (!message) return;
        auto* tasks = SKSE::GetTaskInterface();
        if (message->type == SKSE::MessagingInterface::kPreLoadGame) {
            // Stop starting previews across a save transition. Any in-flight
            // model is allowed to finish and tear down through the guarded
            // capture state machine before queued work resumes.
            if (g_skyCounterUIAvailable) SkyOS::SetSkyCounterUIIconCaptureEnabled(false);
            g_skyCollectionNewGamePending.store(false, std::memory_order_release);
            // Clear immediately. The SKSE serialization callback will restore
            // the catalog from the save record; a deferred task here could run
            // after that restore and erase it again.
            if (g_skyCollectionAvailable) SkyOS::ResetSkyCollectionForSaveLoad();
            if (tasks) {
                tasks->AddTask([] { PublishSkyCollectionCatalog(); });
            } else {
                PublishSkyCollectionCatalog();
            }
            return;
        }
        if (message->type == SKSE::MessagingInterface::kNewGame) {
            if (!g_skyCollectionAvailable) {
                // SkyCounter UI is an independent app. Its render queue must
                // resume on new games even when SkyCollection is absent.
                if (g_skyCounterUIAvailable) {
                    SkyOS::SetSkyCounterUIIconCaptureEnabled(
                        g_skyCounterUIIconCapturePreference.load(std::memory_order_acquire));
                }
                return;
            }
            if (g_skyCounterUIAvailable) SkyOS::SetSkyCounterUIIconCaptureEnabled(false);
            g_skyCollectionNewGamePending.store(true, std::memory_order_release);
            SkyOS::BeginSkyCollectionNewGame();
            if (tasks) tasks->AddTask([] { PublishSkyCollectionCatalog(); });
            else PublishSkyCollectionCatalog();
            return;
        }
        if (message->type == SKSE::MessagingInterface::kPostLoadGame) {
            if (!g_skyCollectionAvailable) {
                // PreLoadGame pauses native model capture during save changes.
                // Restore it independently of SkyCollection's save catalog.
                if (g_skyCounterUIAvailable) {
                    SkyOS::SetSkyCounterUIIconCaptureEnabled(
                        g_skyCounterUIIconCapturePreference.load(std::memory_order_acquire));
                }
                return;
            }
            const bool newGame = g_skyCollectionNewGamePending.exchange(false, std::memory_order_acq_rel);
            if (tasks) {
                tasks->AddTask([newGame] {
                    if (!newGame) {
                        SkyOS::LoadSkyCollectionLegacyCatalog(
                            CurrentPhysicalSavePath(RE::BGSSaveLoadManager::GetSingleton()));
                    }
                    PublishSkyCollectionCatalog();
                    if (g_skyCounterUIAvailable) SkyOS::SetSkyCounterUIIconCaptureEnabled(g_skyCounterUIIconCapturePreference.load(std::memory_order_acquire));
                });
            } else {
                if (!newGame) {
                    SkyOS::LoadSkyCollectionLegacyCatalog(
                        CurrentPhysicalSavePath(RE::BGSSaveLoadManager::GetSingleton()));
                }
                PublishSkyCollectionCatalog();
                if (g_skyCounterUIAvailable) SkyOS::SetSkyCounterUIIconCaptureEnabled(g_skyCounterUIIconCapturePreference.load(std::memory_order_acquire));
            }
            return;
        }
        if (message->type != SKSE::MessagingInterface::kDataLoaded) return;
        g_skySearchAvailable = GetModuleHandleW(L"SkySearch.dll") != nullptr;
        g_skyMonitorAvailable = GetModuleHandleW(L"SkyMonitor.dll") != nullptr;
        g_skyRewriteAvailable = GetModuleHandleW(L"SkyRewrite.dll") != nullptr;
        g_skyCollectionAvailable = GetModuleHandleW(L"SkyCollection.dll") != nullptr;
        g_skyCounterUIAvailable = GetModuleHandleW(L"SkyCounterUI.dll") != nullptr;
        g_skyAchievementsAvailable = GetModuleHandleW(L"SkyAchievements.dll") != nullptr;
        g_skyMissionsAvailable = GetModuleHandleW(L"SkyMissions.dll") != nullptr && g_skyRewriteAvailable;

        if (g_skyCounterUIAvailable) {
            // Start collecting before PrismaUI finishes creating the main page;
            // pickup and discovery events are queued for the page when it is ready.
            SkyOS::InstallSkyCounterUIIconRenderer(OnSkyCounterUIIconRendered, OnSkyCollectionCaptureStatus);
            SkyOS::InstallSkyCounterUIPickupEventSink(OnSkyCounterUIPickup);
            SkyOS::InstallSkyCounterUILocationEventSink(OnSkyCounterUILocationUpdated);
        }

        if (g_skyCollectionAvailable) {
            SkyOS::RegisterSkyCollectionSerialization();
        }
        g_prisma = PRISMA_UI_API::RequestPluginAPI<PRISMA_UI_API::IVPrismaUI1>();
        if (!g_prisma) {
            SKSE::log::error("PrismaUI is missing or does not provide API v1");
            return;
        }

        g_view = g_prisma->CreateView("SkyOS/index.html", OnDomReady);
        if (!g_view) {
            SKSE::log::error("Could not create SkyOS interface");
            return;
        }
        HideSkyOSView();
        if (g_skyCounterUIAvailable) {
            g_skyCounterUIAvailable = SkyOS::InitializeSkyCounterUI(g_prisma, g_view);
            if (!g_skyCounterUIAvailable) SKSE::log::error("Could not initialize SkyCounterUI.dll's overlay");
        }
        if (g_skyMissionsAvailable) {
            g_skyMissionNoticeView = g_prisma->CreateView("SkyOS/SkyMissions/notice.html", OnSkyMissionNoticeDomReady);
            if (g_skyMissionNoticeView) {
                g_prisma->Hide(g_skyMissionNoticeView);
                g_prisma->SetOrder(g_skyMissionNoticeView, g_prisma->GetOrder(g_view) + 2);
                g_prisma->RegisterJSListener(g_skyMissionNoticeView, "skyos_skymissions_mission_notice_hide", OnSkyMissionNoticeHide);
                SKSE::log::info("SkyMissions mission completion overlay initialized");
            } else {
                SKSE::log::error("Could not create SkyMissions mission completion overlay");
            }
        }
        if (g_skyAchievementsAvailable) {
            g_skyAchievementNoticeView = g_prisma->CreateView("SkyOS/SkyAchievements/notice.html", OnSkyAchievementNoticeDomReady);
            if (g_skyAchievementNoticeView) {
                g_prisma->Hide(g_skyAchievementNoticeView);
                g_prisma->SetOrder(g_skyAchievementNoticeView, g_prisma->GetOrder(g_view) + 3);
                g_prisma->RegisterJSListener(g_skyAchievementNoticeView, "skyos_skyachievements_notice_hide", OnSkyAchievementNoticeHide);
                SKSE::log::info("SkyAchievements achievement unlock overlay initialized");
            } else {
                SKSE::log::error("Could not create SkyAchievements achievement unlock overlay");
            }
        }
        if (g_skyRewriteAvailable && !SkyOS::InitializeSkyRewriteDashboard(g_prisma, g_view)) {
            SKSE::log::error("Could not initialize SkyRewrite.dll's dashboard bridge");
        }
        if (g_skyCollectionAvailable) {
            SkyOS::InstallSkyCollectionEventSink(OnSkyCollectionPickup, OnSkyCollectionIconUpdated,
                OnSkyCollectionLocationUpdated);
        }
        g_prisma->RegisterJSListener(g_view, "skyos_list_documents", OnCatalogRequest);
        g_prisma->RegisterJSListener(g_view, "skyos_list_skyview_modules", OnSkyViewModulesRequest);
        g_prisma->RegisterJSListener(g_view, "skyos_list_native_apps", OnNativeAppsRequest);
        g_prisma->RegisterJSListener(g_view, "skyos_app_install_status", OnFirstPartyAppStatusRequest);
        g_prisma->RegisterJSListener(g_view, "skyos_skycollection_catalog", OnSkyCollectionRequest);
        g_prisma->RegisterJSListener(g_view, "skyos_skycollection_reset", OnSkyCollectionReset);
        g_prisma->RegisterJSListener(g_view, "skyos_skycounter_options", OnSkyCounterOptions);
        g_prisma->RegisterJSListener(g_view, "skyos_monitor_snapshot", OnMonitorSnapshotRequest);
        g_prisma->RegisterJSListener(g_view, "skyos_skyachievements_request", OnSkyAchievementsRequest);
        g_prisma->RegisterJSListener(g_view, "skyos_skyachievements_diagnostic", OnSkyAchievementsDiagnostic);
        g_prisma->RegisterJSListener(g_view, "skyos_skyachievements_unlocked", OnSkyAchievementsUnlocked);
        g_prisma->RegisterJSListener(g_view, "skyos_skymissions_request", OnSkyMissionsRequest);
        g_prisma->RegisterJSListener(g_view, "skyos_skymissions_event_snapshot", OnSkyMissionsEventSnapshotRequest);
        g_prisma->RegisterJSListener(g_view, "skyos_skymissions_diagnostic", OnSkyMissionsDiagnostic);
        if (g_skyMissionsAvailable) {
            g_prisma->RegisterJSListener(g_view, "skyos_skymissions_mission_complete", OnSkyMissionsMissionCompleted);
            g_prisma->RegisterJSListener(g_view, "skyos_skymissions_store_purchase", OnSkyMissionsStorePurchase);
            g_prisma->RegisterJSListener(g_view, "skyos_skymissions_store_stock", OnSkyMissionsStoreStockRequest);
            g_prisma->RegisterJSListener(g_view, "skyos_skymissions_store_icons", OnSkyMissionsStoreIconsRequest);
        }
        g_prisma->RegisterJSListener(g_view, "skyos_monitor_profile_start", OnMonitorDeepProfileStart);
        g_prisma->RegisterJSListener(g_view, "skyos_monitor_profile_stop", OnMonitorDeepProfileStop);
        g_prisma->RegisterJSListener(g_view, "skyos_launch_native_app", OnLaunchNativeApp);
        g_prisma->RegisterJSListener(g_view, "skyos_search", OnSearchRequest);
        g_prisma->RegisterJSListener(g_view, "skyos_search_action", OnSearchAction);
        g_prisma->RegisterJSListener(g_view, "skyos_search_opened", OnSearchOpened);
        g_prisma->RegisterJSListener(g_view, "skyos_search_closed", OnSearchClosed);
        g_prisma->RegisterJSListener(g_view, "skyos_save_module_settings", OnSaveModuleSettings);
        g_prisma->RegisterJSListener(g_view, "skyos_open_document", OnOpenDocument);
        g_prisma->RegisterJSListener(g_view, "skyos_read_document", OnReadDocument);
        g_prisma->RegisterJSListener(g_view, "skyos_render_pdf_page", OnRenderPdfPage);
        g_prisma->RegisterJSListener(g_view, "skyos_close_pdf_document", OnClosePdfDocument);
        g_prisma->RegisterJSListener(g_view, "skyos_launch_skynet", OnLaunchSkyNet);
        g_prisma->RegisterJSListener(g_view, "skyos_set_skynet_splash", OnSetSkyNetSplash);
        g_prisma->RegisterJSListener(g_view, "skyos_hide", OnHideRequest);
        g_prisma->RegisterJSListener(g_view, "skyos_set_app_hotkey", OnSetAppHotkey);
        g_prisma->RegisterJSListener(g_view, "skyos_begin_hotkey_capture", OnBeginHotkeyCapture);

        // The page can become DOM-ready before SKSE reaches kDataLoaded. Send
        // the final module availability after every optional app is detected.
        if (g_ready) {
            OnFirstPartyAppStatusRequest(nullptr);
            SendToUI(std::string("SkyOS.setSkyNetStatus(") +
                (SkyOS::HasSkyNetIntegration() ? "true" : "false") + ")");
        }

        SeedCoreHotkeyFallbacks();

        const auto settingsPath = SettingsPath();
        if (!settingsPath.empty()) {
            g_skyNetShowSplash = GetPrivateProfileIntW(L"SkyNet", L"ShowSplash", 0, settingsPath.c_str()) != 0;
            if (!SkyOS::HasSkyNetIntegration()) {
                SKSE::log::warn("SkyNet with the SkyOS compatibility patch is a required dependency.");
            }
        }

        if (auto* input = RE::BSInputDeviceManager::GetSingleton()) {
            // This must run before Skyrim's own controls. Returning kStop from
            // a sink registered at the tail can be too late: the game may
            // already have processed the unmodified base key as a menu action.
            input->PrependEventSink(&g_inputSink);
            SKSE::log::info("SkyOS keyboard input sink registered; F11 fallback is active until saved shortcuts load");
        } else {
            SKSE::log::error("SkyOS could not register its keyboard input sink: BSInputDeviceManager is unavailable");
        }
        SKSE::log::info("SkyOS loaded. Configurable module hotkeys are enabled.");
    }
}

extern "C" __declspec(dllexport) void WINAPI SkyOS_NotifyEmbeddedAppClosed()
{
    // Embedded apps run inside Skyrim's window. Keep SkyOS hidden after they
    // close so they return to gameplay; the player can reopen SkyOS with F11.
    SKSE::log::info("Embedded app closed; SkyOS remains hidden until its open hotkey is pressed");
}

SKSE_PLUGIN_LOAD(const SKSE::LoadInterface* skse)
{
    SKSE::Init(skse);
    auto* messaging = SKSE::GetMessagingInterface();
    if (!messaging || !messaging->RegisterListener("SKSE", OnMessage)) {
        SKSE::log::critical("SkyOS could not register its SKSE message listener");
        return false;
    }
    return true;
}
