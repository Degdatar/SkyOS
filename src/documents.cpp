#include "documents.h"

#include <Windows.h>

#include <delayimp.h>
#include <ocidl.h>
#include <objidl.h>
#include <pdfium/fpdfview.h>
#include <wincodec.h>
#include <wrl/client.h>

#include <algorithm>
#include <atomic>
#include <cmath>
#include <condition_variable>
#include <cstdint>
#include <cwctype>
#include <deque>
#include <exception>
#include <filesystem>
#include <fstream>
#include <functional>
#include <initializer_list>
#include <iterator>
#include <limits>
#include <mutex>
#include <string>
#include <string_view>
#include <thread>
#include <utility>
#include <vector>

namespace {
    HMODULE g_pdfiumModule{};
    DWORD g_pdfiumLoadError{};

    HMODULE LoadPdfiumBesidePlugin()
    {
        HMODULE pluginModule{};
        if (!GetModuleHandleExW(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS | GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,
                                reinterpret_cast<LPCWSTR>(&LoadPdfiumBesidePlugin), &pluginModule)) {
            g_pdfiumLoadError = GetLastError();
            return nullptr;
        }

        std::wstring pluginPath(32768, L'\0');
        const auto pathLength = GetModuleFileNameW(pluginModule, pluginPath.data(), static_cast<DWORD>(pluginPath.size()));
        if (pathLength == 0 || pathLength >= pluginPath.size()) {
            g_pdfiumLoadError = pathLength == 0 ? GetLastError() : ERROR_INSUFFICIENT_BUFFER;
            return nullptr;
        }
        pluginPath.resize(pathLength);
        const auto separator = pluginPath.find_last_of(L"\\/");
        if (separator == std::wstring::npos) {
            g_pdfiumLoadError = ERROR_BAD_PATHNAME;
            return nullptr;
        }
        pluginPath.resize(separator + 1);
        pluginPath += L"pdfium.dll";

        g_pdfiumModule = LoadLibraryExW(pluginPath.c_str(), nullptr, LOAD_WITH_ALTERED_SEARCH_PATH);
        if (!g_pdfiumModule) g_pdfiumLoadError = GetLastError();
        return g_pdfiumModule;
    }

    FARPROC WINAPI PdfiumDelayLoadHook(unsigned notification, PDelayLoadInfo info)
    {
        if (notification != dliNotePreLoadLibrary || !info || !info->szDll ||
            _stricmp(info->szDll, "pdfium.dll") != 0) {
            return nullptr;
        }
        if (!g_pdfiumModule) LoadPdfiumBesidePlugin();
        return reinterpret_cast<FARPROC>(g_pdfiumModule);
    }
}

extern "C" {
    const PfnDliHook __pfnDliNotifyHook2 = PdfiumDelayLoadHook;
}

namespace fs = std::filesystem;

namespace SkyOS {
    namespace {
        // PDF in the user's MO2 SkyOS package is ~11.9 MB. Leave room for real
        // mod manuals while keeping accidental multi-gigabyte files out of Invoke.
        constexpr std::uintmax_t kMaxDocumentBytes = 32 * 1024 * 1024;
        constexpr std::string_view kRoot = "Data/SKSE/Plugins/SkyOS/Mods";
        constexpr std::uintmax_t kMaxStagedTreeBytes = 128 * 1024 * 1024;
        std::atomic_uint64_t g_stageId{ 0 };

