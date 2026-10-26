#pragma once

#include <string>
#include <cstdint>
#include <functional>

namespace SkyOS {
    // Returns a JSON array of mods and their Documents files.
    [[nodiscard]] std::string GetDocumentsCatalog();

    // Loads a supported document as JSON. Paths are resolved only beneath the
    // configured SkyOS mod document root.
    [[nodiscard]] std::string OpenDocument(const std::string& documentId);

    using PdfOpenCallback = std::function<void(std::string)>;
    using PdfPageCallback = std::function<void(std::uint64_t, std::uint64_t, std::uint32_t, std::string)>;

    // PDFium is kept on one serialized worker because its public API is not
    // thread-safe. The callbacks run on that worker and must marshal UI work
    // back to Skyrim's task interface.
    [[nodiscard]] bool IsPdfDocument(const std::string& documentId);
    void OpenPdfDocumentAsync(std::string documentId, PdfOpenCallback callback);
    void RenderPdfPageAsync(std::uint64_t session, std::uint64_t requestId,
                            std::uint32_t pageNumber, PdfPageCallback callback);
    void ClosePdfDocumentAsync(std::uint64_t session);

    // Copies one catalogued document tree into a temporary physical directory
    // so Chromium's out-of-process renderer can follow local relative links.
    [[nodiscard]] std::wstring StageDocumentForExternalViewer(const std::string& documentId);
}
