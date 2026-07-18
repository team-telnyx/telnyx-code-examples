package function

import (
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"os"
	"strconv"
	"time"
)

const maxSkew = 5 * time.Minute

var publicKey ed25519.PublicKey

func init() {
	raw := os.Getenv("TELNYX_PUBLIC_KEY")
	if raw == "" {
		log.Println("warning: TELNYX_PUBLIC_KEY is not set; all requests will be rejected")
		return
	}
	key, err := base64.StdEncoding.DecodeString(raw)
	if err != nil || len(key) != ed25519.PublicKeySize {
		log.Printf("warning: TELNYX_PUBLIC_KEY is invalid (len=%d, err=%v)", len(key), err)
		return
	}
	publicKey = ed25519.PublicKey(key)
}

func Handle(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	body, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "cannot read body", http.StatusBadRequest)
		return
	}

	if !verifyTelnyxSignature(r.Header, body) {
		http.Error(w, "invalid signature", http.StatusForbidden)
		return
	}

	if isDynamicVariablesRequest(body) {
		handleDynamicVariables(w, body)
		return
	}
	handleScheduleEstimate(w, body)
}

// --- Signature verification ---

func verifyTelnyxSignature(h http.Header, body []byte) bool {
	if publicKey == nil {
		return false
	}
	sig := h.Get("telnyx-signature-ed25519")
	ts := h.Get("telnyx-timestamp")
	if sig == "" || ts == "" {
		return false
	}
	t, err := strconv.ParseInt(ts, 10, 64)
	if err != nil {
		return false
	}
	age := time.Since(time.Unix(t, 0))
	if age < -maxSkew || age > maxSkew {
		return false
	}
	s, err := base64.StdEncoding.DecodeString(sig)
	if err != nil {
		return false
	}
	signed := append([]byte(ts+"|"), body...)
	return ed25519.Verify(publicKey, signed, s)
}

// --- Body shape dispatch ---

func isDynamicVariablesRequest(body []byte) bool {
	var probe struct {
		Data *struct {
			EventType string `json:"event_type"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &probe); err != nil {
		return false
	}
	return probe.Data != nil
}

// --- Dynamic Variables ---

type dvRequest struct {
	Data struct {
		EventType string `json:"event_type"`
		Payload   struct {
			Channel       string `json:"telnyx_conversation_channel"`
			AgentTarget   string `json:"telnyx_agent_target"`
			EndUserTarget string `json:"telnyx_end_user_target"`
			CallControlID string `json:"call_control_id"`
			AssistantID   string `json:"assistant_id"`
		} `json:"payload"`
	} `json:"data"`
}

type dvResponse struct {
	DynamicVariables map[string]any `json:"dynamic_variables"`
}

func handleDynamicVariables(w http.ResponseWriter, body []byte) {
	var req dvRequest
	if err := json.Unmarshal(body, &req); err != nil {
		http.Error(w, "bad json", http.StatusBadRequest)
		return
	}

	caller := req.Data.Payload.EndUserTarget

	resp := dvResponse{
		DynamicVariables: map[string]any{
			"company_name":                     lookupCompany(caller),
			"timeframe":                        "two business days",
			"placeholder_transfer_destination": "+15551234567",
		},
	}

	writeJSON(w, resp)
}

func lookupCompany(caller string) string {
	known := map[string]string{
		"+16282564269": "Pinecrest Home Services",
		"+14154948493": "Bay Area Roofing Co",
		"+17177247292": "Pinecrest Home Services",
	}
	if name, ok := known[caller]; ok {
		return name
	}
	return "Pinecrest Home Services"
}

// --- Webhook Tool: schedule_estimate ---

type estimateRequest struct {
	CustomerName   string `json:"customer_name"`
	PhoneNumber    string `json:"phone_number"`
	ServiceType    string `json:"service_type"`
	ServiceAddress string `json:"service_address"`
	PreferredDate  string `json:"preferred_date"`
	PreferredTime  string `json:"preferred_time"`
}

type estimateResponse struct {
	ScheduledDate   string `json:"scheduled_date"`
	ScheduledTime   string `json:"scheduled_time"`
	ConfirmationNum string `json:"confirmation_number"`
	EstimateID      string `json:"estimate_id"`
}

func handleScheduleEstimate(w http.ResponseWriter, body []byte) {
	var req estimateRequest
	if err := json.Unmarshal(body, &req); err != nil {
		http.Error(w, "bad json", http.StatusBadRequest)
		return
	}

	resp := estimateResponse{
		ScheduledDate:   req.PreferredDate,
		ScheduledTime:   req.PreferredTime,
		ConfirmationNum: "CONF-" + strconv.FormatInt(time.Now().Unix(), 10),
		EstimateID:      "EST-" + strconv.FormatInt(time.Now().Unix(), 10),
	}

	writeJSON(w, resp)
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(v)
}