        std::string Base64(std::string_view input)
        {
            constexpr char alphabet[] =
                "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
            std::string encoded;
            encoded.reserve(((input.size() + 2) / 3) * 4);

            for (std::size_t offset = 0; offset < input.size(); offset += 3) {
                const auto remaining = input.size() - offset;
                const auto first = static_cast<unsigned char>(input[offset]);
                const auto second = remaining > 1 ? static_cast<unsigned char>(input[offset + 1]) : 0;
                const auto third = remaining > 2 ? static_cast<unsigned char>(input[offset + 2]) : 0;
                const auto block = (static_cast<std::uint32_t>(first) << 16) |
                    (static_cast<std::uint32_t>(second) << 8) | static_cast<std::uint32_t>(third);

                encoded += alphabet[(block >> 18) & 0x3f];
                encoded += alphabet[(block >> 12) & 0x3f];
                encoded += remaining > 1 ? alphabet[(block >> 6) & 0x3f] : '=';
                encoded += remaining > 2 ? alphabet[block & 0x3f] : '=';
            }
            return encoded;
        }

        std::string JsonEscape(std::string_view input)
        {
            std::string result;
            result.reserve(input.size() + 8);
            for (const unsigned char ch : input) {
                switch (ch) {
                case '"': result += "\\\""; break;
                case '\\': result += "\\\\"; break;
                case '\b': result += "\\b"; break;
                case '\f': result += "\\f"; break;
                case '\n': result += "\\n"; break;
                case '\r': result += "\\r"; break;
                case '\t': result += "\\t"; break;
                default:
                    if (ch < 0x20) {
                        constexpr char hex[] = "0123456789abcdef";
                        result += "\\u00";
                        result += hex[ch >> 4];
                        result += hex[ch & 0x0f];
                    } else {
                        result += static_cast<char>(ch);
                    }
                }
            }
            return result;
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

        std::string ReadModImageFileUrl(const fs::path& modRoot, const std::wstring& stem)
        {
            for (const auto& extension : { L".png", L".jpg", L".jpeg", L".webp" }) {
                const auto path = modRoot / (stem + extension);
                std::error_code error;
                if (!fs::is_regular_file(path, error)) continue;
                return FileUrl(path);
            }
            return {};
        }

        fs::path GameRoot()
        {
            std::wstring buffer(32768, L'\0');
            const auto length = GetModuleFileNameW(nullptr, buffer.data(), static_cast<DWORD>(buffer.size()));
            if (length == 0 || length >= buffer.size()) {
                return {};
            }
            buffer.resize(length);
            return fs::path(buffer).parent_path();
        }

        bool Supported(const fs::path& path)
        {
            auto extension = path.extension().wstring();
            std::transform(extension.begin(), extension.end(), extension.begin(), towlower);
            return extension == L".pdf" || extension == L".html" || extension == L".htm" ||
                   extension == L".txt" || extension == L".md";
        }

        std::string ToUtf8(const std::wstring& value)
        {
            if (value.empty()) return {};
            const int size = WideCharToMultiByte(CP_UTF8, 0, value.data(), static_cast<int>(value.size()), nullptr, 0, nullptr, nullptr);
            std::string result(static_cast<size_t>(size), '\0');
            WideCharToMultiByte(CP_UTF8, 0, value.data(), static_cast<int>(value.size()), result.data(), size, nullptr, nullptr);
            return result;
        }

        std::wstring FromUtf8(const std::string& value)
        {
            if (value.empty()) return {};
            const int size = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, value.data(), static_cast<int>(value.size()), nullptr, 0);
            if (size <= 0) return {};
            std::wstring result(static_cast<size_t>(size), L'\0');
            MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, value.data(), static_cast<int>(value.size()), result.data(), size);
            return result;
        }

        fs::path DocumentsRoot()
        {
            const auto gameRoot = GameRoot();
            if (gameRoot.empty()) return {};
            return gameRoot / fs::path(kRoot);
        }

        std::string MakeId(const fs::path& relative)
        {
            return ToUtf8(relative.generic_wstring());
        }

