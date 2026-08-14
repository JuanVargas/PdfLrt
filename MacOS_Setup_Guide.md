# Setup & Execution Guide for PdfLrt on macOS

This guide provides step-by-step instructions to set up, configure, and run **PdfLrt** (LiteRT Offline Document Assistant) on macOS.

---

## 1. System Requirements & Dependencies

Before starting, ensure the target Mac has the following installed:

* **Go Toolchain** (Go 1.20+ recommended)
* **Python 3.9+**
* **Google Chrome** (Recommended browser for WebGPU and WASM SIMD acceleration)

### Install Required Python Libraries
Open Terminal and run:

```bash
pip3 install PyMuPDF sentence-transformers
```

---

## 2. Cloning the Repository from GitHub

Open Terminal and clone the project repository (or extract the downloaded ZIP):

```bash
git clone https://github.com/JuanVargas/PdfLrt.git
cd PdfLrt
```

---

## 3. Downloading Offline Embedding & LLM Models

The `.gitignore` file intentionally excludes large model files from Git tracking. You must populate the `models/` directory before running the application.

### Step A: Download the Local ONNX Embedding Model
Run the model helper script:

```bash
python3 download_model_from_github.py
```

> **Note**: This script downloads the required ONNX files (`config.json`, `tokenizer.json`, `special_tokens_map.json`, and `onnx/model.onnx`) into `models/nomic-ai/nomic-embed-text-v1.5/`. It includes automatic SSL context handling for macOS Python and fallbacks to Hugging Face if GitHub release assets are not accessible.

### Step B: Place the Generator LLM File
Ensure your LiteRT LLM model (e.g., `gemma-4-E2B-it-web.task` or `gemma-2b-it-cpu-int4.bin`) is located in the `models/` directory:

```text
PdfLrt/
└── models/
    ├── gemma-4-E2B-it-web.task
    └── nomic-ai/
        └── nomic-embed-text-v1.5/
            ├── config.json
            ├── tokenizer.json
            ├── tokenizer_config.json
            ├── special_tokens_map.json
            └── onnx/
                └── model.onnx
```

---

## 4. Ingesting PDF Documents (Building Knowledge Base)

1. Ensure your `.pdf` documents are inside the `PdfDir` folder:
   ```bash
   mkdir -p PdfDir
   # Copy your target PDF files into PdfDir/
   ```

2. Run the ingestion pipeline script:
   ```bash
   python3 build_knowledge_base.py
   ```

3. The script extracts text chunks, parses visual figure captions, generates vector embeddings, and outputs:
   ```text
   PdfDir/knowledge_base.json
   ```

---

## 5. Launching the Go Web Server

Start the Go backend web server directly:

```bash
go run pdflrt.go
```

*(Alternatively, to compile a standalone executable for macOS: `go build -o pdflrt_mac pdflrt.go` and run `./pdflrt_mac`)*

### Server Startup Output:
When started successfully, the server will log:
```text
✅ Local ONNX embedding model found and ready.
📂 Knowledge Base stats loaded: X text chunks and Y visual assets.
Redirect server starting on http://localhost:8085
Main HTTPS Server starting on https://localhost:8443
```

---

## 6. Accessing the Application in Google Chrome

1. Launch Google Chrome and navigate to:
   ```text
   https://localhost:8443
   ```
   *(If Chrome displays a security warning for the local self-signed certificate, click **Advanced** → **Proceed to localhost (unsafe)**).*

2. **Refresh Chrome**:
   Press **`Cmd + Shift + R`** (`⌘ + Shift + R`) to hard reload the page and clear any cached worker states.

3. **Initialize & Chat**:
   * Click **Sync Knowledge Base** (or **Reload Index**).
   * Click **Initialize Engine / Load Model** to load the local ONNX vector engine and LiteRT model into the background Web Worker.
   * Type your query in the chat input to start Q&A sessions!

---

## 7. Packaging for Offline Target Machines (e.g. Restricted Windows PCs)

To deploy from macOS to an offline Windows or Linux machine, zip the complete directory including the **`models/`** folder:

```text
PdfLrt_Package/
├── pdflrt.exe (or pdflrt_linux)   <-- Cross-compiled Go binary
├── index.html
├── app.js
├── worker.js
├── sw.js
├── transformers.min.js
├── manifest.json
├── wasm/                          <-- Downloaded MediaPipe WASM runtime files
├── models/                        <-- ONNX embedding & LLM model files
└── PdfDir/
    └── knowledge_base.json        <-- Compiled document database
```

END of DOC
---