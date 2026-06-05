from fastapi import FastAPI, UploadFile, File, Form, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
import tempfile
import os
import json
from typing import List

# Import local processing utilities
from docx_utils import extract_placeholders_from_docx, fill_docx_template
from pdf_utils import extract_text_from_pdf
from llm_utils import extract_key_value_pairs

app = FastAPI(title="GLR Pipeline Automation API", version="1.0.0")

# Enable CORS for Next.js frontend (local development + optional deployed front-end URL)
frontend_url = os.getenv("FRONTEND_URL", "http://localhost:3000")
origins = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
]
if frontend_url and frontend_url not in origins:
    origins.append(frontend_url)

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def cleanup_file(path: str):
    """Safely removes a file if it exists."""
    try:
        if os.path.exists(path):
            os.remove(path)
    except Exception as e:
        print(f"Error cleaning up file {path}: {e}")

@app.get("/api/health")
async def health_check():
    """Verify that backend is up and running."""
    return {"status": "ok", "message": "GLR Pipeline API is running"}

@app.get("/api/config")
async def get_config():
    """
    Returns config metadata (e.g. which keys are configured on the server)
    without exposing the actual API keys themselves.
    """
    return {
        "geminiKeySet": bool(os.getenv("GEMINI_API_KEY")),
        "groqKeySet": bool(os.getenv("GROQ_API_KEY")),
        "openrouterKeySet": bool(os.getenv("OPENROUTER_API_KEY")),
    }

@app.post("/api/extract-placeholders")
async def extract_placeholders(template: UploadFile = File(...)):
    """
    Uploads a DOCX template, extracts all bracketed/curly placeholders,
    and returns them as a sorted list.
    """
    print(f"\n[BACKEND] Received placeholder extraction request")
    print(f"[BACKEND] Filename: {template.filename}")
    
    if not template.filename.endswith(".docx"):
        raise HTTPException(status_code=400, detail="Only .docx template files are supported.")
        
    temp_path = None
    try:
        contents = await template.read()
        print(f"[BACKEND] Read {len(contents)} bytes from file stream")
        
        with tempfile.NamedTemporaryFile(delete=False, suffix=".docx") as temp_file:
            temp_file.write(contents)
            temp_path = temp_file.name
            
        placeholders = extract_placeholders_from_docx(temp_path)
        print(f"[BACKEND] Extracted placeholders: {placeholders}")
        return {"placeholders": placeholders}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to extract placeholders: {str(e)}")
    finally:
        if temp_path:
            cleanup_file(temp_path)

@app.post("/api/extract-pdf-text")
async def extract_pdf_text(files: List[UploadFile] = File(...)):
    """
    Uploads multiple PDF files, extracts digital text and runs OCR fallback,
    and returns the concatenated text and any warnings.
    """
    all_text = ""
    all_warnings = []
    
    for upload_file in files:
        if not upload_file.filename.endswith(".pdf"):
            all_warnings.append(f"Skipped {upload_file.filename}: Not a PDF.")
            continue
            
        temp_path = None
        try:
            with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf") as temp_file:
                contents = await upload_file.read()
                temp_file.write(contents)
                temp_path = temp_file.name
                
            text, warnings = extract_text_from_pdf(temp_path)
            if warnings:
                all_warnings.extend([f"{upload_file.filename}: {w}" for w in warnings])
            if text:
                all_text += f"\n---\nFile: {upload_file.filename}\n{text}"
        except Exception as e:
            all_warnings.append(f"Failed to parse {upload_file.filename}: {str(e)}")
        finally:
            if temp_path:
                cleanup_file(temp_path)
                
    if not all_text.strip():
        raise HTTPException(status_code=400, detail="No text could be extracted from the uploaded files. Check file format or OCR setup.")
        
    return {"text": all_text.strip(), "warnings": all_warnings}

@app.post("/api/extract-data")
async def extract_data(
    text: str = Form(...),
    api_key: str = Form(...),
    required_fields: str = Form(...), # JSON array of string fields
    provider: str = Form("openrouter"),
    model: str = Form("openai/gpt-3.5-turbo")
):
    """
    Submits text to the selected LLM API (Gemini, Groq, OpenRouter)
    to extract key-value mapping associated with dynamic required fields.
    """
    try:
        fields = json.loads(required_fields)
        if not isinstance(fields, list):
            raise ValueError("required_fields must be a JSON array of strings.")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid required_fields parameter: {str(e)}")
        
    key_value_pairs, raw_response = extract_key_value_pairs(
        text, 
        api_key, 
        fields, 
        provider=provider, 
        model=model
    )
    
    if not key_value_pairs:
        return {
            "success": False,
            "error": raw_response or "LLM failed to extract key-value pairs.",
            "raw_response": raw_response
        }
        
    return {"success": True, "data": key_value_pairs}

@app.post("/api/fill-template")
async def fill_template_route(
    background_tasks: BackgroundTasks,
    template: UploadFile = File(...),
    data: str = Form(...) # JSON string containing placeholder mappings
):
    """
    Fills a DOCX template with the provided key-value data, compiles it,
    and streams the resulting DOCX file back to the browser.
    """
    if not template.filename.endswith(".docx"):
        raise HTTPException(status_code=400, detail="Only .docx template files are supported.")
        
    try:
        key_value_pairs = json.loads(data)
        if not isinstance(key_value_pairs, dict):
            raise ValueError("data must be a JSON object mapping keys to values.")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid data parameter: {str(e)}")
        
    temp_tmpl_path = None
    temp_out_path = None
    
    try:
        # Write uploaded template to temp file
        with tempfile.NamedTemporaryFile(delete=False, suffix=".docx") as temp_tmpl:
            contents = await template.read()
            temp_tmpl.write(contents)
            temp_tmpl_path = temp_tmpl.name
            
        # Create temp output file path
        with tempfile.NamedTemporaryFile(delete=False, suffix=".docx") as temp_out:
            temp_out_path = temp_out.name
            
        # Fill template
        success = fill_docx_template(temp_tmpl_path, key_value_pairs, temp_out_path)
        if not success:
            raise HTTPException(status_code=500, detail="Failed to compile filled template.")
            
        # Schedule deletion of both temp files after the response is completed
        background_tasks.add_task(cleanup_file, temp_tmpl_path)
        background_tasks.add_task(cleanup_file, temp_out_path)
        
        return FileResponse(
            temp_out_path, 
            filename="Completed_Insurance_Report.docx",
            media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        )
    except Exception as e:
        if temp_tmpl_path:
            cleanup_file(temp_tmpl_path)
        if temp_out_path:
            cleanup_file(temp_out_path)
        raise HTTPException(status_code=500, detail=f"Error compiling template: {str(e)}")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