        bool ResolveDocument(const std::string& id, fs::path& output)
        {
            const auto root = DocumentsRoot();
            if (root.empty() || id.empty()) return false;
            const auto decoded = FromUtf8(id);
            if (decoded.empty()) return false;
            const auto relative = fs::path(decoded);
            if (relative.is_absolute()) return false;
            const auto candidate = (root / relative).lexically_normal();
            const auto normalizedRoot = root.lexically_normal();
            const auto candidateText = candidate.native();
            const auto rootText = normalizedRoot.native() + L"\\";
            if (candidateText.size() < rootText.size() ||
                _wcsnicmp(candidateText.c_str(), rootText.c_str(), rootText.size()) != 0) return false;
            output = candidate;
            return true;
        }

        std::uint64_t NextPdfSession()
        {
            static std::atomic_uint64_t next{ 0 };
            auto value = next.fetch_add(1, std::memory_order_relaxed) + 1;
            if (value == 0) value = next.fetch_add(1, std::memory_order_relaxed) + 1;
            return value;
        }

        std::string PdfiumOpenError()
        {
            switch (FPDF_GetLastError()) {
            case FPDF_ERR_PASSWORD:
                return "This PDF is password protected.";
            case FPDF_ERR_SECURITY:
                return "PDFium could not open this PDF because of its security settings.";
            case FPDF_ERR_PAGE:
                return "This PDF contains a page that PDFium could not load.";
            default:
                return "PDFium could not open this PDF. It may be damaged or use an unsupported feature.";
            }
        }

        bool EncodeBitmapAsPng(FPDF_BITMAP bitmap, std::string& output)
        {
            using Microsoft::WRL::ComPtr;
            const int width = FPDFBitmap_GetWidth(bitmap);
            const int height = FPDFBitmap_GetHeight(bitmap);
            const int stride = FPDFBitmap_GetStride(bitmap);
            auto* pixels = static_cast<BYTE*>(FPDFBitmap_GetBuffer(bitmap));
            if (width <= 0 || height <= 0 || stride <= 0 || !pixels) return false;

            const std::uint64_t byteCount64 = static_cast<std::uint64_t>(stride) * static_cast<std::uint64_t>(height);
            if (byteCount64 > std::numeric_limits<UINT>::max()) return false;

            ComPtr<IWICImagingFactory> factory;
            if (FAILED(CoCreateInstance(CLSID_WICImagingFactory, nullptr, CLSCTX_INPROC_SERVER,
                                        IID_PPV_ARGS(&factory)))) return false;
            ComPtr<IStream> stream;
            if (FAILED(CreateStreamOnHGlobal(nullptr, TRUE, &stream))) return false;

            ComPtr<IWICBitmapEncoder> encoder;
            if (FAILED(factory->CreateEncoder(GUID_ContainerFormatPng, nullptr, &encoder)) ||
                FAILED(encoder->Initialize(stream.Get(), WICBitmapEncoderNoCache))) return false;
            ComPtr<IWICBitmapFrameEncode> frame;
            ComPtr<IPropertyBag2> properties;
            if (FAILED(encoder->CreateNewFrame(&frame, &properties)) ||
                FAILED(frame->Initialize(properties.Get())) ||
                FAILED(frame->SetSize(static_cast<UINT>(width), static_cast<UINT>(height)))) return false;

            WICPixelFormatGUID pixelFormat = GUID_WICPixelFormat32bppBGRA;
            if (FAILED(frame->SetPixelFormat(&pixelFormat)) || !IsEqualGUID(pixelFormat, GUID_WICPixelFormat32bppBGRA)) return false;
            if (FAILED(frame->WritePixels(static_cast<UINT>(height), static_cast<UINT>(stride),
                                          static_cast<UINT>(byteCount64), pixels)) ||
                FAILED(frame->Commit()) || FAILED(encoder->Commit())) return false;

            HGLOBAL memory = nullptr;
            if (FAILED(GetHGlobalFromStream(stream.Get(), &memory)) || !memory) return false;
            const auto pngSize = GlobalSize(memory);
            auto* pngBytes = static_cast<const char*>(GlobalLock(memory));
            if (!pngBytes || pngSize == 0) {
                if (pngBytes) GlobalUnlock(memory);
                return false;
            }
            output = Base64(std::string_view(pngBytes, pngSize));
            GlobalUnlock(memory);
            return !output.empty();
        }

