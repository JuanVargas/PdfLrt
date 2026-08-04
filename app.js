// app.js - PdfLrt Frontend Controller

let worker = null;
let kbData = null;
let chatMessageHistory = []; // stores [{q: "question", a: "answer"}] for Excel saving and context
let activeResponseEl = null;
let isRecording = false;
let isSpeakerEnabled = false;
let recognition = null;

// DOM Elements
const chatContainer = document.getElementById('chat-container');
const questionInput = document.getElementById('question');
const btnSend = document.getElementById('btn-send');
const btnMic = document.getElementById('btn-mic');
const btnSpeaker = document.getElementById('btn-speaker');
const btnSyncKb = document.getElementById('btn-sync-kb');
const btnSaveDialog = document.getElementById('btn-save-dialog');
const btnClearDialog = document.getElementById('btn-clear-dialog');
const btnStopServer = document.getElementById('btn-stop-server');
const modelPathInput = document.getElementById('model-path-input');
const btnLoadModel = document.getElementById('btn-load-model');
const deviceSelect = document.getElementById('device-select');
const modelStatusText = document.getElementById('model-status');
const dbStatusText = document.getElementById('status-db-text');
const modelStatusDetail = document.getElementById('status-model-text');
const loadedChunksText = document.getElementById('status-loaded-chunks');
const loadedFiguresText = document.getElementById('status-loaded-figures');
const progressContainer = document.getElementById('progress-container');
const progressBar = document.getElementById('progress-bar');
const pdfItemsContainer = document.getElementById('pdf-items-container');
const historyContainer = document.getElementById('history-container');

// Modal Elements
const imageModal = document.getElementById('image-modal');
const imageModalImg = document.getElementById('image-modal-img');
const imageModalClose = document.getElementById('image-modal-close');

// Close image modal on click
imageModalClose.onclick = () => { imageModal.style.display = 'none'; };
imageModal.onclick = (e) => { if(e.target === imageModal) imageModal.style.display = 'none'; };

// Troubleshoot WebGPU Modal Elements
const btnWebgpuTrouble = document.getElementById('btn-webgpu-trouble');
const webgpuTroubleModal = document.getElementById('webgpu-trouble-modal');
const btnCloseTrouble = document.getElementById('btn-close-trouble');
const btnCloseTroubleFooter = document.getElementById('btn-close-trouble-footer');

if (btnWebgpuTrouble) {
    btnWebgpuTrouble.onclick = () => {
        if (webgpuTroubleModal) {
            webgpuTroubleModal.style.display = 'flex';
            if (window.switchTroubleTab) window.switchTroubleTab('linux');
        }
    };
}
if (btnCloseTrouble) btnCloseTrouble.onclick = () => { webgpuTroubleModal.style.display = 'none'; };
if (btnCloseTroubleFooter) btnCloseTroubleFooter.onclick = () => { webgpuTroubleModal.style.display = 'none'; };
if (webgpuTroubleModal) {
    webgpuTroubleModal.onclick = (e) => {
        if (e.target === webgpuTroubleModal) webgpuTroubleModal.style.display = 'none';
    };
}

const btnForceReset = document.getElementById('btn-force-reset');
if (btnForceReset) {
    btnForceReset.onclick = async () => {
        if (confirm("This will clear the browser's PWA offline cache and unregister the service worker to force a clean reload. Proceed?")) {
            try {
                if ('serviceWorker' in navigator) {
                    const regs = await navigator.serviceWorker.getRegistrations();
                    for (let reg of regs) {
                        await reg.unregister();
                    }
                }
                if ('caches' in window) {
                    const keys = await caches.keys();
                    for (let key of keys) {
                        await caches.delete(key);
                    }
                }
                alert("Cache cleared successfully! Reloading page...");
                window.location.reload();
            } catch (err) {
                console.error("Failed to clear cache:", err);
                alert("Error clearing cache: " + err.message);
            }
        }
    };
}

// ---------- Audio STT / TTS Capabilities ----------

function initSpeechRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
        console.warn("Speech Recognition not supported in this browser.");
        return;
    }
    
    recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = 'en-US';

    recognition.onstart = () => {
        isRecording = true;
        btnMic.classList.add('recording');
    };

    recognition.onend = () => {
        isRecording = false;
        btnMic.classList.remove('recording');
    };

    recognition.onerror = (event) => {
        console.error("Speech recognition error:", event.error);
        isRecording = false;
        btnMic.classList.remove('recording');
    };

    recognition.onresult = (event) => {
        const text = event.results[0][0].transcript;
        questionInput.value = text;
        // Auto-send voice queries
        setTimeout(() => {
            handleUserMessage();
        }, 500);
    };
}

