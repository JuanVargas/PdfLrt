#!/bin/bash
# create_offline_package.sh - Builds and packages all files for offline PdfLrt deployment

set -e

BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RELEASE_DIR="$BASE_DIR/pdflrt_offline_release"
ZIP_FILE="$BASE_DIR/pdflrt_offline_release.zip"

echo "========================================================================"
echo "📦 PdfLrt Offline Release Packaging Tool"
echo "========================================================================"

# Step 1: Clean previous packaging runs
if [ -d "$RELEASE_DIR" ]; then
    echo "🧹 Cleaning existing release directory..."
    rm -rf "$RELEASE_DIR"
fi
if [ -f "$ZIP_FILE" ]; then
    echo "🧹 Removing old zip file..."
    rm -f "$ZIP_FILE"
fi

mkdir -p "$RELEASE_DIR"
mkdir -p "$RELEASE_DIR/wasm"
mkdir -p "$RELEASE_DIR/models"
mkdir -p "$RELEASE_DIR/PdfDir"

# Step 2: Compile binaries for target operating systems
echo "🚀 Cross-compiling Go web server..."

if command -v go >/dev/null 2>&1; then
    echo "  -> Compiling for Windows (64-bit)..."
    GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -ldflags="-s -w" -o "$RELEASE_DIR/pdflrt.exe" "$BASE_DIR/pdflrt.go"

    echo "  -> Compiling for macOS (Apple Silicon)..."
    GOOS=darwin GOARCH=arm64 CGO_ENABLED=0 go build -ldflags="-s -w" -o "$RELEASE_DIR/pdflrt_mac_silicon" "$BASE_DIR/pdflrt.go"

    echo "  -> Compiling for macOS (Intel)..."
    GOOS=darwin GOARCH=amd64 CGO_ENABLED=0 go build -ldflags="-s -w" -o "$RELEASE_DIR/pdflrt_mac_intel" "$BASE_DIR/pdflrt.go"

    echo "  -> Compiling for Linux (64-bit)..."
    GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -ldflags="-s -w" -o "$RELEASE_DIR/pdflrt_linux" "$BASE_DIR/pdflrt.go"
    
    echo "✅ Go binaries cross-compiled successfully."
else
    echo "⚠️ Warning: 'go' command not found. Skipping Go binary compilation."
    echo "   You must compile the Go server manually and place the binary in the release folder."
fi

# Step 3: Copy static frontend assets & ingestion scripts
echo "📁 Copying frontend assets and ingestion files..."
cp "$BASE_DIR/index.html" "$RELEASE_DIR/"
cp "$BASE_DIR/app.js" "$RELEASE_DIR/"
cp "$BASE_DIR/worker.js" "$RELEASE_DIR/"
cp "$BASE_DIR/sw.js" "$RELEASE_DIR/"
cp "$BASE_DIR/transformers.min.js" "$RELEASE_DIR/"
cp "$BASE_DIR/manifest.json" "$RELEASE_DIR/"
cp "$BASE_DIR/icon-192.png" "$RELEASE_DIR/"
cp "$BASE_DIR/icon-512.png" "$RELEASE_DIR/"
cp "$BASE_DIR/build_knowledge_base.py" "$RELEASE_DIR/"
cp "$BASE_DIR/Dockerfile" "$RELEASE_DIR/"
cp "$BASE_DIR/requirements.txt" "$RELEASE_DIR/"
cp "$BASE_DIR/run_ingest.sh" "$RELEASE_DIR/"
cp "$BASE_DIR/run_ingest.bat" "$RELEASE_DIR/"

# Step 4: Copy local WASM files
echo "📁 Copying MediaPipe/ONNX WASM dependencies..."
if [ -d "$BASE_DIR/wasm" ] && [ "$(ls -A "$BASE_DIR/wasm")" ]; then
    cp -r "$BASE_DIR/wasm/"* "$RELEASE_DIR/wasm/"
else
    echo "⚠️ Warning: local 'wasm/' directory is empty or missing."
    echo "   Running 'pdflrt' once on an online host will auto-download these WASM files."
fi

# Step 5: Copy models
echo "📁 Packaging models..."
if [ -d "$BASE_DIR/models/nomic-ai/nomic-embed-text-v1.5" ]; then
    echo "  -> Copying nomic-embed-text-v1.5..."
    mkdir -p "$RELEASE_DIR/models/nomic-ai"
    cp -r "$BASE_DIR/models/nomic-ai/nomic-embed-text-v1.5" "$RELEASE_DIR/models/nomic-ai/"
else
    echo "⚠️ Warning: Local nomic-embedding model directory 'models/nomic-ai/nomic-embed-text-v1.5' not found."
    echo "   Please download the model before packaging or ensure it is present on the target host."
fi

# Check for LLM tasks/models
LLM_TASKS=$(find "$BASE_DIR/models" -maxdepth 1 -name "*.task" -o -name "*.bin" 2>/dev/null)
if [ -n "$LLM_TASKS" ]; then
    echo "  -> Copying local LLM files..."
    for f in $LLM_TASKS; do
        cp "$f" "$RELEASE_DIR/models/"
    done
else
    echo "⚠️ Warning: No local LLM task files (*.task, *.bin) found under 'models/'."
fi

# Step 6: Copy compiled Knowledge Base if present
if [ -f "$BASE_DIR/PdfDir/knowledge_base.json" ]; then
    echo "📁 Copying pre-compiled knowledge_base.json..."
    cp "$BASE_DIR/PdfDir/knowledge_base.json" "$RELEASE_DIR/PdfDir/"
else
    echo "ℹ️ No pre-compiled knowledge_base.json found. The target host will need to generate it."
fi

# Step 7: Bundle into zip file
echo "📦 Archiving everything into a single offline package..."
if command -v zip >/dev/null 2>&1; then
    cd "$RELEASE_DIR"
    zip -r "$ZIP_FILE" .
    cd "$BASE_DIR"
    echo "========================================================================"
    echo "🎉 Success! Created offline release package at:"
    echo "   $ZIP_FILE"
    echo "========================================================================"
    echo "Next Steps:"
    echo "1. Copy 'pdflrt_offline_release.zip' to the target Windows/macOS machine."
    echo "2. Unzip it in your target directory."
    echo "3. Run the Go binary for your OS (e.g. pdflrt.exe or ./pdflrt_mac_silicon)."
    echo "========================================================================"
else
    echo "⚠️ Warning: 'zip' utility not found. Creating a tarball (.tar.gz) instead..."
    TAR_FILE="$BASE_DIR/pdflrt_offline_release.tar.gz"
    tar -czf "$TAR_FILE" -C "$RELEASE_DIR" .
    echo "========================================================================"
    echo "🎉 Success! Created offline release archive at:"
    echo "   $TAR_FILE"
    echo "========================================================================"
fi

# Clean temp directory
rm -rf "$RELEASE_DIR"
