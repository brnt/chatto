package http_server

import (
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

const (
	shareDataTTL            = 5 * time.Minute
	shareDataMaxFiles       = 10
	shareDataMaxFileSize    = 25 * 1024 * 1024 // 25 MB, matches default max_upload_size
	shareDataCleanupPeriod  = 1 * time.Minute
	shareFormMaxMemory      = 32 * 1024 * 1024 // 32 MB in memory before temp files
)

// ShareData holds the data received from the Web Share Target API.
type ShareData struct {
	ID        string
	Title     string
	Text      string
	URL       string
	Files     []ShareFile
	CreatedAt time.Time
}

// ShareFile represents a shared file.
type ShareFile struct {
	Filename    string
	ContentType string
	Size        int64
	Data        []byte
}

// shareDataStore manages temporary share data with automatic cleanup.
type shareDataStore struct {
	mu      sync.RWMutex
	entries map[string]*ShareData
	stopCh  chan struct{}
}

func newShareDataStore() *shareDataStore {
	s := &shareDataStore{
		entries: make(map[string]*ShareData),
		stopCh:  make(chan struct{}),
	}
	go s.cleanupLoop()
	return s
}

func (s *shareDataStore) Put(data *ShareData) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.entries[data.ID] = data
}

func (s *shareDataStore) Get(id string) (*ShareData, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	data, ok := s.entries[id]
	return data, ok
}

func (s *shareDataStore) Delete(id string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.entries, id)
}

func (s *shareDataStore) cleanupLoop() {
	ticker := time.NewTicker(shareDataCleanupPeriod)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			s.cleanup()
		case <-s.stopCh:
			return
		}
	}
}

func (s *shareDataStore) cleanup() {
	s.mu.Lock()
	defer s.mu.Unlock()

	now := time.Now()
	for id, data := range s.entries {
		if now.Sub(data.CreatedAt) > shareDataTTL {
			delete(s.entries, id)
		}
	}
}

func (s *shareDataStore) Stop() {
	close(s.stopCh)
}

// generateShareID creates a cryptographically random share ID.
func generateShareID() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

// handleShareTarget handles POST requests from the Web Share Target API.
func (s *HTTPServer) handleShareTarget(c *gin.Context) {
	// Parse multipart form with size limit
	if err := c.Request.ParseMultipartForm(shareFormMaxMemory); err != nil {
		s.logger.Warn("failed to parse share target form", "error", err)
		c.String(http.StatusBadRequest, "Invalid share data")
		return
	}

	shareID, err := generateShareID()
	if err != nil {
		s.logger.Error("failed to generate share ID", "error", err)
		c.String(http.StatusInternalServerError, "Failed to process share")
		return
	}

	shareData := &ShareData{
		ID:        shareID,
		Title:     c.PostForm("title"),
		Text:      c.PostForm("text"),
		URL:       c.PostForm("url"),
		CreatedAt: time.Now(),
	}

	// Process shared files
	if c.Request.MultipartForm != nil && c.Request.MultipartForm.File != nil {
		fileHeaders := c.Request.MultipartForm.File["files"]
		if len(fileHeaders) > shareDataMaxFiles {
			c.String(http.StatusBadRequest, fmt.Sprintf("Too many files (max %d)", shareDataMaxFiles))
			return
		}

		for _, fileHeader := range fileHeaders {
			if fileHeader.Size > shareDataMaxFileSize {
				c.String(http.StatusBadRequest, fmt.Sprintf("File %s is too large (max %d MB)", fileHeader.Filename, shareDataMaxFileSize/(1024*1024)))
				return
			}

			file, err := fileHeader.Open()
			if err != nil {
				s.logger.Warn("failed to open shared file", "filename", fileHeader.Filename, "error", err)
				c.String(http.StatusBadRequest, "Failed to read shared file")
				return
			}

			data, err := readFileData(file, fileHeader.Size)
			file.Close()
			if err != nil {
				s.logger.Warn("failed to read shared file data", "filename", fileHeader.Filename, "error", err)
				c.String(http.StatusBadRequest, "Failed to read shared file")
				return
			}

			shareData.Files = append(shareData.Files, ShareFile{
				Filename:    fileHeader.Filename,
				ContentType: fileHeader.Header.Get("Content-Type"),
				Size:        fileHeader.Size,
				Data:        data,
			})
		}
	}

	// Store the share data
	s.shareDataStore.Put(shareData)

	// Redirect to the SPA share route
	redirectURL := fmt.Sprintf("/share/%s", shareID)
	c.Redirect(http.StatusSeeOther, redirectURL)
}

// readFileData reads up to maxSize bytes from a multipart file.
func readFileData(file multipart.File, maxSize int64) ([]byte, error) {
	// Use LimitReader to prevent reading more than maxSize
	limited := io.LimitReader(file, maxSize+1)
	data, err := io.ReadAll(limited)
	if err != nil {
		return nil, err
	}
	if int64(len(data)) > maxSize {
		return nil, fmt.Errorf("file size exceeds maximum")
	}
	return data, nil
}

// handleShareDataAPI returns share data as JSON for the frontend.
func (s *HTTPServer) handleShareDataAPI(c *gin.Context) {
	shareID := c.Param("id")
	if shareID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Missing share ID"})
		return
	}

	data, ok := s.shareDataStore.Get(shareID)
	if !ok {
		c.JSON(http.StatusNotFound, gin.H{"error": "Share data not found or expired"})
		return
	}

	// Return share data as JSON (files as base64)
	filesJSON := make([]gin.H, len(data.Files))
	for i, file := range data.Files {
		filesJSON[i] = gin.H{
			"filename":    file.Filename,
			"contentType": file.ContentType,
			"size":        file.Size,
			"data":        base64.StdEncoding.EncodeToString(file.Data),
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"id":    data.ID,
		"title": data.Title,
		"text":  data.Text,
		"url":   data.URL,
		"files": filesJSON,
	})
}
