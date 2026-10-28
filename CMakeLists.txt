cmake_minimum_required(VERSION 3.24)
project(SkyOS VERSION 0.1.0 LANGUAGES CXX)

include(FetchContent)

set(CMAKE_CXX_STANDARD 23)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

# The app implementations are maintained in their own repositories. SkyOS
# keeps their public bridge headers and links to the import libraries produced
# by those app builds.
set(SKYOS_APP_IMPORT_LIB_DIR "${CMAKE_CURRENT_SOURCE_DIR}/lib" CACHE PATH
    "Directory containing the import libraries for the separately built SkyOS app modules")
set(_skyos_bridge_modules
    SkySearch
    SkyMonitor
    SkyRewrite
    SkyCollection
    SkyCounterUI
    SkyAchievements
    SkyMissions
)
set(_skyos_bridge_libraries)
foreach(_module IN LISTS _skyos_bridge_modules)
    set(_module_library_variable "_skyos_${_module}_import_library")
    find_library(${_module_library_variable}
        NAMES "${_module}"
        PATHS "${SKYOS_APP_IMPORT_LIB_DIR}"
        NO_DEFAULT_PATH
    )
    if(NOT ${_module_library_variable})
        message(FATAL_ERROR
            "Missing ${_module}.lib in '${SKYOS_APP_IMPORT_LIB_DIR}'. Build the separate ${_module} project and place its import library there, or set SKYOS_APP_IMPORT_LIB_DIR to the directory containing all seven app import libraries.")
    endif()
    list(APPEND _skyos_bridge_libraries "${${_module_library_variable}}")
endforeach()

# Keep in sync with the CommonLibSSE-NG branch used by the SkyOS source tree.
FetchContent_Declare(
    CommonLibSSE
    GIT_REPOSITORY https://github.com/alandtse/CommonLibSSE-NG.git
    GIT_TAG ng
    GIT_SUBMODULES ""
    GIT_SHALLOW TRUE
)
set(BUILD_TESTS OFF CACHE BOOL "Disable CommonLibSSE-NG tests" FORCE)
set(BUILD_TESTING OFF CACHE BOOL "Disable CommonLibSSE-NG tests" FORCE)
set(ENABLE_SKYRIM_VR OFF CACHE BOOL "SkyOS targets Skyrim SE/AE, not VR" FORCE)

# CommonLib is a build dependency; do not copy its install rules into the mod.
set(CMAKE_SKIP_INSTALL_RULES ON)
FetchContent_MakeAvailable(CommonLibSSE)
set(CMAKE_SKIP_INSTALL_RULES OFF)
include("${commonlibsse_SOURCE_DIR}/cmake/CommonLibSSE.cmake")

# PDFium is fetched from NuGet and verified before extracting the x64 files.
set(SKYOS_PDFIUM_VERSION "155.0.8044")
set(SKYOS_PDFIUM_SHA256 "3be91703fc616fedc2ac40b26905ad4a134ae03861460e21347280b296b54993")
set(SKYOS_PDFIUM_ARCHIVE "${CMAKE_BINARY_DIR}/_deps/bblanchon.PDFium.Win32.${SKYOS_PDFIUM_VERSION}.nupkg")
set(SKYOS_PDFIUM_ROOT "${CMAKE_BINARY_DIR}/_deps/pdfium-${SKYOS_PDFIUM_VERSION}")
file(MAKE_DIRECTORY "${CMAKE_BINARY_DIR}/_deps")
if(NOT EXISTS "${SKYOS_PDFIUM_ARCHIVE}")
    file(DOWNLOAD
        "https://api.nuget.org/v3-flatcontainer/bblanchon.pdfium.win32/${SKYOS_PDFIUM_VERSION}/bblanchon.pdfium.win32.${SKYOS_PDFIUM_VERSION}.nupkg"
        "${SKYOS_PDFIUM_ARCHIVE}"
        EXPECTED_HASH "SHA256=${SKYOS_PDFIUM_SHA256}"
        TLS_VERIFY ON
        SHOW_PROGRESS
        STATUS SKYOS_PDFIUM_DOWNLOAD_STATUS
    )
    list(GET SKYOS_PDFIUM_DOWNLOAD_STATUS 0 SKYOS_PDFIUM_DOWNLOAD_CODE)
    if(NOT SKYOS_PDFIUM_DOWNLOAD_CODE EQUAL 0)
        list(GET SKYOS_PDFIUM_DOWNLOAD_STATUS 1 SKYOS_PDFIUM_DOWNLOAD_MESSAGE)
        message(FATAL_ERROR "Could not download the pinned PDFium package: ${SKYOS_PDFIUM_DOWNLOAD_MESSAGE}")
    endif()
endif()
file(SHA256 "${SKYOS_PDFIUM_ARCHIVE}" SKYOS_PDFIUM_ACTUAL_SHA256)
if(NOT SKYOS_PDFIUM_ACTUAL_SHA256 STREQUAL SKYOS_PDFIUM_SHA256)
    message(FATAL_ERROR "The cached PDFium package failed its SHA-256 check. Remove ${SKYOS_PDFIUM_ARCHIVE} and configure again.")
