# PdfLrt Migration & Deployment Guide

This document contains step-by-step instructions to migrate **PdfLrt** to a Windows environment and access it remotely from an Apple iPad.

---

## 1. Migrating to a Windows Host

We do **not** need to transfer the original PDF documents to the windows machine, if the pdf ingestion was already made, because the ingestion database is self-contained.

### Files to Copy
Zip the application directory, keeping only the following:

* **All Code Files**:
  * `index.html` (Application frontend structure)
  * `app.js` (Frontend logic and intent classifier)
  * `worker.js` (Offline LLM / embedding worker)
  * `sw.js` (Service worker cache configuration)
  * `transformers.min.js` (Transformers local engine)
  * `manifest.json` (PWA application manifest)
  * `pdflrt.go` (Go backend server source code)
  * `go.mod` & `go.sum` (Go module definitions)

* **The Ingestion Database**:
  * `PdfDir/knowledge_base.json` (Contains all text chunks, embeddings, and embedded figures in base64 format). *We can safely delete the raw `.pdf` files inside `PdfDir/` if the knowledge base is already synched.*

* **Framework resources**:
  * `wasm/` directory (Enables offline same-origin WASM loading for browsers).

* **Model file (Optional)**:
  * `models/` directory containing the `.bin` model file. 
  * *Note: If the Windows machine is online, we don't need to copy this folder, as the browser will download and cache the model from Hugging Face automatically during startup.* However, I believe this will be necessary to do in GAC.

---

## 2. Setting Up and Running on Windows

1. Copy the zipped folder to the Windows machine and extract it.

2. Ensure we have **Go** installed on the Windows machine (or compile the binary on Linux using cross-compilation: `GOOS=windows GOARCH=amd64 go build -o pdflrt.exe pdflrt.go` and copy the `.exe`).

3. Open a Command Prompt or PowerShell window in the project folder.

4. Run the Go server:
   ```cmd
   go run pdflrt.go
   ```
   *(Or double-click the compiled `pdflrt.exe` file).*

5. Open your browser and navigate to the local secure URL:
   ```text
   https://localhost:8443
   ```
   > [!IMPORTANT]
   > **HTTPS is strictly required** by browsers (Chrome, Firefox, Safari) to establish a "Secure Context". Without a Secure Context, the browser will disable access to the GPU (`navigator.gpu` for WebGPU) and multi-threaded WebAssembly (`SharedArrayBuffer`), causing model loading to fail.

6. **Bypass the self-signed certificate warning**: Since the server generates a local SSL certificate on startup, the browser will display a privacy warning. Click **Advanced** and choose **Proceed to localhost (unsafe)** (or **Accept the Risk and Continue** in Firefox) to load the page.

---

## 3. Remote Access from an Apple iPad

Since iOS/iPadOS cannot execute compiled Go binaries directly, we will need to host the app on the Windows machine and access it from the iPad browser over the local Wi-Fi network.

### Step 1: Connect to the Same Network
Ensure both the Windows computer and the iPad are connected to the same Wi-Fi router.

### Step 2: Get the Windows Local IP

1. On the Windows host, open a Command Prompt and run:
   ```cmd
   ipconfig
   ```

2. Note down the **IPv4 Address** of your network adapter (e.g., `192.168.1.15`).

### Step 3: Configure Windows Firewall

By default, Windows Firewall blocks incoming traffic. If the iPad cannot connect, allow port `8443` through the firewall:

1. Open Windows Search and type **Windows Defender Firewall**.

2. Select **Advanced Settings** -> **Inbound Rules** -> **New Rule...**

3. Choose **Port** -> **TCP** -> Specify local port: `8443`.

4. Choose **Allow the connection** and apply it to Private networks.

### Step 4: Open Safari on iPad

1. Open **Safari** on the iPad.

2. Enter the HTTPS address of the Windows machine:
   ```text
   https://<windows_ip>:8443
   ```
   *(Example: `https://192.168.1.15:8443`)*

3. **Bypass the SSL safety warning**: Since the server generates a local self-signed certificate, Safari will issue a warning saying that the connection is not private. Tap **Show Details**, then tap **Visit this website** to proceed. *Note: HTTPS secure context is strictly required by the browser to enable WebGPU/WASM threads.*

### Step 5: Install as a Progressive Web App (PWA)

1. Tap the **Share** button (box with an up arrow) in Safari.

2. Scroll down the menu and choose **Add to Home Screen**.

3. Tap **Add** in the top right. 

4. The **PdfLrt** icon will now appear on your iPad home screen, allowing you to run it as a standalone, distraction-free app.
