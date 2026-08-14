@echo off
REM run_ingest.bat - Runs the PDF pre-processing pipeline for PdfLrt on Windows

REM Prevent Git Bash/MSYS from auto-translating Linux-style container paths (like /app) into Windows host paths
set MSYS_NO_PATHCONV=1

REM Determine script directory
set "SCRIPT_DIR=%~dp0"
if "%SCRIPT_DIR:~-1%"=="\" set "SCRIPT_DIR=%SCRIPT_DIR:~0,-1%"

set "RAW_PDF_DIR=%~1"
set "RAW_OUTPUT_DIR=%~2"

REM If run interactively without arguments, prompt for inputs
if "%RAW_PDF_DIR%"=="" (
    echo =======================================================================
    echo 📂 PdfLrt Knowledge Base Ingestion Setup
    echo =======================================================================
    set /p "RAW_PDF_DIR=Enter path to PDF folder [default: .\PdfDir]: "
)

if "%RAW_PDF_DIR%"=="" set "RAW_PDF_DIR=.\PdfDir"

if "%RAW_OUTPUT_DIR%"=="" (
    if "%~1"=="" (
        set /p "RAW_OUTPUT_DIR=Enter output path for Knowledge Base [default: %RAW_PDF_DIR%]: "
    )
)

if "%RAW_OUTPUT_DIR%"=="" set "RAW_OUTPUT_DIR=%RAW_PDF_DIR%"

REM Normalize PDF_DIR: convert slashes and handle drive-relative paths (\Users... or /Users...)
set "NORM_PDF_DIR=%RAW_PDF_DIR:/=\%"
if "%NORM_PDF_DIR:~0,1%"=="\" (
    if not "%NORM_PDF_DIR:~1,1%"=="\" (
        set "NORM_PDF_DIR=%SystemDrive%%NORM_PDF_DIR%"
    )
)
for %%I in ("%NORM_PDF_DIR%") do set "ABS_PDF_DIR=%%~fI"

REM Normalize OUTPUT_DIR: convert slashes and handle drive-relative paths
set "NORM_OUTPUT_DIR=%RAW_OUTPUT_DIR:/=\%"
if "%NORM_OUTPUT_DIR:~0,1%"=="\" (
    if not "%NORM_OUTPUT_DIR:~1,1%"=="\" (
        set "NORM_OUTPUT_DIR=%SystemDrive%%NORM_OUTPUT_DIR%"
    )
)
for %%I in ("%NORM_OUTPUT_DIR%") do set "ABS_OUTPUT_DIR=%%~fI"

echo 📂 PDF Input Directory: "%ABS_PDF_DIR%"
echo 📂 KB Output Directory: "%ABS_OUTPUT_DIR%"

if not exist "%ABS_PDF_DIR%" mkdir "%ABS_PDF_DIR%"
if not exist "%ABS_OUTPUT_DIR%" mkdir "%ABS_OUTPUT_DIR%"
if not exist "%USERPROFILE%\.cache\huggingface" mkdir "%USERPROFILE%\.cache\huggingface"

REM Check if Docker Desktop daemon is actually running
docker info >nul 2>&1
if %errorlevel% equ 0 (
    echo 🐳 Docker daemon active. Building/Verifying the PdfLrt Ingestion Docker Image...
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
    echo ⚠️ Docker Desktop daemon is not running or responsive. Checking for local Python...
    set "PYTHON_CMD="
    python --version >nul 2>&1 && set "PYTHON_CMD=python"
    if "%PYTHON_CMD%"=="" (
        py -3 --version >nul 2>&1 && set "PYTHON_CMD=py -3"
    )
    if "%PYTHON_CMD%"=="" (
        python3 --version >nul 2>&1 && set "PYTHON_CMD=python3"
    )
    
    if not "%PYTHON_CMD%"=="" (
        echo 🐍 Falling back to local Python ingestion execution...
        %PYTHON_CMD% "%SCRIPT_DIR%\build_knowledge_base.py" --pdf-dir "%ABS_PDF_DIR%" --output-dir "%ABS_OUTPUT_DIR%"
    ) else (
        echo ❌ Error: Docker daemon is not running AND Python is not available in PATH!
        echo 💡 Fix options:
        echo    1. Start Docker Desktop on Windows.
        echo    2. OR install Python and dependencies: pip install PyMuPDF sentence-transformers
        exit /b 1
    )
)

if %errorlevel% neq 0 (
    echo ❌ Ingestion failed!
    exit /b %errorlevel%
)

REM If ABS_OUTPUT_DIR is outside local project PdfDir, copy output files for local server compatibility
if /i not "%ABS_OUTPUT_DIR%"=="%SCRIPT_DIR%\PdfDir" (
    echo 🔄 Syncing generated KB to local project PdfDir...
    if not exist "%SCRIPT_DIR%\PdfDir\KB" mkdir "%SCRIPT_DIR%\PdfDir\KB"
    if exist "%ABS_OUTPUT_DIR%\KB\knowledge_base.json" (
        copy /y "%ABS_OUTPUT_DIR%\KB\knowledge_base.json" "%SCRIPT_DIR%\PdfDir\KB\knowledge_base.json" >nul
    )
    if exist "%ABS_OUTPUT_DIR%\KB\figures" (
        xcopy /s /y /i "%ABS_OUTPUT_DIR%\KB\figures" "%SCRIPT_DIR%\PdfDir\KB\figures" >nul
    )
)

echo ✅ PDF Pre-processing and embedding generation complete!
