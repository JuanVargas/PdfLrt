import os
import fitz  # PyMuPDF
import json
import base64
import re
import sys

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PDF_DIR = os.path.join(BASE_DIR, "PdfDir")
OUTPUT_FILE = os.path.join(PDF_DIR, "knowledge_base.json")

# Import sentence-transformers for local, offline embeddings
try:
    from sentence_transformers import SentenceTransformer
except ImportError:
    print("Error: sentence-transformers is not installed. Please run: pip install sentence-transformers")
    sys.exit(1)

def process_pdfs():
    kb = {
        "chunks": [],
        "figures": []
    }

    if not os.path.exists(PDF_DIR):
        print(f"Directory {PDF_DIR} not found. Creating it...")
        os.makedirs(PDF_DIR, exist_ok=True)
        print("Please place PDF manuals in PdfDir and run this script again.")
        return

    # Check if we can load/download the embedding model
    model_path = os.path.join(BASE_DIR, "models", "nomic-ai", "nomic-embed-text-v1.5")
    if os.path.exists(model_path):
        print(f"Loading local embedding model from {model_path}...")
        try:
            model = SentenceTransformer(model_path, trust_remote_code=True)
            print("Local embedding model loaded successfully.")
        except Exception as e:
            print(f"Failed to load local embedding model: {e}")
            sys.exit(1)
    else:
        print("Loading local embedding model 'nomic-ai/nomic-embed-text-v1.5' from Hugging Face...")
        try:
            # trust_remote_code=True is required for nomic-embed-text
            model = SentenceTransformer("nomic-ai/nomic-embed-text-v1.5", trust_remote_code=True)
            print("Embedding model loaded successfully from online hub.")
        except Exception as e:
            print(f"Failed to load embedding model: {e}")
            sys.exit(1)

    pdf_files = [f for f in os.listdir(PDF_DIR) if f.lower().endswith(".pdf")]
    if not pdf_files:
        print(f"No PDF files found in {PDF_DIR}.")
        # Create an empty knowledge base file so the server can start/be sync'd
        with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
            json.dump(kb, f)
        print(f"Created empty knowledge base at {OUTPUT_FILE}")
        return

    for filename in pdf_files:
        filepath = os.path.join(PDF_DIR, filename)
        print(f"Processing {filename}...")
        seen_figures = set()
        
        try:
            doc = fitz.open(filepath)
        except Exception as e:
            print(f"Failed to open {filename}: {e}")
            continue

        for page_num in range(len(doc)):
            page = doc[page_num]
            blocks = page.get_text("blocks")
            page_text = ""
            
            for b in blocks:
                # b is (x0, y0, x1, y1, text, block_no, block_type)
                # block_type 0 is text
                if b[6] != 0:
                    continue
                    
                text = b[4].strip()
                if not text:
                    continue
                    
                clean_text = text.replace('\n', ' ')
                page_text += clean_text + " "

                # Figure detection heuristic: check each line in the block for figure/table caption tags
                for line in text.split('\n'):
                    line_clean = line.strip()
                    match = re.match(r'^(?:Figure|Fig\.?|Fi gure|Table|Tab\.?)\s*(\d+(?:\s*[-.]\s*\d+)*[a-zA-Z]?)\b[:.-]?\s*(.*)', line_clean, re.IGNORECASE)
                    if match:
                        caption = match.group(0)
                        if "...." in line_clean or "· · ·" in line_clean or "____" in line_clean:
                            continue
                            
                        raw_id = match.group(1)
                        # Normalize ID to use hyphens (e.g. Figure 7-2)
                        fig_id = re.sub(r'\s+', '', raw_id).replace('.', '-')
                        
                        if fig_id in seen_figures:
                            continue
                        seen_figures.add(fig_id)
                        
                        print(f"  -> Found Visual Element {fig_id} on page {page_num + 1}")
                        
                        # Render the full page to base64 image (resolution multiplier 1.5)
                        try:
                            pix = page.get_pixmap(matrix=fitz.Matrix(1.5, 1.5))
                            img_data = pix.tobytes("jpeg")
                            b64 = base64.b64encode(img_data).decode('utf-8')
                            img_uri = f"data:image/jpeg;base64,{b64}"
                            
                            kb["figures"].append({
                                "source": filename,
                                "id": fig_id,
                                "caption": line_clean,
                                "image": img_uri,
                                "page": page_num + 1
                            })
                        except Exception as render_err:
                            print(f"  -> Warning: Failed to render page {page_num+1} image: {render_err}")
                    
            # Chunk the page text with overlap
            chunk_size = 1200
            overlap = 200
            start = 0
            page_text = page_text.strip()
            
            # Extract chunks
            chunks_to_embed = []
            chunk_metadata = []
            
            while start < len(page_text):
                end = min(start + chunk_size, len(page_text))
                
                if end < len(page_text):
                    last_period = page_text.rfind('. ', start, end)
                    if last_period != -1 and (end - last_period) < 300:
                        end = last_period + 1
                    else:
                        last_space = page_text.rfind(' ', start, end)
                        if last_space != -1:
                            end = last_space
                            
                chunk = page_text[start:end].strip()
                if len(chunk) > 50:
                    enriched = f"Document: {filename} (Page {page_num + 1})\n{chunk}"
                    chunks_to_embed.append(enriched)
                    chunk_metadata.append({
                        "source": filename,
                        "text": enriched,
                        "page": page_num + 1
                    })
                
                if end >= len(page_text):
                    break
                    
                start = end - overlap
                if start < 0:
                    start = 0

            # Batch embed chunks for this page
            if chunks_to_embed:
                try:
                    embeddings = model.encode(chunks_to_embed, show_progress_bar=False)
                    for i, emb in enumerate(embeddings):
                        metadata = chunk_metadata[i]
                        kb["chunks"].append({
                            "source": metadata["source"],
                            "text": metadata["text"],
                            "page": metadata["page"],
                            "embedding": emb.tolist()
                        })
                except Exception as emb_err:
                    print(f"  -> Error generating embeddings for page {page_num+1}: {emb_err}")
                    # If embedding fails, append chunk with empty embedding
                    for metadata in chunk_metadata:
                        kb["chunks"].append({
                            "source": metadata["source"],
                            "text": metadata["text"],
                            "page": metadata["page"],
                            "embedding": []
                        })

        doc.close()

    # Save to file
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(kb, f)
    
    print(f"\nKnowledge base saved to {OUTPUT_FILE}")
    print(f"Extracted {len(kb['chunks'])} text chunks (with embeddings) and {len(kb['figures'])} visual assets.")

    # Also make a symbolic link or backup as knowledge_base.json for compatibility/robustness
    alt_output = os.path.join(PDF_DIR, "knowledge_base.json")
    try:
        with open(alt_output, "w", encoding="utf-8") as f:
            json.dump(kb, f)
        print(f"Compatibility knowledge base copy saved to {alt_output}")
    except Exception as e:
        pass

if __name__ == "__main__":
    process_pdfs()
