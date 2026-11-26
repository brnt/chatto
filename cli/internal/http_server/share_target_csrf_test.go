package http_server

import (
	"bytes"
	"context"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/chattocorp/chatto/cli/internal/config"
	"github.com/chattocorp/chatto/cli/internal/core"
	"github.com/chattocorp/chatto/cli/internal/testutil"
	"github.com/gin-contrib/sessions"
	"github.com/gin-contrib/sessions/cookie"
	"github.com/gin-gonic/gin"
)

func setupShareProbeServer(t *testing.T) (*httptest.Server, *http.Client) {
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
	if err != nil {
		t.Fatalf("NewChattoCore: %v", err)
	}
	startCoreServices(t, chattoCore)
	user, err := chattoCore.CreateUser(ctx, "", "csrf-test-user", "CSRF Test User", "password123")
	if err != nil {
		t.Fatalf("CreateUser: %v", err)
	}

	s := &HTTPServer{
		config: config.ChattoConfig{
			Webserver: config.WebserverConfig{
				URL:                 "http://localhost:4000",
				CookieSigningSecret: cookieSecret,
			},
		},
		router: router,
		core:   chattoCore,
	}
	browserStore := newJetStreamBrowserSessionStore(chattoCore)
	s.browserSessions = newBrowserSessionManager(browserStore, s.config.Auth.TokenTTLOrDefault(), false)
	router.Use(func(c *gin.Context) {
		if c.GetHeader("X-Test-Cancel-Authentication") == "true" {
			ctx, cancel := context.WithCancel(c.Request.Context())
			cancel()
			c.Request = c.Request.WithContext(ctx)
		}
		c.Next()
	})
	router.Use(s.csrfMiddleware())
	s.shareDataStore = newShareDataStore()
	router.POST("/share", s.handleShareTarget)

	router.GET("/login-test", func(c *gin.Context) {
		if err := s.createCookieSession(c, user.Id, "csrf_test"); err != nil {
			c.String(http.StatusInternalServerError, err.Error())
			return
		}
		if err := s.ensureCSRFToken(c); err != nil {
			c.String(http.StatusInternalServerError, err.Error())
			return
		}
		c.String(http.StatusOK, "logged in")
	})
	router.GET("/csrf-refresh", func(c *gin.Context) {
		c.String(http.StatusOK, "refreshed")
	})
	router.POST(serverDiscoveryConnectPath, func(c *gin.Context) {
		c.String(http.StatusOK, "connect ok")
	})
	router.POST("/auth/logout", func(c *gin.Context) {
		session := sessions.Default(c)
		session.Clear()
		_ = session.Save()
		clearCSRFCookie(c)
		c.String(http.StatusOK, "logged out")
	})
	router.POST("/auth/verify-email/request-code", func(c *gin.Context) {
		c.String(http.StatusOK, "verification ok")
	})
	router.POST("/auth/login", func(c *gin.Context) {
		c.String(http.StatusOK, "login ok")
	})
	router.POST("/oauth/token", func(c *gin.Context) {
		c.String(http.StatusOK, "token ok")
	})

	server := httptest.NewServer(router)
	t.Cleanup(server.Close)

	jar, err := cookiejar.New(nil)
	if err != nil {
		t.Fatalf("cookie jar: %v", err)
	}
	return server, &http.Client{Jar: jar}
}

func TestProbeShareCSRF(t *testing.T) {
	post := func(client *http.Client, url string) int {
		body := &bytes.Buffer{}
		w := multipart.NewWriter(body)
		_ = w.WriteField("text", "hello")
		_ = w.Close()
		req, _ := http.NewRequest(http.MethodPost, url+"/share", body)
		req.Header.Set("Content-Type", w.FormDataContentType())
		client.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
		resp, err := client.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		b, _ := io.ReadAll(resp.Body)
		t.Logf("status=%d location=%q body=%s", resp.StatusCode, resp.Header.Get("Location"), b)
		return resp.StatusCode
	}
	server, client := setupShareProbeServer(t)
	t.Logf("anonymous: %d", post(&http.Client{}, server.URL))
	csrfCookieValue(t, client, server.URL)
	t.Logf("signed-in (cookie, no CSRF header, as a share_target form POST sends): %d", post(client, server.URL))
}
