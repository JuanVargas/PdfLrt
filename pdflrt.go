package main

import (
	"encoding/json"
	"fmt"
	"io"
	"mime"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/xuri/excelize/v2"
)

// ---------- Config & Env ----------
var (
	httpPort = getEnv("HTTP_PORT", "8080")
)

func getEnv(key, defaultVal string) string {
	if val, ok := os.LookupEnv(key); ok {
		return val
	}
	return defaultVal
}

// ---------- Data Structures ----------
type TextChunk struct {
	Source    string    `json:"source"`
	Text      string    `json:"text"`
	Page      int       `json:"page"`
	Embedding []float32 `json:"embedding"`
}

type Figure struct {
	Source  string `json:"source"`
	ID      string `json:"id"`
	Caption string `json:"caption"`
	Image   string `json:"image"` // base64 JPEG data URI
}

type KnowledgeBase struct {
	Chunks  []TextChunk `json:"chunks"`
	Figures []Figure    `json:"figures"`
}

type DialogEntry struct {
	Q string `json:"q"`
	A string `json:"a"`
}

// Global Memory Vector Database Metadata
var (
	kbMutex sync.RWMutex
	kbCount struct {
		Chunks  int `json:"chunks"`
		Figures int `json:"figures"`
	}
)

var server *http.Server

// Certificate generation deleted for pure HTTP execution

// ---------- Read/Load Knowledge Base Statistics ----------
func loadKnowledgeBaseStats() error {
	kbMutex.Lock()
	defer kbMutex.Unlock()

	kbFile := filepath.Join("PdfDir", "knowledge_base.json")

	if _, err := os.Stat(kbFile); os.IsNotExist(err) {
		kbCount.Chunks = 0
		kbCount.Figures = 0
		fmt.Println("⚠️  knowledge_base.json not found. Ingest documents first.")
		return nil
	}

	data, err := os.ReadFile(kbFile)
	if err != nil {
		return fmt.Errorf("failed to read knowledge base file: %v", err)
	}

	var tempKB struct {
		Chunks  []interface{} `json:"chunks"`
		Figures []interface{} `json:"figures"`
	}
	if err := json.Unmarshal(data, &tempKB); err != nil {
		return fmt.Errorf("failed to parse knowledge base: %v", err)
	}

	kbCount.Chunks = len(tempKB.Chunks)
	kbCount.Figures = len(tempKB.Figures)
	fmt.Printf("📂 Knowledge Base stats loaded: %d text chunks and %d visual assets.\n", kbCount.Chunks, kbCount.Figures)
	return nil
}

// ---------- API Response Helpers ----------

type APIResponse struct {
	Status  string `json:"status,omitempty"`
	Message string `json:"message,omitempty"`
	Error   string `json:"error,omitempty"`
	Chunks  int    `json:"chunks"`
	Figures int    `json:"figures"`
	File    string `json:"file,omitempty"`
}

func writeJSON(w http.ResponseWriter, status int, data APIResponse) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(data)
}

// ---------- API Request Handlers ----------

func handleStop(w http.ResponseWriter, r *http.Request) {
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(`{"status": "stopping"}`))

	go func() {
		time.Sleep(1 * time.Second)
		fmt.Println("\nShutting down server...")
		if server != nil {
			_ = server.Close()
		}
		os.Exit(0)
	}()
}

func handleListPDFs(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	var pdfs []string

	entries, err := os.ReadDir("PdfDir")
	if err == nil {
		for _, e := range entries {
			if !e.IsDir() && strings.HasSuffix(strings.ToLower(e.Name()), ".pdf") {
				pdfs = append(pdfs, e.Name())
			}
		}
	}

	if pdfs == nil {
		pdfs = []string{}
	}

	out, _ := json.Marshal(pdfs)
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(out)
}

func handleReloadIndex(w http.ResponseWriter, r *http.Request) {
	if err := loadKnowledgeBaseStats(); err != nil {
		writeJSON(w, http.StatusInternalServerError, APIResponse{Error: err.Error()})
		return
	}

	kbMutex.RLock()
	defer kbMutex.RUnlock()

	writeJSON(w, http.StatusOK, APIResponse{Status: "success", Chunks: kbCount.Chunks, Figures: kbCount.Figures})
}