        class PdfRenderer final
        {
        public:
            PdfRenderer() : worker_([this] { Run(); }) {}

            ~PdfRenderer()
            {
                {
                    std::lock_guard lock(mutex_);
                    stopping_ = true;
                }
                wake_.notify_one();
                if (worker_.joinable()) worker_.join();
            }

            void Open(std::string documentId, PdfOpenCallback callback)
            {
                Enqueue([this, documentId = std::move(documentId), callback = std::move(callback)]() mutable {
                    CloseActiveDocument();
                    if (!pdfiumReady_) {
                        if (callback) {
                            callback("{\"error\":\"PDFium could not be loaded beside SkyOS.dll (Windows error " +
                                     std::to_string(g_pdfiumLoadError) +
                                     "). Check that pdfium.dll is in the same SKSE\\\\Plugins folder.\"}");
                        }
                        return;
                    }
                    fs::path path;
                    if (!ResolveDocument(documentId, path)) {
                        if (callback) callback("{\"error\":\"Invalid document path\"}");
                        return;
                    }
                    std::error_code error;
                    if (!fs::is_regular_file(path, error) || _wcsicmp(path.extension().c_str(), L".pdf") != 0) {
                        if (callback) callback("{\"error\":\"PDF not found\"}");
                        return;
                    }
                    const auto size = fs::file_size(path, error);
                    if (error || size == 0 || size > kMaxDocumentBytes || size > static_cast<std::uintmax_t>(std::numeric_limits<int>::max())) {
                        if (callback) callback("{\"error\":\"PDF is empty or exceeds the 32 MiB reader limit\"}");
                        return;
                    }

                    std::ifstream input(path, std::ios::binary);
                    if (!input) {
                        if (callback) callback("{\"error\":\"Could not read PDF\"}");
                        return;
                    }
                    std::vector<char> bytes(std::istreambuf_iterator<char>(input), {});
                    if (bytes.size() != size) {
                        if (callback) callback("{\"error\":\"Could not read the complete PDF\"}");
                        return;
                    }

                    FPDF_DOCUMENT document = FPDF_LoadMemDocument(bytes.data(), static_cast<int>(bytes.size()), nullptr);
                    if (!document) {
                        if (callback) callback("{\"error\":\"" + JsonEscape(PdfiumOpenError()) + "\"}");
                        return;
                    }
                    const int pageCount = FPDF_GetPageCount(document);
                    if (pageCount <= 0) {
                        FPDF_CloseDocument(document);
                        if (callback) callback("{\"error\":\"This PDF does not contain any readable pages.\"}");
                        return;
                    }

                    activeDocument_ = document;
                    activeBytes_ = std::move(bytes);
                    activeSession_ = NextPdfSession();
                    const auto name = ToUtf8(path.filename().wstring());
                    if (callback) {
                        callback("{\"name\":\"" + JsonEscape(name) + "\",\"type\":\"pdf-native\",\"session\":" +
                                 std::to_string(activeSession_) + ",\"pages\":" + std::to_string(pageCount) + "}");
                    }
                });
            }

