@echo off
REM run_ingest.bat - Runs the PDF pre-processing pipeline for PdfLrt on Windows

REM Prevent Git Bash/MSYS from auto-translating Linux-style container paths (like /app) into Windows host paths
set MSYS_NO_PATHCONV=1

REM Determine script directory
set "SCRIPT_DIR=%~dp0"
if "%SCRIPT_DIR:~-1%"=="\" set "SCRIPT_DIR=%SCRIPT_DIR:~0,-1%"

set PDF_DIR=%~1
set OUTPUT_DIR=%~2

if "%PDF_DIR%"=="" (
    echo =======================================================================
    echo 📂 PdfLrt Knowledge Base Ingestion Setup
    echo =======================================================================
    set /p "PDF_DIR=Enter path to PDF folder [default: .\PdfDir]: "
)

if "%PDF_DIR%"=="" set PDF_DIR=.\PdfDir

if "%OUTPUT_DIR%"=="" (
    set /p "OUTPUT_DIR=Enter output path for Knowledge Base [default: %PDF_DIR%]: "
)

if "%OUTPUT_DIR%"=="" set OUTPUT_DIR=%PDF_DIR%

REM Resolve paths to full absolute paths for Docker mounting
for %%I in ("%PDF_DIR%") do set "ABS_PDF_DIR=%%~fI"
for %%I in ("%OUTPUT_DIR%") do set "ABS_OUTPUT_DIR=%%~fI"

echo 📂 PDF Input Directory: %ABS_PDF_DIR%
echo 📂 KB Output Directory: %ABS_OUTPUT_DIR%

if not exist "%ABS_PDF_DIR%" mkdir "%ABS_PDF_DIR%"
if not exist "%ABS_OUTPUT_DIR%" mkdir "%ABS_OUTPUT_DIR%"
if not exist "%USERPROFILE%\.cache\huggingface" mkdir "%USERPROFILE%\.cache\huggingface"

docker --version >nul 2>&1
if %errorlevel% equ 0 (
    echo 🐳 Building/Verifying the PdfLrt Ingestion Docker Image...
    docker build -t pdflrt-ingest -f "%SCRIPT_DIR%\Dockerfile" "%SCRIPT_DIR%"
    if %errorlevel% neq 0 (
        echo ❌ Docker build failed!
        exit /b %errorlevel%
    )

    echo 🚀 Running ingestion container...
    docker run --rm ^
      -v "%SCRIPT_DIR%:/app" ^
      -v "%ABS_PDF_DIR%:/pdf_input" ^
      -v "%ABS_OUTPUT_DIR%:/output_dir" ^
      -v "%USERPROFILE%\.cache\huggingface:/root/.cache/huggingface" ^
      -w /app ^
      pdflrt-ingest python3 build_knowledge_base.py --pdf-dir /pdf_input --output-dir /output_dir
) else (
    echo ⚠️ Docker not detected. Running local Python build script...
    python "%SCRIPT_DIR%\build_knowledge_base.py" --pdf-dir "%ABS_PDF_DIR%" --output-dir "%ABS_OUTPUT_DIR%"
)

if %errorlevel% neq 0 (
    echo ❌ Ingestion failed!
    exit /b %errorlevel%
)

echo ✅ PDF Pre-processing and embedding generation complete!


