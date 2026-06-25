"""PDF utilities for deed/foreclosure scraping."""

import io
import logging

import fitz  # PyMuPDF
import pdfplumber
try:
    import pytesseract
    from PIL import Image
    _OCR_AVAILABLE = True
except ImportError:
    pytesseract = None  # type: ignore[assignment]
    Image = None  # type: ignore[assignment]
    _OCR_AVAILABLE = False

log = logging.getLogger("pdf_utils")


def extract_text_from_pdf(pdf_bytes: bytes) -> str:
    """Try PyMuPDF → pdfplumber → OCR fallback."""
    # 1. PyMuPDF (fast text)
    try:
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        text = "\n".join(page.get_text("text") for page in doc)
        if text.strip():
            return text
    except Exception as e:
        log.debug("PyMuPDF failed: %s", e)

    # 2. pdfplumber (structured tables)
    try:
        with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
            text = "\n".join(page.extract_text() or "" for page in pdf.pages)
            if text.strip():
                return text
    except Exception as e:
        log.debug("pdfplumber failed: %s", e)

    # 3. OCR fallback (scanned images) — only if tesseract is available
    if _OCR_AVAILABLE:
        try:
            doc = fitz.open(stream=pdf_bytes, filetype="pdf")
            text_blocks = []
            for page in doc:
                pix = page.get_pixmap()
                img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
                text_blocks.append(pytesseract.image_to_string(img))
            return "\n".join(text_blocks)
        except Exception as e:
            log.warning("OCR failed: %s", e)
    else:
        log.debug("pytesseract not available — skipping OCR fallback")

    return ""
