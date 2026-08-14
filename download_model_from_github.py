import os
import sys
import urllib.request
import tarfile
import ssl

# Constants
DEFAULT_OWNER = "JuanVargas"
DEFAULT_REPO = "PdfLrt"
DEFAULT_TAG = "v1.0.0-models"
FILENAME = "nomic-embed-text-v1.5.tar.gz"

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MODELS_DIR = os.path.join(BASE_DIR, "models")
TARGET_MODEL_DIR = os.path.join(MODELS_DIR, "nomic-ai", "nomic-embed-text-v1.5")

def get_ssl_context():
    # Create non-verifying SSL context for platforms (like macOS) with unconfigured root certificates
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    return ctx

def download_from_huggingface():
    print("\nAttempting direct download of ONNX embedding model from Hugging Face...")
    base_url = "https://huggingface.co/nomic-ai/nomic-embed-text-v1.5/resolve/main/"
    files = [
        "config.json",
        "tokenizer.json",
        "tokenizer_config.json",
        "special_tokens_map.json",
        "onnx/model.onnx"
    ]
    
    os.makedirs(os.path.join(TARGET_MODEL_DIR, "onnx"), exist_ok=True)
    ctx = get_ssl_context()

    for f in files:
        url = base_url + f
        dest = os.path.join(TARGET_MODEL_DIR, f)
        print(f"Downloading {f}...")
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
            with urllib.request.urlopen(req, context=ctx) as resp, open(dest, 'wb') as out:
                total = int(resp.headers.get('content-length', 0))
                downloaded = 0
                block_size = 1024 * 1024 # 1MB
                while True:
                    buffer = resp.read(block_size)
                    if not buffer:
                        break
                    downloaded += len(buffer)
                    out.write(buffer)
                    if total > 0:
                        percent = int(downloaded * 100 / total)
                        sys.stdout.write(f"\rDownloading {f}... {percent}% ({downloaded / (1024*1024):.1f} MB / {total / (1024*1024):.1f} MB)")
                        sys.stdout.flush()
            print(f"\nSaved {f} successfully.")
        except Exception as e:
            print(f"\nFailed to download {f}: {e}")
            return False

    print(f"\n✅ All ONNX model files saved to {TARGET_MODEL_DIR}")
    return True

def download_and_extract(owner, repo, tag):
    url = f"https://github.com/{owner}/{repo}/releases/download/{tag}/{FILENAME}"
    target_tar = os.path.join(MODELS_DIR, FILENAME)
    
    os.makedirs(MODELS_DIR, exist_ok=True)
    
    if os.path.exists(os.path.join(TARGET_MODEL_DIR, "onnx", "model.onnx")):
        print(f"✅ Local model already exists at {TARGET_MODEL_DIR}")
        return

    print(f"Downloading model package from GitHub Release: {url}")
    print(f"Saving to: {target_tar}")
    
    ctx = get_ssl_context()
    
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, context=ctx) as resp, open(target_tar, 'wb') as out:
            total = int(resp.headers.get('content-length', 0))
            downloaded = 0
            block_size = 1024 * 1024
            while True:
                buffer = resp.read(block_size)
                if not buffer:
                    break
                downloaded += len(buffer)
                out.write(buffer)
                if total > 0:
                    percent = int(downloaded * 100 / total)
                    sys.stdout.write(f"\rDownloading... {percent}%")
                    sys.stdout.flush()
        print("\nGitHub release download completed successfully.")
        
        print(f"Extracting model files to {MODELS_DIR}...")
        with tarfile.open(target_tar, 'r:gz') as tar_ref:
            tar_ref.extractall(MODELS_DIR)
        print("Extraction complete!")
        
        if os.path.exists(target_tar):
            os.remove(target_tar)
        print(f"Model is ready locally at {TARGET_MODEL_DIR}")
    except Exception as e:
        print(f"\nGitHub release download was unavailable or failed: {e}")
        if not download_from_huggingface():
            print("\n❌ Could not retrieve model files. Please check network connection.")
            sys.exit(1)

if __name__ == "__main__":
    owner = DEFAULT_OWNER
    repo = DEFAULT_REPO
    tag = DEFAULT_TAG
    
    if len(sys.argv) > 1:
        tag = sys.argv[1]
    if len(sys.argv) > 2:
        owner = sys.argv[2]
    if len(sys.argv) > 3:
        repo = sys.argv[3]
        
    download_and_extract(owner, repo, tag)

