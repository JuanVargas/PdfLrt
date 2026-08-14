# Build Knowledge Base via Docker for PdfLrt

This file describes the setup that builds a local Docker container to execute the ingestion and embedding generation script, 
avoiding the need to install Python dependencies on the host machine.

## Prerequisites

1. Docker must be running on the system.

2. A folder containing the PDF files to be ingested (defaults to `./PdfDir` if omitted).

## Setup & Running

### macOS / Linux

From the terminal console execute these commands:

1. **Make the script executable:**
   ```bash
   chmod +x run_ingest.sh
   ```

2. **Execute the ingestion:**
   ```bash
   ./run_ingest.sh [PATH_TO_PDF_DIR] [PATH_TO_OUTPUT_DIR]
   ```
   *If arguments are omitted, the script will prompt interactively for the PDF directory path (defaulting to `./PdfDir`).*

### Windows

1. **Execute the batch script from a command prompt (cmd.exe), PowerShell, or Git Bash:**
   ```cmd
   run_ingest.bat [PATH_TO_PDF_DIR] [PATH_TO_OUTPUT_DIR]
   ```
   *If arguments are omitted, the script will prompt interactively for the PDF directory path (defaulting to `.\PdfDir`).*

   > [!NOTE]
   > When executing Docker commands from Git Bash or MSYS on Windows, container paths starting with a slash (like `/app` or `/root/.cache`) are automatically converted into Windows host paths (e.g. `C:\Program Files\Git\app`), which causes the build/run to fail since that path does not exist on the host. The `run_ingest.bat` script automatically disables this by setting `MSYS_NO_PATHCONV=1` for the duration of the script.

## What it does:
1. Builds a Docker image named `pdflrt-ingest` using the [Dockerfile](file:///home/juan/code/PdfLrt/Dockerfile).

2. Mounts the `PdfLrt` code directory to `/app` (so the container accesses local scripts and models in `./models/nomic-ai/nomic-embed-text-v1.5`), the PDF input directory to `/pdf_input`, and the output directory to `/output_dir`.

3. **Model Caching (Important):** Checks for offline local embedding models first (`models/nomic-ai/nomic-embed-text-v1.5`). If internet connection is present and local model is missing, it mounts the host's Hugging Face cache folder (`~/.cache/huggingface` on macOS/Linux or `%USERPROFILE%\.cache\huggingface` on Windows) to `/root/.cache/huggingface`.

END of DOC
---