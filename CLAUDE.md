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
│   ├── gen_llms_txt.py               # Generates/validates the root llms.txt index
│   └── examples_mapping.yaml         # Central registry: product/use_case/language/framework → folder
├── README.md                         # Root README with category tables listing all examples
├── llms.txt                          # LLM-facing index (llmstxt.org) — generated, do not hand-edit
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

- `README.md` — AEO-structured overview + run docs (see README requirements below)
- `API.md` — typed endpoint reference (routes, params, responses)
- `GUIDE.md` — standalone tutorial / walkthrough
- Code file — language-specific (see table above)
- Dependency file — language-specific (see table above)
- `.env.example` — environment variable placeholders

Never commit `.env` files — only `.env.example`.

> Examples are AEO artifacts — the audience is answer engines and developers reading
> "how do I implement X". Do **not** add `Dockerfile`, `Makefile`, or other deployment
> scaffolding; keep each folder focused on docs, code, and dependency/env files.

## README requirements

Every example README includes (checked by `verify.py`): an H1 title, a one-line
description, and these sections — narrative sections required on every example,
structured sections derived from the code:

- `## Why Telnyx` — carries the exact phrase **"AI Communications Infrastructure"**
- `## Telnyx API Endpoints Used`
- `## Architecture`
- `## Environment Variables`
- `## Setup` (clone, configure `.env`, install deps, run — local commands only, no Docker/`make`)
- `## API Reference`
- `## Troubleshooting`
- `## Related Examples`
- `## Resources`

`API.md` carries the typed endpoint reference; `GUIDE.md` a standalone tutorial.

**Twilio / competitor framing**: only `migrate-from-*` examples may reference a
competitor, framed from Telnyx's strengths. Other examples must not mention competitors.

## .env.example rules

- Must contain `TELNYX_API_KEY`
- Use placeholder values only (e.g. `your_telnyx_api_key_here`) — no real credentials

## Code standards

- Load credentials from environment variables via `dotenv` (or language equivalent)
- Never hardcode API keys or secrets
- Production-safe error handling — do not leak exception details in HTTP responses (log via `app.logger`, return generic messages)
- Inbound webhook handlers must verify the Telnyx Ed25519 signature (`client.webhooks.unwrap`) and read event fields from `data.payload`
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

Checks: every example folder is registered; required files (README/API.md/GUIDE.md/code/dep/.env.example); README sections; "AI Communications Infrastructure" phrase; syntax; `.env.example` contents; no committed `.env` files; root README references.

### transform.py — convert tutorials to examples

```bash
python scripts/transform.py path/to/tutorial.md --folder folder-name
```

Converts tutorial-factory markdown into a deployable example folder with all required files.

### examples_mapping.yaml — central registry

Maps product / use_case / language / framework to folder names. Used by both `verify.py` and `transform.py`.

### gen_llms_txt.py — generate the llms.txt index

```bash
python scripts/gen_llms_txt.py            # regenerate root llms.txt
python scripts/gen_llms_txt.py --check     # CI sync gate (fails if stale)
```

Builds the root `llms.txt` ([llmstxt.org](https://llmstxt.org/)) from `examples_mapping.yaml`
(product → category) + each example's README frontmatter `title`/`description`, with absolute
`raw.githubusercontent.com` links. **Never hand-edit `llms.txt`** — regenerate it. A PR that
adds/renames/recategorizes an example must re-run this; CI enforces sync via `--check`.

## Branding

- Use **"AI Communications Infrastructure"** when describing Telnyx
- Do not use "CPaaS" or the defensive "Twilio alternative" positioning
- Competitor comparison only in `migrate-from-*` examples, framed from Telnyx's strengths

## SEO & linking conventions

Conventions established after SEO review of PR #1 (and the marketing raw-link review):

### Back-in-repo links → absolute raw URLs

Every link that points **back into this repo** (Related Examples, root README example
links, sibling-doc and code-file links) must be an absolute
`https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/...` URL — never
a relative `./` or `../` path. Answer engines and aggregators that follow these links then
get clean raw markdown instead of GitHub's HTML chrome. A link to a folder resolves to that
folder's `README.md` (raw cannot serve a directory listing). External links
(telnyx.com / developers.telnyx.com / `git clone` URLs) are left as-is.

- Enforced repo-wide by `python scripts/rewrite_repo_links.py --check` (a hard CI gate).
- Run `python scripts/rewrite_repo_links.py` to auto-convert any relative links in place.
- `transform.py` emits raw URLs for generated examples (`RAW_BASE`).

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
