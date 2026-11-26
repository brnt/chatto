package http_server

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/charmbracelet/log"
	"github.com/chattocorp/chatto/cli/internal/config"
	"github.com/chattocorp/chatto/cli/internal/core"
	"github.com/chattocorp/chatto/cli/internal/testutil"
	"github.com/gin-contrib/sessions"
	"github.com/gin-contrib/sessions/cookie"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func setupShareSecurityTestServer(t *testing.T) (*httptest.Server, *HTTPServer, string, string) {
	t.Helper()
	gin.SetMode(gin.TestMode)

	router := gin.New()
	cookieSecret := "test-secret-key-32-bytes-long!!"
	sessionStore := cookie.NewStore([]byte(cookieSecret))
	sessionStore.Options(sessions.Options{
		MaxAge:   60 * 60 * 24 * 90,
		HttpOnly: true,
		Secure:   false,
		Path:     "/",
	})
	router.Use(sessions.Sessions("chatto_session", sessionStore))

	_, nc := testutil.StartSharedNATS(t)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	t.Cleanup(cancel)

	chattoCore, err := core.NewChattoCore(ctx, nc, config.CoreConfig{})
	require.NoError(t, err)

	startCoreServices(t, chattoCore)

	user1, err := chattoCore.CreateUser(ctx, "", "test-user-1", "Test User 1", "password123")
	require.NoError(t, err)

	user2, err := chattoCore.CreateUser(ctx, "", "test-user-2", "Test User 2", "password456")
	require.NoError(t, err)

	logger := log.New(nil)
	logger.SetLevel(log.FatalLevel)

	s := &HTTPServer{
		config: config.ChattoConfig{
			Webserver: config.WebserverConfig{
				URL:                 "http://localhost:4000",
				CookieSigningSecret: cookieSecret,
			},
			Core: config.CoreConfig{
				Assets: config.AssetsConfig{
					MaxUploadSize: 25 * 1024 * 1024, // 25 MB
				},
			},
		},
		router: router,
		core:   chattoCore,
		logger: logger,
	}

	browserStore := newJetStreamBrowserSessionStore(chattoCore)
	s.browserSessions = newBrowserSessionManager(browserStore, s.config.Auth.TokenTTLOrDefault(), false)

	router.Use(s.csrfMiddleware())
	s.shareDataStore = newShareDataStore()

	s.setupShareTargetRoutes()

	router.GET("/login-test-user1", func(c *gin.Context) {
		if err := s.createCookieSession(c, user1.Id, "test_session"); err != nil {
			c.String(http.StatusInternalServerError, err.Error())
			return
		}
		if err := s.ensureCSRFToken(c); err != nil {
			c.String(http.StatusInternalServerError, err.Error())
			return
		}
		c.String(http.StatusOK, "logged in as user1")
	})

	router.GET("/login-test-user2", func(c *gin.Context) {
		if err := s.createCookieSession(c, user2.Id, "test_session"); err != nil {
			c.String(http.StatusInternalServerError, err.Error())
			return
		}
		if err := s.ensureCSRFToken(c); err != nil {
			c.String(http.StatusInternalServerError, err.Error())
			return
		}
		c.String(http.StatusOK, "logged in as user2")
	})

	server := httptest.NewServer(router)
	t.Cleanup(server.Close)
	t.Cleanup(func() { s.shareDataStore.Stop() })

	return server, s, user1.Id, user2.Id
}

func createSharePost(text string, fileSize int) (*bytes.Buffer, string) {
	body := &bytes.Buffer{}
	w := multipart.NewWriter(body)
	w.WriteField("title", "Test Share")
	w.WriteField("text", text)

	if fileSize > 0 {
		fw, _ := w.CreateFormFile("files", "test.bin")
		fw.Write(make([]byte, fileSize))
	}

	contentType := w.FormDataContentType()
	w.Close()
	return body, contentType
}