endif()
if(NOT EXISTS "${SKYOS_PDFIUM_ROOT}/build/native/lib/win-x64/pdfium.dll.lib" OR
   NOT EXISTS "${SKYOS_PDFIUM_ROOT}/runtimes/win-x64/native/pdfium.dll")
    set(SKYOS_PDFIUM_ZIP "${SKYOS_PDFIUM_ROOT}/pdfium-package.zip")
    file(MAKE_DIRECTORY "${SKYOS_PDFIUM_ROOT}")
    file(COPY_FILE "${SKYOS_PDFIUM_ARCHIVE}" "${SKYOS_PDFIUM_ZIP}")
    file(ARCHIVE_EXTRACT INPUT "${SKYOS_PDFIUM_ZIP}" DESTINATION "${SKYOS_PDFIUM_ROOT}")
    file(REMOVE "${SKYOS_PDFIUM_ZIP}")
endif()
if(NOT EXISTS "${SKYOS_PDFIUM_ROOT}/build/native/lib/win-x64/pdfium.dll.lib" OR
   NOT EXISTS "${SKYOS_PDFIUM_ROOT}/runtimes/win-x64/native/pdfium.dll")
    message(FATAL_ERROR "The pinned PDFium package does not contain its expected x64 files.")
endif()

add_commonlibsse_plugin(SkyOS
    NAME SkyOS
    AUTHOR "SkyOS"
    VERSION ${PROJECT_VERSION}
    SOURCES
        src/main.cpp
        src/documents.cpp
        src/skyview_modules.cpp
        src/sky_apps.cpp
        src/skynet_bridge.cpp
)

target_include_directories(SkyOS PRIVATE
    "${CMAKE_CURRENT_SOURCE_DIR}/src"
    "${CMAKE_CURRENT_SOURCE_DIR}/include"
    "${CMAKE_CURRENT_SOURCE_DIR}/include/bridges"
    "${SKYOS_PDFIUM_ROOT}/build/native/include"
)
target_precompile_headers(SkyOS PRIVATE src/pch.h)
target_compile_features(SkyOS PRIVATE cxx_std_23)
target_compile_definitions(SkyOS PRIVATE WIN32_LEAN_AND_MEAN NOMINMAX)
target_link_libraries(SkyOS PRIVATE
    ${_skyos_bridge_libraries}
    Pdh Psapi Advapi32 Shell32 Dbghelp Windowscodecs Ole32
    "${SKYOS_PDFIUM_ROOT}/build/native/lib/win-x64/pdfium.dll.lib"
)

if(MSVC)
    # Preserve the independently installable app-module layout and allow the
    # core to load when some optional modules are absent.
    target_link_libraries(SkyOS PRIVATE delayimp)
    target_link_options(SkyOS PRIVATE "/DELAYLOAD:pdfium.dll")
    foreach(_module IN LISTS _skyos_bridge_modules)
        target_link_options(SkyOS PRIVATE "/DELAYLOAD:${_module}.dll")
    endforeach()
endif()

# This sample is shipped in the optional Starter Kit, not in the normal build.
add_commonlibsse_plugin(SkyOSStarterKitExample
    NAME "SkyOS Starter Kit Example"
    AUTHOR "SkyOS"
    VERSION 1.0.0
    SOURCES src/starterkit_example.cpp
)
set_target_properties(SkyOSStarterKitExample PROPERTIES EXCLUDE_FROM_ALL TRUE)
target_include_directories(SkyOSStarterKitExample PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}/src")
target_compile_features(SkyOSStarterKitExample PRIVATE cxx_std_23)
target_compile_definitions(SkyOSStarterKitExample PRIVATE WIN32_LEAN_AND_MEAN NOMINMAX)
target_precompile_headers(SkyOSStarterKitExample PRIVATE src/pch.h)

install(TARGETS SkyOS RUNTIME DESTINATION "Data/SKSE/Plugins" COMPONENT SkyOS)
install(FILES "${SKYOS_PDFIUM_ROOT}/runtimes/win-x64/native/pdfium.dll"
    DESTINATION "Data/SKSE/Plugins" COMPONENT SkyOS)
install(FILES
    "${SKYOS_PDFIUM_ROOT}/bblanchon.PDFium.Win32.nuspec"
    "${SKYOS_PDFIUM_ROOT}/README.md"
    DESTINATION "Data/SKSE/Plugins/SkyOS/ThirdParty/PDFium" COMPONENT SkyOS)

# The shared shell owns SkyOS, SkyViewer, and SkyDocuments views. Module-owned
# notice overlays and the embedded SkyCounter page are installed by their apps.
install(DIRECTORY data/PrismaUI/views/SkyOS
    DESTINATION "Data/PrismaUI/views" COMPONENT SkyOS
    PATTERN "pdfjs" EXCLUDE
    PATTERN "SkyAchievements" EXCLUDE
    PATTERN "SkyMissions" EXCLUDE
    PATTERN "SkyCounter" EXCLUDE)