func handleSyncKnowledgeBase(w http.ResponseWriter, r *http.Request) {
	// Trigger build_knowledge_base.py via the Docker script
	fmt.Println("🔄 Triggering knowledge base synchronization via Docker container...")
	
	var cmd *exec.Cmd
	if runtime.GOOS == "windows" {
		cmd = exec.Command("cmd", "/c", "run_ingest.bat")
	} else {
		cmd = exec.Command("/bin/bash", "./run_ingest.sh")
	}
	
	output, err := cmd.CombinedOutput()
	if err != nil {
		fmt.Printf("❌ Ingestion script failed: %v\nOutput:\n%s\n", err, string(output))
		writeJSON(w, http.StatusInternalServerError, APIResponse{
			Status:  "error",
			Error:   err.Error(),
			Message: string(output),
		})
		return
	}

	fmt.Println("✅ Knowledge base built successfully.")
	
	// Reload stats
	_ = loadKnowledgeBaseStats()

	kbMutex.RLock()
	defer kbMutex.RUnlock()

	writeJSON(w, http.StatusOK, APIResponse{Status: "success", Chunks: kbCount.Chunks, Figures: kbCount.Figures})
}

func handleSaveDialog(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	bodyBytes, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "Error reading request", http.StatusBadRequest)
		return
	}

	var dialogs []DialogEntry
	if err := json.Unmarshal(bodyBytes, &dialogs); err != nil {
		http.Error(w, "Error parsing json", http.StatusBadRequest)
		return
	}

	targetDir := filepath.Join("Dialogs")
	if err := os.MkdirAll(targetDir, 0755); err != nil {
		http.Error(w, "Internal Server Error", http.StatusInternalServerError)
		return
	}

	// File named "PdfLrt_Dialog_date_time.xlsx" as requested
	filename := fmt.Sprintf("PdfLrt_Dialog_%s.xlsx", time.Now().Format("20060102_150405"))
	targetFile := filepath.Join(targetDir, filename)

	f := excelize.NewFile()
	defer func() {
		_ = f.Close()
	}()

	// Columns named "Questions" and "Answers" as requested
	_ = f.SetCellValue("Sheet1", "A1", "Questions")
	_ = f.SetCellValue("Sheet1", "B1", "Answers")

	// Apply headers styling
	style, err := f.NewStyle(&excelize.Style{
		Font: &excelize.Font{Bold: true, Color: "FFFFFF"},
		Fill: excelize.Fill{Type: "pattern", Color: []string{"3B82F6"}, Pattern: 1},
	})
	if err == nil {
		_ = f.SetCellStyle("Sheet1", "A1", "B1", style)
	}

	for i, entry := range dialogs {
		row := i + 2
		_ = f.SetCellValue("Sheet1", fmt.Sprintf("A%d", row), entry.Q)
		_ = f.SetCellValue("Sheet1", fmt.Sprintf("B%d", row), entry.A)
	}

	// Set column widths for nice appearance
	_ = f.SetColWidth("Sheet1", "A", "A", 40)
	_ = f.SetColWidth("Sheet1", "B", "B", 60)

	if err := f.SaveAs(targetFile); err != nil {
		fmt.Printf("Error saving excel file: %v\n", err)
		http.Error(w, "Internal Server Error", http.StatusInternalServerError)
		return
	}

	fmt.Printf("✅ Saved dialog session to %s with %d entries.\n", targetFile, len(dialogs))
	writeJSON(w, http.StatusOK, APIResponse{Status: "success", File: filename})
}

