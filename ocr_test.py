from pdf2image import convert_from_path
import pytesseract

pages = convert_from_path("sample_foreclosure.pdf", dpi=300)
for i, page in enumerate(pages):
    text = pytesseract.image_to_string(page)
    print(f"Page {i+1}:\n{text[:500]}")
