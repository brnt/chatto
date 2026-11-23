package http_server

func (s *HTTPServer) setupShareTargetRoutes() {
	// Web Share Target API POST endpoint
	s.router.POST("/share", s.handleShareTarget)

	// API endpoint to retrieve share data
	s.router.GET("/api/share/:id", s.handleShareDataAPI)
}
