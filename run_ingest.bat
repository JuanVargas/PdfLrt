@echo off
REM run_ingest.bat - Runs the PDF pre-processing pipeline for PdfLrt on Windows

REM Prevent Git Bash/MSYS from auto-translating Linux-style container paths (like /app) into Windows host paths
set MSYS_NO_PATHCONV=1

set PDF_DIR=%~1
if "%PDF_DIR%"=="" set PDF_DIR=.\PdfDir

set OUTPUT_DIR=%~2
if "%OUTPUT_DIR%"=="" set OUTPUT_DIR=%PDF_DIR%

echo 📂 PDF Input Directory: %PDF_DIR%
echo 📂 KB Output Directory: %OUTPUT_DIR%

if not exist "%PDF_DIR%" mkdir "%PDF_DIR%"
if not exist "%OUTPUT_DIR%" mkdir "%OUTPUT_DIR%"
if not exist "%USERPROFILE%\.cache\huggingface" mkdir "%USERPROFILE%\.cache\huggingface"

docker --version >nul 2>&1
if %errorlevel% equ 0 (
    echo 🐳 Building/Verifying the PdfLrt Ingestion Docker Image...
    docker build -t pdfplrt-ingest -f Dockerfile .
    if %errorlevel% neq 0 (
        echo ❌ Docker build failed!
        exit /b %errorlevel%
    )

    echo 🚀 Running ingestion container...
    docker run --rm ^
      -v "%cd%:/app" ^
      -v "%PDF_DIR%:/pdf_input" ^
      -v "%OUTPUT_DIR%:/output_dir" ^
      -v "%USERPROFILE%\.cache\huggingface:/root/.cache/huggingface" ^
      -w /app ^
      pdflrt-ingest python3 build_knowledge_base.py --pdf-dir /pdf_input --output-dir /output_dir
) else (
    echo ⚠️ Docker not detected. Running local Python build script...
    python build_knowledge_base.py --pdf-dir "%PDF_DIR%" --output-dir "%OUTPUT_DIR%"
)

if %errorlevel% neq 0 (
    echo ❌ Ingestion failed!
    exit /b %errorlevel%
)

echo ✅ PDF Pre-processing and embedding generation complete!

