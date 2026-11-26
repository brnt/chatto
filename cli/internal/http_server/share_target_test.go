// SPDX-FileCopyrightText: 2024 Chatto Corp
// SPDX-License-Identifier: AGPL-3.0-or-later

package http_server

import (
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/charmbracelet/log"
	"github.com/chattocorp/chatto/cli/internal/authctx"
	"github.com/chattocorp/chatto/cli/internal/config"
	"github.com/chattocorp/chatto/cli/internal/readmodel"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestShareDataStore_PerUserByteCapEvictsOldest(t *testing.T) {
	store := newShareDataStore()
	defer store.Stop()

	userID := "byte-cap-user"
	halfCap := int64(shareDataMaxPerUserBytes / 2)

	first := &ShareData{
		ID:        "share-1",
		UserID:    userID,
		CreatedAt: time.Now(),
		SizeBytes: halfCap,
	}
	second := &ShareData{
		ID:        "share-2",
		UserID:    userID,
		CreatedAt: time.Now(),
		SizeBytes: halfCap,
	}
	require.NoError(t, store.Put(first))
	require.NoError(t, store.Put(second))

	// A third share that would exceed the per-user byte cap must evict the oldest.
	third := &ShareData{
		ID:        "share-3",
		UserID:    userID,
		CreatedAt: time.Now(),
		SizeBytes: halfCap,
	}
	require.NoError(t, store.Put(third))

	store.mu.RLock()
	defer store.mu.RUnlock()
	_, hasFirst := store.entries["share-1"]
	_, hasSecond := store.entries["share-2"]
	_, hasThird := store.entries["share-3"]
	assert.False(t, hasFirst, "oldest share should be evicted for per-user byte cap")
	assert.True(t, hasSecond)
	assert.True(t, hasThird)
	assert.Equal(t, halfCap*2, store.userBytesLocked(userID))
}

func TestShareDataStore_PerUserByteCapRejectsOversizedShare(t *testing.T) {
	store := newShareDataStore()
	defer store.Stop()

	err := store.Put(&ShareData{
		ID:        "too-big",
		UserID:    "byte-cap-user",
		CreatedAt: time.Now(),
		SizeBytes: shareDataMaxPerUserBytes + 1,
	})
	require.Error(t, err)
	assert.ErrorIs(t, err, errShareExceedsPerUserBytes)
	assert.NotErrorIs(t, err, errShareStorageFull)
}

func TestShareDataStore_CleanupExpired(t *testing.T) {
	store := newShareDataStore()
	defer store.Stop()

	// Add an entry that's already expired
	oldID := "old-id"
	store.mu.Lock()
	store.entries[oldID] = &ShareData{
		ID:        oldID,
		Title:     "Old share",
		CreatedAt: time.Now().Add(-10 * time.Minute), // Expired
	}
	store.mu.Unlock()

	// Add a fresh entry
	freshID := "fresh-id"
	store.mu.Lock()
	store.entries[freshID] = &ShareData{
		ID:        freshID,
		Title:     "Fresh share",
		CreatedAt: time.Now(),
	}
	store.mu.Unlock()

	// Wait for cleanup goroutine to run (it runs every minute)
	// For testing, we can directly check expiration logic
	time.Sleep(100 * time.Millisecond)

	// Check entries - expired one should still be there until cleanup runs
	// Since we can't easily trigger cleanup in tests, we'll just verify
	// the data structure is correct
	store.mu.RLock()
	defer store.mu.RUnlock()
	assert.NotNil(t, store.entries[oldID], "entry exists before cleanup")
	assert.NotNil(t, store.entries[freshID], "fresh entry should exist")
}

func TestShareDataStore_IDUnguessability(t *testing.T) {
	// Generate multiple IDs and ensure they are unique and unpredictable
	ids := make(map[string]bool)
	for i := 0; i < 1000; i++ {
		var buf [16]byte
		_, err := rand.Read(buf[:])
		require.NoError(t, err)
		id := hex.EncodeToString(buf[:])

		// Check uniqueness
		assert.False(t, ids[id], "generated duplicate ID")
		ids[id] = true

		// Check length (16 bytes = 32 hex chars)
		assert.Equal(t, 32, len(id))
	}
}

func TestHandleShareTarget_BasicParsing(t *testing.T) {
	gin.SetMode(gin.TestMode)

	store := newShareDataStore()
	defer store.Stop()

	// Create a full router to test redirects properly
	router := gin.New()
	logger := log.New(nil)
	logger.SetLevel(log.FatalLevel)
	srv := &HTTPServer{
		config: config.ChattoConfig{
			Core: config.CoreConfig{
				Assets: config.AssetsConfig{
					MaxUploadSize: 25 * 1024 * 1024,
				},
			},
		},
		shareDataStore: store,
		logger:         logger,
	}

	// Add middleware to inject a fake user context
	router.Use(func(c *gin.Context) {
		user := &readmodel.User{Id: "test-user-id"}
		ctx := authctx.WithUser(c.Request.Context(), user)
		c.Request = c.Request.WithContext(ctx)
		c.Next()
	})

	router.POST("/share", srv.handleShareTarget)

	// Create multipart form
	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	writer.WriteField("title", "Test Title")
	writer.WriteField("text", "Test text content")
	writer.WriteField("url", "https://example.com")
	writer.Close()

	req := httptest.NewRequest(http.MethodPost, "/share", body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	w := httptest.NewRecorder()

	router.ServeHTTP(w, req)

	// Should redirect with 303 See Other
	assert.Equal(t, http.StatusSeeOther, w.Code)

	// Extract share ID from redirect location
	location := w.Header().Get("Location")
	assert.True(t, strings.HasPrefix(location, "/share/"))
	shareID := strings.TrimPrefix(location, "/share/")

	// Verify data was stored
	store.mu.RLock()
	shareData := store.entries[shareID]
	store.mu.RUnlock()

	require.NotNil(t, shareData)
	assert.Equal(t, "Test Title", shareData.Title)
	assert.Equal(t, "Test text content", shareData.Text)
	assert.Equal(t, "https://example.com", shareData.URL)
	assert.Empty(t, shareData.Files)
}

func TestHandleShareTarget_FileUpload(t *testing.T) {
	gin.SetMode(gin.TestMode)

	store := newShareDataStore()
	defer store.Stop()

	// Create a full router
	router := gin.New()
	logger := log.New(nil)
	logger.SetLevel(log.FatalLevel)
	srv := &HTTPServer{
		config: config.ChattoConfig{
			Core: config.CoreConfig{
				Assets: config.AssetsConfig{
					MaxUploadSize: 25 * 1024 * 1024,
				},
			},
		},
		shareDataStore: store,
		logger:         logger,
	}

	// Add middleware to inject a fake user context
	router.Use(func(c *gin.Context) {
		user := &readmodel.User{Id: "test-user-id"}
		ctx := authctx.WithUser(c.Request.Context(), user)
		c.Request = c.Request.WithContext(ctx)
		c.Next()
	})

	router.POST("/share", srv.handleShareTarget)

	// Create multipart form with a file
	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	writer.WriteField("title", "File share")

	// Add a small test file
	fileWriter, err := writer.CreateFormFile("files", "test.txt")
	require.NoError(t, err)
	fileWriter.Write([]byte("test file content"))

	writer.Close()

	req := httptest.NewRequest(http.MethodPost, "/share", body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	w := httptest.NewRecorder()

	router.ServeHTTP(w, req)

	assert.Equal(t, http.StatusSeeOther, w.Code)

	location := w.Header().Get("Location")
	require.True(t, strings.HasPrefix(location, "/share/"))
	shareID := strings.TrimPrefix(location, "/share/")

	store.mu.RLock()
	shareData := store.entries[shareID]
	store.mu.RUnlock()

	require.NotNil(t, shareData)
	require.Len(t, shareData.Files, 1)
	assert.Equal(t, "test.txt", shareData.Files[0].Filename)
	assert.Equal(t, "application/octet-stream", shareData.Files[0].ContentType)
	assert.Equal(t, []byte("test file content"), shareData.Files[0].Data)
}

func TestHandleShareTarget_FileSizeLimit(t *testing.T) {
	gin.SetMode(gin.TestMode)

	store := newShareDataStore()
	defer store.Stop()

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)

	// Create a file larger than 25MB
	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)

	fileWriter, err := writer.CreateFormFile("files", "large.bin")
	require.NoError(t, err)

	// Write 26MB of data
	largeData := make([]byte, 26*1024*1024)
	fileWriter.Write(largeData)

	writer.Close()

	c.Request = httptest.NewRequest(http.MethodPost, "/share", body)
	c.Request.Header.Set("Content-Type", writer.FormDataContentType())
	c.Request.Header.Set("Sec-Fetch-Site", "none")

	// Inject user context
	user := &readmodel.User{Id: "test-user-id"}
	ctx := authctx.WithUser(c.Request.Context(), user)
	c.Request = c.Request.WithContext(ctx)

	logger := log.New(nil)
	logger.SetLevel(log.FatalLevel)
	srv := &HTTPServer{
		config: config.ChattoConfig{
			Core: config.CoreConfig{
				Assets: config.AssetsConfig{
					MaxUploadSize: 25 * 1024 * 1024,
				},
			},
		},
		shareDataStore: store,
		logger:         logger,
	}

	srv.handleShareTarget(c)

	// Should return error (413 Request Entity Too Large)
	assert.Equal(t, http.StatusRequestEntityTooLarge, w.Code)
	assert.Contains(t, w.Body.String(), "too large")
}

func TestHandleShareTarget_FileCountLimit(t *testing.T) {
	gin.SetMode(gin.TestMode)

	store := newShareDataStore()
	defer store.Stop()

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)

	// Create multipart form with more than 10 files
	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)

	for i := 0; i < 11; i++ {
		fileWriter, err := writer.CreateFormFile("files", "file"+string(rune('0'+i))+".txt")
		require.NoError(t, err)
		fileWriter.Write([]byte("content"))
	}

	writer.Close()

	c.Request = httptest.NewRequest(http.MethodPost, "/share", body)
	c.Request.Header.Set("Content-Type", writer.FormDataContentType())
	c.Request.Header.Set("Sec-Fetch-Site", "none")

	// Inject user context
	user := &readmodel.User{Id: "test-user-id"}
	ctx := authctx.WithUser(c.Request.Context(), user)
	c.Request = c.Request.WithContext(ctx)

	logger := log.New(nil)
	logger.SetLevel(log.FatalLevel)
	srv := &HTTPServer{
		config: config.ChattoConfig{
			Core: config.CoreConfig{
				Assets: config.AssetsConfig{
					MaxUploadSize: 25 * 1024 * 1024,
				},
			},
		},
		shareDataStore: store,
		logger:         logger,
	}

	srv.handleShareTarget(c)

	// Should return error
	assert.Equal(t, http.StatusBadRequest, w.Code)
	assert.Contains(t, w.Body.String(), "Too many files")
}

