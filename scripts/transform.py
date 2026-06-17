#!/usr/bin/env python3
"""Transform tutorial-factory markdown output into AEO-ready, deployable example folders.

Reads a TF-generated .md file and produces a self-contained folder with:
- README.md (AEO-restructured)
- Code file (app.py / server.js / main.go / app.rb)
- Dependency file (requirements.txt / package.json / go.mod / Gemfile)
- Dockerfile
- Makefile
- .env.example

Usage:
    python scripts/transform.py path/to/tutorial.md --output-dir send-sms-python/
    python scripts/transform.py path/to/tutorial.md --folder send-sms-python
"""

import argparse
import json
import os
import re
import sys
from pathlib import Path

import yaml


# ---------------------------------------------------------------------------
# Language / file mappings
# ---------------------------------------------------------------------------

LANG_CODE_FILE = {
    "python": "app.py",
    "nodejs": "server.js",
    "go": "main.go",
    "ruby": "app.rb",
    "java": "Application.java",
    "php": "index.php",
    "csharp": "Program.cs",
}

LANG_DEP_FILE = {
    "python": "requirements.txt",
    "nodejs": "package.json",
    "go": "go.mod",
    "ruby": "Gemfile",
}

LANG_LABELS = {
    "python": "Python",
    "nodejs": "Node.js",
    "go": "Go",
    "ruby": "Ruby",
    "java": "Java",
    "php": "PHP",
    "csharp": "C#",
}

FRAMEWORK_LABELS = {
    "flask": "Flask",
    "fastapi": "FastAPI",
    "django": "Django",
    "express": "Express",
    "fastify": "Fastify",
    "nextjs": "Next.js",
    "rails": "Rails",
    "sinatra": "Sinatra",
    "gin": "Gin",
    "echo": "Echo",
    "spring": "Spring",
    "laravel": "Laravel",
    "symfony": "Symfony",
    "aspnet": "ASP.NET",
}

PRODUCT_LABELS = {
    "sms": "SMS",
    "voice": "Voice",
    "ai": "AI",
    "sip": "SIP",
    "iot": "IoT",
}

PRODUCT_LINKS = {
    "sms": {
        "docs": [
            ("Messaging Overview", "https://developers.telnyx.com/docs/messaging"),
            ("Send an SMS — Quickstart", "https://developers.telnyx.com/docs/messaging/messages/send-message"),
            ("Messaging API Reference", "https://developers.telnyx.com/api-reference/messages/send-a-message"),
        ],
        "dotcom": [
            ("Telnyx SMS API", "https://telnyx.com/products/sms-api"),
            ("Messaging Pricing", "https://telnyx.com/pricing/messaging"),
        ],
    },
    "voice": {
        "docs": [
            ("Voice API Overview", "https://developers.telnyx.com/docs/voice"),
            ("Voice API Commands", "https://developers.telnyx.com/docs/voice/programmable-voice/voice-api-commands-and-resources"),
            ("AI Assistant Start", "https://developers.telnyx.com/docs/voice/programmable-voice/ai-assistant-start"),
            ("Call Control API Reference", "https://developers.telnyx.com/api-reference/call-commands/dial"),
        ],
        "dotcom": [
            ("Telnyx Voice API", "https://telnyx.com/products/voice-api"),
            ("Voice AI Agents", "https://telnyx.com/products/voice-ai-agents"),
        ],
    },
    "ai": {
        "docs": [
            ("AI Assistants Guide", "https://developers.telnyx.com/docs/inference/ai-assistants/no-code-voice-assistant"),
            ("Assistants API Reference", "https://developers.telnyx.com/api-reference/assistants/create-an-assistant"),
        ],
        "dotcom": [
            ("Telnyx AI Assistants", "https://telnyx.com/ai-assistants"),
            ("Voice AI Agents", "https://telnyx.com/products/voice-ai-agents"),
        ],
    },
    "sip": {
        "docs": [
            ("SIP Trunking Get Started", "https://developers.telnyx.com/docs/voice/sip-trunking/get-started"),
            ("SIP Configuration Guides", "https://developers.telnyx.com/docs/voice/sip-trunking/configuration-guides"),
        ],
        "dotcom": [
            ("Telnyx SIP Trunks", "https://telnyx.com/products/sip-trunks"),
            ("SIP Trunking Pricing", "https://telnyx.com/pricing/elastic-sip"),
        ],
    },
    "iot": {
        "docs": [
            ("IoT SIM Get Started", "https://developers.telnyx.com/docs/iot-sim/get-started"),
            ("SIM Card API Reference", "https://developers.telnyx.com/api-reference/sim-cards/get-all-sim-cards"),
        ],
        "dotcom": [
            ("Telnyx IoT SIM Cards", "https://telnyx.com/products/iot-sim-card"),
            ("IoT Data Plans Pricing", "https://telnyx.com/pricing/iot-data-plans"),
        ],
    },
}

