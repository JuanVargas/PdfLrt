#!/bin/bash
# run_ingest.sh - Runs the PDF pre-processing pipeline in a local Docker container or Python for PdfLrt

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

RAW_PDF_DIR="$1"
RAW_OUTPUT_DIR="$2"

if [ -z "$RAW_PDF_DIR" ]; then
    echo "========================================================================"
    echo "📂 PdfLrt Knowledge Base Ingestion Setup"
    echo "========================================================================"
    read -rp "Enter path to PDF folder [default: ./PdfDir]: " RAW_PDF_DIR
fi

RAW_PDF_DIR="${RAW_PDF_DIR:-./PdfDir}"

if [ -z "$RAW_OUTPUT_DIR" ]; then
    if [ -z "$1" ]; then
        read -rp "Enter output path for Knowledge Base [default: $RAW_PDF_DIR]: " RAW_OUTPUT_DIR
    fi
fi

RAW_OUTPUT_DIR="${RAW_OUTPUT_DIR:-$RAW_PDF_DIR}"

RAW_PDF_DIR="${RAW_PDF_DIR/#\~/$HOME}"
RAW_OUTPUT_DIR="${RAW_OUTPUT_DIR/#\~/$HOME}"

mkdir -p "$RAW_PDF_DIR"
mkdir -p "$RAW_OUTPUT_DIR"

ABS_PDF_DIR=$(cd "$RAW_PDF_DIR" && pwd)
ABS_OUTPUT_DIR=$(cd "$RAW_OUTPUT_DIR" && pwd)

echo "📂 PDF Input Directory: $ABS_PDF_DIR"
echo "📂 KB Output Directory: $ABS_OUTPUT_DIR"

mkdir -p "$HOME/.cache/huggingface"

if command -v docker &> /dev/null && docker info &> /dev/null; then
    echo "🐳 Building/Verifying the PdfLrt Ingestion Docker Image..."
    docker build -t pdflrt-ingest -f "$SCRIPT_DIR/Dockerfile" "$SCRIPT_DIR"

    echo "🚀 Running ingestion container..."
    docker run --rm \
      -v "$SCRIPT_DIR:/app" \
      -v "$ABS_PDF_DIR:/pdf_input" \
      -v "$ABS_OUTPUT_DIR:/output_dir" \
      -v "$HOME/.cache/huggingface:/root/.cache/huggingface" \
      -w /app \
      pdflrt-ingest python3 build_knowledge_base.py --pdf-dir /pdf_input --output-dir /output_dir
else
    echo "⚠️ Docker not detected or not running. Falling back to host python3 execution..."
    python3 "$SCRIPT_DIR/build_knowledge_base.py" --pdf-dir "$ABS_PDF_DIR" --output-dir "$ABS_OUTPUT_DIR"
fi

if [ "$ABS_OUTPUT_DIR" != "$SCRIPT_DIR/PdfDir" ]; then
    echo "🔄 Syncing generated KB to local project PdfDir..."
    mkdir -p "$SCRIPT_DIR/PdfDir/KB"
    if [ -f "$ABS_OUTPUT_DIR/KB/knowledge_base.json" ]; then
        cp "$ABS_OUTPUT_DIR/KB/knowledge_base.json" "$SCRIPT_DIR/PdfDir/KB/knowledge_base.json"
    fi
    if [ -d "$ABS_OUTPUT_DIR/KB/figures" ]; then
        mkdir -p "$SCRIPT_DIR/PdfDir/KB/figures"
        cp -r "$ABS_OUTPUT_DIR/KB/figures/"* "$SCRIPT_DIR/PdfDir/KB/figures/" 2>/dev/null || true
    fi
fi

echo "✅ PDF Pre-processing and embedding generation complete!"