            void Render(std::uint64_t session, std::uint64_t requestId, std::uint32_t pageNumber, PdfPageCallback callback)
            {
                Enqueue([this, session, requestId, pageNumber, callback = std::move(callback)]() mutable {
                    auto reply = [&](std::string json) {
                        if (callback) callback(session, requestId, pageNumber, std::move(json));
                    };
                    if (!activeDocument_ || session == 0 || session != activeSession_) {
                        reply("{\"error\":\"This PDF is no longer open. Reopen it and try again.\"}");
                        return;
                    }
                    const int pageCount = FPDF_GetPageCount(activeDocument_);
                    if (pageNumber == 0 || pageNumber > static_cast<std::uint32_t>(pageCount)) {
                        reply("{\"error\":\"The requested PDF page is out of range.\"}");
                        return;
                    }

                    FPDF_PAGE page = FPDF_LoadPage(activeDocument_, static_cast<int>(pageNumber - 1));
                    if (!page) {
                        reply("{\"error\":\"PDFium could not load this page.\"}");
                        return;
                    }
                    const double pageWidth = FPDF_GetPageWidthF(page);
                    const double pageHeight = FPDF_GetPageHeightF(page);
                    if (!std::isfinite(pageWidth) || !std::isfinite(pageHeight) || pageWidth <= 0 || pageHeight <= 0) {
                        FPDF_ClosePage(page);
                        reply("{\"error\":\"This PDF page has invalid dimensions.\"}");
                        return;
                    }

                    constexpr double kTargetWidth = 1800.0;
                    constexpr double kMaximumDimension = 8192.0;
                    constexpr double kMaximumPixels = 12.0 * 1024.0 * 1024.0;
                    double scale = kTargetWidth / pageWidth;
                    scale = std::min(scale, kMaximumDimension / pageWidth);
                    scale = std::min(scale, kMaximumDimension / pageHeight);
                    scale = std::min(scale, std::sqrt(kMaximumPixels / (pageWidth * pageHeight)));
                    const int width = std::max(1, static_cast<int>(std::ceil(pageWidth * scale)));
                    const int height = std::max(1, static_cast<int>(std::ceil(pageHeight * scale)));
                    if (static_cast<std::uint64_t>(width) * static_cast<std::uint64_t>(height) > 12u * 1024u * 1024u) {
                        FPDF_ClosePage(page);
                        reply("{\"error\":\"This PDF page is too large to render safely.\"}");
                        return;
                    }

                    FPDF_BITMAP bitmap = FPDFBitmap_Create(width, height, 1);
                    if (!bitmap) {
                        FPDF_ClosePage(page);
                        reply("{\"error\":\"PDFium could not allocate the page image.\"}");
                        return;
                    }
                    FPDFBitmap_FillRect(bitmap, 0, 0, width, height, 0xFFFFFFFF);
                    FPDF_RenderPageBitmap(bitmap, page, 0, 0, width, height, 0,
                                          FPDF_ANNOT | FPDF_LCD_TEXT | FPDF_NO_NATIVETEXT);
                    std::string pngBase64;
                    const bool encoded = EncodeBitmapAsPng(bitmap, pngBase64);
                    FPDFBitmap_Destroy(bitmap);
                    FPDF_ClosePage(page);
                    if (!encoded) {
                        reply("{\"error\":\"Could not encode the rendered PDF page image.\"}");
                        return;
                    }
                    reply("{\"width\":" + std::to_string(width) + ",\"height\":" + std::to_string(height) +
                          ",\"image\":\"data:image/png;base64," + pngBase64 + "\"}");
                });
            }

            void Close(std::uint64_t session)
            {
                Enqueue([this, session] {
                    if (session == activeSession_) CloseActiveDocument();
                });
            }

        private:
            void Enqueue(std::function<void()> job)
            {
                {
                    std::lock_guard lock(mutex_);
                    if (stopping_) return;
                    jobs_.push_back(std::move(job));
                }
                wake_.notify_one();
            }

            void CloseActiveDocument()
            {
                if (activeDocument_) FPDF_CloseDocument(activeDocument_);
                activeDocument_ = nullptr;
                activeSession_ = 0;
                activeBytes_.clear();
            }