LANG_SDK_URL = {
    "python": ("Python SDK", "https://developers.telnyx.com/development/sdk/python"),
    "nodejs": ("Node.js SDK", "https://developers.telnyx.com/development/sdk/node"),
    "ruby":   ("Ruby SDK", "https://developers.telnyx.com/development/sdk/ruby"),
    "go":     ("Go SDK", "https://developers.telnyx.com/development/sdk/go"),
}

# Code block language tags for extraction
LANG_CODE_TAGS = {
    "python": ["python"],
    "nodejs": ["javascript", "js", "typescript", "ts"],
    "go": ["go", "golang"],
    "ruby": ["ruby", "rb"],
    "java": ["java"],
    "php": ["php"],
    "csharp": ["csharp", "cs", "c#"],
}

# Default port by framework
FRAMEWORK_PORTS = {
    "flask": 5000,
    "fastapi": 8000,
    "django": 8000,
    "express": 3000,
    "fastify": 3000,
    "nextjs": 3000,
    "rails": 3000,
    "sinatra": 4567,
    "gin": 8080,
    "echo": 8080,
    "spring": 8080,
    "laravel": 8000,
    "symfony": 8000,
    "aspnet": 5000,
}


# ---------------------------------------------------------------------------
# Parsing
# ---------------------------------------------------------------------------

def parse_frontmatter(content: str) -> tuple[dict, str]:
    """Parse YAML frontmatter from markdown content."""
    trimmed = content.lstrip()
    if not trimmed.startswith("---"):
        return {}, content

    end_match = re.search(r"\n---\n", trimmed[3:])
    if not end_match:
        return {}, content

    frontmatter_str = trimmed[3 : end_match.start() + 3]
    remaining = trimmed[end_match.end() + 3 :]

    try:
        frontmatter = yaml.safe_load(frontmatter_str)
        if not isinstance(frontmatter, dict):
            frontmatter = {}
    except yaml.YAMLError:
        frontmatter = {}

    return frontmatter, remaining


def extract_sections(content: str) -> dict[str, str]:
    """Extract ## sections from markdown content."""
    sections = {}
    current_section = None
    current_content = []

    for line in content.split("\n"):
        if line.startswith("## "):
            if current_section:
                sections[current_section] = "\n".join(current_content).strip()
            current_section = line[3:].strip().lower()
            current_content = []
        elif current_section:
            current_content.append(line)

    if current_section:
        sections[current_section] = "\n".join(current_content).strip()

    return sections


def extract_title(content: str) -> str:
    """Extract the # title from markdown content."""
    _, body = parse_frontmatter(content)
    match = re.search(r"^# (.+)$", body, re.MULTILINE)
    return match.group(1).strip() if match else "Telnyx Example"


def extract_code_blocks(section_content: str, lang_tags: list[str]) -> list[str]:
    """Extract fenced code blocks matching given language tags."""
    pattern = r"```(" + "|".join(lang_tags) + r")\n(.*?)```"
    matches = re.findall(pattern, section_content, re.DOTALL)
    return [code.strip() for _, code in matches]


# ---------------------------------------------------------------------------
# Extraction helpers
# ---------------------------------------------------------------------------