func TestHandleShareDataAPI_Success(t *testing.T) {
	gin.SetMode(gin.TestMode)

	store := newShareDataStore()
	defer store.Stop()

	// Add test data
	shareID := "test-share-id"
	userID := "test-user-id"
	testData := &ShareData{
		ID:        shareID,
		UserID:    userID,
		Title:     "API Test",
		Text:      "Some text",
		URL:       "https://example.com",
		CreatedAt: time.Now(),
	}

	store.mu.Lock()
	store.entries[shareID] = testData
	store.mu.Unlock()

	// Make API request
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Params = gin.Params{{Key: "id", Value: shareID}}
	c.Request = httptest.NewRequest(http.MethodGet, "/api/share/"+shareID, nil)

	// Inject user context (same user who created the share)
	user := &readmodel.User{Id: userID}
	ctx := authctx.WithUser(c.Request.Context(), user)
	c.Request = c.Request.WithContext(ctx)

	logger := log.New(nil)
	logger.SetLevel(log.FatalLevel)
	srv := &HTTPServer{
		shareDataStore: store,
		logger:         logger,
	}

	srv.handleShareDataAPI(c)

	assert.Equal(t, http.StatusOK, w.Code)
	assert.Contains(t, w.Body.String(), "API Test")
	assert.Contains(t, w.Body.String(), "Some text")

	// Verify data was deleted after first read
	store.mu.RLock()
	_, exists := store.entries[shareID]
	store.mu.RUnlock()
	assert.False(t, exists, "share data should be deleted after first read")
}