function speakText(text) {
    if (!isSpeakerEnabled || !('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel(); // cancel current speech
    
    // Clean markdown formatting before reading
    const cleanText = text.replace(/[*#`_\-]/g, '').replace(/\[.*?\]\(.*?\)/g, '');
    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.rate = 1.0;
    utterance.pitch = 1.0;
    window.speechSynthesis.speak(utterance);
}

// ---------- Vector Similarity helper ----------

function cosineSimilarity(a, b) {
    if (!a || !b || a.length !== b.length || a.length === 0) return 0;
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    if (normA === 0 || normB === 0) return 0;
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// ---------- Host API integrations ----------

async function fetchPDFList() {
    try {
        const res = await fetch('/api/pdfs');
        if (!res.ok) throw new Error("Failed to load PDF files list");
        const pdfs = await res.json();
        
        pdfItemsContainer.innerHTML = '';
        if (pdfs.length === 0) {
            pdfItemsContainer.innerHTML = '<div style="color: var(--text-muted); font-style: italic;">No PDF files found.</div>';
            return;
        }

        pdfs.forEach(pdf => {
            const item = document.createElement('div');
            item.className = 'pdf-item';
            item.innerHTML = `📄 <span title="${pdf}">${pdf}</span>`;
            pdfItemsContainer.appendChild(item);
        });
    } catch (e) {
        console.error("Error loading PDF list:", e);
    }
}

async function loadKnowledgeBaseJSON() {
    dbStatusText.innerHTML = "Loading...";
    dbStatusText.style.color = "var(--warning)";
    
    try {
        // Fetch the knowledge_base.json
        const res = await fetch('/PdfDir/knowledge_base.json');

        if (!res.ok) {
            dbStatusText.innerHTML = "Not Synchronized";
            dbStatusText.style.color = "var(--danger)";
            loadedChunksText.innerHTML = "Chunks Loaded: 0";
            loadedFiguresText.innerHTML = "Figures Extracted: 0";
            return;
        }

        kbData = await res.json();
        
        // Normalize loaded kbData to support older flat-array format compatibility
        if (Array.isArray(kbData)) {
            kbData = {
                chunks: kbData,
                figures: []
            };
        } else if (!kbData || typeof kbData !== 'object') {
            kbData = {
                chunks: [],
                figures: []
            };
        } else {
            if (!kbData.chunks) kbData.chunks = [];
            if (!kbData.figures) kbData.figures = [];
        }
        
        const chunksCount = kbData.chunks.length;
        const figuresCount = kbData.figures.length;
        
        loadedChunksText.innerHTML = `Chunks Loaded: ${chunksCount}`;
        loadedFiguresText.innerHTML = `Figures Extracted: ${figuresCount}`;
        dbStatusText.innerHTML = "Synchronized";
        dbStatusText.style.color = "var(--success)";
        
        appendMessage(false, `📂 **System**: Knowledge Base updated with ${chunksCount} text segments and ${figuresCount} visual figures.`, [], "SYSTEM");
    } catch (e) {
        console.error("Error loading knowledge base JSON:", e);
        dbStatusText.innerHTML = "Empty/Not Synchronized";
        dbStatusText.style.color = "var(--danger)";
    }
}

// ---------- Chat UI rendering ----------

function appendMessage(isUser, content, images = [], sender = "") {
    const msgContainer = document.createElement('div');
    msgContainer.className = 'msg-container';
    
    const bubble = document.createElement('div');
    bubble.className = isUser ? 'msg-q' : 'msg-a';

    if (sender) {
        const badge = document.createElement('span');
        badge.className = 'expert-badge';
        badge.innerHTML = `🤖 ${sender}`;
        badge.style.display = 'block';
        badge.style.fontSize = '10px';
        badge.style.marginBottom = '6px';
        badge.style.color = 'var(--accent)';
        bubble.appendChild(badge);
    }

    if (images && images.length > 0) {
        if (typeof images[0] === 'object') {
            const figureContainer = document.createElement('div');
            figureContainer.className = 'visual-figures-container';
            figureContainer.style.display = 'flex';
            figureContainer.style.flexDirection = 'column';
            figureContainer.style.gap = '20px';
            figureContainer.style.marginTop = '10px';
            figureContainer.style.marginBottom = '10px';
            
            images.forEach(fig => {
                const card = document.createElement('div');
                card.className = 'visual-figure-card';
                card.style.background = 'rgba(255, 255, 255, 0.03)';
                card.style.border = '1px solid var(--panel-border)';
                card.style.borderRadius = '12px';
                card.style.padding = '14px';
                card.style.display = 'flex';
                card.style.flexDirection = 'column';
                card.style.gap = '10px';
                
                const header = document.createElement('div');
                header.style.display = 'flex';
                header.style.justifyContent = 'space-between';
                header.style.fontSize = '12px';
                header.style.fontWeight = '600';
                header.style.borderBottom = '1px solid var(--panel-border)';
                header.style.paddingBottom = '6px';
                
                const idSpan = document.createElement('span');
                idSpan.style.color = 'var(--accent)';
                idSpan.innerHTML = `🖼️ Figure ${fig.id}`;
                
                const srcSpan = document.createElement('span');
                srcSpan.style.color = 'var(--text-muted)';
                const pageText = fig.page ? ` (Page ${fig.page})` : '';
                srcSpan.innerHTML = `Source: ${fig.source}${pageText}`;
                
                header.appendChild(idSpan);
                header.appendChild(srcSpan);
                card.appendChild(header);
                
                const imgWrapper = document.createElement('div');
                imgWrapper.className = 'context-img-wrapper';
                imgWrapper.style.maxHeight = '300px';
                imgWrapper.style.display = 'flex';
                imgWrapper.style.justifyContent = 'center';
                imgWrapper.style.background = '#fff';
                imgWrapper.style.borderRadius = '8px';
                imgWrapper.style.overflow = 'hidden';
                
                const img = document.createElement('img');
                img.src = fig.image;
                img.style.maxHeight = '298px';
                img.style.maxWidth = '100%';
                img.style.objectFit = 'contain';
                img.style.cursor = 'pointer';
                img.onclick = () => {
                    imageModalImg.src = fig.image;
                    imageModal.style.display = 'flex';
                };
                
                imgWrapper.appendChild(img);
                card.appendChild(imgWrapper);
                
                const captionDiv = document.createElement('div');
                captionDiv.style.fontSize = '13px';
                captionDiv.style.fontStyle = 'italic';
                captionDiv.style.color = 'var(--text-main)';
                captionDiv.innerHTML = formatMarkdown(fig.caption);
                card.appendChild(captionDiv);
                
                figureContainer.appendChild(card);
            });
            bubble.appendChild(figureContainer);
        } else {
            const imgContainer = document.createElement('div');
            imgContainer.className = 'context-images';
            images.forEach(imgData => {
                const wrapper = document.createElement('div');
                wrapper.className = 'context-img-wrapper';
                const img = document.createElement('img');
                img.src = imgData;
                img.className = 'context-img';
                img.onclick = () => {
                    imageModalImg.src = imgData;
                    imageModal.style.display = 'flex';
                };
                wrapper.appendChild(img);
                imgContainer.appendChild(wrapper);
            });
            bubble.appendChild(imgContainer);
        }
    }

    const textSpan = document.createElement('span');
    textSpan.innerHTML = isUser ? content : formatMarkdown(content);
    bubble.appendChild(textSpan);
    msgContainer.appendChild(bubble);
    chatContainer.appendChild(msgContainer);
    chatContainer.scrollTop = chatContainer.scrollHeight;
    
    return textSpan;
}

// Simple parser for styling markdown lists, bold texts, linebreaks
function formatMarkdown(text) {
    if (!text) return "";
    let formatted = text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.*?)\*/g, '<em>$1</em>')
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/\n/g, '<br>');
    return formatted;
}

// ---------- Core Q&A Action (LiteRT Engine Local Search) ----------

async function handleUserMessage() {
    const text = questionInput.value.trim();
    if (!text) return;
    
    questionInput.value = '';
    appendMessage(true, text);

    // 1. Classify query intent using simple regex-based local rules
    const intent = classifyQueryIntent(text);
    console.log("Classified Query Intent:", intent);

    if (intent === 'VISUAL') {
        const matchedFigs = findFigures(text);
        if (matchedFigs.length > 0) {
            appendMessage(
                false, 
                "", 
                matchedFigs, 
                "VISUAL_EXPERT"
            );
            
            const speakMsg = matchedFigs.length === 1 
                ? `Found 1 figure matching your request.` 
                : `Found ${matchedFigs.length} figures matching your request.`;
            speakText(speakMsg);
            
            // Save to chatMessageHistory for dialogue saving to Excel
            const dialogAnswer = matchedFigs.map(f => {
                const pageText = f.page ? ` (Page ${f.page})` : '';
                return `[Figure ${f.id} from ${f.source}${pageText}: ${f.caption}]`;
            }).join('\n');
            chatMessageHistory.push({ q: text, a: dialogAnswer });
            return;
        } else {
            // Friendly fallback showing list of available figures
            let responseText = "";
            if (!kbData || !kbData.figures || kbData.figures.length === 0) {
                responseText = "🔍 **Visual Expert**: I couldn't find any visual figures or tables in the loaded knowledge base. Please ensure that you have run the ingestion script on documents containing figure/table captions.";
            } else {
                responseText = `🔍 **Visual Expert**: I couldn't find a figure matching your request. \n\nHere are the figures and tables available in the loaded manuals:\n`;
                kbData.figures.slice(0, 10).forEach(f => {
                    responseText += `- **Figure/Table ${f.id}** (${f.source}): *${f.caption}*\n`;
                });
                if (kbData.figures.length > 10) {
                    responseText += `*(and ${kbData.figures.length - 10} more...)*\n`;
                }
            }
            appendMessage(false, responseText, [], "VISUAL_EXPERT");
            speakText("I couldn't find a matching figure.");
            chatMessageHistory.push({ q: text, a: responseText });
            return;
        }
    }

    // 2. Perform Semantic Search / RAG
    if (!kbData || !kbData.chunks || kbData.chunks.length === 0) {
        appendMessage(false, "⚠️ **System**: Knowledge Base is empty or not synchronized. Please load PDF files and click 'Sync Knowledge Base'.", [], "SYSTEM");
        return;
    }

    if (!worker) {
        appendMessage(false, "⚠️ **System**: LiteRT model is not loaded yet. Please wait for model initialization.", [], "SYSTEM");
        return;
    }

    // Append loading spinner
    const spinner = document.createElement('div');
    spinner.className = 'msg-container';
    spinner.innerHTML = `
        <div class="msg-a">
            <span class="expert-badge">🤖 RAG_RETRIEVER</span><br>
            <div class="typing-indicator">
                <span></span>
                <span></span>
                <span></span>
            </div>
        </div>`;
    chatContainer.appendChild(spinner);
    chatContainer.scrollTop = chatContainer.scrollHeight;

    // Save query context to resolve embedding response later
    window.currentQueryText = text;
    window.currentSpinnerEl = spinner;

    // Send embedding command to worker
    worker.postMessage({
        command: 'embed',
        data: { text: text }
    });
}

function classifyQueryIntent(query) {
    const qLower = query.toLowerCase();
    
    // Explicit commands to display figures/images/diagrams
    const visualPatterns = [
        "show figure", "display figure", "show image", "display image",
        "show diagram", "display diagram", "show table", "display table",
        "view figure", "view table", "view diagram", "show fig", "view fig"
    ];
    for (const p of visualPatterns) {
        if (qLower.includes(p)) return "VISUAL";
    }
    
    // If the query contains explanatory/informational words, it's a DESCRIBE intent
    const questionWords = [
        "what", "how", "why", "who", "where", "explain", "describe", 
        "tell me", "meaning", "voltage", "current", "pin", "wire", "connect"
    ];
    for (const word of questionWords) {
        if (qLower.includes(word)) return "DESCRIBE";
    }
    
    // Check for "figure", "fig", "table" followed by numbers (e.g. "Figure 7-2" as a standalone query)
    if (/(?:figure|fig\.?|table|tab\.?)\s*\d+/i.test(qLower)) {
        return "VISUAL";
    }
    
    return "DESCRIBE";
}

function findFigures(query) {
    if (!kbData || !kbData.figures) return [];
    
    // Find explicit matches (e.g. "Figure 3" or "Figure 7-2")
    const re = /(?:figure|fig\.?|table|tab\.?)\s*(\d+(?:\s*[-.]\s*\d+)*[a-z]?)/i;
    const match = query.match(re);
    
    let matched = [];
    let targetSource = null;
    
    // Check if any loaded source document name is mentioned anywhere in the query (robust matching)
    const qLower = query.toLowerCase();
    const uniqueSources = [...new Set(kbData.figures.map(f => f.source))];
    for (const src of uniqueSources) {
        const srcBase = src.replace(/\.pdf$/i, "").toLowerCase();
        // Check if query contains the document name (either base name or full name)
        if (qLower.includes(srcBase) || qLower.includes(src.toLowerCase())) {
            targetSource = src;
            break;
        }
    }
    
    if (match) {
        const requestedID = match[1].replace(/\s+/g, "").replace(/\./g, "-").toLowerCase();
        for (const fig of kbData.figures) {
            const cleanedFigID = fig.id.replace(/\s+/g, "").replace(/\./g, "-").toLowerCase();
            if (cleanedFigID === requestedID) {
                if (!targetSource || fig.source.toLowerCase() === targetSource.toLowerCase()) {
                    matched.push(fig);
                }
            }
        }
    }
    
    // Fallback semantic match on caption words if no explicit matches found
    if (matched.length === 0) {
        const terms = query.toLowerCase().split(/\s+/).filter(t => t.length >= 3 && t !== "figure" && t !== "from");
        if (terms.length > 0) {
            let candidates = [];
            for (const fig of kbData.figures) {
                if (targetSource && fig.source.toLowerCase() !== targetSource.toLowerCase()) {
                    continue;
                }
                const capLower = fig.caption.toLowerCase();
                let matches = 0;
                for (const term of terms) {
                    if (capLower.includes(term)) matches++;
                }
                if (matches >= 2) {
                    candidates.push({ fig, matches });
                }
            }
            candidates.sort((a, b) => b.matches - a.matches);
            matched = candidates.map(c => c.fig).slice(0, 5);
        }
    }
    
    return matched;
}

function getSourcesFootnote(chunks) {
    if (!chunks || chunks.length === 0) return "";
    const sourcesMap = {};
    chunks.forEach(c => {
        if (!c.source) return;
        if (!sourcesMap[c.source]) {
            sourcesMap[c.source] = new Set();
        }
        sourcesMap[c.source].add(c.page);
    });
    
    const parts = [];
    for (const src in sourcesMap) {
        const pages = Array.from(sourcesMap[src]).sort((a, b) => a - b);
        parts.push(`📄 <strong>${src}</strong> (Page${pages.length > 1 ? 's' : ''} ${pages.join(', ')})`);
    }
    return parts.length > 0 ? parts.join('<br>') : "";
}

function getSourcesFootnoteText(chunks) {
    if (!chunks || chunks.length === 0) return "";
    const sourcesMap = {};
    chunks.forEach(c => {
        if (!c.source) return;
        if (!sourcesMap[c.source]) {
            sourcesMap[c.source] = new Set();
        }
        sourcesMap[c.source].add(c.page);
    });
    
    const parts = [];
    for (const src in sourcesMap) {
        const pages = Array.from(sourcesMap[src]).sort((a, b) => a - b);
        parts.push(`- ${src} (Page${pages.length > 1 ? 's' : ''} ${pages.join(', ')})`);
    }
    return parts.join('\n');
}

function handleEmbedResult(queryEmbedding) {
    const text = window.currentQueryText;
    const spinner = window.currentSpinnerEl;
    if (spinner) spinner.remove();

    if (!kbData || !kbData.chunks) return;

    // Calculate similarity against chunks
    const scoredChunks = kbData.chunks.map(chunk => {
        const sim = cosineSimilarity(queryEmbedding, chunk.embedding);
        
        // Boost scores if keywords match the source filename or text
        let boost = 0;
        const qLower = text.toLowerCase();
        const srcLower = chunk.source.toLowerCase();
        const txtLower = chunk.text.toLowerCase();
        const terms = qLower.split(/\s+/).filter(t => t.length >= 3);
        
        for (const term of terms) {
            if (srcLower.includes(term)) boost += 0.02;
            if (txtLower.includes(term)) boost += 0.01;
        }

        return { chunk, score: sim + boost };
    });

    // Sort descending and slice top 4 chunks
    scoredChunks.sort((a, b) => b.score - a.score);
    const topChunks = scoredChunks.slice(0, 4).map(c => c.chunk);
    window.currentTopChunks = topChunks;

    // Update context snippets panel (RAG transparency)
    historyContainer.innerHTML = '';
    topChunks.forEach((chunk, i) => {
        const item = document.createElement('div');
        item.className = 'history-item';
        item.innerHTML = `
            <div class="history-q">🎯 Match ${i+1} (${(scoredChunks[i].score * 100).toFixed(0)}%)</div>
            <div class="history-a"><strong>Source:</strong> ${chunk.source} (Page ${chunk.page})<br>${chunk.text}</div>
        `;
        historyContainer.appendChild(item);
    });

    // Build context prompt
    const context = topChunks.map(c => c.text).join('\n\n');
    const modelUrl = modelPathInput.value.toLowerCase();
    
    let formattedPrompt = "";
    if (modelUrl.includes('llama')) {
        // Llama 3 / 3.2 Chat template
        formattedPrompt = `<|begin_of_text|><|start_header_id|>system<|end_header_id|>\n\nYou are a helpful, expert technical manual assistant. Use the following retrieved context snippets from the manuals to answer the user's question. If the answer cannot be found in the context, say "I don't know based on the provided documents." Do not invent facts. Cite the source document name and the page number for the facts you provide (e.g. "According to [document_name] (Page [page_num])...").\n\nContext:\n${context}<|eot_id|><|start_header_id|>user<|end_header_id|>\n\n`;
        
        // Add dialogue history
        const historyWindow = chatMessageHistory.slice(-2);
        for (const h of historyWindow) {
            formattedPrompt += `User: ${h.q}\nAssistant: ${h.a}\n`;
        }
        
        formattedPrompt += `Question: ${text}<|eot_id|><|start_header_id|>assistant<|end_header_id|>\n\n`;
    } else if (modelUrl.includes('gemma-4') || modelUrl.includes('gemma4')) {
        // Gemma 4 Instruct template with native system prompt support
        formattedPrompt = `<|turn>system\nYou are a helpful, expert technical manual assistant. Use the following retrieved context snippets from the manuals to answer the user's question. If the answer cannot be found in the context, say "I don't know based on the provided documents." Do not invent facts. Cite the source document name and the page number for the facts you provide (e.g. "According to [document_name] (Page [page_num])...").\n\nContext:\n${context}<turn|>\n`;
        
        // Add dialogue history
        const historyWindow = chatMessageHistory.slice(-2);
        for (const h of historyWindow) {
            formattedPrompt += `<|turn>user\n${h.q}<turn|>\n<|turn>model\n${h.a}<turn|>\n`;
        }
        
        formattedPrompt += `<|turn>user\n${text}<turn|>\n<|turn>model\n`;
    } else {
        // Default Gemma 1 / 2 / 3 Instruct template
        formattedPrompt = `<start_of_turn>user\nYou are a helpful, expert technical manual assistant. 
Use the following retrieved context snippets from the manuals to answer the user's question. 
If the answer cannot be found in the context, say "I don't know based on the provided documents." Do not invent facts. 
Cite the source document name and the page number for the facts you provide (e.g. "According to [document_name] (Page [page_num])...").

Context:
${context}

History:
`;
        const historyWindow = chatMessageHistory.slice(-3);
        for (const h of historyWindow) {
            formattedPrompt += `User: ${h.q}\nAssistant: ${h.a}\n`;
        }
        formattedPrompt += `\nQuestion: ${text}<end_of_turn>\n<start_of_turn>model\n`;
    }

    // Stream streaming answer placeholder. If the query mentions any figure, attach it to the RAG response bubble.
    const matchedFigs = findFigures(text);
    activeResponseEl = appendMessage(false, "", matchedFigs, "LITERT_EXPERT");

    // Launch streaming generation
    worker.postMessage({
        command: 'generate',
        data: { prompt: formattedPrompt }
    });
}

// ---------- Worker Initialization ----------

function initInferenceWorker() {
    const modelUrl = modelPathInput.value.trim();
    
    // Check for WebGPU support early
    if (!navigator.gpu) {
        modelStatusText.innerHTML = "● WebGPU Unsupported";
        modelStatusText.style.color = "var(--danger)";
        modelStatusDetail.innerHTML = "navigator.gpu is undefined.";
        
        appendMessage(false, `❌ **Error**: WebGPU is not supported or enabled in this browser. 
        <br><br>
        <div style="background: rgba(245, 158, 11, 0.1); border: 1px solid rgba(245, 158, 11, 0.25); border-radius: 8px; padding: 14px; margin-top: 8px; border-left: 4px solid #fbbf24; line-height: 1.5; text-align: left;">
            <strong style="color: #fbbf24; font-size: 14px;">WebGPU Required for LiteRT LLM:</strong><br>
            LiteRT LLM inference runs entirely on the GPU via WebGPU. Since WebGPU is not active:
            <ul style="margin-left: 20px; margin-top: 6px; font-size: 13px; color: #cbd5e1; display: flex; flex-direction: column; gap: 4px;">
                <li>If you are on <strong>Linux (Nvidia)</strong>, Chrome may have disabled hardware acceleration due to driver glitches. Run with specific flags to enable it stably.</li>
                <li>If you are accessing this server <strong>remotely</strong> (e.g., from an iPad), WebGPU is blocked because the connection is HTTP. You must configure secure context bypass flags.</li>
            </ul>
            <button class="btn" onclick="document.getElementById('webgpu-trouble-modal').style.display='flex'; if(window.switchTroubleTab) window.switchTroubleTab('linux');" style="margin-top: 12px; background: #fbbf24; color: #05070f; border: none; font-weight: 700; font-size: 12px; padding: 6px 12px; border-radius: 6px; cursor: pointer; display: inline-flex; align-items: center; gap: 4px;">
                🛠️ Open WebGPU Setup Guide
            </button>
        </div>`, [], "SYSTEM");
        return;
    }
    
    // Check if the local model file exists on server and show alert if missing
    if (modelUrl.startsWith('/models/')) {
        fetch(modelUrl, { method: 'HEAD' }).then(res => {
            if (!res.ok) {
                appendMessage(false, `⚠️ **System**: Local model file not found at **${modelUrl}**. To use offline Q&A, please download the compatible LiteRT model (e.g., \`gemma-2b-it-cpu-int4.bin\`) and save it to the project's \`models/\` folder.`, [], "SYSTEM");
            }
        }).catch(err => {
            console.warn("Could not check local model file:", err);
        });
    }

    modelStatusText.innerHTML = "● Initializing Worker...";
    modelStatusDetail.innerHTML = "Spawning worker...";
    
    if (worker) {
        worker.terminate();
    }

    worker = new Worker('worker.js?v=226', { type: 'module' });

    worker.onmessage = (event) => {
        const { status, progress, message, actualDevice, embedding, text, error, complete } = event.data;

        if (status === 'progress') {
            progressContainer.style.display = 'block';
            progressBar.style.width = `${progress}%`;
        } else if (status === 'loading') {
            modelStatusDetail.innerHTML = message;
        } else if (status === 'info') {
            console.log("Worker Info:", message);
            modelStatusDetail.innerHTML = message;
        } else if (status === 'ready') {
            progressContainer.style.display = 'none';
            modelStatusText.innerHTML = `● LiteRT Ready (${actualDevice === 'webgpu' ? 'GPU' : 'CPU'})`;
            modelStatusDetail.innerHTML = `Framework loaded on ${actualDevice.toUpperCase()}`;
            modelStatusText.style.color = "var(--success)";
            appendMessage(false, `✅ **System**: LiteRT LLM and embedding engines initialized successfully on **${actualDevice.toUpperCase()}** inference backend.`, [], "SYSTEM");
        } else if (status === 'embed_result') {
            handleEmbedResult(embedding);
        } else if (status === 'token') {
            // mediaPipe LlmInference returns the accumulated generated text so far
            let cleanedText = text || "";
            const stopTokens = ['<|turn>', '<turn|>', '<start_of_turn>', '<end_of_turn>'];
            for (const token of stopTokens) {
                const idx = cleanedText.indexOf(token);
                if (idx !== -1) {
                    cleanedText = cleanedText.substring(0, idx);
                }
            }

            if (activeResponseEl) {
                const footnoteHtml = getSourcesFootnote(window.currentTopChunks);
                if (footnoteHtml && complete) {
                    activeResponseEl.innerHTML = formatMarkdown(cleanedText) + 
                        `<div class="sources-footnote" style="margin-top: 14px; padding-top: 10px; border-top: 1px dashed var(--panel-border); font-size: 13px; color: var(--text-muted);">` +
                        `<strong style="color: var(--accent);">Sources:</strong><br>${footnoteHtml}` +
                        `</div>`;
                } else {
                    activeResponseEl.innerHTML = formatMarkdown(cleanedText);
                }
                chatContainer.scrollTop = chatContainer.scrollHeight;
            }
            if (complete) {
                // Done generating
                const fullText = cleanedText.trim();
                const questionText = window.currentQueryText;
                const footnoteText = getSourcesFootnoteText(window.currentTopChunks);
                const answerText = footnoteText ? `${fullText}\n\nSources:\n${footnoteText}` : fullText;
                
                // Avoid duplicate entries if both the callback and promise resolution trigger 'complete'
                const lastHistory = chatMessageHistory[chatMessageHistory.length - 1];
                if (!lastHistory || lastHistory.q !== questionText || lastHistory.a !== answerText) {
                    chatMessageHistory.push({ q: questionText, a: answerText });
                    speakText(fullText);
                }
            }
        } else if (status === 'done') {
            // Finished streaming. No action needed as 'token' complete flag handles memory storage
        } else if (status === 'error') {
            progressContainer.style.display = 'none';
            modelStatusText.innerHTML = "● Loader Error";
            modelStatusText.style.color = "var(--danger)";
            modelStatusDetail.innerHTML = error;
            if (window.currentSpinnerEl) window.currentSpinnerEl.remove();
            
            const isWebGPUError = error.includes("navigator.gpu") || error.includes("WebGPU") || error.includes("adapter");
            if (isWebGPUError) {
                appendMessage(false, `❌ **Error**: ${error}
                <br><br>
                <div style="background: rgba(245, 158, 11, 0.1); border: 1px solid rgba(245, 158, 11, 0.25); border-radius: 8px; padding: 14px; margin-top: 8px; border-left: 4px solid #fbbf24; line-height: 1.5; text-align: left;">
                    <strong style="color: #fbbf24; font-size: 14px;">WebGPU Configuration Issue Detected:</strong><br>
                    The inference worker failed to request a WebGPU adapter. Please follow the WebGPU troubleshooting steps for your operating system.
                    <br>
                    <button class="btn" onclick="document.getElementById('webgpu-trouble-modal').style.display='flex'; if(window.switchTroubleTab) window.switchTroubleTab('linux');" style="margin-top: 12px; background: #fbbf24; color: #05070f; border: none; font-weight: 700; font-size: 12px; padding: 6px 12px; border-radius: 6px; cursor: pointer; display: inline-flex; align-items: center; gap: 4px;">
                        🛠️ Open WebGPU Setup Guide
                    </button>
                </div>`, [], "SYSTEM");
            } else {
                appendMessage(false, `❌ **Error**: ${error}`, [], "SYSTEM");
            }
        }
    };

    // Load models
    worker.postMessage({
        command: 'load',
        data: {
            embedderModel: 'nomic-ai/nomic-embed-text-v1.5',
            generatorModelPath: modelUrl,
            device: deviceSelect.value
        }
    });
}

// ---------- UI Event Listeners ----------

btnLoadModel.addEventListener('click', () => {
    initInferenceWorker();
});

btnSend.addEventListener('click', handleUserMessage);

questionInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleUserMessage();
    }
});

