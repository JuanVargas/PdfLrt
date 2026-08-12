import os
import fitz  # PyMuPDF
import json
import base64
import re
import sys
import argparse

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# Import sentence-transformers for local, offline embeddings
try:
    from sentence_transformers import SentenceTransformer
except ImportError:
    print("Error: sentence-transformers is not installed. Please run: pip install sentence-transformers")
    sys.exit(1)

def process_pdfs(pdf_dir_arg=None, output_dir_arg=None):
    pdf_dir = os.path.abspath(pdf_dir_arg) if pdf_dir_arg else os.path.join(BASE_DIR, "PdfDir")
    
    if output_dir_arg:
        target_parent = os.path.abspath(output_dir_arg)
    else:
        target_parent = pdf_dir
        
    kb_dir = os.path.join(target_parent, "kb")
    os.makedirs(kb_dir, exist_ok=True)
    
    output_file = os.path.join(kb_dir, "knowledge_base.json")
    figures_dir = os.path.join(kb_dir, "figures")
    
    print(f"📖 PDF Input Directory: {pdf_dir}")
    print(f"💾 Knowledge Base Output Directory: {kb_dir}")

    kb = {
        "chunks": [],
        "figures": []
    }

    if not os.path.exists(pdf_dir):
        print(f"Directory {pdf_dir} not found. Creating it...")
        os.makedirs(pdf_dir, exist_ok=True)
        print("Please place PDF manuals in the PDF directory and run this script again.")
        return

    # Check if we can load/download the embedding model
    model_local_path = "models/nomic-ai/nomic-embed-text-v1.5"
    model_hf_name = "nomic-ai/nomic-embed-text-v1.5"
    
    print("Loading embedding model...")
    model = None
    
    # Try loading from local path first
    if os.path.exists(model_local_path):
        print(f"Attempting to load from local directory: {model_local_path}...")
        try:
            model = SentenceTransformer(model_local_path, trust_remote_code=True)
            print("Successfully loaded model from local directory.")
        except Exception as e:
            print(f"Warning: Failed to load from local directory: {e}")
            
    # If local load failed or directory was not found, try Hugging Face Hub
    if model is None:
        print(f"Attempting to download/load from Hugging Face Hub: {model_hf_name}...")
        try:
            model = SentenceTransformer(model_hf_name, trust_remote_code=True)
            print("Successfully loaded model from Hugging Face Hub.")
        except Exception as e:
            print(f"Failed to load embedding model: {e}")
            sys.exit(1)

    pdf_files = [f for f in os.listdir(pdf_dir) if f.lower().endswith(".pdf")]
    if not pdf_files:
        print(f"No PDF files found in {pdf_dir}.")
        # Create an empty knowledge base file so the server can start/be sync'd
        with open(output_file, "w", encoding="utf-8") as f:
            json.dump(kb, f)
        print(f"Created empty knowledge base at {output_file}")
        return

    for filename in pdf_files:
        filepath = os.path.join(pdf_dir, filename)
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
                        
                        # Save the page as a JPEG file
                        try:
                            # Ensure figures subdirectory in target kb folder exists
                            os.makedirs(figures_dir, exist_ok=True)
                            
                            pix = page.get_pixmap(matrix=fitz.Matrix(1.5, 1.5))
                            # Create a clean, safe filename
                            safe_source = re.sub(r'[^a-zA-Z0-9._-]', '_', filename)
                            safe_fig_id = re.sub(r'[^a-zA-Z0-9._-]', '_', fig_id)
                            image_filename = f"{safe_source}_page{page_num + 1}_{safe_fig_id}.jpg"
                            image_path = os.path.join(figures_dir, image_filename)
                            
                            pix.save(image_path)
                            
                            # Relative path inside knowledge base folder
                            relative_img_uri = f"figures/{image_filename}"
                            
                            kb["figures"].append({
                                "source": filename,
                                "id": fig_id,
                                "caption": line_clean,
                                "image": relative_img_uri,
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
    with open(output_file, "w", encoding="utf-8") as f:
        json.dump(kb, f)
    
    print(f"\nKnowledge base saved to {output_file}")
    print(f"Extracted {len(kb['chunks'])} text chunks (with embeddings) and {len(kb['figures'])} visual assets.")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Build Knowledge Base from PDFs for PdfLrt")
    parser.add_argument("--pdf-dir", "-p", type=str, default=None, help="Directory containing PDF files")
    parser.add_argument("--output-dir", "-o", type=str, default=None, help="Output folder where 'kb' subfolder will be created")
    args = parser.parse_args()
    process_pdfs(pdf_dir_arg=args.pdf_dir, output_dir_arg=args.output_dir)
