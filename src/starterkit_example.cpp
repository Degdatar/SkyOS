#define SKYOS_APP_IMPLEMENTATION
#include "SkyOSAPI.h"

#include <mutex>
#include <string>

namespace {
    constexpr wchar_t kWindowClass[] = L"SkyOSStarterKitExampleWindow";
    constexpr int kCloseButtonId = 1001;
    HWND g_window = nullptr;
    std::wstring g_argument;
    std::once_flag g_classRegistration;
    bool g_classReady = false;

    LRESULT CALLBACK ExampleWindowProc(HWND window, UINT message, WPARAM wParam, LPARAM lParam)
    {
        switch (message) {
        case WM_CREATE: {
            const auto instance = reinterpret_cast<LPCREATESTRUCTW>(lParam)->hInstance;
            CreateWindowW(L"STATIC", L"This is a standalone native app launched by SkyOS.",
                WS_CHILD | WS_VISIBLE, 22, 22, 390, 28, window, nullptr, instance, nullptr);
            CreateWindowW(L"STATIC", g_argument.empty() ? L"Launch argument: (empty)" : g_argument.c_str(),
                WS_CHILD | WS_VISIBLE, 22, 58, 390, 24, window, nullptr, instance, nullptr);
            CreateWindowW(L"BUTTON", L"Close", WS_CHILD | WS_VISIBLE | WS_TABSTOP | BS_PUSHBUTTON,
                22, 105, 92, 30, window, reinterpret_cast<HMENU>(static_cast<INT_PTR>(kCloseButtonId)), instance, nullptr);
            return 0;
        }
        case WM_COMMAND:
            if (LOWORD(wParam) == kCloseButtonId) { DestroyWindow(window); return 0; }
            break;
        case WM_CLOSE:
            DestroyWindow(window);
            return 0;
        case WM_DESTROY:
            if (window == g_window) g_window = nullptr;
            return 0;
        }
        return DefWindowProcW(window, message, wParam, lParam);
    }

    bool RegisterExampleWindowClass(HINSTANCE instance)
    {
        std::call_once(g_classRegistration, [instance] {
            WNDCLASSEXW windowClass{};
            windowClass.cbSize = sizeof(windowClass);
            windowClass.hInstance = instance;
            windowClass.lpfnWndProc = ExampleWindowProc;
            windowClass.hCursor = LoadCursorW(nullptr, MAKEINTRESOURCEW(32512));
            windowClass.hbrBackground = reinterpret_cast<HBRUSH>(static_cast<INT_PTR>(COLOR_WINDOW + 1));
            windowClass.lpszClassName = kWindowClass;
            g_classReady = RegisterClassExW(&windowClass) != 0 || GetLastError() == ERROR_CLASS_ALREADY_EXISTS;
        });
        return g_classReady;
    }
}

extern "C" SKYOS_APP_API HWND WINAPI SkyOS_App_Launch(const wchar_t* argument)
{
    const auto instance = GetModuleHandleW(nullptr);
    if (!RegisterExampleWindowClass(instance)) return nullptr;
    if (g_window && IsWindow(g_window)) {
        ShowWindow(g_window, SW_RESTORE);
        SetForegroundWindow(g_window);
        return g_window;
    }
    g_argument = argument ? argument : L"";
    g_window = CreateWindowExW(WS_EX_APPWINDOW, kWindowClass, L"SkyOS Starter Kit Example",
        WS_OVERLAPPED | WS_CAPTION | WS_SYSMENU | WS_MINIMIZEBOX,
        CW_USEDEFAULT, CW_USEDEFAULT, 460, 205, nullptr, nullptr, instance, nullptr);
    if (!g_window) return nullptr;
    ShowWindow(g_window, SW_SHOW);
    UpdateWindow(g_window);
    SetForegroundWindow(g_window);
    return g_window;
}
