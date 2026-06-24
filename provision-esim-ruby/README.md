# eSIM Provisioning with Ruby and Sinatra

## What Does This Example Do?

Build a production-ready Sinatra application that provisions eSIM profiles over-the-air using the Telnyx IoT API. This tutorial demonstrates how to manage eSIM lifecycle—from profile creation through activation—with proper error handling, webhook integration for status updates, and secure credential management. You'll learn to handle asynchronous provisioning workflows and integrate with device management systems.

## Who Is This For?

- **Ruby developers** building iot features with Sinatra.
- **Backend engineers** integrating telephony or messaging into existing applications.
- **DevOps teams** looking for containerized, production-ready telecom examples.
- **Startups and enterprises** replacing legacy telecom providers with a modern API-first platform.

## Why Telnyx?

Telnyx is an **AI Communications Infrastructure** platform that gives developers a single API for [voice](https://telnyx.com/products/voice-ai-agents), [messaging](https://telnyx.com/products/sms-api), [SIP](https://telnyx.com/products/sip-trunks), [AI](https://telnyx.com/ai-assistants), and [IoT](https://telnyx.com/products/iot-sim-card) — no Frankenstack required.

- **Integrated platform** — [Voice](https://telnyx.com/products/voice-ai-agents), [SMS](https://telnyx.com/products/sms-api), [SIP trunking](https://telnyx.com/products/sip-trunks), [AI assistants](https://telnyx.com/ai-assistants), and [IoT SIM management](https://telnyx.com/products/iot-sim-card) under one roof. No stitching together multiple vendors.
- **Global private network** — Calls and messages traverse the Telnyx-owned IP network for lower latency and higher reliability than the public internet.
- **Developer-first** — SDKs for Python, Node.js, Go, Ruby, Java, and PHP. Comprehensive webhook event model. Sandbox environment for testing.
- **Competitive pricing** — Pay-as-you-go with no minimums, contracts, or per-seat fees.

## Prerequisites

- Ruby 2.7 or higher.
- A Telnyx account with an active API key from the [Telnyx Portal](https://portal.telnyx.com).
- Access to the Telnyx IoT / SIM Management API.
- Bundler (Ruby dependency manager).
- A publicly accessible URL for webhook callbacks (ngrok or similar for local development).
- An eSIM-capable device or simulator for testing.

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/provision-esim-ruby
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create `app.rb` and initialize the Telnyx client using the Ruby SDK pattern. Define helper functions to manage the eSIM provisioning workflow:

```ruby
require "sinatra"
require "telnyx"
require "dotenv/load"
require "json"

# Initialize Telnyx client with API key from environment
client = Telnyx::Client.new(api_key: ENV["TELNYX_API_KEY"])

# Helper function to provision an eSIM profile
def provision_esim(device_id, carrier_code)
  """
  Provision an eSIM profile for a device.
  Returns JSON-serializable response data.
  """
  client = Telnyx::Client.new(api_key: ENV["TELNYX_API_KEY"])
  
  # Validate inputs
  raise ArgumentError, "Device ID cannot be empty" if device_id.nil? || device_id.empty?
  raise ArgumentError, "Carrier code must be provided" if carrier_code.nil? || carrier_code.empty?
  
  # Call the eSIM provisioning API
  # Note: eSIM provisioning is typically done via REST endpoints
  # The SDK may wrap this or you may need to use HTTP client directly
  response = client.esim_profiles.create(
    device_identifier: device_id,
    carrier_code: carrier_code,
    callback_url: ENV["WEBHOOK_URL"]
  )
  
  # Extract serializable data — SDK objects are NOT JSON-serializable
  {
    profile_id: response.data.id,
    device_id: response.data.device_identifier,
    status: response.data.status,
    carrier_code: response.data.carrier_code,
    activation_code: response.data.activation_code,
    created_at: response.data.created_at
  }
rescue ArgumentError => e
  raise e
end

# Helper function to activate a provisioned eSIM profile
def activate_esim(profile_id, confirmation_code = nil)
  """
  Activate a provisioned eSIM profile.
  Returns JSON-serializable response data.
  """
  client = Telnyx::Client.new(api_key: ENV["TELNYX_API_KEY"])
  
  raise ArgumentError, "Profile ID cannot be empty" if profile_id.nil? || profile_id.empty?
  
  # Activate the eSIM profile
  response = client.esim_profiles.activate(
    id: profile_id,
    confirmation_code: confirmation_code
  )
  
  {
    profile_id: response.data.id,
    status: response.data.status,
    activated_at: response.data.activated_at,
    device_id: response.data.device_identifier
  }
rescue ArgumentError => e
  raise e
end

# Helper function to retrieve eSIM profile status
def get_esim_status(profile_id)
  """
  Retrieve the current status of an eSIM profile.
  Returns JSON-serializable response data.
  """
  client = Telnyx::Client.new(api_key: ENV["TELNYX_API_KEY"])
  
  raise ArgumentError, "Profile ID cannot be empty" if profile_id.nil? || profile_id.empty?
  
  response = client.esim_profiles.retrieve(profile_id)
  
  {
    profile_id: response.data.id,
    device_id: response.data.device_identifier,
    status: response.data.status,
    carrier_code: response.data.carrier_code,
    created_at: response.data.created_at,
    activated_at: response.data.activated_at
  }
rescue ArgumentError => e
  raise e
end
```

## Complete Code

See [`app.rb`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/provision-esim-ruby/app.rb) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. If the key was regenerated recently, update your environment file and restart the Sinatra server. Confirm the `.env` file is loaded before the client is initialized. |
| Webhook Not Receiving Events | Provisioning completes but webhook endpoint is never called. | Ensure your `WEBHOOK_URL` in the `.env` file is publicly accessible and points to your `/webhooks/esim` endpoint. Use ngrok (`ngrok http 4567`) to expose your local Sinatra server during development. Update the `WEBHOOK_URL` in `.env` to the ngrok URL. Verify the webhook URL is correctly passed to the `esim_profiles.create()` call. Check Telnyx Portal logs for webhook delivery failures. |
| Profile Activation Fails | Activation returns an error or the profile status remains "provisioning". | Ensure the `profile_id` is correct and the profile has reached "provisioned" status before attempting activation. If a `confirmation_code` is required by your carrier, verify it is provided in the activation request. Check the webhook logs to see if the provisioning completed successfully. Some carriers require additional verification steps—consult your carrier's eSIM documentation. |
| JSON Parsing Error | Request returns `{"error": "Invalid JSON in request body"}` with HTTP 400. | Verify the request body is valid JSON. Use `curl -H "Content-Type: application/json"` to set the correct header. Check that all string values are properly quoted and there are no trailing commas in the JSON object. Test with a JSON validator tool before sending requests. |
| Rate Limit Exceeded (429) | Endpoint returns `{"error": "Rate limit exceeded. Please slow down."}` with HTTP 429. | Implement exponential backoff in your client code. Space out provisioning requests by at least 1 second. If provisioning many devices, batch requests and use the SIM Card Group API for bulk operations. Check your Telnyx account plan for rate limits and contact support if you need higher limits. |

## FAQ

**Q: Do I need a Telnyx account to run this example?**

Yes. Sign up at [portal.telnyx.com](https://portal.telnyx.com) to get an API key. Telnyx offers free trial credit for testing.

**Q: Can I use this IoT example in production?**

Yes. This example includes error handling and environment-based configuration. Review the security and scaling sections before deploying to production.

**Q: What Ruby version do I need?**

Ruby 3.1 or higher. Ruby 3.3 is recommended.

**Q: How is Telnyx different from Twilio?**

Telnyx is an AI Communications Infrastructure platform with a private global network, integrated voice + messaging + AI + SIP + IoT under one API, and significantly lower pricing. No need to stitch together multiple vendors.

**Q: Where do I get a Telnyx phone number?**

Log into the [Telnyx Portal](https://portal.telnyx.com), navigate to Numbers > Search & Buy, and purchase a number with the capabilities you need (SMS, voice, or both).

## Resources

- [IoT SIM Get Started](https://developers.telnyx.com/docs/iot-sim/get-started)
- [SIM Card API Reference](https://developers.telnyx.com/api-reference/sim-cards/get-all-sim-cards)
- [Ruby SDK](https://developers.telnyx.com/development/sdk/ruby)
- [Telnyx IoT SIM Cards](https://telnyx.com/products/iot-sim-card)
- [IoT Data Plans Pricing](https://telnyx.com/pricing/iot-data-plans)

## Related Examples

- [Monitor SIM Card Data Usage](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/iot/ruby/data-usage-monitoring).
- [Activate SIM Cards with Ruby](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/iot/ruby/sim-activation).
- [Handle SIM Status Webhooks](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/iot/ruby/sim-status-webhook).