btnMic.addEventListener('click', () => {
    if (!recognition) {
        initSpeechRecognition();
    }
    if (!recognition) {
        alert("Speech recognition is not supported on this device/browser.");
        return;
    }
    if (isRecording) {
        recognition.stop();
    } else {
        recognition.start();
    }
});

btnSpeaker.addEventListener('click', () => {
    isSpeakerEnabled = !isSpeakerEnabled;
    if (isSpeakerEnabled) {
        btnSpeaker.classList.add('active-speaker');
        if ('speechSynthesis' in window) {
            window.speechSynthesis.cancel();
            const welcome = new SpeechSynthesisUtterance("Voice output activated");
            window.speechSynthesis.speak(welcome);
        }
    } else {
        btnSpeaker.classList.remove('active-speaker');
        if ('speechSynthesis' in window) {
            window.speechSynthesis.cancel();
        }
    }
});

btnClearDialog.addEventListener('click', () => {
    chatMessageHistory = [];
    chatContainer.innerHTML = `
        <div class="msg-container">
            <div class="msg-a">UI Cleared. Ready for new questions!</div>
        </div>`;
    historyContainer.innerHTML = '';
});

btnSyncKb.addEventListener('click', async () => {
    btnSyncKb.disabled = true;
    btnSyncKb.innerHTML = "⏳ Syncing...";
    appendMessage(false, "🔄 **System**: Sync started. Parsing PDF manuals inside `./PdfDir` and computing local vector embeddings. Please wait...", [], "SYSTEM");
    
    try {
        const res = await fetch('/api/sync', { method: 'POST' });
        if (!res.ok) {
            const errBody = await res.json();
            throw new Error(errBody.message || "Failed to compile knowledge base");
        }
        
        await loadKnowledgeBaseJSON();
        await fetchPDFList();
    } catch (e) {
        console.error("Sync error:", e);
        appendMessage(false, `❌ **Sync Failed**: ${e.message}`, [], "SYSTEM");
    } finally {
        btnSyncKb.disabled = false;
        btnSyncKb.innerHTML = "🔄 Sync Knowledge Base";
    }
});

