# Cross-Compiling and Deploying PdfLrt Binaries

This guide provides instructions to compile the **PdfLrt** code on one system (e.g., Linux or macOS) and deploy the executable binary on another target system (e.g., Windows) without needing to install the Go toolchain on the target system.

---

## 1. Why Go is Ideal for Cross-Compilation

Go features native cross-compilation support. The compiler can generate executable binaries for other operating systems and CPU architectures out of the box by setting two environment variables:

* **`GOOS`**: The target operating system (e.g., `windows`, `linux`, `darwin` for macOS).

* **`GOARCH`**: The target processor architecture (e.g., `amd64` for 64-bit Intel/AMD, `arm64` for Apple Silicon or ARM64 mobile/single-board chips).

### CGO and Statically Linked Binaries

Because **PdfLrt** is written in pure Go and uses a hird-party dependency, `excelize`, also in pure Go, there is no need to use the **CGO** which is disabled (`CGO_ENABLED=0`) during cross-compilation. This means the compiler produces a statically linked, self-contained binary that has no external library dependencies on the target OS, ensuring it will run immediately without further compilation or software installation.

---

## 2. Cross-Compilation Commands Matrix

Run the compilation commands from the project root folder, e.g., `/home/juan/code/PdfLrt`.

### A. Compiling FROM Linux or macOS

Use standard shell environment variables prefixing the `go build` command.

| Host OS | Target OS | Target CPU | Compilation Command |
| :--- | :--- | :--- | :--- |
| Linux / macOS | **Windows** | 64-bit Intel/AMD | `GOOS=windows GOARCH=amd64 go build -o pdflrt.exe pdflrt.go` |
| Linux / macOS | **Windows** | ARM64 | `GOOS=windows GOARCH=arm64 go build -o pdflrt.exe pdflrt.go` |
| Linux / macOS | **Linux** | 64-bit Intel/AMD | `GOOS=linux GOARCH=amd64 go build -o pdflrt_linux pdflrt.go` |
| Linux / macOS | **Linux** | ARM64 (e.g., Pi) | `GOOS=linux GOARCH=arm64 go build -o pdflrt_linux pdflrt.go` |
| Linux / macOS | **macOS** | Apple Silicon (M1+) | `GOOS=darwin GOARCH=arm64 go build -o pdflrt_mac pdflrt.go` |
| Linux / macOS | **macOS** | Intel 64-bit | `GOOS=darwin GOARCH=amd64 go build -o pdflrt_mac pdflrt.go` |

### B. Compiling FROM Windows

Depending on which terminal is running, set the variables before compiling.

#### Using PowerShell:
```powershell
# Compile for Linux (64-bit Intel/AMD)
$env:GOOS="linux"; $env:GOARCH="amd64"; go build -o pdflrt_linux pdflrt.go

# Compile for macOS (Apple Silicon M-Series)
$env:GOOS="darwin"; $env:GOARCH="arm64"; go build -o pdflrt_mac pdflrt.go

# Reset environment variables to Windows defaults after compiling
$env:GOOS=""; $env:GOARCH=""
```

#### Using Command Prompt (cmd):
```cmd
:: Compile for Linux (64-bit Intel/AMD)
set GOOS=linux
set GOARCH=amd64
go build -o pdflrt pdflrt.go

:: Compile for macOS (Apple Silicon M-Series)
set GOOS=darwin
set GOARCH=arm64
go build -o pdflrt pdflrt.go

:: Reset environment variables to Windows defaults after compiling
set GOOS=
set GOARCH=
```

---

## 3. Deployment and Running on the Target System

The Go binary contains the web server logic but requires the static frontend assets and the knowledge_base document to run. Follow these steps to package and execute the application:

### Step 1: Package the Deployment Folder
Zip or copy the following files/folders from the build machine and transfer them to the target machine:

```text
├── pdflrt (or pdflrt.exe)   <-- The compiled Go executable
├── index.html                     <-- Frontend UI layout
├── app.js                         <-- Frontend state logic
├── worker.js                      <-- Offline inference worker
├── sw.js                          <-- PWA service worker cache configuration
├── transformers.min.js            <-- ONNX runtime library loader
├── manifest.json                  <-- PWA application manifest file
├── icon-192.png & icon-512.png    <-- PWA app logo graphics
├── wasm/                          <-- local folder containing downloaded MediaPipe runtime binaries
├── models/                        <-- local folder containing ONNX embedding model (models/nomic-ai/nomic-embed-text-v1.5)
└── PdfDir/
    └── knowledge_base.json        <-- The parsed and embedded document database file
```

> [!NOTES]

> * **Raw PDF Files**: We do **not** need to copy the original `.pdf` files. Once `build_knowledge_base.py` has run on the host and generated `knowledge_base.json`, the knowlodge base file is completely self-contained (including text, page metrics, and embedded figure snapshots).

> * **Models Directory**: The browser Web Worker uses `models/nomic-ai/nomic-embed-text-v1.5` to convert user queries into vector embeddings offline. Ensure the `models/` folder is included in the package for target machines (or run `python3 download_model_from_github.py` on machines with internet connection).

> * **Wasm Directory**: The Go server downloads necessary WASM runtime engines into the `wasm/` directory on startup. If target machines will run fully offline, run the Go server once on an online host to populate this directory, and then pack the folder for offline target machines.

### Step 2: Running the Executable on the Target System

#### On Windows:
1. Extract the packaged files into a single directory.

2. Open Command Prompt or PowerShell in that directory.

3. Launch the server:
   ```cmd
   .\pdflrt.exe
   ```
   *(Or simply double-click the `pdflrt.exe` icon in File Explorer).*

#### On Linux or macOS:
1. Extract the files into a single directory.

2. Open a terminal and navigate to the directory.

3. Grant executable permissions to the binary:
   ```bash
   chmod +x pdflrt
   ```

4. Launch the server:
   ```bash
   ./pdflrt
   ```

### Step 3: Accessing the Application
Once the server prints `Main HTTP Server starting on http://localhost:8085`, open a web browser:

* **Local access**: Navigate to `http://localhost:8085`.

* **Network access (e.g. tablet/iPad)**: Navigate to `http://<host-ip-address>:8085`. (Ensure the host system's firewall allows incoming connections on port `8085`).