            void Run()
            {
                const HRESULT comResult = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
                if (LoadPdfiumBesidePlugin()) {
                    FPDF_InitLibrary();
                    pdfiumReady_ = true;
                    SKSE::log::info("Loaded PDFium from the SkyOS plugin directory");
                } else {
                    SKSE::log::error("Could not load pdfium.dll beside SkyOS.dll (Windows error {})", g_pdfiumLoadError);
                }
                for (;;) {
                    std::function<void()> job;
                    {
                        std::unique_lock lock(mutex_);
                        wake_.wait(lock, [this] { return stopping_ || !jobs_.empty(); });
                        if (jobs_.empty() && stopping_) break;
                        job = std::move(jobs_.front());
                        jobs_.pop_front();
                    }
                    try {
                        job();
                    } catch (const std::exception& exception) {
                        SKSE::log::error("PDFium worker operation failed: {}", exception.what());
                    } catch (...) {
                        SKSE::log::error("PDFium worker operation failed with an unknown exception");
                    }
                }
                CloseActiveDocument();
                if (pdfiumReady_) FPDF_DestroyLibrary();
                if (SUCCEEDED(comResult)) CoUninitialize();
            }

            std::mutex mutex_;
            std::condition_variable wake_;
            std::deque<std::function<void()>> jobs_;
            bool stopping_{};
            std::thread worker_;
            bool pdfiumReady_{};
            FPDF_DOCUMENT activeDocument_{};
            std::vector<char> activeBytes_;
            std::uint64_t activeSession_{};
        };

