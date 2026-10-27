---
name: provision-and-route-email-dedicated-ips
title: "Provision and Route Email Dedicated IPs"
description: "Provision a dedicated sending IP, start its warm-up, create a default IP pool, route the IP through the pool, and verify delivery with a test email."
language: python
framework: flask
telnyx_products: [Email, Dedicated IPs, IP Pools]
---

# Provision and Route Email Dedicated IPs

Provision a dedicated sending IP, start its warm-up, create a default IP pool, add the IP to the pool, and send a test email to verify routing.

## The Story

A regional hospital network runs its patient appointment reminders, lab-result notifications, and billing statements through a transactional email platform. If those messages land in spam or get throttled because the sender shares reputation with unrelated bulk mailers, patients miss appointments, lab results go unread, and the billing cycle stalls — a compliance and patient-safety problem, not just a deliverability metric. The network's operations team needs its own isolated sending address whose reputation it controls end to end.

The actor IS the hospital network's email operations service. It is born the moment the team decides to stop renting shared reputation: it purchases a dedicated IP in the Newark region, then begins the slow, deliberate warm-up that teaches mailbox providers to trust this new address. It evolves by grouping that IP into a default pool so every outbound message routes through infrastructure the network owns, and it completes its arc when a test message returns `queued` — proof that the routing path is live. It survives the failure that matters most: if the sending platform reboots mid-warm-up, the IP's provisioning state and DNS confirmation live on Telnyx's side, so the service re-polls and resumes rather than losing its place in the warm-up lifecycle. The rest of this README is the API surface of that story.

## Why Telnyx

Telnyx gives developers programmatic control over sending reputation instead of forcing them through a manual portal. Dedicated IPs, warm-up lifecycle, and IP pools are all first-class API resources, so an operations team can provision isolation, drive warm-up, and route traffic as code — the same way it manages the rest of its **AI Communications Infrastructure**. This sample composes those primitives into a single reproducible flow.

## Telnyx API Endpoints Used

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `POST` | `/email/dedicated_ips` | Purchase a dedicated IP (requires `Idempotency-Key`) |
| `POST` | `/email/dedicated_ips/{id}/actions/start_warmup` | Begin the warm-up lifecycle |
| `GET` | `/email/dedicated_ips/{id}` | Poll until the IP is send-ready |
| `POST` | `/email/ip_pools` | Create a default IP pool |
| `POST` | `/email/ip_pools/{id}/ips` | Add the dedicated IP to the pool |
| `POST` | `/email_messages` | Send a test email to verify routing |

## Architecture

The demo is a Flask app exposing a `/run` endpoint plus a CLI entrypoint. It first provisions infrastructure (IP and pool), then triggers a business action (email send). The `telnyx` PyPI SDK (verified 4.189.0) has no `dedicated_ips` or `ip_pools` resources, so those calls use `requests` against `https://api.telnyx.com/v2`; the email send uses the SDK.

```
Client (curl / CLI)
        │
        ▼
  Flask app  ──►  run_provisioning_flow()
        │
        ├─► POST /email/dedicated_ips            (requests, Idempotency-Key)
        │        └─► data.status == "provisioning"
        │
        ├─► POST /email/dedicated_ips/{id}/actions/start_warmup
        │
        ├─► GET  /email/dedicated_ips/{id}       (poll: warming_up + dns_confirmed)
        │
        ├─► POST /email/ip_pools                 (is_default: true)
        │
        ├─► POST /email/ip_pools/{id}/ips        (dedicated_ip_id)
        │
        ├─► POST /email/dedicated_ips/{id}/actions/start_warmup  (2nd call → 422)
        │
        └─► POST /email_messages                 (SDK: client.email_messages.create)
                 └─► 202, data.status == "queued"
```

