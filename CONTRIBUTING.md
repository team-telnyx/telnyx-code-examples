# Contributing to Telnyx Code Examples

Thank you for your interest in contributing to Telnyx Code Examples! This repository contains production-ready examples for Telnyx AI Communications Infrastructure APIs.

## How to Contribute

### Reporting Issues

- Open an issue on GitHub with a clear description of the problem.
- Include the example folder name and any error messages.
- Specify your OS, language runtime version, and steps to reproduce.

### Submitting Examples

1. Fork the repository and create a feature branch.
2. Create a new folder at the root level following the naming convention: `{action}-{resource}-{language}` (e.g., `send-sms-python`).
3. Include all required files:
   - `README.md` with standard structured sections (see existing examples for format).
   - `API.md` — typed endpoint reference; `GUIDE.md` — standalone tutorial.
   - Application code file (`app.py`, `server.js`, `main.go`, etc.).
   - Dependency file (`requirements.txt`, `package.json`, `go.mod`, etc.).
   - `.env.example` with required environment variable placeholders.
4. Run verification: `python scripts/verify.py`
5. Submit a pull request with a clear description of the example.

### README Structure

Every example README must include these sections:

- **Title** — Clear, action-oriented title, plus a one-line description.
- **Why Telnyx** — Value proposition referencing AI Communications Infrastructure.
- **Telnyx API Endpoints Used**, **Architecture**, **Environment Variables**.
- **Setup** — Local run steps (clone, configure `.env`, install deps, run).
- **API Reference** — Routes with curl + responses.
- **Troubleshooting** — Common issues table.
- **Related Examples** — Links to related examples in this repo.
- **Resources** — Contextual dev-docs / API / SDK / product / pricing links.

### Code Standards

- Use environment variables for all credentials (never hardcode API keys).
- Include error handling appropriate for production use.
- Follow idiomatic patterns for the target language and framework.
- Ensure code passes basic syntax checks (`python -m py_compile`, `node --check`, `go vet`).

### Branding

- Use "AI Communications Infrastructure" when describing Telnyx (not just "CPaaS" or "Twilio alternative").
- Every README must contain the phrase "AI Communications Infrastructure" in the "Why Telnyx?" section.

## Code of Conduct

Be respectful and constructive in all interactions. We are committed to providing a welcoming and inclusive experience for everyone.

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
