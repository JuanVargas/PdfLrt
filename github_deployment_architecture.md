# GitHub Deployment Architecture & Model Distribution

This document details how **PdfLrt** is deployed and how the 1.4 GB local embedding model is distributed via `github.com` without overloading the Git repository history or requiring access to Hugging Face (`huggingface.co`) on target machines.


---

## 1. Distribution Schematic

Below is the workflow showing how the model weights are prepared on the host machine, uploaded to GitHub Releases, and retrieved by the target offline machines.

```text
           [ Host Machine (Online) ]
                       │
                       ▼ (Downloads weights once)
           [ models/nomic-ai/ Directory ]
                       │
                       ▼ (Runs ./package_model.sh)
        [ nomic-embed-text-v1.5.tar.gz ] (1.4 GB Archive)
                       │
                       └──────────────────────┐
                                              ▼ (Uploads archive via browser)
   [ Git Push ]                       [ GitHub Release Page ]
   (Under 2 MB)                     (github.com/JuanVargas/PdfLrt)
        │                                     │
        ▼                                     ▼ (download_model_from_github.py)
[ Git Repository ] ─────────────────► [ Target Offline Machine ]
(Code & Scripts)                         (Gets 1.4 GB Model from GitHub)
                                              │
                                              ▼ (Places PDFs & Runs Ingestion)
                                      [ Local knowledge_base.json ] (431 MB)
                                              │
                                              ▼ (Launches Offline Web App)
                                      [ Local Go Server & UI ]
```

---

## 2. Code Repository vs. Release Assets

To comply with GitHub's file size limits, PdfLrt splits code assets and model weights into two distinct hosting mechanisms on `github.com`:

| Asset Type | Hosting Location | Max Size Limit | Our Size | Git History status |
| :--- | :--- | :--- | :--- | :--- |
| **Source Code** <br>*(HTML, JS, Go server, Scripts)* | **Git Repository** | **100 MB** per file | **~2 MB** total | **Committed & Tracked** |
| **Model Weights** <br>*(ONNX & Safetensors)* | **GitHub Release Asset** | **2.0 GB** per file | **~1.4 GB** packed | **Ignored** *(via `.gitignore`)* |

---

## 3. Directory Structures

### A. What is pushed to GitHub (Git Repository)
Your remote repository on GitHub contains only lightweight code files:
```text
├── go.mod / go.sum
├── pdflrt.go                      <-- Go server launcher
├── index.html / app.js / worker.js <-- Frontend PWA client
├── sw.js / manifest.json          <-- PWA config
├── transformers.min.js            <-- Embedding loader
├── wasm/                          <-- local WASM binaries
├── build_knowledge_base.py        <-- Document ingestion pipeline
├── package_model.sh               <-- Model packaging helper
├── download_model_from_github.py  <-- Target download utility
└── .gitignore                     <-- Instructs Git to ignore models and databases
```

### B. What runs locally (Target Machine)
After pulling the code and running `download_model_from_github.py` and `build_knowledge_base.py`, the target machine's local directory will look like this:
```text
├── [ALL REPOSITORY CODE FILES]
├── PdfDir/
│   ├── faa-manual-1.pdf
│   └── knowledge_base.json        <-- Generated locally (431 MB)
└── models/
    └── nomic-ai/
        └── nomic-embed-text-v1.5/ <-- Downloaded from Release (1.6 GB extracted)
            ├── config.json
            ├── model.safetensors
            ├── tokenizer.json
            └── onnx/
                └── model_quantized.onnx
```
