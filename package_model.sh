#!/bin/bash
set -e

BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MODELS_DIR="$BASE_DIR/models"
TAR_FILE="$MODELS_DIR/nomic-embed-text-v1.5.tar.gz"

if [ ! -d "$MODELS_DIR/nomic-ai/nomic-embed-text-v1.5" ]; then
    echo "Error: Local model directory '$MODELS_DIR/nomic-ai/nomic-embed-text-v1.5' not found."
    echo "Please run the ingestion script once or ensure you have the model files under 'models/nomic-ai/nomic-embed-text-v1.5'."
    exit 1
fi

echo "Packaging local model directory into: $TAR_FILE..."
cd "$MODELS_DIR"
tar --exclude="*.git*" --exclude="*__pycache__*" -czf nomic-embed-text-v1.5.tar.gz nomic-ai/nomic-embed-text-v1.5/

echo "--------------------------------------------------------"
echo "Package created successfully: models/nomic-embed-text-v1.5.tar.gz"
echo "--------------------------------------------------------"
echo "Next Steps:"
echo "1. Go to your GitHub repository: https://github.com/JuanVargas/PdfLrt"
echo "2. Create a new Release with tag name: v1.0.0-models"
echo "3. Upload 'models/nomic-embed-text-v1.5.tar.gz' as a release asset."
echo "4. On target machines, run: python3 download_model_from_github.py"
echo "--------------------------------------------------------"