        PdfRenderer& Renderer()
        {
            static PdfRenderer renderer;
            return renderer;
        }
    }

    std::string GetDocumentsCatalog()
    {
        const auto root = DocumentsRoot();
        std::error_code error;
        if (!fs::is_directory(root, error)) return "[]";

        std::vector<std::string> entries;
        for (fs::directory_iterator modIt(root, fs::directory_options::skip_permission_denied, error), end;
             modIt != end; modIt.increment(error)) {
            if (error) { error.clear(); continue; }
            if (!modIt->is_directory(error)) continue;
            const auto docs = modIt->path() / L"SkyDocuments";
            if (!fs::is_directory(docs, error)) { error.clear(); continue; }
            const auto modName = modIt->path().filename().wstring();
            const auto modLogo = ReadModImageFileUrl(modIt->path(), L"logo");
            const auto modBanner = ReadModImageFileUrl(modIt->path(), L"banner");
            if (!modLogo.empty() || !modBanner.empty()) {
                auto metadata = "{\"id\":\"\",\"mod\":\"" + JsonEscape(ToUtf8(modName)) +
                    "\",\"name\":\"\",\"extension\":\"\",\"size\":0,\"placeholder\":true";
                if (!modLogo.empty()) metadata += ",\"logo\":\"" + modLogo + "\"";
                if (!modBanner.empty()) metadata += ",\"banner\":\"" + modBanner + "\"";
                metadata += "}";
                entries.push_back(std::move(metadata));
            }
            for (fs::recursive_directory_iterator fileIt(docs, fs::directory_options::skip_permission_denied, error), fileEnd;
                 fileIt != fileEnd; fileIt.increment(error)) {
                if (error) { error.clear(); continue; }
                if (!fileIt->is_regular_file(error) || !Supported(fileIt->path())) continue;
                if (_wcsicmp(modName.c_str(), L"SkyOS") == 0) {
                    const auto filename = fileIt->path().filename().wstring();
                    if (_wcsicmp(filename.c_str(), L"SkyOS Feature Guide.html") == 0 ||
                        _wcsicmp(filename.c_str(), L"Modder Integration Guide.html") == 0 ||
                        _wcsicmp(filename.c_str(), L"Requirements and Compatibility.html") == 0) continue;
                }
                const auto size = fileIt->file_size(error);
                if (error || size > kMaxDocumentBytes) { error.clear(); continue; }
                const auto relative = fileIt->path().lexically_relative(root);
                if (relative.empty() || relative.is_absolute()) continue;
                const auto id = MakeId(relative);
                const auto name = ToUtf8(fileIt->path().filename().wstring());
                const auto ext = ToUtf8(fileIt->path().extension().wstring());
                const auto mod = ToUtf8(modName);
                auto entry = "{\"id\":\"" + JsonEscape(id) + "\",\"mod\":\"" + JsonEscape(mod) +
                    "\",\"name\":\"" + JsonEscape(name) + "\",\"extension\":\"" +
                    JsonEscape(ext) + "\",\"size\":" + std::to_string(size);
                entry += "}";
                entries.push_back(std::move(entry));
            }
        }
        std::sort(entries.begin(), entries.end());
        std::string result = "[";
        for (size_t i = 0; i < entries.size(); ++i) {
            if (i) result += ',';
            result += entries[i];
        }
        return result + "]";
    }

    std::string OpenDocument(const std::string& documentId)
    {
        fs::path path;
        if (!ResolveDocument(documentId, path)) return "{\"error\":\"Invalid document path\"}";
        std::error_code error;
        if (!fs::is_regular_file(path, error) || !Supported(path)) return "{\"error\":\"Document not found\"}";
        const auto size = fs::file_size(path, error);
        if (error || size > kMaxDocumentBytes) return "{\"error\":\"Document exceeds the 32 MiB preview limit\"}";

        const auto extension = path.extension().wstring();
        std::ifstream stream(path, std::ios::binary);
        if (!stream) return "{\"error\":\"Could not read document\"}";
        std::string content((std::istreambuf_iterator<char>(stream)), {});
        const auto name = ToUtf8(path.filename().wstring());
        const std::string_view type = (_wcsicmp(extension.c_str(), L".pdf") == 0) ? "pdf" :
            ((_wcsicmp(extension.c_str(), L".html") == 0 || _wcsicmp(extension.c_str(), L".htm") == 0) ? "html" : "text");
        const auto body = type == "pdf" ? Base64(content) : JsonEscape(content);
        return "{\"name\":\"" + JsonEscape(name) + "\",\"type\":\"" + std::string(type) + "\",\"content\":\"" + body + "\"}";
    }

    bool IsPdfDocument(const std::string& documentId)
    {
        fs::path path;
        if (!ResolveDocument(documentId, path)) return false;
        std::error_code error;
        return fs::is_regular_file(path, error) && !error && _wcsicmp(path.extension().c_str(), L".pdf") == 0;
    }

    void OpenPdfDocumentAsync(std::string documentId, PdfOpenCallback callback)
    {
        Renderer().Open(std::move(documentId), std::move(callback));
    }

    void RenderPdfPageAsync(std::uint64_t session, std::uint64_t requestId,
                            std::uint32_t pageNumber, PdfPageCallback callback)
    {
        Renderer().Render(session, requestId, pageNumber, std::move(callback));
    }

    void ClosePdfDocumentAsync(std::uint64_t session)
    {
        Renderer().Close(session);
    }

    std::wstring StageDocumentForExternalViewer(const std::string& documentId)
    {
        fs::path source;
        if (!ResolveDocument(documentId, source)) return {};
        std::error_code error;
        if (!fs::is_regular_file(source, error) || !Supported(source)) return {};

        const auto gameRoot = GameRoot();
        if (gameRoot.empty()) return {};
        const auto modsRoot = (gameRoot / fs::path(kRoot)).lexically_normal();
        const auto relative = source.lexically_relative(modsRoot);
        if (relative.empty() || relative.is_absolute() || *relative.begin() == L"..") return {};
        const auto sourceDocumentsRoot = gameRoot / fs::path(kRoot) / *relative.begin() / L"SkyDocuments";
        const auto relativeDocument = source.lexically_relative(sourceDocumentsRoot.lexically_normal());
        if (relativeDocument.empty() || relativeDocument.is_absolute() || *relativeDocument.begin() == L"..") return {};
        wchar_t tempBuffer[MAX_PATH]{};
        const auto tempLength = GetTempPathW(static_cast<DWORD>(std::size(tempBuffer)), tempBuffer);
        if (!tempLength || tempLength >= std::size(tempBuffer)) return {};

        const auto unique = std::to_wstring(GetCurrentProcessId()) + L"_" +
            std::to_wstring(g_stageId.fetch_add(1, std::memory_order_relaxed));
        const auto targetRoot = fs::path(tempBuffer) / L"SkyOS" / L"SkyNetDocuments" / unique;
        const auto targetModRoot = targetRoot / *relative.begin();
        const auto targetDocumentsRoot = targetModRoot / L"SkyDocuments";
        fs::create_directories(targetRoot, error);
        if (error) return {};

        // A PDF is self-contained. Copy only the selected file so unrelated
        // large files elsewhere in the mod's Documents folder cannot block it.
        if (_wcsicmp(source.extension().c_str(), L".pdf") == 0) {
            const auto stagedPdf = targetDocumentsRoot / relativeDocument;
            fs::create_directories(stagedPdf.parent_path(), error);
            if (!error) fs::copy_file(source, stagedPdf, fs::copy_options::overwrite_existing, error);
            if (error) {
                fs::remove_all(targetRoot, error);
                return {};
            }
            return stagedPdf.wstring();
        }

        std::uintmax_t copiedBytes = 0;
        for (fs::recursive_directory_iterator it(sourceDocumentsRoot, fs::directory_options::skip_permission_denied, error), end;
             it != end; it.increment(error)) {
            if (error) { error.clear(); continue; }
            if (it->is_symlink(error)) { error.clear(); if (it->is_directory(error)) it.disable_recursion_pending(); continue; }
            if (!it->is_regular_file(error)) { error.clear(); continue; }
            const auto size = it->file_size(error);
            if (error || size > kMaxStagedTreeBytes - copiedBytes) {
                fs::remove_all(targetRoot, error);
                return {};
            }
            copiedBytes += size;
            const auto relativeFile = it->path().lexically_relative(sourceDocumentsRoot.lexically_normal());
            if (relativeFile.empty() || relativeFile.is_absolute() || *relativeFile.begin() == L"..") {
                fs::remove_all(targetRoot, error);
                return {};
            }
            const auto target = targetDocumentsRoot / relativeFile;
            fs::create_directories(target.parent_path(), error);
            if (error) { fs::remove_all(targetRoot, error); return {}; }
            std::ifstream input(it->path(), std::ios::binary);
            std::ofstream output(target, std::ios::binary | std::ios::trunc);
            if (!input || !output) { fs::remove_all(targetRoot, error); return {}; }
            output << input.rdbuf();
            if (!output) { fs::remove_all(targetRoot, error); return {}; }
        }

        // SkyNet opens the HTML from a temporary directory. Copy the small
        // sibling brand assets referenced by the guide's ../logo and ../banner
        // URLs so they resolve just as they do from the installed mod folder.
        const auto sourceModRoot = sourceDocumentsRoot.parent_path();
        constexpr std::wstring_view assetNames[]{ L"logo", L"banner" };
        constexpr std::wstring_view imageExtensions[]{ L".png", L".jpg", L".jpeg", L".webp", L".svg" };
        for (const auto assetName : assetNames) {
            for (const auto extension : imageExtensions) {
                const auto asset = sourceModRoot / (std::wstring(assetName) + std::wstring(extension));
                if (!fs::is_regular_file(asset, error)) { error.clear(); continue; }
                const auto size = fs::file_size(asset, error);
                if (error || size > kMaxStagedTreeBytes - copiedBytes) {
                    fs::remove_all(targetRoot, error);
                    return {};
                }
                copiedBytes += size;
                fs::create_directories(targetModRoot, error);
                if (!error) fs::copy_file(asset, targetModRoot / asset.filename(), fs::copy_options::overwrite_existing, error);
                if (error) { fs::remove_all(targetRoot, error); return {}; }
            }
        }

        const auto staged = targetDocumentsRoot / relativeDocument;
        return fs::is_regular_file(staged, error) ? staged.wstring() : std::wstring{};
    }

}