install(DIRECTORY data/PrismaUI/views/SkyNet
    DESTINATION "Data/PrismaUI/views" COMPONENT SkyOS)
install(DIRECTORY data/SKSE/Plugins/SkyOS/Mods/SkyViewer/SkyOS
    DESTINATION "Data/SKSE/Plugins/SkyOS/Mods/SkyViewer" COMPONENT SkyOS)
install(DIRECTORY data/SKSE/Plugins/SkyOS/Mods/SkyViewer/SkyDocuments
    DESTINATION "Data/SKSE/Plugins/SkyOS/Mods/SkyViewer" COMPONENT SkyOS)
install(FILES
    data/SKSE/Plugins/SkyOS/Mods/SkyViewer/logo.png
    data/SKSE/Plugins/SkyOS/Mods/SkyViewer/banner.jpg
    DESTINATION "Data/SKSE/Plugins/SkyOS/Mods/SkyViewer" COMPONENT SkyOS)
install(DIRECTORY data/SKSE/Plugins/SkyOS/Mods/SkyOS
    DESTINATION "Data/SKSE/Plugins/SkyOS/Mods" COMPONENT SkyOS)
install(DIRECTORY data/SKSE/Plugins/SkyOS/Mods/SkyNet
    DESTINATION "Data/SKSE/Plugins/SkyOS/Mods" COMPONENT SkyOS)
install(FILES data/SKSE/Plugins/SkyOS/requirements.json
    DESTINATION "Data/SKSE/Plugins/SkyOS" COMPONENT SkyOS)

install(TARGETS SkyOSStarterKitExample RUNTIME DESTINATION "Data/SKSE/Plugins" COMPONENT SkyOSStarterKit)
install(DIRECTORY data/SkyOSModderStarterKit/SKSE/Plugins/SkyOS/Mods/SkyViewer/SkyOSStarterKit
    DESTINATION "Data/SKSE/Plugins/SkyOS/Mods/SkyViewer" COMPONENT SkyOSStarterKit)
install(FILES
    src/starterkit_example.cpp
    src/SkyOSAPI.h
    DESTINATION "Data/SKSE/Plugins/SkyOS/Mods/SkyViewer/SkyOSStarterKit/NativeAppTemplate"
    COMPONENT SkyOSStarterKit)
install(FILES data/SkyOSModderStarterKit/SKSE/Plugins/SkyOS/Apps/SkyOSStarterKitExample/app.ini
    DESTINATION "Data/SKSE/Plugins/SkyOS/Apps/SkyOSStarterKitExample" COMPONENT SkyOSStarterKit)
install(FILES data/SkyOSAPIHeader/include/SkyOSAPI.h
    DESTINATION "Data/SKSE/Plugins/SkyOSAPIHeader/include" COMPONENT SkyOSStarterKit)
install(FILES data/SkyOSAPIHeader/README.md
    DESTINATION "Data/SKSE/Plugins/SkyOSAPIHeader" COMPONENT SkyOSStarterKit)
install(FILES "data/SkyOSAPIHeader/SkyDocuments/SkyOS API Guide.html"
    DESTINATION "Data/SKSE/Plugins/SkyOS/Mods/SkyOSAPIHeader/SkyDocuments" COMPONENT SkyOSStarterKit)
install(FILES
    data/SKSE/Plugins/SkyOS/Mods/SkyOS/logo.png
    data/SKSE/Plugins/SkyOS/Mods/SkyOS/banner.jpg
    DESTINATION "Data/SKSE/Plugins/SkyOS/Mods/SkyOSAPIHeader" COMPONENT SkyOSStarterKit)

set(CPACK_PACKAGE_NAME "SkyOS")
set(CPACK_PACKAGE_VENDOR "SkyOS")
set(CPACK_PACKAGE_VERSION "${PROJECT_VERSION}")
set(CPACK_ARCHIVE_COMPONENT_INSTALL ON)
set(CPACK_COMPONENTS_ALL SkyOS SkyOSStarterKit)
set(CPACK_ARCHIVE_SKYOS_FILE_NAME "SkyOS")
set(CPACK_ARCHIVE_SKYOSSTARTERKIT_FILE_NAME "SkyOSStarterKit")
set(CPACK_COMPONENT_SKYOS_DISPLAY_NAME "SkyOS Core")
set(CPACK_COMPONENT_SKYOSSTARTERKIT_DISPLAY_NAME "SkyOS Modder Starter Kit")
set(CPACK_COMPONENT_SKYOS_DESCRIPTION "SkyOS Core with built-in SkyViewer, SkyDocuments, and the PDF reader.")
set(CPACK_COMPONENT_SKYOSSTARTERKIT_DESCRIPTION "Internal and native app templates, API header, example plugin, and guides.")
set(CPACK_COMPONENT_SKYOSSTARTERKIT_DEPENDS SkyOS)
include(CPack)