func TestShareSecurity_SignedInNoCsrfWithSecFetchSiteNone(t *testing.T) {
	server, _, _, _ := setupShareSecurityTestServer(t)

	jar, _ := cookiejar.New(nil)
	client := &http.Client{Jar: jar}

	// Log in
	resp, err := client.Get(server.URL + "/login-test-user1")
	require.NoError(t, err)
	resp.Body.Close()

	// POST with Sec-Fetch-Site: none (from share sheet) - should work
	body, contentType := createSharePost("hello", 0)
	req, _ := http.NewRequest(http.MethodPost, server.URL+"/share", body)
	req.Header.Set("Content-Type", contentType)
	req.Header.Set("Sec-Fetch-Site", "none")

	client.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	resp, err = client.Do(req)
	require.NoError(t, err)
	defer resp.Body.Close()

	assert.Equal(t, http.StatusSeeOther, resp.StatusCode)
	assert.True(t, strings.HasPrefix(resp.Header.Get("Location"), "/share/"))
}

func TestShareSecurity_SignedOutRedirectsToLogin(t *testing.T) {
	server, _, _, _ := setupShareSecurityTestServer(t)

	body, contentType := createSharePost("hello", 0)
	req, _ := http.NewRequest(http.MethodPost, server.URL+"/share", body)
	req.Header.Set("Content-Type", contentType)
	req.Header.Set("Sec-Fetch-Site", "none")

	client := &http.Client{
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}
	resp, err := client.Do(req)
	require.NoError(t, err)
	defer resp.Body.Close()

	assert.Equal(t, http.StatusSeeOther, resp.StatusCode)
	assert.Contains(t, resp.Header.Get("Location"), "/login")
}

func TestShareSecurity_CrossSiteRejected(t *testing.T) {
	server, _, _, _ := setupShareSecurityTestServer(t)

	jar, _ := cookiejar.New(nil)
	client := &http.Client{Jar: jar}

	// Log in
	resp, err := client.Get(server.URL + "/login-test-user1")
	require.NoError(t, err)
	resp.Body.Close()

	// POST with Sec-Fetch-Site: cross-site - should be rejected
	body, contentType := createSharePost("hello", 0)
	req, _ := http.NewRequest(http.MethodPost, server.URL+"/share", body)
	req.Header.Set("Content-Type", contentType)
	req.Header.Set("Sec-Fetch-Site", "cross-site")

	client.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	resp, err = client.Do(req)
	require.NoError(t, err)
	defer resp.Body.Close()

	bodyBytes, _ := io.ReadAll(resp.Body)
	assert.Equal(t, http.StatusForbidden, resp.StatusCode)
	assert.Contains(t, string(bodyBytes), "Cross-site")
}

func TestShareSecurity_PerUserByteCapReturns413(t *testing.T) {
	server, _, _, _ := setupShareSecurityTestServer(t)

	jar, _ := cookiejar.New(nil)
	client := &http.Client{Jar: jar}

	resp, err := client.Get(server.URL + "/login-test-user1")
	require.NoError(t, err)
	resp.Body.Close()

	// Three 20 MB files (60 MB) exceed the 50 MB per-user byte cap but stay
	// under the 25 MB per-file and 110 MB request-body limits.
	body := &bytes.Buffer{}
	w := multipart.NewWriter(body)
	require.NoError(t, w.WriteField("title", "oversized share"))
	fileSize := 20 * 1024 * 1024
	for i := 0; i < 3; i++ {
		fw, err := w.CreateFormFile("files", fmt.Sprintf("part-%d.bin", i))
		require.NoError(t, err)
		_, err = fw.Write(make([]byte, fileSize))
		require.NoError(t, err)
	}
	contentType := w.FormDataContentType()
	require.NoError(t, w.Close())

	req, err := http.NewRequest(http.MethodPost, server.URL+"/share", body)
	require.NoError(t, err)
	req.Header.Set("Content-Type", contentType)
	req.Header.Set("Sec-Fetch-Site", "none")

	client.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	resp, err = client.Do(req)
	require.NoError(t, err)
	defer resp.Body.Close()

	bodyBytes, _ := io.ReadAll(resp.Body)
	assert.Equal(t, http.StatusRequestEntityTooLarge, resp.StatusCode)
	assert.Contains(t, string(bodyBytes), "too large")
	assert.NotContains(t, string(bodyBytes), "temporarily full")
}

