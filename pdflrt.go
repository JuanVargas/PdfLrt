package main

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha1"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"io"
	"math/big"
	"mime"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/xuri/excelize/v2"
)

// ---------- Config & Env ----------
var (
	httpPort  = getEnv("HTTP_PORT", "8085")
	httpsPort = getEnv("HTTPS_PORT", "8443")
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

// ---------- SSL Certificate Auto-Generation ----------
func savePEM(path string, pemType string, bytes []byte) error {
	block := &pem.Block{
		Type:  pemType,
		Bytes: bytes,
	}
	return os.WriteFile(path, pem.EncodeToMemory(block), 0644)
}

func loadPEM(path string) ([]byte, error) {
	bytes, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	block, _ := pem.Decode(bytes)
	if block == nil {
		return nil, fmt.Errorf("failed to decode PEM block in %s", path)
	}
	return block.Bytes, nil
}

func saveECPrivateKey(path string, key *ecdsa.PrivateKey) error {
	bytes, err := x509.MarshalECPrivateKey(key)
	if err != nil {
		return err
	}
	return savePEM(path, "EC PRIVATE KEY", bytes)
}

func loadECPrivateKey(path string) (*ecdsa.PrivateKey, error) {
	bytes, err := loadPEM(path)
	if err != nil {
		return nil, err
	}
	return x509.ParseECPrivateKey(bytes)
}

func loadCertificate(path string) (*x509.Certificate, error) {
	bytes, err := loadPEM(path)
	if err != nil {
		return nil, err
	}
	return x509.ParseCertificate(bytes)
}

func generateCerts() error {
	var ips []net.IP
	ips = append(ips, net.ParseIP("127.0.0.1"), net.ParseIP("::1"))
	ifaces, _ := net.Interfaces()
	for _, i := range ifaces {
		addrs, _ := i.Addrs()
		for _, addr := range addrs {
			var ip net.IP
			switch v := addr.(type) {
			case *net.IPNet:
				ip = v.IP
			case *net.IPAddr:
				ip = v.IP
			}
			if ip != nil {
				ips = append(ips, ip)
			}
		}
	}

	var caPriv *ecdsa.PrivateKey
	var caTemplate *x509.Certificate
	var err error
	needsNewCA := false

	if _, err := os.Stat("ca.pem"); err == nil {
		if _, err := os.Stat("ca.key"); err == nil {
			caPriv, err = loadECPrivateKey("ca.key")
			if err == nil {
				caTemplate, err = loadCertificate("ca.pem")
			}
			if err != nil {
				fmt.Printf("⚠️ Error loading existing CA. Generating a new one: %v\n", err)
				needsNewCA = true
			}
		} else {
			needsNewCA = true
		}
	} else {
		needsNewCA = true
	}

	if needsNewCA {
		fmt.Println("Generating dedicated Root CA...")
		caPriv, err = ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
		if err != nil {
			return err
		}
		pubBytes, _ := x509.MarshalPKIXPublicKey(&caPriv.PublicKey)
		hash := sha1.Sum(pubBytes)
		caTemplate = &x509.Certificate{
			SerialNumber: big.NewInt(2048),
			Subject: pkix.Name{
				Organization: []string{"PdfLrt Local System"},
				CommonName:   "PdfLrt Root CA",
			},
			NotBefore:             time.Now().Add(-24 * time.Hour),
			NotAfter:              time.Now().Add(10 * 365 * 24 * time.Hour),
			IsCA:                  true,
			KeyUsage:              x509.KeyUsageCertSign | x509.KeyUsageCRLSign,
			BasicConstraintsValid: true,
			SubjectKeyId:          hash[:],
		}
		caBytes, err := x509.CreateCertificate(rand.Reader, caTemplate, caTemplate, &caPriv.PublicKey, caPriv)
		if err != nil {
			return err
		}

		_ = savePEM("ca.pem", "CERTIFICATE", caBytes)
		_ = saveECPrivateKey("ca.key", caPriv)
		caTemplate, _ = loadCertificate("ca.pem")
	}

	needsNewServerCert := false
	if _, err := os.Stat("cert.pem"); err != nil {
		needsNewServerCert = true
	} else if _, err := os.Stat("key.pem"); err != nil {
		needsNewServerCert = true
	} else if needsNewCA {
		needsNewServerCert = true
	} else {
		cert, err := loadCertificate("cert.pem")
		if err != nil {
			needsNewServerCert = true
		} else {
			if time.Now().After(cert.NotAfter) || time.Now().Add(30*24*time.Hour).After(cert.NotAfter) {
				needsNewServerCert = true
			} else {
				certIPs := make(map[string]bool)
				for _, ip := range cert.IPAddresses {
					certIPs[ip.String()] = true
				}
				for _, ip := range ips {
					if !certIPs[ip.String()] {
						needsNewServerCert = true
						break
					}
				}
			}
		}
	}

	if needsNewServerCert {
		fmt.Println("Generating Server Certificate signed by Root CA...")
		priv, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
		if err != nil {
			return err
		}

		certTemplate := x509.Certificate{
			SerialNumber: big.NewInt(1),
			Subject: pkix.Name{
				Organization: []string{"PdfLrt Local System"},
				CommonName:   "PdfLrt Server Leaf",
			},
			NotBefore:             time.Now().Add(-24 * time.Hour),
			NotAfter:              time.Now().Add(365 * 24 * time.Hour),
			KeyUsage:              x509.KeyUsageDigitalSignature | x509.KeyUsageKeyEncipherment,
			ExtKeyUsage:           []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
			BasicConstraintsValid: true,
			IPAddresses:           ips,
			DNSNames:              []string{"localhost"},
		}

		certBytes, err := x509.CreateCertificate(rand.Reader, &certTemplate, caTemplate, &priv.PublicKey, caPriv)
		if err != nil {
			return err
		}

		_ = savePEM("cert.pem", "CERTIFICATE", certBytes)
		_ = saveECPrivateKey("key.pem", priv)
		fmt.Println("✅ Server certs regenerated successfully.")
	}

	return nil
}

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
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	if err := loadKnowledgeBaseStats(); err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte(fmt.Sprintf(`{"error": "%s"}`, err.Error())))
		return
	}

	kbMutex.RLock()
	defer kbMutex.RUnlock()

	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(fmt.Sprintf(`{"status": "success", "chunks": %d, "figures": %d}`, kbCount.Chunks, kbCount.Figures)))
}

