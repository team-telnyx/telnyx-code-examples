# Voice-Verified Identity + 2FA

## What Does This Example Do?

A complete identity verification chain for sensitive phone transactions. Incoming call triggers Number Lookup to identify the caller, Verify API sends an SMS OTP for two-factor authentication, and once verified, an AI assistant handles the secure transaction with full audit trail. Banking, healthcare, insurance — any workflow that needs verified identity before action.

## Who Is This For?

- Financial services teams building phone-based secure transactions.
- Healthcare developers handling PHI over voice with identity verification.
- Security engineers implementing multi-factor authentication for voice channels.

## Why Telnyx?

Telnyx is an **AI Communications Infrastructure** platform. Identity, verification, voice, and AI on one network.

- **Number Lookup + Verify + Voice + AI** — The entire identity-to-transaction chain in one platform. No Twilio Lookup + Authy + separate voice + separate AI.
- **Verify API** — Built-in OTP delivery and verification. No third-party auth provider.
- **Audit trail** — Every step (lookup, verification, conversation) logged on one platform.

## Prerequisites

- Python 3.8+
- Telnyx account with API key
- Verify Profile configured in Telnyx Portal
- Telnyx phone number with voice enabled
- [ngrok](https://ngrok.com) for webhooks

## Quick Start

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/voice-verified-identity-2fa-python
cp .env.example .env
make setup && make run
```

## Implementation Details

### Verification flow

```
Inbound Call → Number Lookup (identify caller)
                    |
              Send OTP via Verify API (SMS)
                    |
              Caller enters/speaks 6-digit code
                    |
              Verify OTP → Identity confirmed
                    |
              AI Assistant handles secure transaction
                    |
              Audit log stored
```

### Products used

| Product | Role |
|---------|------|
| Number Lookup | Caller identification, carrier info |
| Verify API | SMS OTP delivery and validation |
| Voice API | Call handling, DTMF + speech input |
| Inference | AI-assisted secure transactions |

## Complete Code

See [app.py](./app.py) for the full implementation.

## FAQ

**Q: Can I use voice biometrics instead of OTP?**
This example uses OTP. Voice biometrics can be layered on via the Telnyx AI platform for additional verification.

**Q: Is this PCI/HIPAA compliant?**
This is a technical demonstration. Production deployments need compliance review for your specific use case.

## Resources

- [Verify API](https://developers.telnyx.com/docs/verify)
- [Number Lookup](https://developers.telnyx.com/docs/numbers/number-lookup)
- [Voice API](https://developers.telnyx.com/docs/voice)
- [Inference](https://developers.telnyx.com/docs/inference)

## Related Examples

- [Build a Voice AI Agent](../build-voice-ai-agent-python/)
- [Compliance Call Recorder](../compliance-call-recorder-ai-auditor-python/)
