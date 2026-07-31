// worker.js - PdfLrt WebGPU/WASM Offline Inference Worker using LiteRT

import { pipeline, env, AutoTokenizer } from './transformers.min.js';
import { FilesetResolver, LlmInference } from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-genai';

// Polyfill importScripts for ES Module Workers (required for MediaPipe WASM loading)
try {
    console.log("[Worker] Installing importScripts polyfill via Object.defineProperty...");
    Object.defineProperty(self, 'importScripts', {
        value: function(...urls) {
            console.log("[Worker] importScripts called for:", urls);
            for (const url of urls) {
                try {
                    const xhr = new XMLHttpRequest();
                    xhr.open('GET', url, false); // Synchronous fetch inside Worker
                    xhr.send(null);
                    if (xhr.status === 200) {
                        console.log("[Worker] importScripts successfully loaded:", url);
                        // Indirect eval executes in the global context
                        (0, eval)(xhr.responseText + `\n//# sourceURL=${url}`);
                        console.log("[Worker] importScripts successfully evaluated:", url);
                    } else {
                        throw new Error(`Status code: ${xhr.status}`);
                    }
                } catch (err) {
                    console.error("[Worker] importScripts failed for " + url, err);
                    throw new Error(`importScripts failed for ${url} (Error: ${err.message})`);
                }
            }
        },
        writable: true,
        configurable: true
    });
} catch (e) {
    console.error("[Worker] Failed to define importScripts polyfill:", e);
}

// Enable local model loading and disable remote (HF) model loading to guarantee offline functionality
env.allowLocalModels = true;
env.allowRemoteModels = false;
env.localModelPath = self.location.origin + '/models/';
env.useBrowserCache = false;

// Configure local WASM paths for ONNX Runtime Web to support offline/COEP environments
try {
    const isSafari = typeof navigator !== 'undefined' && 
        (navigator.vendor || "").indexOf("Apple") > -1 && 
        !navigator.userAgent.match(/CriOS|FxiOS|EdgiOS|OPiOS|mercury|brave/i) && 
        !navigator.userAgent.includes("Chrome") && 
        !navigator.userAgent.includes("Android");

    const wasmFolder = self.location.origin + '/wasm/';
    const wasmPaths = isSafari ? {
        mjs: wasmFolder + 'ort-wasm-simd-threaded.mjs',
        wasm: wasmFolder + 'ort-wasm-simd-threaded.wasm'
    } : {
        mjs: wasmFolder + 'ort-wasm-simd-threaded.asyncify.mjs',
        wasm: wasmFolder + 'ort-wasm-simd-threaded.asyncify.wasm'
    };

    if (env.backends && env.backends.onnx) {
        if (!env.backends.onnx.wasm) env.backends.onnx.wasm = {};
        env.backends.onnx.wasm.wasmPaths = wasmPaths;
    }
    if (env.onnx) {
        if (!env.onnx.wasm) env.onnx.wasm = {};
        env.onnx.wasm.wasmPaths = wasmPaths;
    }
} catch (e) {
    console.warn("Failed to set early WASM paths in worker.js:", e);
}

let embedder = null;
let llmInference = null;
const fileProgress = {};

function reportOverallProgress() {
    let totalProgress = 0;
    const keys = Object.keys(fileProgress);
    if (keys.length === 0) return;
    
    keys.forEach(k => {
        totalProgress += fileProgress[k];
    });
    const averageProgress = totalProgress / keys.length;
    self.postMessage({ status: 'progress', progress: averageProgress });
}

