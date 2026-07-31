import os
import sys
import urllib.request
import tarfile

# Constants
DEFAULT_OWNER = "JuanVargas"
DEFAULT_REPO = "PdfLrt"
DEFAULT_TAG = "v1.0.0-models"
FILENAME = "nomic-embed-text-v1.5.tar.gz"

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MODELS_DIR = os.path.join(BASE_DIR, "models")

def download_and_extract(owner, repo, tag):
    url = f"https://github.com/{owner}/{repo}/releases/download/{tag}/{FILENAME}"
    target_tar = os.path.join(MODELS_DIR, FILENAME)
    
    os.makedirs(MODELS_DIR, exist_ok=True)
    
    print(f"Downloading model package from: {url}")
    print(f"Saving to: {target_tar}")
    
    try:
        def progress_hook(count, block_size, total_size):
            if total_size > 0:
                percent = int(count * block_size * 100 / total_size)
                percent = min(percent, 100)
                sys.stdout.write(f"\rDownloading... {percent}%")
                sys.stdout.flush()
        
        urllib.request.urlretrieve(url, target_tar, reporthook=progress_hook)
        print("\nDownload completed successfully.")
    except Exception as e:
        print(f"\nError downloading the model: {e}")
        print("\nEnsure that:")
        print(f"1. The release with tag '{tag}' exists in repository '{owner}/{repo}'.")
        print(f"2. The file '{FILENAME}' is attached as a release asset.")
        print("3. You have an active internet connection to github.com.")
        sys.exit(1)
        
    print(f"Extracting model files to {MODELS_DIR}...")
    try:
        with tarfile.open(target_tar, 'r:gz') as tar_ref:
            tar_ref.extractall(MODELS_DIR)
        print("Extraction complete!")
        
        # Clean up tar file
        os.remove(target_tar)
        print("Cleaned up temporary tar.gz archive.")
        print(f"Model is ready locally at {os.path.join(MODELS_DIR, 'nomic-embed-text-v1.5')}")
    except Exception as e:
        print(f"Error during extraction: {e}")
        sys.exit(1)

if __name__ == "__main__":
    owner = DEFAULT_OWNER
    repo = DEFAULT_REPO
    tag = DEFAULT_TAG
    
    # Allow overriding via command line arguments
    if len(sys.argv) > 1:
        tag = sys.argv[1]
    if len(sys.argv) > 2:
        owner = sys.argv[2]
    if len(sys.argv) > 3:
        repo = sys.argv[3]
        
    download_and_extract(owner, repo, tag)
