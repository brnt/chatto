package http_server

import "time"

const (
	maxShareBody  = 110 * 1024 * 1024 // 110 MB: room for 4× 25 MB files plus form overhead
	uploadTimeout = 2 * time.Minute
)

func (s *HTTPServer) setupShareTargetRoutes() {
	// Web Share Target API POST endpoint with body size limit
	s.router.POST("/share", limitRequestBody(maxShareBody, uploadTimeout), s.handleShareTarget)

	// API endpoint to retrieve share data
	s.router.GET("/api/share/:id", s.handleShareDataAPI)
}
