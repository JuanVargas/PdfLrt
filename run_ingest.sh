#!/bin/bash
# run_ingest.sh - Runs the PDF pre-processing pipeline in a local Docker container for PdfLrt

# Exit on any error
set -e

echo "🐳 Building/Verifying the PdfLrt Ingestion Docker Image..."
docker build -t pdflrt-ingest -f Dockerfile .

# Ensure the PdfDir and Host HuggingFace cache directories exist
mkdir -p PdfDir
mkdir -p "$HOME/.cache/huggingface"

echo "🚀 Running ingestion container..."
# -v "$(pwd):/app" mounts the current project directory so the script can read PDFs and write knowledge_base.json
# -v "$HOME/.cache/huggingface:/root/.cache/huggingface" mounts the HuggingFace cache directory so model downloads are persisted on the host machine
docker run --rm \
  -v "$(pwd):/app" \
  -v "$HOME/.cache/huggingface:/root/.cache/huggingface" \
  -w /app \
  pdflrt-ingest

echo "✅ PDF Pre-processing and embedding generation complete!"