func handleSyncKnowledgeBase(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	// Trigger build_knowledge_base.py
	fmt.Println("🔄 Triggering knowledge base synchronization...")

	// Create context with a timeout of 10 minutes for large files
	cmd := exec.Command("python3", "build_knowledge_base.py")
	output, err := cmd.CombinedOutput()
	if err != nil {
		fmt.Printf("❌ Ingestion script failed: %v\nOutput:\n%s\n", err, string(output))
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte(fmt.Sprintf(`{"status": "error", "message": "%s: %s"}`, err.Error(), strings.ReplaceAll(string(output), "\n", " "))))
		return
	}

	fmt.Println("✅ Knowledge base built successfully.")

	// Reload stats
	_ = loadKnowledgeBaseStats()

	kbMutex.RLock()
	defer kbMutex.RUnlock()

	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(fmt.Sprintf(`{"status": "success", "chunks": %d, "figures": %d}`, kbCount.Chunks, kbCount.Figures)))
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

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(fmt.Sprintf(`{"status": "success", "file": "%s"}`, filename)))
}

func downloadWasmFiles() {
	_ = os.MkdirAll("wasm", 0755)
	
	// Define files and their corresponding CDN download URLs
	downloads := []struct {
		filename string
		url      string
	}{
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

	// Ensure SSL certificates exist for secure contexts (HTTPS)
	if err := generateCerts(); err != nil {
		fmt.Printf("Fatal: failed to generate certificates: %v\n", err)
		os.Exit(1)
	}

	// File Server for local static files
	fs := http.FileServer(http.Dir("."))
	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		fmt.Printf("[Static Server] %s %s\n", r.Method, r.URL.Path)
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

	// Run HTTP redirect to HTTPS
	go func() {
		fmt.Printf("Redirect server starting on http://localhost:%s\n", httpPort)
		err := http.ListenAndServe(":"+httpPort, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			host, _, _ := net.SplitHostPort(r.Host)
			if host == "" {
				host = r.Host
			}
			target := "https://" + host + ":" + httpsPort + r.URL.Path
			if r.URL.RawQuery != "" {
				target += "?" + r.URL.RawQuery
			}
			http.Redirect(w, r, target, http.StatusMovedPermanently)
		}))
		if err != nil {
			fmt.Printf("Redirect server error: %v\n", err)
		}
	}()

	fmt.Println("========================================================================")
	fmt.Printf("🚀 PdfLrt HTTPS Server starting on https://localhost:%s\n", httpsPort)
	fmt.Println("========================================================================")
	fmt.Println("💡 WebGPU Linux & Nvidia Optimization Tip:")
	fmt.Println("   Chrome may behave erratically or disable WebGPU on Linux with Nvidia GPUs.")
	fmt.Println("   To run with WebGPU enabled safely without flickering or lag, run:")
	fmt.Println("   google-chrome --enable-unsafe-webgpu --enable-features=Vulkan --ozone-platform=x11")
	fmt.Println("========================================================================")
	server = &http.Server{Addr: ":" + httpsPort}
	err := server.ListenAndServeTLS("cert.pem", "key.pem")
	if err != nil && err != http.ErrServerClosed {
		fmt.Printf("HTTPS Server failed: %v\n", err)
		os.Exit(1)
	}
}