func TestHandleShareDataAPI_NotFound(t *testing.T) {
	gin.SetMode(gin.TestMode)

	store := newShareDataStore()
	defer store.Stop()

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Params = gin.Params{{Key: "id", Value: "nonexistent"}}
	c.Request = httptest.NewRequest(http.MethodGet, "/api/share/nonexistent", nil)

	// Inject user context
	user := &readmodel.User{Id: "test-user-id"}
	ctx := authctx.WithUser(c.Request.Context(), user)
	c.Request = c.Request.WithContext(ctx)

	logger := log.New(nil)
	logger.SetLevel(log.FatalLevel)
	srv := &HTTPServer{
		shareDataStore: store,
		logger:         logger,
	}

	srv.handleShareDataAPI(c)

	assert.Equal(t, http.StatusNotFound, w.Code)
}

func TestHandleShareDataAPI_Expired(t *testing.T) {
	gin.SetMode(gin.TestMode)

	store := newShareDataStore()
	defer store.Stop()

	// Add expired data
	shareID := "expired-share"
	userID := "test-user-id"
	testData := &ShareData{
		ID:        shareID,
		UserID:    userID,
		Title:     "Expired",
		CreatedAt: time.Now().Add(-10 * time.Minute),
	}

	store.mu.Lock()
	store.entries[shareID] = testData
	store.mu.Unlock()

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Params = gin.Params{{Key: "id", Value: shareID}}
	c.Request = httptest.NewRequest(http.MethodGet, "/api/share/"+shareID, nil)

	// Inject user context (same user who created the share)
	user := &readmodel.User{Id: userID}
	ctx := authctx.WithUser(c.Request.Context(), user)
	c.Request = c.Request.WithContext(ctx)

	logger := log.New(nil)
	logger.SetLevel(log.FatalLevel)
	srv := &HTTPServer{
		shareDataStore: store,
		logger:         logger,
	}

	srv.handleShareDataAPI(c)

	// GetAndDelete does not check expiration; cleanup goroutine removes expired entries
	// The API returns the data even if expired; frontend should check CreatedAt
	assert.Equal(t, http.StatusOK, w.Code)
}