func downloadWasmFiles() {
	_ = os.MkdirAll("wasm", 0755)
	
	// Define files and their corresponding CDN download URLs
	downloads := []struct {
		filename string
		url      string
	}{
		{"tasks-genai.js", "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-genai"},
		{"genai_wasm_internal.js", "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-genai/wasm/genai_wasm_internal.js"},
		{"genai_wasm_internal.wasm", "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-genai/wasm/genai_wasm_internal.wasm"},
		{"ort-wasm-simd-threaded.wasm", "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.26.0-dev.20260416-b7804b056c/dist/ort-wasm-simd-threaded.wasm"},
		{"ort-wasm-simd-threaded.mjs", "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.26.0-dev.20260416-b7804b056c/dist/ort-wasm-simd-threaded.mjs"},
		{"ort-wasm-simd-threaded.asyncify.wasm", "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.26.0-dev.20260416-b7804b056c/dist/ort-wasm-simd-threaded.asyncify.wasm"},
		{"ort-wasm-simd-threaded.asyncify.mjs", "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.26.0-dev.20260416-b7804b056c/dist/ort-wasm-simd-threaded.asyncify.mjs"},
	}

	for _, dl := range downloads {
		path := filepath.Join("wasm", dl.filename)
		if _, err := os.Stat(path); os.IsNotExist(err) {
			fmt.Printf("Downloading %s from CDN for offline same-origin serving...\n", dl.filename)
			resp, err := http.Get(dl.url)
			if err != nil {
				fmt.Printf("Failed to download %s: %v\n", dl.filename, err)
				continue
			}
			
			out, err := os.Create(path)
			if err != nil {
				resp.Body.Close()
				fmt.Printf("Failed to create file %s: %v\n", dl.filename, err)
				continue
			}
			
			_, err = io.Copy(out, resp.Body)
			out.Close()
			resp.Body.Close()
			
			if err != nil {
				fmt.Printf("Failed to save %s: %v\n", dl.filename, err)
			} else {
				fmt.Printf("Successfully downloaded %s\n", dl.filename)
			}
		}
	}
}

func main() {
	// Register custom mime types to ensure proper wasm/mjs loading in browser
	_ = mime.AddExtensionType(".wasm", "application/wasm")
	_ = mime.AddExtensionType(".mjs", "application/javascript")

	// Create required folders
	_ = os.MkdirAll("PdfDir", 0755)
	_ = os.MkdirAll("Dialogs", 0755)
	_ = os.MkdirAll("wasm", 0755)

	// Download WASM resources for offline same-origin resolution
	downloadWasmFiles()

	// Pre-load current knowledge base stats if file exists
	_ = loadKnowledgeBaseStats()

	// File Server for local static files
	fs := http.FileServer(http.Dir("."))
	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		// Set headers to support offline caching and WebAssembly threads/WebGPU
		w.Header().Set("Service-Worker-Allowed", "/")
		// COOP and COEP are critical for SharedArrayBuffer support in browsers
		w.Header().Set("Cross-Origin-Opener-Policy", "same-origin")
		w.Header().Set("Cross-Origin-Embedder-Policy", "require-corp")
		w.Header().Set("Access-Control-Allow-Origin", "*")
		fs.ServeHTTP(w, r)
	})

	http.HandleFunc("/api/stop", handleStop)
	http.HandleFunc("/api/pdfs", handleListPDFs)
	http.HandleFunc("/api/reload", handleReloadIndex)
	http.HandleFunc("/api/sync", handleSyncKnowledgeBase)
	http.HandleFunc("/api/savedialog", handleSaveDialog)

	fmt.Println("========================================================================")
	fmt.Printf("🚀 PdfLrt HTTP Server starting on http://localhost:%s\n", httpPort)
	fmt.Println("========================================================================")
	fmt.Println("💡 WebGPU Linux & Nvidia Optimization Tip:")
	fmt.Println("   Chrome may behave erratically or disable WebGPU on Linux with Nvidia GPUs.")
	fmt.Println("   To run with WebGPU enabled safely without flickering or lag, run:")
	fmt.Println("   google-chrome --enable-unsafe-webgpu --enable-features=Vulkan --ozone-platform=x11")
	fmt.Println("========================================================================")
	server = &http.Server{Addr: ":" + httpPort}
	err := server.ListenAndServe()
	if err != nil && err != http.ErrServerClosed {
		fmt.Printf("HTTP Server failed: %v\n", err)
		os.Exit(1)
	}
}
