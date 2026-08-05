# PdfLrt Offline Operation Guide

Progressive Web Apps (**PWAs**) are web applications that can deliver a native, app-like experience while operating in environments with NO Internet access. 

PWAs synthetize the convergence of web accessibility and native app performance, delivering a decent experience directly through a user's browser. By leveraging modern web technology, PWAs can provide features like offline functionality, push notifications, and device installation without the friction of downloading from an app store.

**PdfLrt** is designed to operate as a PWA. This document summariez how to run PdfLrt in offline environments (without access to internet connections) on Windows, macOS, Linux, and iOS. It also details causes of possible failures and how to resolve such situations to ensure that PdfLrt can operate as a TCP/IP network-independent system.

---

## 1. Causes of Previous Offline Failures

During initial testing of PdfLrt on a macOS machine with no internet connection, PdfLrt failed to operate, due to the following causes:

### A. Web Worker CDN Dependency

In `worker.js`, the main MediaPipe GenAI library, was being imported via an ES6 import directly from a remote jsDelivr CDN URL:

```javascript
  import { FilesetResolver, LlmInference } from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-genai';
```

When offline, the browser could not resolve this package for download. The `worker.js` crashed immediately on initialization, preventing the LiteRT LLM engine from loading.

**Resolution:**

The package must be served locally. The Go backend automatically downloads `tasks-genai.js` into the `wasm/` directory during its first run while online. `worker.js` and has been updated to load from the same-origin relative path:

```javascript
  import { FilesetResolver, LlmInference } from './wasm/tasks-genai.js';
```

### B. Brittle Service Worker Caching (Google Fonts)

In the server worker code `sw.js`, the worker static cache list (`urlsToCache`) included a remote stylesheet URL for Google Fonts:

```javascript
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Plus+Jakarta+Sans:wght@500;600;700;800&display=swap'
```

In PWA specifications, `cache.addAll()` is an atomic operation. If a single resource in the list fails to load (which happens to any remote internet resource when offline), the entire cache creation is aborted, the service worker install step fails, and the service worker is never registered.

**Resolution:**
The remote Google Fonts URL was removed from the service worker's static cache list. If offline, the browser will degrade gracefully to local system sans-serif fonts. 

Additionally, the new local `/wasm/tasks-genai.js` was added to the caching list, and the cache name version was incremented to `pdflrt-cache-v10` to invalidate old caches and force a clean reload.

---

## 2. Necessary Steps to Run PdfLrt Offline

To run PdfLrt offline on a target device, follow these steps:

### Step 1: Create the Offline Package

On the developer machine (connected to the internet):

1. Start the Go server once to ensure it downloads the necessary files to the `wasm/` directory (or verify they are already present in `./wasm/`):

   - `wasm/tasks-genai.js`
   - `wasm/genai_wasm_internal.js`
   - `wasm/genai_wasm_internal.wasm`
   - `wasm/ort-wasm-simd-threaded.wasm`
   - etc.

2. Run the packaging script:

   ```bash
   ./create_offline_package.sh
   ```

   The script compiles the Go server for Windows, Linux, and macOS, and bundles them along with the WebGPU/WASM libraries, embedding models, and frontend code into `pdflrt_offline_release.zip` or `pdflrt_offline_release.tar.gz`.

### Step 2: Transfer and Extract

Copy the zip/tarball file to the target machine (via network, USB drive, etc.) and extract it to the target directory of choice.

### Step 3: Add Your Models

Ensure that:

1. The target PDF docs are placed in the `./PdfDir` folder.

2. A compatible LiteRT/Mediapipe task model (e.g., `gemma-4-E2B-it-web.task`) is saved in the `./models` folder.

3. The embedding model `models/nomic-ai/nomic-embed-text-v1.5` is fully unpacked in the `./models/nomic-ai` directory.

### Step 4: Perform the Connected Initialization (Recommended)

Once the code and related files have been obtained and the appllication successfully tested while on line, trhe next step is to test PdfLrt on the same machine, but this time with no internect access. 

Before removing the internet connection entirely:

1. Start the Go server on the machine and navigate to the application URL (e.g. `http://localhost:8080`).

2. Click **🗑️ Reset Cache** in the top bar to clean out any cached versions of the old service worker.

3. This set of actions will register the new PWA Service Worker, will cache the local WASM files, and will ensure a clean local execution.

---

## 3. Platform-Specific Operation Instructions

**WebGPU** is a mandatory requirement for browser-based LiteRT LLM execution. Secure Contexts (HTTPS or localhost) are also required to access WebGPU APIs.

### 🍎 macOS

1. **Starting the server**:
   Open Terminal, navigate to the folder, and run:

   ```bash
     chmod +x ./pdflrt_mac_silicon # (or ./pdflrt_mac_intel for Intel Macs)
   ./pdflrt_mac_silicon
   ```

