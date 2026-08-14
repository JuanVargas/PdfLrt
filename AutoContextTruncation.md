# Auto-Context Truncation & Failure Recovery Strategy in PdfLrt

This document details the root cause analysis, technical corrections, and the **Auto-Context Truncation & Retry Strategy** implemented in **PdfLrt** to prevent and recover from LLM context token overflow errors during single and batch question processing.

---

## 1. Root Cause Analysis

### The Reported Failure
When processing batch questions on a Target host, the following error may occurr:

```text
Error: INVALID_ARGUMENT: CalculatorGraph::Run() failed:
Calculator::Process() for node "LlmGpuCalculator" failed: Input is too long for the model to process: current_step(110) + input_size(1951) was not less than maxTokens(2048). 'maxTokens' is the maximum number of tokens (input tokens + output tokens) the model handles, which can be set in the task options.; WaitUntilIdle failed
=== Source Location Trace: ===
third_party/odml/infra/genai/inference/calculators/llm_gpu_calculator.cc:863
third_party/mediapipe/framework/calculator_node.cc:1012
research/drishti/app/pursuit/wasm/graph_utils.cc:196
```

### Technical Breakdown

1. **Context Window Allocation Limit (`maxTokens: 2048`)**:

   - `worker.js` configured `LlmInference.createFromOptions` with `maxTokens: 2048`.

   - In MediaPipe GenAI / LiteRT, `maxTokens` defines the total KV cache buffer size allocated on GPU memory for **Input Tokens (Prompt + System Instruction + RAG Context)** plus **Output Tokens (Generated Answer)**.

   - Retrieving 4 RAG text chunks from complex technical PDF manuals may generate prompt token lengths (`input_size`) up to ~1,951 tokens. Combined with accumulated KV cache steps (`current_step: 110`), `110 + 1951 = 2061` tokens may exceed `maxTokens(2048)`.

2. **Input Prefill Phase Crash vs. Output Generation**:

   - Failure may occurr during **prompt prefill** (feeding the retrieved context into the model) before the model could output even a single token.

   - Therefore, asking the LLM to *"rephrase its answer to use fewer tokens"* cannot resolve this error because no answer would be produced.

3. **Permanent MediaPipe Graph Failure Cascade**:
   
   - When MediaPipe's C++ `LlmGpuCalculator` throws a token overflow exception, the internal `CalculatorGraph` enters a failed state (`WaitUntilIdle failed`).
   
   - If the worker continues to reuse the broken `llmInference` object without re-initialization, every subsequent query will fail immediately.

4. **Batch History Accumulation**:

   - Sequential batch execution was appending previous Q&A history into `chatMessageHistory`, continually expanding prompt lengths across consecutive batch questions.

---

## 2. Technical Corrections

### A. LiteRT Worker Engine (`worker.js`)

- **Expanded Token Window**: Increased `maxTokens` from `2048` to `4096` in `LlmInference.createFromOptions`.

- **Automatic Graph Recovery**:

  - Implemented `reinitLlmInference()` to re-create the `LlmInference` instance when an error occurs or when a `'reset'` command is received.

  - Ensures the MediaPipe C++ graph returns to a clean, idle state after any generation error.

### B. Batch Context Isolation (`app.js`)

- Added `window.isBatchProcessing` flag.

- During batch processing of independent questions from Excel files, prior chat session history is excluded from the prompt to prevent cumulative context inflation.

### C. Excel Error Row Flagging (`pdflrt.go`)

- Added `IsError bool json:"is_error"` to the `DialogEntry` struct.

- In `handleSaveQuestionsResponses`, failed question rows are formatted with a soft red fill (`#FEE2E2`) and bold dark red text (`#991B1B`) across columns `A:C` in `Questions_Responses.xlsx`.

---

## 3. Auto-Context Truncation & Retry Strategy

### System Architecture

```text
[Question Input]
       │
       ▼
 [Level 0 Execution] ── Top 4 Chunks (Max 3,500 chars context)
       │
       ├── SUCCESS ──> [Save Response & Sources]
       │
       └── INFERENCE ERROR / TOKEN OVERFLOW
               │
               ▼
 [Level 1 Auto-Retry] ── Reset Engine ➡️ Top 2 Chunks (Max 1,800 chars context)
       │
       ├── SUCCESS ──> [Save Response & Sources]
       │
       └── INFERENCE ERROR
               │
               ▼
 [Level 2 Auto-Retry] ── Reset Engine ➡️ Top 1 Chunk (Max 900 chars context)
       │
       ├── SUCCESS ──> [Save Response & Sources]
       │
       └── STILL FAILS ──> [Flag Error Row in Red in Excel, Continue Next Question]
```

### Multi-Tiered Context Window Scaling

| Retry Tier | Context Chunks | Max Context Length | Description |
| :--- | :---: | :---: | :--- |
| **Level 0 (Default)** | 4 Chunks | 3,500 Chars (~1,000 Tokens) | Standard full RAG retrieval context. |
| **Level 1 (First Retry)** | 2 Chunks | 1,800 Chars (~500 Tokens) | First fallback tier triggered automatically on error. |
| **Level 2 (Second Retry)** | 1 Chunk | 900 Chars (~250 Tokens) | Minimal context fallback tier for extremely constrained context windows. |

### Execution Workflow (`answerQuestionWithAutoRetry` in `app.js`)

1. **Initial Attempt (Level 0)**: Submits the question with full context.

2. **Error Detection & Signal**: If the attempt fails, `answerQuestionWithAutoRetry` catches the error, displays an in-app system notification (`⚠️ Auto-Retry Attempt 1/2...`), and sends a `reset` signal to `worker.js`.

3. **Automated Worker Reset**: The worker executes `reinitLlmInference()`, freeing old MediaPipe graph state and re-binding WebGPU buffers.

4. **Retry Execution**: Re-submits the question with the next context tier (Level 1, then Level 2 if needed).

5. **Resilient Completion**:
   - If any retry succeeds, the answer and citations are recorded.
   - If all retries fail, the entry is tagged (`is_error: true`), written into `Questions_Responses.xlsx` with a red highlight, and the system continues processing the remaining questions.


END OF DOC
---