self.onmessage = async (event) => {
    const { command, data } = event.data;

    if (command === 'load') {
        const { embedderModel, generatorModelPath, device } = data;
        const targetDevice = device || 'webgpu';
        
        try {
            // Configure WebGPU/WASM required features globally on the underlying ONNX Runtime env for embeddings
            try {
                if (env.backends && env.backends.onnx) {
                    if (!env.backends.onnx.env) env.backends.onnx.env = {};
                    if (!env.backends.onnx.env.webgpu) env.backends.onnx.env.webgpu = {};
                    env.backends.onnx.env.webgpu.deviceOptions = {
                        requiredFeatures: ['shader-f16']
                    };
                    
                    const isSafari = typeof navigator !== 'undefined' && 
                        (navigator.vendor || "").indexOf("Apple") > -1 && 
                        !navigator.userAgent.match(/CriOS|FxiOS|EdgiOS|OPiOS|mercury|brave/i) && 
                        !navigator.userAgent.includes("Chrome") && 
                        !navigator.userAgent.includes("Android");

                    const wasmFolder = self.location.origin + '/wasm/';
                    const wasmPaths = isSafari ? {
                        mjs: wasmFolder + 'ort-wasm-simd-threaded.mjs',
                        wasm: wasmFolder + 'ort-wasm-simd-threaded.wasm'
                    } : {
                        mjs: wasmFolder + 'ort-wasm-simd-threaded.asyncify.mjs',
                        wasm: wasmFolder + 'ort-wasm-simd-threaded.asyncify.wasm'
                    };

                    if (!env.backends.onnx.wasm) env.backends.onnx.wasm = {};
                    env.backends.onnx.wasm.wasmPaths = wasmPaths;
                }
                if (env.onnx) {
                    const isSafari = typeof navigator !== 'undefined' && 
                        (navigator.vendor || "").indexOf("Apple") > -1 && 
                        !navigator.userAgent.match(/CriOS|FxiOS|EdgiOS|OPiOS|mercury|brave/i) && 
                        !navigator.userAgent.includes("Chrome") && 
                        !navigator.userAgent.includes("Android");

                    const wasmFolder = self.location.origin + '/wasm/';
                    const wasmPaths = isSafari ? {
                        mjs: wasmFolder + 'ort-wasm-simd-threaded.mjs',
                        wasm: wasmFolder + 'ort-wasm-simd-threaded.wasm'
                    } : {
                        mjs: wasmFolder + 'ort-wasm-simd-threaded.asyncify.mjs',
                        wasm: wasmFolder + 'ort-wasm-simd-threaded.asyncify.wasm'
                    };

                    if (!env.onnx.wasm) env.onnx.wasm = {};
                    env.onnx.wasm.wasmPaths = wasmPaths;
                }
            } catch (e) {
                console.warn("Failed to set WebGPU/WASM device options in Transformers.js:", e);
            }

            // Dispose old engines if they exist
            if (embedder) {
                try { await embedder.dispose(); } catch (e) {}
                embedder = null;
            }
            if (llmInference) {
                try { await llmInference.close(); } catch (e) {}
                llmInference = null;
            }

            self.postMessage({ status: 'loading', message: 'Initializing local embedding model...' });
            
            // Initialize embedding pipeline (transformers.js v3)
            const embedOptions = {
                progress_callback: (progressData) => {
                    if (progressData.status === 'progress') {
                        fileProgress[progressData.file] = progressData.progress;
                        reportOverallProgress();
                    }
                }
            };

            try {
                self.postMessage({ status: 'loading', message: 'Loading local embedding tokenizer...' });
                const tokenizer = await AutoTokenizer.from_pretrained(embedderModel);
                
                embedder = await pipeline('feature-extraction', embedderModel, {
                    ...embedOptions,
                    tokenizer: tokenizer,
                    device: targetDevice === 'webgpu' ? 'webgpu' : 'wasm',
                    dtype: targetDevice === 'webgpu' ? 'fp32' : 'fp32'
                });
                self.postMessage({ status: 'info', message: 'Embedding model loaded successfully.' });
            } catch (embedErr) {
                console.warn('Embedding load failed on WebGPU, falling back to WASM:', embedErr);
                try {
                    const tokenizer = await AutoTokenizer.from_pretrained(embedderModel);
                    embedder = await pipeline('feature-extraction', embedderModel, {
                        ...embedOptions,
                        tokenizer: tokenizer,
                        device: 'wasm'
                    });
                    self.postMessage({ status: 'info', message: 'Embedding model loaded using WASM (CPU).' });
                } catch (wasmEmbedErr) {
                    console.error('Embedding load failed completely:', wasmEmbedErr);
                    throw wasmEmbedErr;
                }
            }

            self.postMessage({ status: 'loading', message: 'Verifying model file availability...' });
            const modelUrl = generatorModelPath || "https://huggingface.co/google/gemma-2b-it-cpu-int4/resolve/main/gemma-2b-it-cpu-int4.bin";
            
            try {
                // Try fetching first 100 bytes to check if the file is reachable
                const checkRes = await fetch(modelUrl, { headers: { Range: 'bytes=0-99' } });
                if (!checkRes.ok && checkRes.status !== 405) { // 405 Method Not Allowed is fine
                    throw new Error(`HTTP status ${checkRes.status}`);
                }
            } catch (fetchErr) {
                // If it fails, report that the model is inaccessible
                throw new Error(`Model file not reachable at: ${modelUrl}. ${fetchErr.message}. Make sure you have downloaded the model or entered a valid public URL.`);
            }

            self.postMessage({ status: 'loading', message: 'Loading LiteRT task libraries...' });

            // Initialize MediaPipe FilesetResolver for GenAI (LiteRT-LM Wasm) locally
            const genai = await FilesetResolver.forGenAiTasks(self.location.origin + "/wasm");

            // Attempt to load the model (first GPU, fallback to CPU)
            try {
                if (targetDevice === 'webgpu') {
                    self.postMessage({ status: 'loading', message: 'Downloading & compiling LiteRT LLM on GPU...' });
                    llmInference = await LlmInference.createFromOptions(genai, {
                        baseOptions: {
                            modelAssetPath: modelUrl,
                            delegate: 'GPU'
                        },
                        maxTokens: 2048,
                        temperature: 0.3
                    });
                    self.postMessage({ status: 'ready', actualDevice: 'webgpu' });
                } else {
                    throw new Error("WASM mode selected");
                }
            } catch (gpuErr) {
                console.warn('LiteRT GPU loading failed or bypassed, falling back to CPU:', gpuErr);
                self.postMessage({ status: 'loading', message: 'GPU initialization failed. Downloading & compiling LiteRT LLM on CPU...' });
                
                llmInference = await LlmInference.createFromOptions(genai, {
                    baseOptions: {
                        modelAssetPath: modelUrl,
                        delegate: 'CPU'
                    },
                    maxTokens: 2048,
                    temperature: 0.3
                });
                self.postMessage({ status: 'ready', actualDevice: 'wasm' });
            }
        } catch (error) {
            console.error('Error loading models in worker:', error);
            self.postMessage({ status: 'error', error: error.message });
        }
    }

    else if (command === 'embed') {
        const { text } = data;
        if (!embedder) {
            self.postMessage({ status: 'error', error: 'Embedding model is not loaded yet.' });
            return;
        }
        try {
            const output = await embedder(text, { pooling: 'mean', normalize: true });
            const embedding = Array.from(output.data);
            self.postMessage({ status: 'embed_result', embedding });
        } catch (error) {
            self.postMessage({ status: 'error', error: error.message });
        }
    }

    else if (command === 'generate') {
        const { prompt } = data;
        if (!llmInference) {
            self.postMessage({ status: 'error', error: 'LiteRT LLM is not initialized.' });
            return;
        }
        try {
            let accumulatedText = "";
            await llmInference.generateResponse(prompt, (partialResult, complete) => {
                if (typeof partialResult === 'string') {
                    if (partialResult.startsWith(accumulatedText)) {
                        accumulatedText = partialResult;
                    } else {
                        accumulatedText += partialResult;
                    }
                }
                // Send streaming update to main thread (complete might be passed, but we don't rely solely on it)
                self.postMessage({ 
                    status: 'token', 
                    text: accumulatedText, 
                    complete: complete === true 
                });
            });

            // Once the generateResponse promise resolves, generation is guaranteed to be finished
            self.postMessage({ 
                status: 'token', 
                text: accumulatedText, 
                complete: true 
            });
            self.postMessage({ status: 'done' });
        } catch (error) {
            self.postMessage({ status: 'error', error: error.message });
        }
    }
};