func TestShareSecurity_OversizedBodyRejected(t *testing.T) {
	server, _, _, _ := setupShareSecurityTestServer(t)

	jar, _ := cookiejar.New(nil)
	client := &http.Client{Jar: jar}

	// Log in
	resp, err := client.Get(server.URL + "/login-test-user1")
	require.NoError(t, err)
	resp.Body.Close()

	// POST with oversized body (30 MB > 25 MB file limit)
	body, contentType := createSharePost("hello", 30*1024*1024)
	req, _ := http.NewRequest(http.MethodPost, server.URL+"/share", body)
	req.Header.Set("Content-Type", contentType)
	req.Header.Set("Sec-Fetch-Site", "none")
	req.ContentLength = int64(body.Len())

	client.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	resp, err = client.Do(req)
	require.NoError(t, err)
	defer resp.Body.Close()

	bodyBytes, _ := io.ReadAll(resp.Body)
	assert.Equal(t, http.StatusRequestEntityTooLarge, resp.StatusCode)
	assert.Contains(t, string(bodyBytes), "too large")
}

type shareZeroReader struct{}

func (shareZeroReader) Read(p []byte) (int, error) {
	for i := range p {
		p[i] = 'x'
	}
	return len(p), nil
}

func TestShareSecurity_ChunkedOversizedBodyRejected(t *testing.T) {
	server, _, _, _ := setupShareSecurityTestServer(t)

	jar, _ := cookiejar.New(nil)
	client := &http.Client{Jar: jar}

	resp, err := client.Get(server.URL + "/login-test-user1")
	require.NoError(t, err)
	resp.Body.Close()

	// Stream a multipart body larger than maxShareBody with ContentLength = -1
	// so limitRequestBody cannot reject from the Content-Length header alone.
	pr, pw := io.Pipe()
	writer := multipart.NewWriter(pw)
	contentType := writer.FormDataContentType()
	go func() {
		defer pw.Close()
		defer writer.Close()
		_ = writer.WriteField("title", "chunked")
		fw, err := writer.CreateFormFile("files", "big.bin")
		if err != nil {
			pw.CloseWithError(err)
			return
		}
		if _, err := io.CopyN(fw, shareZeroReader{}, maxShareBody); err != nil {
			pw.CloseWithError(err)
			return
		}
	}()

	req, err := http.NewRequest(http.MethodPost, server.URL+"/share", pr)
	require.NoError(t, err)
	req.Header.Set("Content-Type", contentType)
	req.Header.Set("Sec-Fetch-Site", "none")
	req.ContentLength = -1

	client.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	resp, err = client.Do(req)
	require.NoError(t, err)
	defer resp.Body.Close()

	bodyBytes, _ := io.ReadAll(resp.Body)
	assert.Equal(t, http.StatusRequestEntityTooLarge, resp.StatusCode)
	assert.Contains(t, string(bodyBytes), "too large")
}