def extract_complete_code(sections: dict, language: str) -> str:
    """Extract the complete code block from the 'complete code' section."""
    complete = sections.get("complete code", "")
    if not complete:
        return ""

    tags = LANG_CODE_TAGS.get(language, ["python"])
    blocks = extract_code_blocks(complete, tags)
    if blocks:
        return blocks[0]

    # Fallback: grab any code block
    all_blocks = re.findall(r"```\w+\n(.*?)```", complete, re.DOTALL)
    return all_blocks[0].strip() if all_blocks else ""


def sanitize_code(code: str, language: str) -> str:
    """Apply security post-processing to extracted code."""
    if language == "python":
        # Fix debug=True
        code = code.replace(
            "app.run(debug=True, port=5000)",
            'app.run(debug=os.getenv("FLASK_DEBUG", "false").lower() == "true", port=5000)',
        )
        # Fix exception info exposure — don't leak str(e) in HTTP responses.
        # Pattern: jsonify({"error": str(e), "status_code": e.status_code}), e.status_code
        code = code.replace(
            'return jsonify({"error": str(e), "status_code": e.status_code}), e.status_code',
            'return jsonify({"error": "API request failed", "status_code": e.status_code}), e.status_code',
        )
        # Pattern: jsonify({"error": str(e)}), e.status_code
        code = code.replace(
            'return jsonify({"error": str(e)}), e.status_code',
            'return jsonify({"error": "API request failed"}), e.status_code',
        )
        # Pattern: jsonify({"error": str(e)}), 400
        code = code.replace(
            'return jsonify({"error": str(e)}), 400',
            'return jsonify({"error": "Invalid request"}), 400',
        )
        # Pattern: jsonify({"error": f"Unexpected error: {str(e)}"}), 500
        code = code.replace(
            'return jsonify({"error": f"Unexpected error: {str(e)}"}), 500',
            'return jsonify({"error": "Internal server error"}), 500',
        )
        # Pattern: jsonify({"error": str(e)}), 500
        code = code.replace(
            'return jsonify({"error": str(e)}), 500',
            'return jsonify({"error": "Internal server error"}), 500',
        )
    return code


def extract_env_vars(code: str, language: str) -> list[str]:
    """Extract environment variable names from code."""
    env_vars = set()

    # Python: os.getenv("VAR") or os.environ["VAR"] or os.environ.get("VAR")
    env_vars.update(re.findall(r'os\.getenv\(["\'](\w+)["\']', code))
    env_vars.update(re.findall(r'os\.environ\[["\'](\w+)["\']', code))
    env_vars.update(re.findall(r'os\.environ\.get\(["\'](\w+)["\']', code))

    # Node.js: process.env.VAR
    env_vars.update(re.findall(r'process\.env\.(\w+)', code))

    # Go: os.Getenv("VAR")
    env_vars.update(re.findall(r'os\.Getenv\(["\'](\w+)["\']', code))

    # Ruby: ENV["VAR"]
    env_vars.update(re.findall(r'ENV\[["\'](\w+)["\']', code))

    # Ensure TELNYX_API_KEY is always present
    env_vars.add("TELNYX_API_KEY")

    # Sort with TELNYX_API_KEY first
    sorted_vars = sorted(env_vars - {"TELNYX_API_KEY"})
    return ["TELNYX_API_KEY"] + sorted_vars


def extract_dependencies(sections: dict, language: str, framework: str) -> str:
    """Extract dependency info from the setup section and produce the dep file content."""
    setup = sections.get("step 1: setup", sections.get("step 1", ""))

    if language == "python":
        return _extract_python_deps(setup, framework)
    elif language == "nodejs":
        return _extract_nodejs_deps(setup, framework)
    elif language == "go":
        return _extract_go_deps(setup, framework)
    elif language == "ruby":
        return _extract_ruby_deps(setup, framework)
    return ""


def _extract_python_deps(setup: str, framework: str) -> str:
    """Extract Python deps from pip install commands."""
    packages = set()

    # Match pip install lines
    for match in re.finditer(r"pip install\s+(.+?)(?:\n|$)", setup):
        line = match.group(1).strip()
        # Split on whitespace, remove flags
        for pkg in line.split():
            if not pkg.startswith("-"):
                packages.add(pkg)

    # Ensure core packages
    packages.add("telnyx")
    packages.add("python-dotenv")
    if framework in ("flask", "Flask"):
        packages.add("flask")
    elif framework in ("fastapi", "FastAPI"):
        packages.add("fastapi")
        packages.add("uvicorn")
    elif framework in ("django", "Django"):
        packages.add("django")

    return "\n".join(sorted(packages)) + "\n"


