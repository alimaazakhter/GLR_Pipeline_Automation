import fitz  # PyMuPDF
import pytesseract
from PIL import Image
import io

def extract_text_from_pdf(file):
    """
    Extracts text from a PDF file-like object or file path.
    - Uses PyMuPDF (fitz) as the primary text extractor (faster and more accurate).
    - Falls back to OCR page-by-page using pytesseract and PyMuPDF pixmaps for scanned pages.
    Returns a tuple: (extracted_text, warnings_list)
    """
    text = ""
    warnings = []
    doc = None
    try:
        # Check if input is a Streamlit UploadedFile (file-like) or a string path
        if hasattr(file, "read"):
            file.seek(0)
            pdf_bytes = file.read()
            doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        else:
            doc = fitz.open(file)
            
        for i in range(len(doc)):
            page = doc.load_page(i)
            page_text = page.get_text() or ""
            
            if page_text.strip():
                text += page_text + "\n"
            else:
                # OCR fallback for image-only pages
                try:
                    pix = page.get_pixmap()
                    img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
                    ocr_text = pytesseract.image_to_string(img)
                    if ocr_text.strip():
                        text += ocr_text + "\n"
                    else:
                        warnings.append(f"No text extracted from page {i+1} (OCR returned empty).")
                except Exception as ocr_e:
                    warnings.append(f"OCR failed on page {i+1}: {ocr_e}")
    except Exception as e:
        warnings.append(f"Error extracting text from PDF: {e}")
        return "", warnings
    finally:
        if doc:
            doc.close()
            
    if not text.strip():
        warnings.append("No text could be extracted from the entire PDF.")
        
    return text.strip(), warnings
