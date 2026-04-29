import fitz
import pdfplumber
from paddleocr import PaddleOCR
import usaddress

class PDFExtractor:
    def __init__(self, file_path: str):
        self.file_path = file_path

    def extract(self):
        # Auto-detect digital vs scanned PDFs
        with fitz.open(self.file_path) as doc:
            if doc.is_recoverable:
                # Digital PDF
                with pdfplumber.open(self.file_path) as pdf:
                    text = ''
                    for page in pdf.pages:
                        text += page.extract_text()
                    addresses = usaddress.tag(text)
                    return addresses
            else:
                # Scanned PDF, use PaddleOCR as fallback
                ocr = PaddleOCR(lang='en')
                print("Using PaddleOCR for scanned PDF")
                # TODO: implement PaddleOCR extraction
                return None