def _extract_nodejs_deps(setup: str, framework: str) -> str:
    """Extract Node.js deps and produce a package.json."""
    packages = {}

    # Match npm install lines
    for match in re.finditer(r"npm install\s+(.+?)(?:\n|$)", setup):
        line = match.group(1).strip()
        for pkg in line.split():
            if not pkg.startswith("-"):
                packages[pkg] = "latest"

    # Ensure core packages
    packages["telnyx"] = "latest"
    packages["dotenv"] = "latest"
    if framework in ("express", "Express"):
        packages["express"] = "latest"
    elif framework in ("fastify", "Fastify"):
        packages["fastify"] = "latest"

    pkg_json = {
        "name": "telnyx-example",
        "version": "1.0.0",
        "description": "Telnyx API example",
        "main": "server.js",
        "scripts": {
            "start": "node server.js",
            "test": "node --check server.js",
        },
        "dependencies": packages,
    }
    return json.dumps(pkg_json, indent=2) + "\n"


def _extract_go_deps(setup: str, framework: str) -> str:
    """Produce a go.mod file."""
    requires = ["github.com/telnyx/telnyx-go"]
    if framework in ("gin", "Gin"):
        requires.append("github.com/gin-gonic/gin")
    elif framework in ("echo", "Echo"):
        requires.append("github.com/labstack/echo/v4")

    lines = ["module telnyx-example", "", "go 1.22", "", "require ("]
    for req in requires:
        lines.append(f"\t{req} latest")
    lines.append(")")
    return "\n".join(lines) + "\n"


def _extract_ruby_deps(setup: str, framework: str) -> str:
    """Produce a Gemfile."""
    gems = ["telnyx", "dotenv"]
    if framework in ("rails", "Rails"):
        gems.append("rails")
    elif framework in ("sinatra", "Sinatra"):
        gems.append("sinatra")

    lines = ['source "https://rubygems.org"', ""]
    for gem in gems:
        lines.append(f'gem "{gem}"')
    return "\n".join(lines) + "\n"


# ---------------------------------------------------------------------------
# Generators: Dockerfile, Makefile, .env.example
# ---------------------------------------------------------------------------

def generate_dockerfile(language: str, framework: str) -> str:
    """Generate a language-appropriate Dockerfile."""
    code_file = LANG_CODE_FILE.get(language, "app.py")
    port = FRAMEWORK_PORTS.get(framework, 5000)

    if language == "python":
        dep_file = "requirements.txt"
        return f"""FROM python:3.12-slim

WORKDIR /app

COPY {dep_file} .
RUN pip install --no-cache-dir -r {dep_file}

COPY . .

RUN useradd -r appuser && chown -R appuser /app
USER appuser

EXPOSE {port}

CMD ["python", "{code_file}"]
"""
    elif language == "nodejs":
        return f"""FROM node:20-slim

WORKDIR /app

COPY package.json .
RUN npm install --production

COPY . .

USER node

EXPOSE {port}

CMD ["node", "{code_file}"]
"""
    elif language == "go":
        return f"""FROM golang:1.22 AS builder

WORKDIR /app

COPY go.mod go.sum* ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o /app/server .

FROM alpine:3.19
WORKDIR /app
COPY --from=builder /app/server .

RUN adduser -D appuser
USER appuser

EXPOSE {port}

CMD ["./server"]
"""
    elif language == "ruby":
        return f"""FROM ruby:3.3-slim

WORKDIR /app

COPY Gemfile Gemfile.lock* ./
RUN bundle install

COPY . .

RUN useradd -r appuser && chown -R appuser /app
USER appuser

EXPOSE {port}

CMD ["ruby", "{code_file}"]
"""
    else:
        return f"""FROM python:3.12-slim
WORKDIR /app
COPY . .
RUN useradd -r appuser && chown -R appuser /app
USER appuser
EXPOSE {port}
CMD ["python", "{code_file}"]
"""


