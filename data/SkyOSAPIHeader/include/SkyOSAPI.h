#pragma once

#include <Windows.h>

// Native-app entry point discovered by SkyOS from an Apps/<AppId>/app.ini
// registration. Define SKYOS_APP_IMPLEMENTATION in the plugin that implements
// this export. This is a C ABI; no import library is required.
#if defined(SKYOS_APP_IMPLEMENTATION)
#define SKYOS_APP_API __declspec(dllexport)
#else
#define SKYOS_APP_API
#endif

extern "C" SKYOS_APP_API HWND WINAPI SkyOS_App_Launch(const wchar_t* argument);
