@echo off
title GLR Pipeline Web Application
echo =======================================================
echo               GLR Pipeline Web Application
echo =======================================================
echo.

:: 1. Check Python Requirements
echo [SYSTEM] Verifying Python backend environment...
python -c "import uvicorn, fastapi, docx, fitz, pytesseract" >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Python requirements are not satisfied.
    echo Please run: pip install -r backend/requirements.txt
    pause
    exit /b 1
)

:: 2. Start FastAPI Backend in a new process window
echo [SYSTEM] Starting FastAPI Backend on port 8000...
start "GLR Backend (Python)" cmd /c "cd backend && python -m uvicorn main:app --host 127.0.0.1 --port 8000"

:: 3. Start Next.js Frontend in the current window
echo [SYSTEM] Starting Next.js React Frontend on port 3000...
echo [SYSTEM] Opening http://localhost:3000 in your default browser...
ping 127.0.0.1 -n 4 >nul
start http://localhost:3000

cd frontend && npm run dev