def generate_makefile(language: str, framework: str) -> str:
    """Generate a Makefile with standard targets."""
    code_file = LANG_CODE_FILE.get(language, "app.py")

    if language == "python":
        setup_cmd = "pip install -r requirements.txt"
        run_cmd = f"python {code_file}"
        test_cmd = f"python -m py_compile {code_file}"
    elif language == "nodejs":
        setup_cmd = "npm install"
        run_cmd = f"node {code_file}"
        test_cmd = f"node --check {code_file}"
    elif language == "go":
        setup_cmd = "go mod download"
        run_cmd = "go run ."
        test_cmd = "go vet ."
    elif language == "ruby":
        setup_cmd = "bundle install"
        run_cmd = f"ruby {code_file}"
        test_cmd = f"ruby -c {code_file}"
    else:
        setup_cmd = "echo 'Setup complete'"
        run_cmd = f"python {code_file}"
        test_cmd = "echo 'No tests configured'"

    return f""".PHONY: setup run test docker-build docker-run

setup:
\t{setup_cmd}

run:
\t{run_cmd}

test:
\t{test_cmd}

docker-build:
\tdocker build -t $$(basename $$(pwd)) .

docker-run:
\tdocker run --env-file .env -p {FRAMEWORK_PORTS.get(framework, 5000)}:{FRAMEWORK_PORTS.get(framework, 5000)} $$(basename $$(pwd))
"""


def generate_env_example(env_vars: list[str]) -> str:
    """Generate .env.example with placeholder values."""
    placeholders = {
        "TELNYX_API_KEY": "KEY_your_telnyx_api_key_here",
        "TELNYX_PHONE_NUMBER": "+15551234567",
        "TELNYX_CONNECTION_ID": "your_connection_id_here",
        "TELNYX_MESSAGING_PROFILE_ID": "your_messaging_profile_id_here",
        "TELNYX_SIP_CONNECTION_ID": "your_sip_connection_id_here",
        "TELNYX_SIM_CARD_ID": "your_sim_card_id_here",
        "TELNYX_ASSISTANT_ID": "your_assistant_id_here",
        "WEBHOOK_URL": "https://your-domain.com/webhook",
        "PORT": "5000",
    }

    lines = ["# Telnyx API credentials — get yours at https://portal.telnyx.com", ""]
    for var in env_vars:
        placeholder = placeholders.get(var, f"your_{var.lower()}_here")
        lines.append(f"{var}={placeholder}")
    return "\n".join(lines) + "\n"


# ---------------------------------------------------------------------------
# README restructuring (AEO format)
# ---------------------------------------------------------------------------

def build_who_is_this_for(product: str, language: str, framework: str) -> str:
    """Generate the 'Who Is This For?' section."""
    lang_label = LANG_LABELS.get(language, language)
    fw_label = FRAMEWORK_LABELS.get(framework, framework)
    product_label = PRODUCT_LABELS.get(product, product)

    return f"""## Who Is This For?

- **{lang_label} developers** building {product_label.lower()} features with {fw_label}.
- **Backend engineers** integrating telephony or messaging into existing applications.
- **DevOps teams** looking for containerized, production-ready telecom examples.
- **Startups and enterprises** replacing legacy telecom providers with a modern API-first platform.
"""


def build_why_telnyx() -> str:
    """Generate the standard 'Why Telnyx?' section."""
    return """## Why Telnyx?

Telnyx is an **AI Communications Infrastructure** platform that gives developers a single API for [voice](https://telnyx.com/products/voice-ai-agents), [messaging](https://telnyx.com/products/sms-api), [SIP](https://telnyx.com/products/sip-trunks), [AI](https://telnyx.com/ai-assistants), and [IoT](https://telnyx.com/products/iot-sim-card) — no Frankenstack required.

- **Integrated platform** — [Voice](https://telnyx.com/products/voice-ai-agents), [SMS](https://telnyx.com/products/sms-api), [SIP trunking](https://telnyx.com/products/sip-trunks), [AI assistants](https://telnyx.com/ai-assistants), and [IoT SIM management](https://telnyx.com/products/iot-sim-card) under one roof. No stitching together multiple vendors.
- **Global private network** — Calls and messages traverse the Telnyx-owned IP network for lower latency and higher reliability than the public internet.
- **Developer-first** — SDKs for Python, Node.js, Go, Ruby, Java, and PHP. Comprehensive webhook event model. Sandbox environment for testing.
- **Competitive pricing** — Pay-as-you-go with no minimums, contracts, or per-seat fees.
"""


