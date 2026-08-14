# Reconstructing Nomic Embedding Model via GitHub Releases

This guide describes how to download the `nomic-embed-text-v1.5` embedding model from Hugging Face on an internet-connected Linux host, package it, upload it to a GitHub Release, and reconstruct it offline on a target Windows host.

---

## Phase 1: Download the Model to the Linux Host

On the internet-connected **Linux host**, you need to retrieve the PyTorch/Safetensors weights (for ingestion) and the ONNX weights (for the browser).

### Method A: Download via Python (Recommended)
Make sure you have `huggingface_hub` installed (`pip install huggingface_hub`), then run this python script inside your Linux `PdfLrt/` directory:

```python
import os
from huggingface_hub import snapshot_download

target_dir = os.path.join("models", "nomic-ai", "nomic-embed-text-v1.5")
print(f"Downloading model to {target_dir}...")
snapshot_download(
    repo_id="nomic-ai/nomic-embed-text-v1.5",
    local_dir=target_dir,
    ignore_patterns=["*.msgpack", "*.h5", "*.ot"]
)
print("Download complete!")
```

### Method B: Package Existing Local Folder
If you already have the `models/nomic-ai/nomic-embed-text-v1.5` folder on your Linux host, package it into a tarball using your existing script:
```bash
./package_model.sh
```
This generates the compressed file: `models/nomic-embed-text-v1.5.tar.gz` (approx. 1.44 GB).

---

## Phase 2: Split and Rename the Archive (Linux Host)

Since the browser interface on GitHub Releases times out on uploads larger than 1.0 GB, we split the 1.44 GB tarball into two smaller parts and append a `.zip` extension to bypass GitHub's file extension limits.

1. Navigate to the `models/` directory on your Linux host:
   ```bash
   cd /home/juan/code/go/PdfLrt/models/
   ```
2. Split the file into two **750 MB** parts:
   ```bash
   split -b 750M nomic-embed-text-v1.5.tar.gz nomic-embed-text-v1.5.tar.gz.part-
   ```
   *(Creates: `nomic-embed-text-v1.5.tar.gz.part-aa` and `nomic-embed-text-v1.5.tar.gz.part-ab`)*
3. Rename the split files to use the `.zip` extension:
   ```bash
   mv nomic-embed-text-v1.5.tar.gz.part-aa nomic-embed-text-v1.5.tar.gz.part-aa.zip
   mv nomic-embed-text-v1.5.tar.gz.part-ab nomic-embed-text-v1.5.tar.gz.part-ab.zip
   ```

---

## Phase 3: Create GitHub Release & Upload

1. Open your browser on the Linux host and go to your GitHub Releases page:
   **`https://github.com/JuanVargas/PdfLrt/releases`**
2. Click **Draft a new release** (or **New Release**).
3. Set the release details:
   * **Choose a tag**: Enter `v1.0.0-models` and click *Create new tag*.
   * **Release title**: Enter `v1.0.0-models`.
4. Scroll down to the uploader area: **"Attach binaries by dropping them here or selecting them"**.
5. Drag and drop the two `.zip` files:
   * `nomic-embed-text-v1.5.tar.gz.part-aa.zip`
   * `nomic-embed-text-v1.5.tar.gz.part-ab.zip`
6. Once the uploads complete, click **Publish release** at the bottom.

---

## Phase 4: Download and Reconstruct on the Windows Host

On the target **Windows host** (which has access only to `github.com`):

### 1. Download the Assets
1. Open the browser and go to your published release:
   **`https://github.com/JuanVargas/PdfLrt/releases/tag/v1.0.0-models`**
2. Download both zip files:
   * `nomic-embed-text-v1.5.tar.gz.part-aa.zip`
   * `nomic-embed-text-v1.5.tar.gz.part-ab.zip`
3. Move both files into the **`PdfLrt/models/`** folder. *(Create the `models/` folder if it does not exist).*

### 2. Merge the Files
1. Open the `PdfLrt/models/` folder in File Explorer.
2. Click on the address bar at the top of the window, type **`cmd`**, and press **Enter** to open Command Prompt in this folder.
3. Run the binary copy command to merge the files:
   ```cmd
   copy /b nomic-embed-text-v1.5.tar.gz.part-aa.zip + nomic-embed-text-v1.5.tar.gz.part-ab.zip nomic-embed-text-v1.5.tar.gz
   ```
4. Delete the temporary zip files:
   ```cmd
   del *.zip
   ```

### 3. Extract the Archive (Using Windows native `tar`)
In the same Command Prompt window, run the native Windows extraction command:
```cmd
tar -xvzf nomic-embed-text-v1.5.tar.gz
```
This extracts the files and recreates the required structure:
`PdfLrt/models/nomic-ai/nomic-embed-text-v1.5/...`

### 4. Cleanup
Once the extraction completes successfully, delete the tarball to free up disk space:
```cmd
del nomic-embed-text-v1.5.tar.gz
```
