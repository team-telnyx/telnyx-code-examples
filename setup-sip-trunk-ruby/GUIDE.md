# Guide: Set Up a SIP Trunk with Ruby and Telnyx

This walkthrough builds a small Sinatra service that creates, lists, and
retrieves credential-authenticated SIP connections on Telnyx, and receives
signature-verified webhooks. SIP credential connections let a PBX, SBC, or
softphone register to Telnyx with a username and password instead of an IP
allow-list.

> **Ruby version:** the Telnyx 5.x SDK requires **Ruby 3.2+**. This guide was
> authored on a Ruby 2.6 machine, so the commands below were **not run locally —
> CI must confirm** them on Ruby 3.2+.

## 1. Prerequisites

- Ruby 3.2 or newer (`ruby -v`).
- A Telnyx account and an API key from the [Portal](https://portal.telnyx.com/#/app/account/keys).
- (For webhooks) your account's base64 Ed25519 **public key**, also in the Portal under Keys & Credentials.

## 2. Project dependencies

Create a `Gemfile` with pinned versions. Two things are easy to miss:

- The Telnyx 5.x gem `require`s `standardwebhooks` at load time but does **not**
  declare it as a runtime dependency, so you must add it yourself or
  `require "telnyx"` raises `LoadError`.
- We verify webhook signatures with the native `ed25519` gem (see step 6 for why).

```ruby
source "https://rubygems.org"

ruby ">= 3.2.0"

gem "telnyx", "~> 5.131"
gem "sinatra", "~> 4.1"
gem "rackup", "~> 2.2"
gem "puma", "~> 6.4"
gem "dotenv", "~> 3.1"
gem "ed25519", "~> 1.3"
gem "standardwebhooks", "~> 1.1"
```

Install:

```bash
bundle install
```

## 3. Initialize the client

The 5.x SDK uses an **instance** API — `Telnyx::Client.new(...)`, not the legacy
the legacy module-level API key setter. Create the client once per process.

```ruby
require "sinatra"
require "telnyx"
require "ed25519"
require "base64"
require "json"
require "dotenv/load"

TELNYX = Telnyx::Client.new(api_key: ENV.fetch("TELNYX_API_KEY", nil))
```

## 4. Create, list, and retrieve connections

The resource is `credential_connections` (not `sip_connections`, which does not
exist in the 5.x SDK). Required create params are `connection_name:`,
`user_name:`, and `password:` — note `user_name` with an underscore.

```ruby
module SipConnections
  module_function

  def create(connection_name:, user_name:, password:)
    response = TELNYX.credential_connections.create(
      connection_name: connection_name,
      user_name: user_name,
      password: password
    )
    serialize(response.data)
  end

  def list(page_number: 1, page_size: 20)
    page = TELNYX.credential_connections.list(
      page_number: page_number,
      page_size: page_size,
      sort: :created_at
    )
    page.data.map { |conn| serialize(conn) }
  end

  def retrieve(connection_id)
    response = TELNYX.credential_connections.retrieve(connection_id)
    serialize(response.data)
  end

  def serialize(conn)
    {
      id: conn.id,
      connection_name: conn.connection_name,
      user_name: conn.user_name,
      status: conn.active ? "active" : "inactive",
      created_at: conn.created_at
    }
  end
end
```

Notes on the SDK shapes:

- `create` returns a response whose `.data` exposes `.id`, `.connection_name`,
  `.user_name`, and `.active`.
- `list` returns a paginated collection; iterate `page.data` (an array of
  connection models) or call `page.auto_paging_each { |c| ... }`.
- List paging uses `page_number:` / `page_size:` / `sort:` — not `limit:`/`after:`.

## 5. Wire up routes with safe error handling

Map known SDK errors (namespaced under `Telnyx::Errors::` in 5.x) to generic HTTP
responses. Never echo raw exception detail back to the client.

```ruby
def with_telnyx_error_handling
  yield
rescue Telnyx::Errors::AuthenticationError
  halt 401, json_error("Invalid API key")
rescue Telnyx::Errors::RateLimitError
  halt 429, json_error("Rate limit exceeded. Please slow down.")
rescue Telnyx::Errors::APIStatusError => e
  status_code = e.respond_to?(:status) && e.status ? e.status : 502
  logger.warn("Telnyx API error: #{e.class} status=#{status_code}")
  halt status_code, json_error("Telnyx API request failed")
rescue Telnyx::Errors::APIConnectionError
  halt 503, json_error("Network error connecting to Telnyx")
end

def json_error(message)
  { error: message }.to_json
end

post "/sip/connections" do
  body = parse_json_body
  name = body["name"]
  username = body["username"]
  password = body["password"]

  if name.to_s.empty? || username.to_s.empty? || password.to_s.empty?
    halt 400, json_error("Missing required fields: name, username, password")
  end

  result = with_telnyx_error_handling do
    SipConnections.create(connection_name: name, user_name: username, password: password)
  end
  status 201
  result.to_json
end
```

The `GET /sip/connections/:id` and `GET /sip/connections` routes follow the same
pattern (see [`app.rb`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/setup-sip-trunk-ruby/app.rb)).

> The HTTP status accessor on `APIStatusError` is `e.status` (an Integer) in the
> 5.x SDK — there is no `e.status_code`.

## 6. Verify inbound webhooks with native Ed25519

Telnyx signs every webhook with **Ed25519** over the string
`"<telnyx-timestamp>|<raw-body>"`, sending the signature in
`telnyx-signature-ed25519` and the timestamp in `telnyx-timestamp`.

Do **not** use `client.webhooks.unwrap` for Telnyx webhooks in the 5.x Ruby SDK:
it delegates to the Standard Webhooks spec (HMAC-SHA256 with `webhook-*` headers),
which is a different scheme and will always reject a genuine Telnyx signature.
Verify natively instead, and always verify **before** parsing the body.

```ruby
MAX_WEBHOOK_SKEW = 300 # seconds — replay protection

post "/webhooks/sip" do
  raw = request.body.read
  signature = request.env["HTTP_TELNYX_SIGNATURE_ED25519"]
  timestamp = request.env["HTTP_TELNYX_TIMESTAMP"]

  halt 400, json_error("Missing signature headers") if signature.nil? || timestamp.nil?
  if (Time.now.to_i - timestamp.to_i).abs > MAX_WEBHOOK_SKEW
    halt 408, json_error("Stale webhook timestamp")
  end

  public_key = ENV["TELNYX_PUBLIC_KEY"]
  halt 500, json_error("Webhook verification not configured") if public_key.to_s.empty?

  begin
    verify_key = Ed25519::VerifyKey.new(Base64.decode64(public_key))
    verify_key.verify(Base64.decode64(signature), "#{timestamp}|#{raw}")
  rescue Ed25519::VerifyError, ArgumentError
    halt 401, json_error("Invalid signature")
  end

  event = JSON.parse(raw)
  payload = event.dig("data", "payload")
  event_type = event.dig("data", "event_type")
  logger.info("Received verified Telnyx webhook: #{event_type}")
  # ... read fields from `payload` and act on the event ...

  status 200
  { received: true }.to_json
end
```

Header names arrive uppercased and prefixed in Rack's env:
`HTTP_TELNYX_SIGNATURE_ED25519` and `HTTP_TELNYX_TIMESTAMP`. Sinatra's
`request.body.read` gives you the raw body directly — no JSON parser consumes it
first, which is essential for signature verification.

## 7. Run it

```bash
cp .env.example .env   # fill in TELNYX_API_KEY (and TELNYX_PUBLIC_KEY for webhooks)
bundle install
ruby app.rb            # http://localhost:4567
```

Create a connection:

```bash
curl -X POST http://localhost:4567/sip/connections \
  -H "Content-Type: application/json" \
  -d '{"name": "office-pbx", "username": "pbxuser01", "password": "s3cretp4ssw0rd"}'
```

Then point your PBX/SBC at the Telnyx SIP gateway using the `user_name` and
`password` you supplied. See the [SIP Trunking docs](https://developers.telnyx.com/docs/voice/sip-trunking/get-started)
for registration and routing details.
