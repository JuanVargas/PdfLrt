# Build Knowledge Base via Docker for PdfLrt

This setup builds a local Docker container to execute the ingestion and embedding generation script, avoiding the need to install Python dependencies on your host machine.

## Prerequisites
* Docker must be running on your system.

## Setup & Running

### macOS / Linux

1. **Make the script executable:**
   ```bash
   chmod +x run_ingest.sh
   ```

2. **Execute the ingestion:**
   ```bash
   ./run_ingest.sh
   ```

### Windows

1. **Execute the batch script from a command prompt (cmd.exe) or Git Bash:**
   ```cmd
   run_ingest.bat
   ```

   > [!NOTE]
   > When executing Docker commands from Git Bash or MSYS on Windows, container paths starting with a slash (like `/app` or `/root/.cache`) are automatically converted into Windows host paths (e.g. `C:\Program Files\Git\app`), which causes the build/run to fail since that path does not exist on the host. The `run_ingest.bat` script automatically disables this by setting `MSYS_NO_PATHCONV=1` for the duration of the script.

## What it does:
1. Builds a Docker image named `pdflrt-ingest` using the [Dockerfile](file:///home/juan/code/PdfLrt/Dockerfile).
2. Runs the container mounting the current directory to `/app` (so it can read `/PdfDir` and write `knowledge_base.json`).
3. **Model Caching (Important):** Mounts the host's Hugging Face cache folder (`~/.cache/huggingface` on macOS/Linux or `%USERPROFILE%\.cache\huggingface` on Windows) to the container's `/root/.cache/huggingface`. This ensures that the embedding model (`nomic-ai/nomic-embed-text-v1.5`) is cached on your host machine and won't need to be re-downloaded (approx. 500MB) on subsequent runs.
