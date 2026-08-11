package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/xuri/excelize/v2"
)

func TestSaveDialogWithSources(t *testing.T) {
	dialogs := []DialogEntry{
		{
			Q:       "Describe Deicing procedure",
			A:       "Deicing is the process of removing snow, ice, or frost from a surface.",
			Sources: "faa-8083025c.pdf (Page 200)",
		},
		{
			Q:       "What is pre-flight inspection?",
			A:       "A check conducted by pilots before flight.",
			Sources: "manual_flight.pdf (Page 45)",
		},
	}

	body, _ := json.Marshal(dialogs)
	req := httptest.NewRequest(http.MethodPost, "/api/savedialog", bytes.NewReader(body))
	rec := httptest.NewRecorder()

	handleSaveDialog(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected HTTP 200, got %d", rec.Code)
	}

	var resp APIResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to parse response JSON: %v", err)
	}

	savedFile := filepath.Join("Dialogs", resp.File)
	defer os.Remove(savedFile)

	f, err := excelize.OpenFile(savedFile)
	if err != nil {
		t.Fatalf("failed to open saved excel file: %v", err)
	}
	defer f.Close()

	rows, err := f.GetRows("Sheet1")
	if err != nil || len(rows) < 3 {
		t.Fatalf("expected at least 3 rows in excel, got %d rows, err: %v", len(rows), err)
	}

	// Verify Header
	if rows[0][0] != "Questions" || rows[0][1] != "Answers" || rows[0][2] != "Sources" {
		t.Fatalf("unexpected headers: %v", rows[0])
	}

	// Verify Row 1
	if rows[1][0] != dialogs[0].Q || rows[1][1] != dialogs[0].A || rows[1][2] != dialogs[0].Sources {
		t.Fatalf("unexpected row 1 values: %v", rows[1])
	}

	t.Logf("✅ SaveDialog test passed cleanly with 3 columns!")
}

func TestBatchQuestionsWorkflowWithErrorFlagging(t *testing.T) {
	testDir := filepath.Join("Dialogs")
	_ = os.MkdirAll(testDir, 0755)

	inputFilePath := filepath.Join(testDir, "QuestionsTest.xlsx")
	defer os.Remove(inputFilePath)

	// Create sample questions Excel file
	f := excelize.NewFile()
	_ = f.SetCellValue("Sheet1", "A1", "Questions")
	_ = f.SetCellValue("Sheet1", "A2", "Describe Deicing procedure")
	_ = f.SetCellValue("Sheet1", "A3", "What are the categories of runaway incursions")
	_ = f.SetCellValue("Sheet1", "A4", "Explain holdover time.")
	if err := f.SaveAs(inputFilePath); err != nil {
		t.Fatalf("failed to create test input file: %v", err)
	}
	_ = f.Close()

	// 1. Test handleReadQuestions with "QuestionsTest.xlsx"
	readReqBody, _ := json.Marshal(map[string]string{"filename": "QuestionsTest.xlsx"})
	reqRead := httptest.NewRequest(http.MethodPost, "/api/readquestions", bytes.NewReader(readReqBody))
	recRead := httptest.NewRecorder()

	handleReadQuestions(recRead, reqRead)

	if recRead.Code != http.StatusOK {
		t.Fatalf("readquestions failed with HTTP %d: %s", recRead.Code, recRead.Body.String())
	}

	var readResp ReadQuestionsResp
	_ = json.Unmarshal(recRead.Body.Bytes(), &readResp)

	if len(readResp.Questions) != 3 {
		t.Fatalf("expected 3 questions extracted, got %d: %v", len(readResp.Questions), readResp.Questions)
	}

	// 2. Test handleSaveQuestionsResponses with normal and error entries
	batchReq := SaveBatchReq{
		OriginalFile: readResp.FilePath,
		Entries: []DialogEntry{
			{
				Q:       "Describe Deicing procedure",
				A:       "Deicing is the process of removing snow, ice, or frost from a surface.",
				Sources: "faa-8083025c.pdf (Page 200)",
				IsError: false,
			},
			{
				Q:       "What are the categories of runaway incursions",
				A:       "Error: INVALID_ARGUMENT: CalculatorGraph::Run() failed: Calculator::Process() for node \"LlmGpuCalculator\" failed: Input is too long",
				Sources: "ERROR - FAILED TO GENERATE",
				IsError: true,
			},
			{
				Q:       "Explain holdover time.",
				A:       "Holdover time is the estimated time deicing fluid will prevent frost/ice.",
				Sources: "faa-8083025c.pdf (Page 210)",
				IsError: false,
			},
		},
	}

	saveReqBody, _ := json.Marshal(batchReq)
	reqSave := httptest.NewRequest(http.MethodPost, "/api/savequestionsresponses", bytes.NewReader(saveReqBody))
	recSave := httptest.NewRecorder()

	handleSaveQuestionsResponses(recSave, reqSave)

	if recSave.Code != http.StatusOK {
		t.Fatalf("savequestionsresponses failed with HTTP %d: %s", recSave.Code, recSave.Body.String())
	}

	var saveResp SaveBatchResp
	_ = json.Unmarshal(recSave.Body.Bytes(), &saveResp)

	expectedOutPath := filepath.Join(testDir, "QuestionsTest_Responses.xlsx")
	defer os.Remove(expectedOutPath)

	if saveResp.File != expectedOutPath {
		t.Fatalf("expected output file path '%s', got '%s'", expectedOutPath, saveResp.File)
	}

	// Verify output Excel file
	outF, err := excelize.OpenFile(saveResp.File)
	if err != nil {
		t.Fatalf("failed to open output responses file: %v", err)
	}
	defer outF.Close()

	outRows, err := outF.GetRows("Sheet1")
	if err != nil || len(outRows) < 4 {
		t.Fatalf("expected at least 4 rows in output file, got %d", len(outRows))
	}

	if outRows[0][0] != "Questions" || outRows[0][1] != "Answers" || outRows[0][2] != "Sources" {
		t.Fatalf("unexpected headers in output file: %v", outRows[0])
	}

	// Verify row 1 (normal)
	if outRows[1][0] != batchReq.Entries[0].Q || outRows[1][1] != batchReq.Entries[0].A {
		t.Fatalf("unexpected row 1 in output file: %v", outRows[1])
	}

	// Verify row 2 (error flagged)
	if outRows[2][0] != batchReq.Entries[1].Q || outRows[2][2] != "ERROR - FAILED TO GENERATE" {
		t.Fatalf("unexpected row 2 error flagging in output file: %v", outRows[2])
	}

	// Verify row 3 (normal continued after error)
	if outRows[3][0] != batchReq.Entries[2].Q || outRows[3][1] != batchReq.Entries[2].A {
		t.Fatalf("unexpected row 3 in output file: %v", outRows[3])
	}

	t.Logf("✅ BatchQuestions test passed cleanly with error flagging and continuation verification!")
}
