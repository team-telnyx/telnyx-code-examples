package main

import (
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
	"sync"

	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
	"github.com/team-telnyx/telnyx-go/v4/v2"
	"github.com/team-telnyx/telnyx-go/v4/v2/messaging"
)

// Configuration and state management
type SurveyResponse struct {
	PhoneNumber string
	Question    int
	Answer      string
}

type SurveyState struct {
	mu        sync.RWMutex
	responses map[string][]SurveyResponse
}

var surveyState = &SurveyState{
	responses: make(map[string][]SurveyResponse),
}

var surveyQuestions = []string{
	"How satisfied are you with our service? Reply 1-5.",
	"Would you recommend us to a friend? Reply YES or NO.",
	"What could we improve? Reply with your feedback.",
}

// Request and webhook types
type StartSurveyRequest struct {
	PhoneNumber string `json:"phone_number" binding:"required"`
}

type WebhookPayload struct {
	Data struct {
		ID        string `json:"id"`
		Direction string `json:"direction"`
		From      struct {
			PhoneNumber string `json:"phone_number"`
		} `json:"from"`
		Text string `json:"text"`
	} `json:"data"`
	EventType string `json:"event_type"`
}

// Initialization
func init() {
	godotenv.Load()
}

// Helper functions
func getAPIKey() string {
	return os.Getenv("TELNYX_API_KEY")
}

func getPhoneNumber() string {
	return os.Getenv("TELNYX_PHONE_NUMBER")
}

func isValidE164(phoneNumber string) bool {
	if len(phoneNumber) < 10 || len(phoneNumber) > 15 {
		return false
	}
	if phoneNumber[0] != '+' {
		return false
	}
	for _, ch := range phoneNumber[1:] {
		if ch < '0' || ch > '9' {
			return false
		}
	}
	return true
}

func (s *SurveyState) addResponse(phoneNumber string, response SurveyResponse) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.responses[phoneNumber] = append(s.responses[phoneNumber], response)
}

func (s *SurveyState) getResponses(phoneNumber string) []SurveyResponse {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.responses[phoneNumber]
}

func (s *SurveyState) getAllResponses() map[string][]SurveyResponse {
	s.mu.RLock()
	defer s.mu.RUnlock()
	result := make(map[string][]SurveyResponse)
	for k, v := range s.responses {
		result[k] = append([]SurveyResponse{}, v...)
	}
	return result
}

// Survey operations
func sendSurveyQuestion(toNumber string, questionIndex int) error {
	client := telnyx.NewClient(telnyx.WithAPIKey(getAPIKey()))
	fromNumber := getPhoneNumber()

	if fromNumber == "" {
		return fmt.Errorf("TELNYX_PHONE_NUMBER environment variable not set")
	}

	if !isValidE164(toNumber) {
		return fmt.Errorf("phone number must be in E.164 format (e.g., +15551234567)")
	}

	if questionIndex < 0 || questionIndex >= len(surveyQuestions) {
		return fmt.Errorf("invalid question index: %d", questionIndex)
	}

	messageText := surveyQuestions[questionIndex]

	params := &messaging.CreateMessageParams{
		From: fromNumber,
		To:   toNumber,
		Text: messageText,
	}

	response, err := client.Messages.CreateMessage(params)
	if err != nil {
		return fmt.Errorf("failed to send SMS: %w", err)
	}

	if response == nil || response.Data == nil {
		return fmt.Errorf("empty response from Telnyx API")
	}

	return nil
}

func startSurvey(toNumber string) error {
	return sendSurveyQuestion(toNumber, 0)
}

func sendNextQuestion(toNumber string) error {
	responses := surveyState.getResponses(toNumber)
	nextQuestionIndex := len(responses)

	if nextQuestionIndex >= len(surveyQuestions) {
		client := telnyx.NewClient(telnyx.WithAPIKey(getAPIKey()))
		fromNumber := getPhoneNumber()

		params := &messaging.CreateMessageParams{
			From: fromNumber,
			To:   toNumber,
			Text: "Thank you for completing our survey!",
		}

		_, err := client.Messages.CreateMessage(params)
		return err
	}

	return sendSurveyQuestion(toNumber, nextQuestionIndex)
}

// HTTP handlers
func StartSurveyHandler(c *gin.Context) {
	var req StartSurveyRequest

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Missing required field: phone_number"})
		return
	}

	if !isValidE164(req.PhoneNumber) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Phone number must be in E.164 format (e.g., +15551234567)"})
		return
	}

	if err := startSurvey(req.PhoneNumber); err != nil {
		handleSMSError(c, err)
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message":      "Survey started",
		"phone_number": req.PhoneNumber,
		"question":     1,
	})
}

func WebhookHandler(c *gin.Context) {
	var payload WebhookPayload

	if err := c.ShouldBindJSON(&payload); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid webhook payload"})
		return
	}

	if payload.EventType != "message.received" || payload.Data.Direction != "inbound" {
		c.JSON(http.StatusOK, gin.H{"status": "ignored"})
		return
	}

	phoneNumber := payload.Data.From.PhoneNumber
	answer := strings.TrimSpace(payload.Data.Text)

	responses := surveyState.getResponses(phoneNumber)
	surveyResponse := SurveyResponse{
		PhoneNumber: phoneNumber,
		Question:    len(responses) + 1,
		Answer:      answer,
	}
	surveyState.addResponse(phoneNumber, surveyResponse)

	if err := sendNextQuestion(phoneNumber); err != nil {
		c.JSON(http.StatusOK, gin.H{
			"status": "response_recorded",
			"error":  err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"status":       "response_recorded",
		"phone_number": phoneNumber,
		"question":     len(responses) + 1,
	})
}

func GetSurveyResultsHandler(c *gin.Context) {
	allResponses := surveyState.getAllResponses()

	results := make(map[string]interface{})
	for phoneNumber, responses := range allResponses {
		responseList := make([]map[string]interface{}, len(responses))
		for i, resp := range responses {
			responseList[i] = map[string]interface{}{
				"question": resp.Question,
				"answer":   resp.Answer,
			}
		}
		results[phoneNumber] = responseList
	}

	c.JSON(http.StatusOK, gin.H{
		"total_respondents": len(allResponses),
		"responses":         results,
	})
}

func handleSMSError(c *gin.Context, err error) {
	switch err.(type) {
	case *telnyx.AuthenticationError:
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid API key"})
	case *telnyx.RateLimitError:
		c.JSON(http.StatusTooManyRequests, gin.H{"error": "Rate limit exceeded. Please slow down."})
	case *telnyx.APIStatusError:
		apiErr := err.(*telnyx.APIStatusError)
		c.JSON(apiErr.StatusCode, gin.H{"error": apiErr.Error(), "status_code": apiErr.StatusCode})
	case *telnyx.APIConnectionError:
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Network error connecting to Telnyx"})
	default:
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
	}
}

// Main server
func main() {
	if getAPIKey() == "" {
		log.Fatal("TELNYX_API_KEY environment variable not set")
	}
	if getPhoneNumber() == "" {
		log.Fatal("TELNYX_PHONE_NUMBER environment variable not set")
	}

	router := gin.Default()

	router.POST("/surveys/start", StartSurveyHandler)
	router.POST("/webhooks/sms", WebhookHandler)
	router.GET("/surveys/results", GetSurveyResultsHandler)
	router.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
	})

	log.Println("Starting SMS survey server on :8080")
	if err := router.Run(":8080"); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}
