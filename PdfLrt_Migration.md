# PdfLrt Migration & Deployment Guide

This document contains step-by-step instructions to package, migrate, and run **PdfLrt** in offline, restricted target environments (such as Windows or macOS target hosts) and access it remotely from client devices (like Apple iPads).

---

## 1. Automated Packaging (Recommended)

To simplify offline deployment, a packaging script [create_offline_package.sh](file:///home/juan/code/go/PdfLrt/create_offline_package.sh) is provided. It compiles the Go backend server for Windows, macOS, and/or Linux, gathers all static web files, wasm dependencies, models, and outputs a self-contained ZIP archive.

### Step 1: Run the Packaging Tool (on Ubuntu/Build Host)
From the console terminal, run:
```bash
./create_offline_package.sh
```

### Step 2: Transfer and Extract

Copy the generated `pdflrt_offline_release.zip` file to the target offline host (Windows or macOS) via USB drive or internal file share and extract it.
It contains everything needed to run:

* The pre-compiled Go server binary (`pdflrt.exe`, `pdflrt_mac_silicon`, etc.)

* All static frontend assets (`index.html`, `app.js`, etc.)

* Pre-downloaded MediaPipe WASM runtimes (`wasm/`)

* Local embedding and LLM model files (`models/`)

* Pre-compiled document knowledge base (`PdfDir/knowledge_base.json`), if generated.

---

## 2. Manual Packaging (Alternative)

If possible, an alternative is to zip the directory manually, compile the binary and ensure the folders listed beow are included :

* **Go Executable**: Cross-compile the Go server from the build host:
  * For Windows: `GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -o pdflrt.exe pdflrt.go`
  * For macOS (M-series): `GOOS=darwin GOARCH=arm64 CGO_ENABLED=0 go build -o pdflrt_mac pdflrt.go`
* **Static Assets**: `index.html`, `app.js`, `worker.js`, `sw.js`, `transformers.min.js`, `manifest.json`, and icons.
* **WASM Directory**: `wasm/` containing downloaded MediaPipe runtimes (required for offline same-origin WebWorker loading).
* **Models Directory**: `models/` containing:
  * `gemma-4-E2B-it-web.task` (or similar LLM model)
  * `nomic-ai/nomic-embed-text-v1.5/` (the ONNX embedding model files).
  > [!IMPORTANT]
  > **Models are NOT optional in offline networks**: Since target hosts cannot connect to Hugging Face or GitHub, you **must** copy the `models/` directory manually from the build host. It is excluded from Git by `.gitignore`.
* **Database**: `PdfDir/knowledge_base.json` (the compiled document database). The raw `.pdf` files can be deleted if the database is already built.

---

## 3. Setting Up and Running on the Target Host

1. Copy the zipped folder to the target machine and extract it.

2. Open a Command Prompt (Windows) or Terminal (macOS) in the extracted folder.

3. Start the Go web server:
   - **Windows**: Double-click `pdflrt.exe` or run `.\pdflrt.exe`
   - **macOS**: Run `./pdflrt_mac_silicon` (or `pdflrt_mac_intel`)

4. Open a web browser (Google Chrome recommended) and navigate to:
   ```text
   https://localhost:8443
   ```
   > [!IMPORTANT]
   > **HTTPS is strictly required** by browsers to establish a "Secure Context". Without a Secure Context, the browser will disable access to the GPU (`WebGPU`) and multi-threaded WebAssembly (`SharedArrayBuffer`), causing model loading to fail.

5. **Bypass the self-signed certificate warning**: Since the server generates a local SSL certificate on startup, the browser will display a warning. Click **Advanced** and choose **Proceed to localhost (unsafe)** to load the application.

---

## 4. Remote Access from an Apple iPad

To host the application on the target server and access it from an iPad browser over the local Wi-Fi network:

### Step 1: Connect to the Same Network
Ensure both the target server and the iPad are connected to the same Wi-Fi router.

### Step 2: Get the Server IP Address
* On Windows: Open a Command Prompt, run `ipconfig`, and find the IPv4 address (e.g. `192.168.1.15`).
* On macOS: Open System Settings -> Wi-Fi -> Details, or run `ifconfig` in Terminal.

### Step 3: Configure Server Firewall (Windows only)

Allow port `8443` through Windows Defender Firewall:

1. Search for **Windows Defender Firewall with Advanced Security**.

2. Select **Inbound Rules** -> **New Rule...**

3. Choose **Port** -> **TCP** -> Specify local port: `8443`.

4. Choose **Allow the connection** and apply to Private networks.

### Step 4: Open Safari on iPad

1. Open **Safari** on the iPad.

2. Enter the HTTPS address: `https://<server_ip>:8443` (e.g., `https://192.168.1.15:8443`).

3. Tap **Show Details** -> **Visit this website** to bypass the SSL warning.

4. **Install as a PWA**: Tap the **Share** button -> **Add to Home Screen** -> **Add**. The app will now run in standalone, fullscreen mode with WebGPU and offline support.

---

## 5. Advanced: Ingesting PDFs Offline via Docker Image Transfer

If there is a need to process new PDF manuals on target hosts but cannot install Python/pip dependencies due to network restrictions, you can transfer the Docker ingestion image offline.

### Step 1: Build and Save the Image on the Build Host (with internet)
1. Build the Docker image:
   ```bash
   docker build -t pdflrt-ingest -f Dockerfile .
   ```
2. Export the image to a tarball archive:
   ```bash
   docker save -o pdflrt-ingest.tar pdflrt-ingest
   ```

### Step 2: Load and Run the Image on the Target Host (offline)
1. Copy `pdflrt-ingest.tar` to the target host.
2. Load the image into the local Docker daemon:
   ```bash
   docker load -i pdflrt-ingest.tar
   ```
3. Run the ingestion pipeline (using the standard scripts):
   - Windows: Run `run_ingest.bat`
   - macOS/Linux: Run `./run_ingest.sh`
   The ingestion script will now run completely offline inside Docker, reading your local PDFs and outputting `knowledge_base.json` without requiring internet access.

---

## 6. Advanced: Building Docker Ingestion behind an SSL intercepting Proxy

If the target host has limited internet access but is behind a corporate SSL decrypting proxy, the Docker build might fail with SSL certificate errors during `pip install`.

To build the image locally in this environment:
1. Export your corporate SSL decrypting proxy root certificate in Base64 PEM format.
2. Save it in the project root folder as `proxy-ca.crt` (the `.crt` extension is required).
3. Re-run the Docker build. The [Dockerfile](file:///home/juan/code/go/PdfLrt/Dockerfile) will automatically detect the `proxy-ca.crt` file, trust it, and pip will use the trusted host flags to complete the installation safely.

END of DOC
---