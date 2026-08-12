# PdfLrt Target OS System Requirements, APIs, and Libraries

This document lists the runtime engines, compiler tools, system APIs, native libraries, and web APIs required by the **PdfLrt** (LiteRT Offline Document Assistant) system to run on Linux, macOS, or Windows.

---

## 1. Core Server Runtime & Compile-Time Dependencies

The web server is written in Go; the document ingestion pipeline is written in Python.

### Go Development and Compilation (All OSs)

* **Go Compiler**: Go version `1.26.4` or higher is required to build the executable from source.

* **Go Standard Libraries**:
  - `net/http` (HTTP Server API)
  - `bytes`, `encoding/json` (Data serialization)
  - `io`, `os`, `os/exec`, `path/filepath` (File I/O, subprocess execution to download WASM resources, paths)
  - `sync`, `time` (Concurrency and execution metrics)
  - `strings` (Query processing)

* **External Go Packages**:
  - `github.com/xuri/excelize/v2` (MSFT Excel file generation API, used for saving conversation logs)

### Python Ingestion Pipeline (All OSs)

* **Python Runtime**: Python `3.10` or higher.

* **Required Pip Libraries**:

  - `pymupdf` (Python binding for the C-based MuPDF engine; used for extracting text, layout, and images from PDFs). Note: Installs pre-compiled native binaries on Windows/macOS/Linux automatically via wheels.

  - `requests` (HTTP requests library to communicate with local embedding/download APIs).

---

## 2. Platform-Specific System Libraries & APIs

### A. Linux (Ubuntu, Debian, Fedora, RHEL, etc.)

* **Dynamic Linker / C Standard Library**: `glibc` (GNU C Library) `2.31` or higher is required by the compiled Go binary.
* **Network Stack**: BSD Socket API for TCP/IP communication (port `8085` or `8080` for HTTP).
* **Web Browser**: Chrome, Firefox, or Edge supporting WebGPU and WebAssembly SIMD.
* **GPU Acceleration (Optional, for browser GPU execution)**:
  - **NVIDIA GPU**: NVIDIA proprietary drivers (v450+) and Vulkan/WebGL2/WebGPU backend support.
  - **AMD GPU**: ROCm or Vulkan drivers.
  - *Fallback*: CPU execution (MediaPipe WASM leverages **XNNPack** CPU optimizations natively).

### B. macOS (Intel & Apple Silicon)

* **Kernel & System APIs**: Darwin kernel, POSIX-compliant file system APIs.
* **GPU Acceleration (Highly recommended for client-side LiteRT execution)**:
  - **Apple Silicon (M1/M2/M3/M4)**: Safari, Chrome, or Edge leverages Apple Metal API and Metal Performance Shaders (MPS) natively via WebGPU to run LiteRT models in unified memory.
  - **Intel Macs**: CPU execution only (or Metal for discrete GPUs).

### C. Windows (Windows 10 / 11)

* **Command Shell**: PowerShell 5.1+ or Cmd for executing the PDF ingestion scripts (`run_ingest.ps1` or `run_ingest.bat`).
* **C-Runtime**: MSFT Visual C++ Redistributable (often required for native binary components in Go or Python packages).
* **GPU Acceleration (Optional, for browser GPU execution)**:
  - **NVIDIA GPU**: NVIDIA proprietary drivers and DirectX12/Vulkan backends supporting WebGPU in browsers.
  - *Fallback*: CPU execution optimized via XNNPack under WebAssembly.

---

## 3. Frontend Web Browser API Requirements

Since PdfLrt features a Progressive Web App (PWA) frontend with offline client-side inference powered by **LiteRT** (MediaPipe Tasks GenAI), the browser must support the following Web APIs:

| API | Role in PdfLrt | Support |
| :--- | :--- | :--- |
| **Service Workers API** | Enables background asset caching for offline application access. | Chrome, Firefox, Safari, Edge |
| **Cache Storage API** | Stores static assets (`index.html`, `app.js`, `transformers.min.js`, etc.) offline. | Chrome, Firefox, Safari, Edge |
| **IndexedDB API** | Stores the synced document database (`knowledge_base.json`) and extracted images locally in browser storage. | Chrome, Firefox, Safari, Edge |
| **WebAssembly (WASM) SIMD** | Delivers fast CPU execution speed for LiteRT fallback using vector instructions. | Chrome (91+), Firefox (89+), Safari (16.4+), Edge (91+) |
| **WebAssembly Threads** | Enables multi-threaded parallel model inference on the CPU using `SharedArrayBuffer`. | Chrome, Firefox, Safari, Edge (requires COOP/COEP headers) |
| **WebGPU API** | Executes the LiteRT Large Language Model (Gemma-2B-IT) using client GPU hardware for rapid offline response generation. | Chrome (113+), Edge (113+), Safari (Sonoma+ / iOS 17+), Firefox (Nightly/Configured) |
| **MediaPipe Tasks GenAI API** | Javascript engine (`@mediapipe/tasks-genai`) wrapping the LiteRT runtime for client-side LLM inference. | Loaded dynamically via CDN |
| **Speech Synthesis & Speech Recognition** | Powers standard text-to-speech and voice input buttons in the UI. | Chrome, Safari, Edge |

> [!IMPORTANT]
> **Secure Context Requirement**:
> The **Service Worker API** and **WebGPU API** are strictly limited by modern browsers to **Secure Contexts**. This means they will only load and run under:
> 1. `localhost` / `127.0.0.1` (during local development on the same machine).
> 2. `HTTPS` origins with valid or accepted certificates (when connecting from another device, such as a mobile tablet over the local network).
> If running on plain HTTP, these APIs will be disabled for remote devices.


## Does PdfLrt need to have Ollama or another LLM server installed on the target OS?

No, PdfLrt does not need to have Ollama installed or running on the target OS.

Here is why:

1. Vector Ingestion (build_knowledge_base.py)

The build_knowledge_base.py script generates local vector embeddings for the PDFs using the Hugging Face sentence-transformers library in Python. It downloads and executes nomic-ai/nomic-embed-text-v1.5 directly via PyTorch/Hugging Face cache, completely bypassing Ollama.

2. Client-Side Inference (worker.js) When running the web application, all inference is executed client-side inside the browser using a Web Worker worker.js


Embeddings: Handled in-browser via transformers.js (running nomic-ai/nomic-embed-text-v1.5 on WebGPU or WASM fallback).

LLM Inference: Handled in-browser via Google's LiteRT Tasks GenAI SDK (@mediapipe/tasks-genai running models like gemma-2b-it on WebGPU or CPU-optimized WASM). 

Refer to the detailed runtime comparison in LiteRT vs WebLLM.md 

Because the entire pipeline is self-contained within PyTorch/Python (for ingestion) and WebGPU/WASM (for browser runtime), there is **zero** dependency on Ollama.

END of DOC
---