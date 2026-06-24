# CNAM Lookup with Node.js and Express

## What Does This Example Do?

Build a production-ready Express endpoint that performs CNAM (Caller Name) lookups using the Telnyx API. This tutorial demonstrates how to identify the caller name associated with incoming phone numbers, a critical feature for call screening, fraud detection, and customer experience enhancement. You'll learn to handle asynchronous API calls, manage rate limits, and serialize API responses for HTTP clients.

## Who Is This For?

- **Node.js developers** building sip features with Express.
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

- Node.js 14 or higher.
- A Telnyx account with an active API key from the [Telnyx Portal](https://portal.telnyx.com).
- npm (Node Package Manager).
- A REST client like curl or Postman for testing.

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/sip-cnam-lookup-nodejs
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create a helper function to perform the CNAM lookup. This function validates the phone number format and calls the Telnyx API:

```javascript
async function lookupCNAM(phoneNumber) {
  // Validate E.164 format to prevent API errors
  if (!phoneNumber.startsWith("+")) {
    throw new Error("Phone number must be in E.164 format (e.g., +15551234567)");
  }

  // Remove any non-digit characters except the leading +
  const cleanNumber = phoneNumber.replace(/[^\d+]/g, "");
  if (!/^\+\d{10,15}$/.test(cleanNumber)) {
    throw new Error("Invalid phone number format");
  }

  // Call the CNAM lookup endpoint via REST
  // The SDK does not have a dedicated CNAM method, so we use the underlying HTTP client
  const response = await client.get(`/v2/cnam_lookups/${cleanNumber}`);

  // Extract serializable data from the response
  return {
    phone_number: response.data.phone_number,
    cnam: response.data.cnam,
    carrier_name: response.data.carrier_name || null,
    last_updated: response.data.last_updated || null,
  };
}
```

## Complete Code

See [`server.js`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/sip-cnam-lookup-nodejs/server.js) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. If the key was regenerated recently, update your environment file and restart the Node.js server. |
| Invalid Phone Number Format | You receive a 400 error stating "Phone number must be in E.164 format" or a Telnyx API error about invalid format. | Ensure all phone numbers use E.164 format: start with `+`, followed by country code and number without spaces or dashes. Example: `+15551234567` (US) or `+447700900123` (UK). Update your test curl command to use properly formatted numbers. |
| CNAM Data Not Available | The response returns `"cnam": null` even for valid phone numbers. | CNAM data availability depends on the carrier and phone number type. Not all numbers have associated caller name data in the Telnyx database. This is expected behavior for unlisted, VoIP, or international numbers. The `carrier_name` field may still contain useful information. |
| Rate Limit Exceeded (429) | The endpoint returns `{"error": "Rate limit exceeded. Please slow down."}` with HTTP 429. | CNAM lookups are rate-limited to prevent abuse. Implement exponential backoff in your client: wait 1 second, then 2 seconds, then 4 seconds between retries. For production systems, cache CNAM results for frequently called numbers to reduce API calls. |
| Network Connection Error (503) | The endpoint returns `{"error": "Network error connecting to Telnyx"}` with HTTP 503. | This indicates a temporary network issue or Telnyx API unavailability. Implement retry logic with exponential backoff in your application. Check the [Telnyx Status Page](https://status.telnyx.com) for any ongoing incidents. Verify your server has outbound HTTPS access to `api.telnyx.com`. |

## FAQ

**Q: Do I need a Telnyx account to run this example?**

Yes. Sign up at [portal.telnyx.com](https://portal.telnyx.com) to get an API key. Telnyx offers free trial credit for testing.

**Q: Can I use this SIP example in production?**

Yes. This example includes error handling and environment-based configuration. Review the security and scaling sections before deploying to production.

**Q: What Node.js version do I need?**

Node.js 18 or higher. Node.js 20 LTS is recommended.

**Q: How is Telnyx different from Twilio?**

Telnyx is an AI Communications Infrastructure platform with a private global network, integrated voice + messaging + AI + SIP + IoT under one API, and significantly lower pricing. No need to stitch together multiple vendors.

**Q: Where do I get a Telnyx phone number?**

Log into the [Telnyx Portal](https://portal.telnyx.com), navigate to Numbers > Search & Buy, and purchase a number with the capabilities you need (SMS, voice, or both).

## Resources

- [SIP Trunking Get Started](https://developers.telnyx.com/docs/voice/sip-trunking/get-started)
- [SIP Configuration Guides](https://developers.telnyx.com/docs/voice/sip-trunking/configuration-guides)
- [Node.js SDK](https://developers.telnyx.com/development/sdk/node)
- [Telnyx SIP Trunks](https://telnyx.com/products/sip-trunks)
- [SIP Trunking Pricing](https://telnyx.com/pricing/elastic-sip)

## Related Examples

- [Set Up SIP Trunking](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/sip/nodejs/sip-trunking-setup).
- [Configure SIP Authentication](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/sip/nodejs/sip-authentication).
- [Route Inbound SIP Calls](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/sip/nodejs/inbound-sip-routing).
