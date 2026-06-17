# CLAUDE.md — telnyx-code-examples

## Project overview

Production-ready, deployable code examples for Telnyx APIs. Each top-level folder is one self-contained example that can be cloned, configured, and run independently.

## Repo structure

```
telnyx-code-examples/
├── {action}-{resource}-{language}/   # Example folders (e.g. send-sms-python)
├── scripts/
│   ├── verify.py                     # Validates all example folders
│   ├── transform.py                  # Converts tutorial-factory markdown → example folder
│   ├── batch_pipeline.py             # Batch processing pipeline
│   └── examples_mapping.yaml         # Central registry: product/use_case/language/framework → folder
├── README.md                         # Root README with category tables listing all examples
├── CONTRIBUTING.md                   # Contributor guidelines
└── LICENSE
```

## Language file mappings

| Language | Code file   | Dependency file    |
|----------|-------------|--------------------|
| Python   | `app.py`    | `requirements.txt` |
| Node.js  | `server.js` | `package.json`     |
| Go       | `main.go`   | `go.mod`           |
| Ruby     | `app.rb`    | `Gemfile`          |

## Required files per example folder

Every example folder must contain:

- `README.md` — AEO-structured documentation (see README requirements below)
- Code file — language-specific (see table above)
- Dependency file — language-specific (see table above)
- `Dockerfile` — containerized deployment
- `Makefile` — standard build/run targets
- `.env.example` — environment variable placeholders

Never commit `.env` files — only `.env.example`.

## README requirements

Every example README must include these 10 AEO sections (checked by `verify.py`):

1. What Does This Example Do?
2. Who Is This For?
3. Why Telnyx?
4. Prerequisites
5. Quick Start
6. Implementation Details
7. Complete Code
8. Troubleshooting
9. FAQ
10. Related Examples

The README must contain the exact phrase **"AI Communications Infrastructure"** (typically in the "Why Telnyx?" section).

## Makefile targets

Every Makefile must define these five targets:

- `setup` — install dependencies
- `run` — start the application
- `test` — run tests / syntax checks
- `docker-build` — build the Docker image
- `docker-run` — run the Docker container

## Dockerfile conventions

- Base images: `python:3.12-slim`, `node:20-slim`, `golang:1.22`, `ruby:3.3-slim`
- Run as a non-root user
- Include `EXPOSE` for the application port
- Add health checks

## .env.example rules

- Must contain `TELNYX_API_KEY`
- Use placeholder values only (e.g. `your_telnyx_api_key_here`) — no real credentials

## Code standards

- Load credentials from environment variables via `dotenv` (or language equivalent)
- Never hardcode API keys or secrets
- Production-safe error handling — do not leak exception details in HTTP responses
- Code must pass basic syntax checks:
  - Python: `python -m py_compile app.py`
  - Node.js: `node --check server.js`
  - Go: `go vet ./...`
  - Ruby: `ruby -c app.rb`

## Key scripts

### verify.py — validate examples

```bash
python scripts/verify.py               # Verify all examples
python scripts/verify.py --verbose      # Detailed output
python scripts/verify.py --only send-sms-python   # Single example
```

Checks: required files, AEO sections, "AI Communications Infrastructure" phrase, syntax, Dockerfile validity, Makefile targets, `.env.example` contents, no committed `.env` files, root README references.

### transform.py — convert tutorials to examples

```bash
python scripts/transform.py path/to/tutorial.md --folder folder-name
```

Converts tutorial-factory markdown into a deployable example folder with all required files.

### examples_mapping.yaml — central registry

Maps product / use_case / language / framework to folder names. Used by both `verify.py` and `transform.py`.

## Branding

- Use **"AI Communications Infrastructure"** when describing Telnyx
- Do not use "CPaaS" or "Twilio alternative"

## SEO & linking conventions

Two conventions established after SEO review of PR #1:

### Root README product links

Each category section description in the root README must link to the corresponding telnyx.com product page:

| Category       | Link                                              |
|----------------|---------------------------------------------------|
| Voice AI       | `https://telnyx.com/products/voice-ai-agents`     |
| SMS API        | `https://telnyx.com/products/sms-api`             |
| AI Assistants  | `https://telnyx.com/ai-assistants`                |
| SIP Trunks     | `https://telnyx.com/products/sip-trunks`          |
| IoT SIM Cards  | `https://telnyx.com/products/iot-sim-card`        |

The root README must also include an API docs blockquote after Quick Start:

```markdown
> Full API reference at [developers.telnyx.com](https://developers.telnyx.com)
```

### Example README Resources section

Every example README must include a "Resources" section with contextual links to:

- Dev docs guides (`developers.telnyx.com/docs/...`)
- API reference pages (`developers.telnyx.com/api-reference/...`)
- Language SDK page (`developers.telnyx.com/development/sdk/...`)
- Product page on telnyx.com (`telnyx.com/products/...`)
- Pricing page (`telnyx.com/pricing/...`)

These links are auto-generated by `transform.py` via the `PRODUCT_LINKS` and `LANG_SDK_URL` mappings and the `build_resources()` helper (see `scripts/transform.py` lines 83-144, 698+).