func TestShareSecurity_CapReached(t *testing.T) {
	gin.SetMode(gin.TestMode)

	router := gin.New()
	cookieSecret := "test-secret-key-32-bytes-long!!"
	sessionStore := cookie.NewStore([]byte(cookieSecret))
	sessionStore.Options(sessions.Options{
		MaxAge:   60 * 60 * 24 * 90,
		HttpOnly: true,
		Secure:   false,
		Path:     "/",
	})
	router.Use(sessions.Sessions("chatto_session", sessionStore))

	_, nc := testutil.StartSharedNATS(t)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	t.Cleanup(cancel)

	chattoCore, err := core.NewChattoCore(ctx, nc, config.CoreConfig{})
	require.NoError(t, err)

	startCoreServices(t, chattoCore)

	// With per-user quota of 3, we need multiple users to hit the global cap of 100.
	// Create 34 users (34 * 3 = 102 shares attempted)
	numUsers := (shareDataMaxEntries / shareDataMaxPerUser) + 1
	userIDs := make([]string, numUsers)

	for i := 0; i < numUsers; i++ {
		user, err := chattoCore.CreateUser(ctx, "", fmt.Sprintf("test-user-%d", i+1), fmt.Sprintf("Test User %d", i+1), "password123")
		require.NoError(t, err)
		userIDs[i] = user.Id
	}

	logger := log.New(nil)
	logger.SetLevel(log.FatalLevel)

	srv := &HTTPServer{
		router:         router,
		core:           chattoCore,
		shareDataStore: newShareDataStore(),
		logger:         logger,
	}

	setupShareTargetRoutes := func(s *HTTPServer) {
		srv.router.POST("/share", srv.handleShareTarget)
		srv.router.GET("/api/share/:id", srv.handleShareDataAPI)
	}
	setupShareTargetRoutes(srv)

	// Create login routes for all users
	for i := 0; i < numUsers; i++ {
		userId := userIDs[i]
		loginPath := fmt.Sprintf("/login-test-user%d", i+1)
		router.GET(loginPath, func(c *gin.Context) {
			if err := srv.createCookieSession(c, userId, "test_session"); err != nil {
				c.String(http.StatusInternalServerError, err.Error())
				return
			}
			if err := srv.ensureCSRFToken(c); err != nil {
				c.String(http.StatusInternalServerError, err.Error())
				return
			}
			c.String(http.StatusOK, fmt.Sprintf("logged in as user %s", userId))
		})
	}

	server := httptest.NewServer(router)
	t.Cleanup(server.Close)

	// Create shares from multiple users to fill the global store
	for userIdx := 0; userIdx < numUsers; userIdx++ {
		jar, _ := cookiejar.New(nil)
		client := &http.Client{Jar: jar}

		// Log in as the specific user
		loginURL := fmt.Sprintf("%s/login-test-user%d", server.URL, userIdx+1)
		resp, err := client.Get(loginURL)
		require.NoError(t, err)
		resp.Body.Close()

		// Each user creates up to 3 shares (per-user quota)
		for shareIdx := 0; shareIdx < shareDataMaxPerUser; shareIdx++ {
			totalShares := userIdx*shareDataMaxPerUser + shareIdx
			if totalShares >= shareDataMaxEntries+1 {
				break
			}

			body, contentType := createSharePost(fmt.Sprintf("user%d share%d", userIdx, shareIdx), 1024)
			req, _ := http.NewRequest(http.MethodPost, server.URL+"/share", body)
			req.Header.Set("Content-Type", contentType)
			req.Header.Set("Sec-Fetch-Site", "none")

			client.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
			resp, err = client.Do(req)
			require.NoError(t, err)

			if totalShares < shareDataMaxEntries {
				require.Equal(t, http.StatusSeeOther, resp.StatusCode, "share %d should succeed", totalShares)
			} else {
				// This should hit the global cap
				bodyBytes, _ := io.ReadAll(resp.Body)
				resp.Body.Close()
				assert.Equal(t, http.StatusServiceUnavailable, resp.StatusCode)
				assert.Contains(t, string(bodyBytes), "full")
				goto verifyStats
			}
			resp.Body.Close()
		}
	}

verifyStats:
	// Verify store stats
	srv.shareDataStore.mu.RLock()
	entryCount := len(srv.shareDataStore.entries)
	srv.shareDataStore.mu.RUnlock()
	assert.Equal(t, shareDataMaxEntries, entryCount)
}

