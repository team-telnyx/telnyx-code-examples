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
| `DEMO_MODE` | `string` | `your_demo_mode_here` | **yes** | DEMO_MODE | — |
| `PORT` | `string` | `your_port_here` | **yes** | PORT | — |
| `TELNYX_API_KEY` | `string` | `your_telnyx_api_key_here` | **yes** | TELNYX_API_KEY | — |
| `TELNYX_EMAIL_FROM` | `string` | `your_telnyx_email_from_here` | **yes** | TELNYX_EMAIL_FROM | — |
| `TELNYX_EMAIL_TO` | `string` | `your_telnyx_email_to_here` | **yes** | TELNYX_EMAIL_TO | — |
| `WARMUP_POLL_INTERVAL_SECONDS` | `string` | `your_warmup_poll_interval_seconds_here` | **yes** | WARMUP_POLL_INTERVAL_SECONDS | — |
| `WARMUP_TIMEOUT_SECONDS` | `string` | `your_warmup_timeout_seconds_here` | **yes** | WARMUP_TIMEOUT_SECONDS | — |

`TELNYX_EMAIL_FROM` must be on a verified Telnyx email domain. `TELNYX_EMAIL_TO` should be a mailbox you control.

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

Run the flow as a one-shot CLI:

```bash
python app.py run
```

Or start the Flask server and hit the endpoint:

```bash
python app.py
curl -X POST http://localhost:5000/run
```

`DEMO_MODE=true` (the default) simulates the entire flow — no billed IP purchase and no real email. Set `DEMO_MODE=false` to run against the live API. See GUIDE.md for the full demo-vs-live walkthrough.

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
| Existing-default error on pool create | Account already has a default pool | Delete or reuse the existing default pool |
| `504` from `/run` | Warm-up poll timed out | Increase `WARMUP_TIMEOUT_SECONDS`; the IP may still be provisioning |
| `502` from `/run` | Telnyx API returned an error | Check the server log for the upstream status and body |

## Agent Discovery

- Telnyx agent signup: https://telnyx.com/agent-signup.md
- Telnyx AI examples: https://github.com/team-telnyx/ai
- llms.txt: https://telnyx.com/llms.txt

## Related Examples

- Send an Email Message
- Manage Email IP Pools
- Email Deliverability and Warm-up

## Resources

- [Email Dedicated IPs docs](https://developers.telnyx.com/docs/messaging/email/dedicated-ips)
- [Purchase a Dedicated IP API reference](https://developers.telnyx.com/api-reference/dedicated-ips/purchase-a-dedicated-ip)
- [Create an IP Pool API reference](https://developers.telnyx.com/api-reference/ip-pools/create-an-ip-pool)
- [Telnyx Python SDK](https://github.com/team-telnyx/telnyx-python)
- [Email product page](https://telnyx.com/products/email)
- [Telnyx pricing](https://telnyx.com/pricing)
