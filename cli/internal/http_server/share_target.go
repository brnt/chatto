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

	"github.com/chattocorp/chatto/cli/internal/authctx"
	"github.com/gin-gonic/gin"
)

const (
	shareDataTTL            = 5 * time.Minute
	shareDataMaxFiles       = 10
	shareDataMaxFileSize    = 25 * 1024 * 1024 // 25 MB, matches default max_upload_size
	shareDataCleanupPeriod  = 1 * time.Minute
	shareFormMaxMemory      = 32 * 1024 * 1024 // 32 MB in memory before temp files
	shareDataMaxEntries     = 100              // Global cap on stored entries
	shareDataMaxTotalBytes  = 100 * 1024 * 1024 // 100 MB total storage cap
)

// ShareData holds the data received from the Web Share Target API.
// Each entry is bound to the user who created it.
type ShareData struct {
	ID        string
	UserID    string // Owner of this share data
	Title     string
	Text      string
	URL       string
	Files     []ShareFile
	CreatedAt time.Time
	SizeBytes int64 // Total size for quota enforcement
}

// ShareFile represents a shared file.
type ShareFile struct {
	Filename    string
	ContentType string
	Size        int64
	Data        []byte
}

// shareDataStore manages temporary share data with automatic cleanup.
// Enforces global caps on entries and total storage to prevent DoS.
type shareDataStore struct {
	mu         sync.RWMutex
	entries    map[string]*ShareData
	totalBytes int64
	stopCh     chan struct{}
}

func newShareDataStore() *shareDataStore {
	s := &shareDataStore{
		entries: make(map[string]*ShareData),
		stopCh:  make(chan struct{}),
	}
	go s.cleanupLoop()
	return s
}

// Put stores share data if global caps aren't exceeded.
// Returns an error if the caps are reached.
func (s *shareDataStore) Put(data *ShareData) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if len(s.entries) >= shareDataMaxEntries {
		return fmt.Errorf("share storage full (max %d entries)", shareDataMaxEntries)
	}

	if s.totalBytes+data.SizeBytes > shareDataMaxTotalBytes {
		return fmt.Errorf("share storage full (max %d MB total)", shareDataMaxTotalBytes/(1024*1024))
	}

	s.entries[data.ID] = data
	s.totalBytes += data.SizeBytes
	return nil
}

// GetAndDelete retrieves share data and immediately deletes it (single-use).
// Only returns data if the userId matches the owner.
func (s *shareDataStore) GetAndDelete(id string, userId string) (*ShareData, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()

	data, ok := s.entries[id]
	if !ok {
		return nil, false
	}

	// Only the owner can read their share data
	if data.UserID != userId {
		return nil, false
	}

	// Delete on first read (single-use)
	delete(s.entries, id)
	s.totalBytes -= data.SizeBytes
	return data, true
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
			s.totalBytes -= data.SizeBytes
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
// Requires authentication and validates origin to prevent CSRF and DoS attacks.
func (s *HTTPServer) handleShareTarget(c *gin.Context) {
	// Inject user into context for authentication
	c.Request = s.injectUserIntoContext(c)
	
	// Require authenticated session to prevent anonymous DoS
	user := authctx.ForContext(c.Request.Context())
	if user == nil {
		// Redirect to login; user can re-share after signing in
		c.Redirect(http.StatusSeeOther, "/login?return=/")
		return
	}
	userId := user.Id

	// Validate origin to prevent CSRF from third-party sites.
	// Web Share Target sends Sec-Fetch-Site: none (from share sheet) or same-origin (from browser).
	// We reject cross-site requests to prevent malicious sites from forging shares.
	secFetchSite := c.GetHeader("Sec-Fetch-Site")
	if secFetchSite != "" && secFetchSite != "none" && secFetchSite != "same-origin" {
		s.logger.Warn("rejected cross-site share attempt", "sec-fetch-site", secFetchSite)
		c.String(http.StatusForbidden, "Cross-site share requests are not allowed")
		return
	}

	// Enforce overall body size limit based on configured max upload size
	maxBodySize := int64(s.config.Core.Assets.MaxUploadSize)
	if maxBodySize == 0 {
		maxBodySize = shareDataMaxFileSize // Default to per-file limit if not configured
	}
	if c.Request.ContentLength > 0 && c.Request.ContentLength > maxBodySize {
		c.String(http.StatusRequestEntityTooLarge, fmt.Sprintf("Request too large (max %d MB)", maxBodySize/(1024*1024)))
		return
	}

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
		UserID:    userId,
		Title:     c.PostForm("title"),
		Text:      c.PostForm("text"),
		URL:       c.PostForm("url"),
		CreatedAt: time.Now(),
	}

	// Calculate size for quota enforcement
	shareData.SizeBytes = int64(len(shareData.Title) + len(shareData.Text) + len(shareData.URL))

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
			shareData.SizeBytes += fileHeader.Size
		}
	}

	// Store the share data (enforces global caps)
	if err := s.shareDataStore.Put(shareData); err != nil {
		s.logger.Warn("failed to store share data", "error", err)
		c.String(http.StatusServiceUnavailable, fmt.Sprintf("Share storage temporarily full: %v", err))
		return
	}

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
// Requires authentication and only returns data to the owner.
// Deletes the data on first read (single-use).
func (s *HTTPServer) handleShareDataAPI(c *gin.Context) {
	// Inject user into context for authentication
	c.Request = s.injectUserIntoContext(c)
	
	// Require authenticated session
	user := authctx.ForContext(c.Request.Context())
	if user == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Authentication required"})
		return
	}
	userId := user.Id

	shareID := c.Param("id")
	if shareID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Missing share ID"})
		return
	}

	// Get and delete in one operation (single-use, owner-only)
	data, ok := s.shareDataStore.GetAndDelete(shareID, userId)
	if !ok {
		c.JSON(http.StatusNotFound, gin.H{"error": "Share data not found, expired, or not owned by you"})
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