## Environment Variables

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `DEMO_MODE` | `string` | `true` | no | When `true` (default), simulate the flow with no billed purchase or email | — |
| `PORT` | `string` | `5000` | no | Flask server port | — |
| `TELNYX_API_KEY` | `string` | `KEY0123456789ABCDEF` | **yes** | Telnyx API v2 key | [Portal → API Keys](https://portal.telnyx.com/api-keys) |
| `TELNYX_EMAIL_FROM` | `string` | `no-reply@your-domain.com` | **yes** | From address on a verified Telnyx sending domain (shared-domain zero-setup option: `onboarding@msgtelnyx.com`) | [Portal → Email → Domains](https://portal.telnyx.com/email/domains) |
| `TELNYX_EMAIL_TO` | `string` | `you@your-mailbox.com` | **yes** | Mailbox you control; must match the account owner's verified email when sending from a shared domain | — |
| `REUSE_DEDICATED_IP_ID` | `string` | `12345678-1234-1234-1234-123456789012` | no | Resume a previous run's IP instead of purchasing a new one (avoids double billing on re-runs) | Printed in the warm-up timeout message |
| `WARMUP_POLL_INTERVAL_SECONDS` | `string` | `10` | no | Seconds between warm-up status polls | — |
| `WARMUP_TIMEOUT_SECONDS` | `string` | `300` | no | How long to wait for the IP to become send-ready | — |

`TELNYX_EMAIL_FROM` must be on a verified Telnyx email domain. `TELNYX_EMAIL_TO` should be a mailbox you control.

> **Agent / CLI access** — the Telnyx CLI does not yet cover email dedicated IPs or IP pools; provision these resources via the REST calls in this sample. Authentication works the same either way:
>
> ```bash
> telnyx auth login
> ```
>
> Full API discovery: [llms-full.txt](https://developers.telnyx.com/llms-full.txt) · [CLI docs](https://developers.telnyx.com/development/cli)

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/provision-and-route-email-dedicated-ips

python -m venv .venv
source .venv/bin/activate

pip install -r requirements.txt

cp .env.example .env
# edit .env with your credentials
```

<details>
<summary>Programmatic / CLI setup</summary>

```bash
# Install CLI — https://developers.telnyx.com/development/cli
go install github.com/team-telnyx/telnyx-cli/cmd/telnyx@latest
telnyx auth login
```

The Telnyx CLI has no verbs for email dedicated IPs, IP pools, or `POST /email_messages` — use the REST calls in this sample (or point your agent at `llms-full.txt` for full API discovery):

```bash
curl -X POST https://api.telnyx.com/v2/email/dedicated_ips \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Idempotency-Key: $(uuidgen)" \
  -H "Content-Type: application/json" \
  -d '{"region": "ewr-nj1", "ip_version": "ipv4"}'
```

For full API discovery, point your agent at [`llms-full.txt`](https://developers.telnyx.com/llms-full.txt).

</details>

Run the flow as a one-shot CLI:

```bash
python app.py run
```

Or start the Flask server and hit the endpoint:

```bash
python app.py
curl -X POST http://localhost:5000/run
```

`DEMO_MODE=true` (the default) simulates the entire flow — no billed IP purchase and no real email. Set `DEMO_MODE=false` to run against the live API.

### Before you run live mode

What you need, and what you pay for:

| Step | Cost | Notes |
|------|------|-------|
| Telnyx API key | Free | [Portal → API Keys](https://portal.telnyx.com/api-keys) |
| Sending domain | Free | **Shared domains need zero setup**: `onboarding@msgtelnyx.com` is verified out of the box, but recipients must be the account owner's verified email and reputation is not isolated to your account. For real reputation control, register your own domain (`POST /email_domains`), publish the DNS records Telnyx generates, and verify it |
| Dedicated IP | **$14/month from purchase** | Requires a verified, enterprise, or legacy account (`403` otherwise). The MRC runs while the IP is `provisioning`/`warming_up`/`active`/`suspended` and stops only after release |
| Email sends | Pay per message | Pennies at demo volume |

Two things the sample protects you from:

1. **Wasted purchases.** Before buying the IP, the live flow validates that `TELNYX_EMAIL_FROM` is on a verified sending domain for your account and aborts with instructions if not — the purchase cannot be undone, so it should never run against a from-address that can't deliver.
2. **Double billing on re-runs.** Every live purchase starts a new $14/month IP. If the warm-up poll times out, re-run with `REUSE_DEDICATED_IP_ID=<ip-id>` (the timeout message prints it) to resume the same IP instead of buying another. The live flow also reuses your account's existing default IP pool rather than failing on "default already exists".

Full domain setup: [Domains guide](https://developers.telnyx.com/docs/messaging/email/domains.md).

## Teardown

Dedicated IPs are billed ($14/month/IP as an MRC from purchase). When you no
longer need the IP, release it:

```bash
curl -X DELETE "https://api.telnyx.com/v2/email/dedicated_ips/{ip_id}" \
  -H "Authorization: Bearer $TELNYX_API_KEY"
```

A released IP stops carrying mail and enters a 30-day quarantine. Removing a
pool's last IP (or deleting a pool that still has IPs) returns `409` unless
you pass `force=true` and `drain=true` — see the
[Dedicated IPs guide](https://developers.telnyx.com/docs/messaging/email/dedicated-ips).

## API Reference

See [API.md](./API.md) for the typed endpoint reference: routes, request/response shapes, and status codes.

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `400` code `10015` on IP purchase | Missing `Idempotency-Key` header | The sample generates one automatically; if calling manually, add the header |
| `429` with waitlist body | No dedicated IP stock for the selected region | Surface it and try another region; do not retry in a loop |
| `403` on IP purchase | Account not verified / enterprise / legacy | Contact Telnyx to enable dedicated IPs on the account |
| `422` on `start_warmup` | IP is not in `provisioning` status | Expected for `warming_up`/`active`/`released` IPs — the sample demonstrates this case |
| `409` code `40901` on `start_warmup` | IP is `suspended` | Resolve the suspension before warming up |
| Existing-default error on pool create | Account already has a default pool | The live flow now reuses the existing default pool automatically; when calling the API manually, reuse it instead of creating another |
| Warm-up poll timed out (CLI) | DNS not confirmed within `WARMUP_TIMEOUT_SECONDS` | Do **not** re-run bare (`python app.py run` buys another billed IP). Re-run with `REUSE_DEDICATED_IP_ID=<ip-id>` and a larger timeout; the IP id is printed in the error |
| Preflight abort: "not a verified sending domain" | `TELNYX_EMAIL_FROM` domain not registered/verified on the account | Fix the address or verify the domain first (see "Before you run live mode") — the check runs before the billed purchase on purpose |
| Send rejected with `403` code `10007` | Sending from a shared domain to a non-owner recipient | Shared-domain sends must go to the account owner's verified email; verify a custom domain for arbitrary recipients |
| `504` from `/run` | Warm-up poll timed out | Increase `WARMUP_TIMEOUT_SECONDS`; the IP may still be provisioning |
| `502` from `/run` | Telnyx API returned an error | Check the server log for the upstream status and body |

## Agent Discovery

- Telnyx agent signup: https://telnyx.com/agent-signup.md
- Telnyx AI examples: https://github.com/team-telnyx/ai
- llms.txt: https://telnyx.com/llms.txt

## Related Examples

- [Setup Email API (Node.js)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/setup-email-api-nodejs/README.md)
- [AI Email Agent (Python)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/ai-email-agent-python/README.md)
- [Email WhatsApp Support (Python)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/email-whatsapp-support-python/README.md)

## Resources

- [Email Dedicated IPs docs](https://developers.telnyx.com/docs/messaging/email/dedicated-ips)
- [Purchase a Dedicated IP API reference](https://developers.telnyx.com/api-reference/dedicated-ips/purchase-a-dedicated-ip)
- [Create an IP Pool API reference](https://developers.telnyx.com/api-reference/ip-pools/create-an-ip-pool)
- [Telnyx Python SDK](https://github.com/team-telnyx/telnyx-python)
- [Email product page](https://telnyx.com/products/email)
- [Telnyx pricing](https://telnyx.com/pricing)