func TestShareSecurity_OnlyOwnerCanReadShareData(t *testing.T) {
	server, _, userId1, userId2 := setupShareSecurityTestServer(t)

	jar1, _ := cookiejar.New(nil)
	client1 := &http.Client{Jar: jar1}

	// User 1 logs in and creates a share
	resp, err := client1.Get(server.URL + "/login-test-user1")
	require.NoError(t, err)
	resp.Body.Close()

	body, contentType := createSharePost("user1 secret", 0)
	req, _ := http.NewRequest(http.MethodPost, server.URL+"/share", body)
	req.Header.Set("Content-Type", contentType)
	req.Header.Set("Sec-Fetch-Site", "none")

	client1.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	resp, err = client1.Do(req)
	require.NoError(t, err)
	location := resp.Header.Get("Location")
	resp.Body.Close()

	require.True(t, strings.HasPrefix(location, "/share/"))
	shareId := strings.TrimPrefix(location, "/share/")

	// User 2 logs in and tries to read user 1's share - should fail
	jar2, _ := cookiejar.New(nil)
	client2 := &http.Client{Jar: jar2}

	resp, err = client2.Get(server.URL + "/login-test-user2")
	require.NoError(t, err)
	resp.Body.Close()

	resp, err = client2.Get(server.URL + "/api/share/" + shareId)
	require.NoError(t, err)
	defer resp.Body.Close()

	bodyBytes, _ := io.ReadAll(resp.Body)
	assert.Equal(t, http.StatusNotFound, resp.StatusCode)
	assert.Contains(t, string(bodyBytes), "not found or expired")

	t.Logf("user1=%s user2=%s", userId1, userId2)
}

func TestShareSecurity_DeletedAfterFirstRead(t *testing.T) {
	server, _, _, _ := setupShareSecurityTestServer(t)

	jar, _ := cookiejar.New(nil)
	client := &http.Client{Jar: jar}

	// Log in
	resp, err := client.Get(server.URL + "/login-test-user1")
	require.NoError(t, err)
	resp.Body.Close()

	// Create a share
	body, contentType := createSharePost("one-time secret", 0)
	req, _ := http.NewRequest(http.MethodPost, server.URL+"/share", body)
	req.Header.Set("Content-Type", contentType)
	req.Header.Set("Sec-Fetch-Site", "none")

	client.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	resp, err = client.Do(req)
	require.NoError(t, err)
	location := resp.Header.Get("Location")
	resp.Body.Close()

	require.True(t, strings.HasPrefix(location, "/share/"))
	shareId := strings.TrimPrefix(location, "/share/")

	// First read - should succeed
	resp, err = client.Get(server.URL + "/api/share/" + shareId)
	require.NoError(t, err)
	bodyBytes, _ := io.ReadAll(resp.Body)
	resp.Body.Close()

	assert.Equal(t, http.StatusOK, resp.StatusCode)

	var shareData map[string]interface{}
	err = json.Unmarshal(bodyBytes, &shareData)
	require.NoError(t, err)
	assert.Equal(t, "one-time secret", shareData["text"])

	// Second read - should fail (already deleted)
	resp, err = client.Get(server.URL + "/api/share/" + shareId)
	require.NoError(t, err)
	bodyBytes, _ = io.ReadAll(resp.Body)
	resp.Body.Close()

	assert.Equal(t, http.StatusNotFound, resp.StatusCode)
	assert.Contains(t, string(bodyBytes), "not found")
}

func TestShareSecurity_UnauthenticatedCannotReadShareData(t *testing.T) {
	server, _, _, _ := setupShareSecurityTestServer(t)

	jar, _ := cookiejar.New(nil)
	client := &http.Client{Jar: jar}

	// Log in and create a share
	resp, err := client.Get(server.URL + "/login-test-user1")
	require.NoError(t, err)
	resp.Body.Close()

	body, contentType := createSharePost("secret", 0)
	req, _ := http.NewRequest(http.MethodPost, server.URL+"/share", body)
	req.Header.Set("Content-Type", contentType)
	req.Header.Set("Sec-Fetch-Site", "none")

	client.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	resp, err = client.Do(req)
	require.NoError(t, err)
	location := resp.Header.Get("Location")
	resp.Body.Close()

	shareId := strings.TrimPrefix(location, "/share/")

	// Try to read with unauthenticated client
	anonClient := &http.Client{}
	resp, err = anonClient.Get(server.URL + "/api/share/" + shareId)
	require.NoError(t, err)
	defer resp.Body.Close()

	bodyBytes, _ := io.ReadAll(resp.Body)
	assert.Equal(t, http.StatusUnauthorized, resp.StatusCode)
	assert.Contains(t, string(bodyBytes), "Authentication required")
}
