package main

import (
	"net/http"
	"os"

	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
	"github.com/telnyx/telnyx-go"
	"github.com/telnyx/telnyx-go/option"
)

func main() {
	// Load environment variables securely
	if err := godotenv.Load(); err != nil {
		panic("Error loading .env file")
	}

	// Initialize Telnyx client using new pattern — environment variable only
	client := telnyx.NewClient(option.WithAPIKey(os.Getenv("TELNYX_API_KEY")))

	r := gin.Default()

	// POST /sip-connections — Create a new SIP connection for PBX registration
	r.POST("/sip-connections", func(c *gin.Context) {
		var req struct {
			Name     string `json:"name" binding:"required"`
			Username string `json:"username" binding:"required"`
			Password string `json:"password" binding:"required"`
		}

		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request: " + err.Error()})
			return
		}

		// Create connection with credential authentication
		resp, err := client.SIPConnections.Create(c.Request.Context(), telnyx.SIPConnectionCreateParams{
			Name: req.Name,
			SIPAuthentication: &telnyx.SIPAuthentication{
				Username: req.Username,
				Password: req.Password,
			},
			TransportProtocol: "TLS",
		})

		if err != nil {
			handleTelnyxError(c, err)
			return
		}

		// Serialize SDK response to plain JSON — never return raw SDK objects
		c.JSON(http.StatusCreated, gin.H{
			"id":     resp.Data.ID,
			"name":   resp.Data.Name,
			"status": resp.Data.Status,
			"sip_authentication": gin.H{
				"username": resp.Data.SIPAuthentication.Username,
				"realm":    resp.Data.SIPAuthentication.Realm,
			},
			"transport_protocol": resp.Data.TransportProtocol,
		})
	})

	// GET /sip-connections — List all SIP connections
	r.GET("/sip-connections", func(c *gin.Context) {
		resp, err := client.SIPConnections.List(c.Request.Context(), telnyx.SIPConnectionListParams{})
		if err != nil {
			handleTelnyxError(c, err)
			return
		}

		// Unpack paginated list to serializable format
		connections := make([]gin.H, 0, len(resp.Data))
		for _, conn := range resp.Data {
			connections = append(connections, gin.H{
				"id":     conn.ID,
				"name":   conn.Name,
				"status": conn.Status,
			})
		}

		c.JSON(http.StatusOK, gin.H{"data": connections})
	})

	r.Run(":8080")
}

// handleTelnyxError converts SDK errors to HTTP responses using flat error namespace
func handleTelnyxError(c *gin.Context, err error) {
	switch e := err.(type) {
	case *telnyx.AuthenticationError:
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid API key"})
	case *telnyx.RateLimitError:
		c.JSON(http.StatusTooManyRequests, gin.H{"error": "Rate limit exceeded. Please slow down."})
	case *telnyx.APIStatusError:
		c.JSON(e.StatusCode, gin.H{"error": e.Error(), "status_code": e.StatusCode})
	case *telnyx.APIConnectionError:
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Network error connecting to Telnyx"})
	default:
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Internal server error: " + err.Error()})
	}
}
