# Create AI Assistant with Ruby and Sinatra

## What Does This Example Do?

Build a production-ready Sinatra endpoint that creates AI assistants using the Telnyx Ruby SDK. This tutorial demonstrates the client-based initialization pattern, proper error handling for telecom APIs, secure credential management via environment variables, and JSON serialization of SDK responses for web frameworks.

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
- Bundler (Ruby dependency manager).
- Basic familiarity with Sinatra and REST APIs.

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/create-ai-assistant-ruby
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 2: Docker

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/create-ai-assistant-ruby
cp .env.example .env
# Edit .env with your credentials
make docker-build
make docker-run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create `app.rb` and initialize the Telnyx client using the Ruby SDK pattern. Define a helper function to handle assistant creation with proper validation:

```ruby
require "sinatra"
require "telnyx"
require "dotenv/load"
require "json"

# Initialize client with the Ruby SDK pattern
client = Telnyx::Client.new(api_key: ENV["TELNYX_API_KEY"])

def create_assistant(name:, model:, instructions:, enabled_features: [])
  """Create an AI assistant and return JSON-serializable response data."""
  
  # Validate required fields to prevent API errors
  raise ArgumentError, "Name is required" if name.nil? || name.empty?
  raise ArgumentError, "Model is required" if model.nil? || model.empty?
  raise ArgumentError, "Instructions are required" if instructions.nil? || instructions.empty?
  
  # Use client.ai_assistants.create() — NOT client.ai_assistants.create()
  response = client.ai_assistants.create(
    name: name,
    model: model,
    instructions: instructions,
    enabled_features: enabled_features
  )
  
  # Extract serializable data — SDK objects are NOT JSON-serializable
  {
    id: response.data.id,
    name: response.data.name,
    model: response.data.model,
    instructions: response.data.instructions,
    enabled_features: response.data.enabled_features,
    created_at: response.data.created_at
  }
end
```

## Complete Code

See [`app.rb`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/create-ai-assistant-ruby/app.rb) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. If the key was regenerated recently, update your environment file and restart the Sinatra server. |
| Missing Required Fields (400) | You receive a 400 error stating "Missing required fields: 'name', 'model', 'instructions'". | Ensure your JSON request body includes all three required fields: `name`, `model`, and `instructions`. Verify the JSON is valid by using a JSON validator. Update your curl command to include all required fields with non-empty string values. |
| Environment Variable Not Set | The application raises an error about `TELNYX_API_KEY` being nil or the Telnyx client fails to initialize. | Confirm your `.env` file exists in the same directory as `app.rb` and contains the variable. Ensure the file is named exactly `.env` (not `.env.txt` or `env`). The `require "dotenv/load"` statement must execute before the client is initialized—verify this import order in your code. |
| Invalid JSON in Request Body | The endpoint returns `{"error": "Invalid JSON in request body"}` with HTTP 400. | Verify your JSON is properly formatted using a JSON validator tool. Ensure all strings are wrapped in double quotes, not single quotes. Check that your curl command uses `-d` with properly escaped JSON or uses `@filename.json` to read from a file. |
| Model Not Recognized | The API returns an error about an invalid or unsupported model. | Verify the model name matches a supported Telnyx AI model (e.g., `meta-llama/Meta-Llama-3.1-70B-Instruct`). Check the [Telnyx AI documentation](https://developers.telnyx.com/docs/api/ai-assistants) for the current list of available models. Update your request with a valid model identifier. |

## FAQ

**Q: Do I need a Telnyx account to run this example?**

Yes. Sign up at [portal.telnyx.com](https://portal.telnyx.com) to get an API key. Telnyx offers free trial credit for testing.

**Q: Can I use this AI example in production?**

Yes. This example includes error handling, environment-based configuration, and a Dockerfile for containerized deployment. Review the security and scaling sections before deploying to production.

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

- [List AI Assistants](/tutorials/ai/ruby/list-ai-assistants).
- [Get an AI Assistant](/tutorials/ai/ruby/get-ai-assistant).
- [Chat with an AI Assistant](/tutorials/ai/ruby/chat-with-ai-assistant).