def build_quick_start(folder_name: str, language: str, framework: str) -> str:
    """Generate the Quick Start section with 3 deployment options."""
    port = FRAMEWORK_PORTS.get(framework, 5000)

    return f"""## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/{folder_name}
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 2: Docker

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/{folder_name}
cp .env.example .env
# Edit .env with your credentials
make docker-build
make docker-run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.
"""


def build_faq(title: str, product: str, language: str, framework: str) -> str:
    """Generate a FAQ section with structured Q&A pairs."""
    lang_label = LANG_LABELS.get(language, language)
    fw_label = FRAMEWORK_LABELS.get(framework, framework)
    product_label = PRODUCT_LABELS.get(product, product)

    faqs = [
        {
            "q": "Do I need a Telnyx account to run this example?",
            "a": "Yes. Sign up at [portal.telnyx.com](https://portal.telnyx.com) to get an API key. Telnyx offers free trial credit for testing.",
        },
        {
            "q": f"Can I use this {product_label} example in production?",
            "a": f"Yes. This example includes error handling, environment-based configuration, and a Dockerfile for containerized deployment. Review the security and scaling sections before deploying to production.",
        },
        {
            "q": f"What {lang_label} version do I need?",
            "a": _get_version_answer(language),
        },
        {
            "q": "How is Telnyx different from Twilio?",
            "a": "Telnyx is an AI Communications Infrastructure platform with a private global network, integrated voice + messaging + AI + SIP + IoT under one API, and significantly lower pricing. No need to stitch together multiple vendors.",
        },
        {
            "q": "Where do I get a Telnyx phone number?",
            "a": "Log into the [Telnyx Portal](https://portal.telnyx.com), navigate to Numbers > Search & Buy, and purchase a number with the capabilities you need (SMS, voice, or both).",
        },
    ]

    lines = ["## FAQ", ""]
    for faq in faqs:
        lines.append(f"**Q: {faq['q']}**")
        lines.append(f"\n{faq['a']}\n")

    return "\n".join(lines)


def _get_version_answer(language: str) -> str:
    versions = {
        "python": "Python 3.8 or higher. Python 3.12+ is recommended.",
        "nodejs": "Node.js 18 or higher. Node.js 20 LTS is recommended.",
        "go": "Go 1.22 or higher.",
        "ruby": "Ruby 3.1 or higher. Ruby 3.3 is recommended.",
        "java": "Java 17 or higher.",
        "php": "PHP 8.1 or higher.",
        "csharp": ".NET 8.0 or higher.",
    }
    return versions.get(language, "See the Prerequisites section.")


def build_resources(product: str, language: str) -> str:
    """Generate a Resources section with links to Dev Docs, SDK, and product pages."""
    links = PRODUCT_LINKS.get(product, {})
    sdk = LANG_SDK_URL.get(language)
    items = []
    for label, url in links.get("docs", []):
        items.append(f"- [{label}]({url})")
    if sdk:
        items.append(f"- [{sdk[0]}]({sdk[1]})")
    for label, url in links.get("dotcom", []):
        items.append(f"- [{label}]({url})")
    lines = ["## Resources", ""]
    lines.extend(items)
    lines.append("")
    return "\n".join(lines)


def build_related_examples(sections: dict, product: str, language: str) -> str:
    """Build the Related Examples section from TF Next Steps."""
    next_steps = sections.get("next steps", "")
    if not next_steps:
        return "## Related Examples\n\nExplore more examples in this repository.\n"

    return f"## Related Examples\n\n{next_steps}\n"


