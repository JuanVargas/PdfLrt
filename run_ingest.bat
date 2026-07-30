@echo off
REM run_ingest.bat - Runs the PDF pre-processing pipeline in a local Docker container for PdfLrt on Windows

REM Prevent Git Bash/MSYS from auto-translating Linux-style container paths (like /app) into Windows host paths
set MSYS_NO_PATHCONV=1

echo 🐳 Building/Verifying the PdfLrt Ingestion Docker Image...
docker build -t pdflrt-ingest -f Dockerfile .
if %errorlevel% neq 0 (
    echo ❌ Docker build failed!
    exit /b %errorlevel%
)

REM Ensure the PdfDir and Host HuggingFace cache directories exist
if not exist PdfDir mkdir PdfDir
if not exist "%USERPROFILE%\.cache\huggingface" mkdir "%USERPROFILE%\.cache\huggingface"

echo 🚀 Running ingestion container...
REM -v "%cd%:/app" mounts the current project directory so the script can read PDFs and write knowledge_base.json
REM -v "%USERPROFILE%\.cache\huggingface:/root/.cache/huggingface" mounts the HuggingFace cache directory so model downloads are persisted on the host machine
docker run --rm ^
  -v "%cd%:/app" ^
  -v "%USERPROFILE%\.cache\huggingface:/root/.cache/huggingface" ^
  -w /app ^
  pdflrt-ingest

if %errorlevel% neq 0 (
    echo ❌ Docker run failed!
    exit /b %errorlevel%
)

echo ✅ PDF Pre-processing and embedding generation complete!