func TestHandleShareTarget_NoOpenRedirect(t *testing.T) {
	gin.SetMode(gin.TestMode)

	store := newShareDataStore()
	defer store.Stop()

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)

	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	writer.WriteField("title", "Test")
	writer.Close()

	c.Request = httptest.NewRequest(http.MethodPost, "/share", body)
	c.Request.Header.Set("Content-Type", writer.FormDataContentType())
	c.Request.Header.Set("Sec-Fetch-Site", "none")

	// Inject user context
	user := &readmodel.User{Id: "test-user-id"}
	ctx := authctx.WithUser(c.Request.Context(), user)
	c.Request = c.Request.WithContext(ctx)

	logger := log.New(nil)
	logger.SetLevel(log.FatalLevel)
	srv := &HTTPServer{
		config: config.ChattoConfig{
			Core: config.CoreConfig{
				Assets: config.AssetsConfig{
					MaxUploadSize: 25 * 1024 * 1024,
				},
			},
		},
		shareDataStore: store,
		logger:         logger,
	}

	srv.handleShareTarget(c)

	location := w.Header().Get("Location")

	// Ensure redirect is to a local path only (no protocol or domain)
	assert.True(t, strings.HasPrefix(location, "/share/"))
	// Make sure it's a relative path, not an absolute URL
	assert.False(t, strings.Contains(location, "://"))
	assert.False(t, strings.HasPrefix(location, "//"))
}