def restructure_readme(
    content: str,
    frontmatter: dict,
    sections: dict,
    folder_name: str,
    code_file: str,
) -> str:
    """Restructure TF markdown into AEO-formatted README."""
    title = extract_title(content)
    product = frontmatter.get("product", "sms")
    language = frontmatter.get("language", "python")
    framework = frontmatter.get("framework", "flask")

    overview = sections.get("overview", "")
    prerequisites = sections.get("prerequisites", "")
    implementation = sections.get("step 3: implementation", sections.get("step 3", ""))
    implementation = sanitize_code(implementation, language)
    troubleshooting = sections.get("troubleshooting", "")

    parts = [
        f"# {title}",
        "",
        "## What Does This Example Do?",
        "",
        overview,
        "",
        build_who_is_this_for(product, language, framework),
        build_why_telnyx(),
        "## Prerequisites",
        "",
        prerequisites,
        "",
        build_quick_start(folder_name, language, framework),
        "## Implementation Details",
        "",
        implementation,
        "",
        "## Complete Code",
        "",
        f"See [`{code_file}`](./{code_file}) for the full implementation.",
        "",
        "## Troubleshooting",
        "",
        troubleshooting,
        "",
        build_faq(title, product, language, framework),
        build_resources(product, language),
        build_related_examples(sections, product, language),
    ]

    return "\n".join(parts)


# ---------------------------------------------------------------------------
# Main transform function
# ---------------------------------------------------------------------------

def transform(
    md_path: str,
    output_dir: str,
    folder_name: str | None = None,
) -> str:
    """Transform a TF markdown file into an AEO-ready example folder.

    Args:
        md_path: Path to the tutorial-factory generated .md file.
        output_dir: Base output directory (repo root).
        folder_name: Target folder name. If None, derived from frontmatter.

    Returns:
        Path to the created folder.
    """
    md_path = Path(md_path)
    if not md_path.exists():
        raise FileNotFoundError(f"Tutorial not found: {md_path}")

    content = md_path.read_text()
    frontmatter, body = parse_frontmatter(content)
    sections = extract_sections(body)

    product = frontmatter.get("product", "sms")
    language = frontmatter.get("language", "python")
    framework = frontmatter.get("framework", "flask")

    if not folder_name:
        use_case = frontmatter.get("use_case", "example")
        folder_name = f"{use_case}-{language}"

    code_file = LANG_CODE_FILE.get(language, "app.py")
    dep_file = LANG_DEP_FILE.get(language, "requirements.txt")

    # Create output folder
    folder_path = Path(output_dir) / folder_name
    folder_path.mkdir(parents=True, exist_ok=True)

    # 1. Extract and write code file
    code = extract_complete_code(sections, language)
    code = sanitize_code(code, language)
    if code:
        (folder_path / code_file).write_text(code + "\n")
    else:
        print(f"  Warning: No code block found in 'Complete Code' section for {folder_name}")
        (folder_path / code_file).write_text(f"# TODO: Add {code_file} implementation\n")

    # 2. Extract and write dependencies
    deps = extract_dependencies(sections, language, framework)
    (folder_path / dep_file).write_text(deps)

    # 3. Extract env vars and write .env.example
    env_vars = extract_env_vars(code, language)
    (folder_path / ".env.example").write_text(generate_env_example(env_vars))

    # 4. Generate Dockerfile
    (folder_path / "Dockerfile").write_text(generate_dockerfile(language, framework))

    # 5. Generate Makefile
    (folder_path / "Makefile").write_text(generate_makefile(language, framework))

    # 6. Restructure README
    readme = restructure_readme(content, frontmatter, sections, folder_name, code_file)
    (folder_path / "README.md").write_text(readme)

    return str(folder_path)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="Transform tutorial-factory output into AEO-ready example folders.",
    )
    parser.add_argument("md_path", help="Path to the TF-generated markdown file")
    parser.add_argument(
        "--output-dir",
        default=".",
        help="Base output directory (default: current directory)",
    )
    parser.add_argument(
        "--folder",
        default=None,
        help="Target folder name (default: derived from frontmatter)",
    )

    args = parser.parse_args()

    try:
        result = transform(args.md_path, args.output_dir, args.folder)
        print(f"Created: {result}")
    except FileNotFoundError as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