btnSaveDialog.addEventListener('click', async () => {
    if (chatMessageHistory.length === 0) {
        alert("Dialogue is empty. Engage in a Q&A session first.");
        return;
    }
    
    btnSaveDialog.disabled = true;
    btnSaveDialog.innerHTML = "💾 Saving...";
    
    try {
        const res = await fetch('/api/savedialog', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(chatMessageHistory)
        });
        
        if (!res.ok) throw new Error("Failed to export dialogue session");
        const body = await res.json();
        
        appendMessage(false, `💾 **System**: Dialogue session exported successfully as **${body.file}** in the \`Dialogs/\` directory.`, [], "SYSTEM");
    } catch (e) {
        console.error("Save dialog error:", e);
        appendMessage(false, `❌ **Save Dialog Failed**: ${e.message}`, [], "SYSTEM");
    } finally {
        btnSaveDialog.disabled = false;
        btnSaveDialog.innerHTML = "💾 Save Dialog";
    }
});

btnStopServer.addEventListener('click', async () => {
    if (confirm("Are you sure you want to stop the local Go server?")) {
        appendMessage(false, "🛑 **System**: Shutting down server. Goodbye!", [], "SYSTEM");
        try {
            await fetch('/api/stop');
        } catch (e) {}
    }
});

deviceSelect.addEventListener('change', () => {
    initInferenceWorker();
});

// ---------- Initialization ----------

window.addEventListener('DOMContentLoaded', () => {
    fetchPDFList();
    loadKnowledgeBaseJSON();
    initInferenceWorker();
});
