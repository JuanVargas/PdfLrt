# LiteRT-LM vs. WebLLM for PdfLrt

A comparative analysis of LiteRT-LM (MediaPipe tasks-genai) vs WebLLM (MLC-LLM) for client-side, offline RAG applications on mobile and desktop platforms.

---

## Overview

| Feature | LiteRT-LM (MediaPipe) | WebLLM (MLC-LLM) |
| :--- | :--- | :--- |
| **Primary Focus** | Mobile, CPU & GPU hybrid execution | High-performance WebGPU execution |
| **Model Footprint** | Extremely lightweight | Moderate to heavy |
| **CPU Fallback Speed** | **Fast** (Powered by XNNPack) | **Very Slow** (Generic Wasm backend) |
| **Optimization Tech** | Per-Layer Embeddings (PLE) & Multi-Token Prediction (MTP) | Apache TVM shader compiler |
| **Gemma 4 Compatibility** | **First-Class** (Native support) | Community conversion required |
| **SDK Maturity** | Rapidly evolving (2026 stack) | Mature, stable API |

---

## Detailed Comparison

### 1. CPU Fallback Performance (Crucial for Mobile/Offline)

*   **WebLLM:** Highly optimized for WebGPU, which runs nice on modern Apple Silicon Macs or newer iPhones. However, on older iPads, budget Android devices, or browsers with restricted WebGPU contexts, WebLLM must fall back to CPU (Wasm). Under these circumstances, compilation and decode speed can be extremely slow (often taking minutes to generate a single response).

*   **LiteRT-LM:** Built is built on top of Google's mobile optimization stack (TF Lite for AI Edge). It utilizes **XNNPack CPU acceleration**, which translates into a significantly faster CPU/Wasm execution speed on mobile devices, allowing the app to remain usable even on devices without GPU access.

### 2. Next-Gen Model Optimization (Gemma 4 E2B/E4B)

*   Google's **Gemma 4** family (released April 2026) incorporates **Per-Layer Embeddings (PLE)** and **Multi-Token Prediction (MTP)**. 

*   LiteRT-LM is the official runtime optimized by Google to execute these models and features, achieving up to **2.2x faster decoding speeds** 
on mobile GPUs and CPUs while consuming substantially less memory than standard LLM architectures.

### 3. PWA Resource Footprint

*   **WebLLM** requires downloading the TVM runtime and heavy pre-compiled Javascript shader configuration objects.

*   **LiteRT-LM** uses a very small WebAssembly loader size. For a Progressive Web App (PWA) that needs to be downloaded in areas with low or spotty connectivity before going offline, a smaller footprint is highly desirable.

### 4. Same-Origin Offline Reliability

*   While WebLLM relies on complex dynamic imports and downloads from HuggingFace, LiteRT-LM's WASM engine can be fully hosted on the local same-origin server (`/wasm/`). This bypasses browser Cross-Origin Resource Policy (CORP/COEP) blockages entirely, guaranteeing 100% offline stability.

---

## Recommendation for PdfLrt

For **PdfLrt** (where the core requirement is running on mobile devices in remote areas with zero WiFi), **LiteRT-LM is the superior choice**. While there is some initial setup friction regarding local file configurations and same-origin policies, resolving these grants PdfLrt a lightweight, offline-reliable, and highly CPU-performant architecture that runs Gemma 4 at peak performance.

END of DOC
---