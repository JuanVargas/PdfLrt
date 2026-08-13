#!/bin/bash
# run_ingest.sh - Runs the PDF pre-processing pipeline in a local Docker container or Python for PdfLrt

set -e

RAW_PDF_DIR="${1:-./PdfDir}"
RAW_OUTPUT_DIR="${2:-$RAW_PDF_DIR}"

ABS_PDF_DIR=$(realpath -m "$RAW_PDF_DIR")
ABS_OUTPUT_DIR=$(realpath -m "$RAW_OUTPUT_DIR")

echo "📂 PDF Input Directory: $ABS_PDF_DIR"
echo "📂 KB Output Directory: $ABS_OUTPUT_DIR"

mkdir -p "$ABS_PDF_DIR"
mkdir -p "$ABS_OUTPUT_DIR"
mkdir -p "$HOME/.cache/huggingface"

if command -v docker &> /dev/null && docker info &> /dev/null; then
    echo "🐳 Building/Verifying the PdfLrt Ingestion Docker Image..."
    docker build -t pdflrt-ingest -f Dockerfile .

    echo "🚀 Running ingestion container..."
    docker run --rm \
      -v "$(pwd):/app" \
      -v "$ABS_PDF_DIR:/pdf_input" \
      -v "$ABS_OUTPUT_DIR:/output_dir" \
      -v "$HOME/.cache/huggingface:/root/.cache/huggingface" \
      -w /app \
      pdflrt-ingest python3 build_knowledge_base.py --pdf-dir /pdf_input --output-dir /output_dir
else
    echo "⚠️ Docker not detected or not running. Falling back to host python3 execution..."
    python3 build_knowledge_base.py --pdf-dir "$ABS_PDF_DIR" --output-dir "$ABS_OUTPUT_DIR"
fi

echo "✅ PDF Pre-processing and embedding generation complete!"

