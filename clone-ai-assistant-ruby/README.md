# Clone AI Assistant with Ruby and Sinatra

## What Does This Example Do?

Build a production-ready Sinatra endpoint that clones an existing AI Assistant using the Telnyx Ruby SDK. This tutorial demonstrates how to duplicate an assistant's configuration, including its model, instructions, and tools, enabling rapid deployment of similar assistants for different use cases. You'll learn proper error handling for telecom APIs, secure credential management, and JSON serialization patterns specific to Sinatra.

## Who Is This For?

- **Ruby developers** building ai features with Sinatra.
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
- An existing AI Assistant to clone (see [Create an AI Assistant](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/ai/ruby/create-ai-assistant) if you need to create one first).
- Bundler (Ruby dependency manager).

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/clone-ai-assistant-ruby
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Define a helper function to clone an AI Assistant. This function retrieves the source assistant, extracts its configuration, and creates a clone with a new name:

```ruby
def clone_assistant(source_assistant_id, new_name)
  """Clone an AI Assistant and return JSON-serializable response data."""
  client = Telnyx::Client.new(api_key: ENV["TELNYX_API_KEY"])
  
  # Retrieve the source assistant to get its configuration
  source_response = client.ai_assistants.retrieve(source_assistant_id)
  source = source_response.data
  
  # Validate that the source assistant exists
  if source.nil?
    raise "Source assistant not found"
  end
  
  # Use the clone endpoint to duplicate the assistant
  # The clone method handles copying all configuration including model, instructions, and tools
  clone_response = client.ai_assistants.clone(
    source_assistant_id,
    name: new_name
  )
  
  # Extract serializable data — SDK objects are NOT JSON-serializable
  {
    id: clone_response.data.id,
    name: clone_response.data.name,
    model: clone_response.data.model,
    instructions: clone_response.data.instructions,
    enabled_features: clone_response.data.enabled_features,
    created_at: clone_response.data.created_at
  }
end
```

Now define the Sinatra route to handle clone requests. Sinatra routes are defined at the top level and automatically handle JSON serialization:

```ruby
post "/assistants/clone" do
  # Set response content type to JSON
  content_type :json
  
  # Parse incoming JSON request body
  request_body = JSON.parse(request.body.read)
  
  source_assistant_id = request_body["source_assistant_id"]
  new_name = request_body["new_name"]
  
  # Validate required fields
  if !source_assistant_id || !new_name
    status 400
    return { error: "Missing required fields: 'source_assistant_id' and 'new_name'" }.to_json
  end
  
  begin
    result = clone_assistant(source_assistant_id, new_name)
    status 201
    return result.to_json
    
  rescue Telnyx::AuthenticationError
    status 401
    return { error: "Invalid API key" }.to_json
  rescue Telnyx::RateLimitError
    status 429
    return { error: "Rate limit exceeded. Please slow down." }.to_json
  rescue Telnyx::APIStatusError => e
    status e.status_code || 500
    return { error: e.message, status_code: e.status_code }.to_json
  rescue Telnyx::APIConnectionError
    status 503
    return { error: "Network error connecting to Telnyx" }.to_json
  rescue StandardError => e
    status 400
    return { error: e.message }.to_json
  end
end
```

## Complete Code

See [`app.rb`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/clone-ai-assistant-ruby/app.rb) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. If the key was regenerated recently, update your environment file and restart the Sinatra server. |
| Source Assistant Not Found | You receive a 400 error stating "Source assistant not found" or a Telnyx API error about invalid assistant ID. | Verify the `source_assistant_id` in your request matches an existing assistant. Use the [List AI Assistants](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/ai/ruby/list-ai-assistants) endpoint to retrieve valid assistant IDs. Ensure the ID is in the correct UUID format (e.g., `12345678-1234-1234-1234-123456789012`). |
| Missing Required Fields | The endpoint returns `{"error": "Missing required fields: 'source_assistant_id' and 'new_name'"}` with HTTP 400. | Ensure your JSON request body includes both `source_assistant_id` and `new_name` fields. Verify the request uses `Content-Type: application/json` header. Check that the JSON is valid by testing with a JSON validator before sending the request. |
| Rate Limit Exceeded (429) | The endpoint returns `{"error": "Rate limit exceeded. Please slow down."}` with HTTP 429. | The Telnyx API has rate limits. Implement exponential backoff in your client code and retry requests after a delay. Space out clone requests to avoid hitting rate limits. Check the [Telnyx documentation](https://developers.telnyx.com) for current rate limit thresholds. |

## FAQ

**Q: Do I need a Telnyx account to run this example?**

Yes. Sign up at [portal.telnyx.com](https://portal.telnyx.com) to get an API key. Telnyx offers free trial credit for testing.

**Q: Can I use this AI example in production?**

Yes. This example includes error handling and environment-based configuration. Review the security and scaling sections before deploying to production.

**Q: What Ruby version do I need?**

Ruby 3.1 or higher. Ruby 3.3 is recommended.

**Q: How is Telnyx different from Twilio?**

Telnyx is an AI Communications Infrastructure platform with a private global network, integrated voice + messaging + AI + SIP + IoT under one API, and significantly lower pricing. No need to stitch together multiple vendors.

**Q: Where do I get a Telnyx phone number?**

Log into the [Telnyx Portal](https://portal.telnyx.com), navigate to Numbers > Search & Buy, and purchase a number with the capabilities you need (SMS, voice, or both).

## Resources

- [AI Assistants Guide](https://developers.telnyx.com/docs/inference/ai-assistants/no-code-voice-assistant)
- [Assistants API Reference](https://developers.telnyx.com/api-reference/assistants/create-an-assistant)
- [Ruby SDK](https://developers.telnyx.com/development/sdk/ruby)
- [Telnyx AI Assistants](https://telnyx.com/ai-assistants)
- [Voice AI Agents](https://telnyx.com/products/voice-ai-agents)

## Related Examples

- [List AI Assistants](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/ai/ruby/list-ai-assistants).
- [Get an AI Assistant](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/ai/ruby/get-ai-assistant).
- [Chat with an AI Assistant](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/ai/ruby/chat-with-ai-assistant).