2. **Browser Compatibility**:

   - **Google Chrome**: Works out of the box on macOS via `http://localhost:8080`.

   - **Safari 17+**: WebGPU is off by default. Open Safari, go to **Settings > Advanced**, check *Show features for web developers*. Then in the **Develop** menu, check **Feature Flags > WebGPU**.

3. **Remote Access over LAN (e.g. from an iPad)**:

   Because LAN IPs accessed over HTTP (e.g., `http://192.168.1.50:8080`) are insecure, macOS browsers block WebGPU. If accessing the server remotely, you should use the secure HTTPS address: `https://<server-ip>:8443` (see Section 4).

### 🐧 Linux

1. **Starting the server**:

   Open Terminal, navigate to the folder, and run:

   ```bash
   chmod +x ./pdflrt_linux
   ./pdflrt_linux
   ```

2. **Chrome / WebGPU Nvidia Optimization**:

   Chrome's hardware acceleration can be unstable or display lag/flickering on Linux with Nvidia GPUs. Running with graphics acceleration disabled turns off WebGPU completely. Run Chrome with the following flags to force-enable WebGPU safely:

   ```bash
     google-chrome --enable-unsafe-webgpu --enable-features=Vulkan --ozone-platform=x11
   ```

   If flickering persists, disable GPU compositing but keep WebGPU active by running:
   ```bash
     google-chrome --enable-unsafe-webgpu --enable-features=Vulkan --ozone-platform=x11 --disable-gpu-compositing
   ```

### 🪟 Windows

1. **Starting the server**:
   Double-click `pdflrt.exe` or run it from Command Prompt/PowerShell.

2. **Enable Hardware Acceleration**:
   If WebGPU fails to load in Chrome:
   - Go to Chrome **Settings > System**.
   - Ensure **"Use graphics acceleration when available"** is toggled **ON**.
   - Click **Relaunch**.

3. **Treating LAN Server as Secure Context**:
   If you host the server on Windows and want to connect from another device in your home network:
   - Open Chrome on the client device and go to `chrome://flags`.
   - Search for `#unsafely-treat-insecure-origin-as-secure`.
   - Enable it and input your server's IP and port (e.g., `http://192.168.1.15:8080`).
   - Relaunch Chrome. This allows WebGPU to run over insecure LAN connections. Alternatively, access it securely via HTTPS at `https://192.168.1.15:8443`.

### 📱 iOS (iPad / iPhone)

iOS devices can act as clients accessing a Go backend hosted on your home network.

1. **Enable WebGPU in Safari (iOS 17+)**:
   - Go to iPad/iPhone **Settings > Safari > Advanced > Feature Flags**.
   - Toggle **WebGPU** to **ON**.

2. **Bypassing LAN Secure Context constraints**:
   Because LAN IP connections are HTTP, Safari blocks WebGPU. You can bypass this restriction by using the HTTPS server or adding the page to your Home Screen:
   - **Option A (HTTPS)**: Open Safari and navigate to `https://<server-ip>:8443` (see Section 4).
   - **Option B (PWA shortcut)**: Open Safari and type in your host's local IP address (e.g., `http://192.168.1.15:8080`). Tap the **Share** button and choose **Add to Home Screen**. Standalone PWAs run in a sandboxed wrapper that automatically grants secure context privileges.

---

## 4. Secure Contexts and HTTPS (Port 8443) Execution

To access **WebGPU** APIs, modern browsers strictly require a **Secure Context**. While `http://localhost` is automatically considered secure, accessing the application across a local network using an IP address (e.g., `http://192.168.1.15:8080`) is blocked by default unless HTTPS is used.

### A. Dual HTTP and HTTPS Server Setup
To resolve this, the Go backend (`pdflrt.go`) automatically spins up a secure HTTPS server when SSL certificates are found in the root directory:
* **HTTP Port**: `8080` (Standard localhost access)
* **HTTPS Port**: `8443` (Secure local network access)

When starting the server, it will check for `cert.pem` and `key.pem`. If they exist, it boots both ports:
```
🚀 PdfLrt HTTP Server starting on http://localhost:8080
🔒 PdfLrt HTTPS Server starting on https://localhost:8443
```

### B. Bypassing Self-Signed Certificate Warnings
Since local servers use self-signed SSL certificates, your browser will show a security warning (*"Your connection is not private"* or similar) when you first visit `https://<your-ip>:8443`.
* **To bypass in Chrome/Edge**: Click **Advanced** and select **Proceed to <your-ip> (unsafe)**.
* **To bypass in Safari (macOS/iOS)**: Tap **Show details** -> **Visit this website** and confirm you want to trust the certificate.
* Once bypassed, the browser treats the site as a Secure Context, enabling WebGPU and service worker capabilities immediately without changing any browser flags.
