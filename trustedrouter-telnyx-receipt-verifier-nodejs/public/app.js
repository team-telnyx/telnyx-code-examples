/* TrustedRouter Telnyx receipt explorer — browser logic. */
"use strict";

const PROMPT_MAX_FALLBACK = 4000;
const TOKEN_STORAGE_KEY = "trustedrouter_demo_token";
const SAMPLE_PROMPT =
  "In two sentences, explain what edge inference is and why running a model close to the caller reduces latency.";

const errorMessages = {
  MISSING_TOKEN: "This deployment requires a demo access token. Paste one into the form and retry.",
  INVALID_TOKEN: "The demo access token is not valid. Check it and retry.",
  MISSING_SERVER_KEY: "The server has no TrustedRouter API key configured. Set TRUSTEDROUTER_API_KEY and restart the service.",
  UNKNOWN_MODEL: "That model is not in the current Telnyx zero-data-retention catalog. Pick a model from the list.",
  NO_TELNYX_ROUTE: "TrustedRouter currently has no Telnyx route satisfying the ZDR requirement for this model. Try another model from the list.",
  AUTH_FAILED: "TrustedRouter rejected the server-side API key. The operator must check TRUSTEDROUTER_API_KEY.",
  INSUFFICIENT_CREDITS: "The TrustedRouter key has run out of credits. Top up the key or use one with a spend limit.",
  UPSTREAM_RATE_LIMITED: "TrustedRouter rate limited the request. Wait a moment and retry.",
  UPSTREAM_ERROR: "TrustedRouter or the upstream provider failed. Retry, and check the gateway status if it persists.",
  TIMEOUT: "The request timed out. Retry, or shorten the prompt.",
  NETWORK_ERROR: "The request could not reach TrustedRouter. Check network connectivity.",
  PROVIDER_MISMATCH: "The verified receipt did not report Telnyx as the provider. The response was rejected.",
  MODEL_MISMATCH: "The verified receipt reported a different model than requested. The response was rejected.",
  RATE_LIMITED: "Too many requests from this address. Wait for the Retry-After interval and retry.",
  FORBIDDEN_ORIGIN: "Cross-origin requests are not accepted by this deployment.",
  PAYLOAD_TOO_LARGE: "The request body is too large.",
  INVALID_INPUT: "The request was not valid.",
  INTERNAL: "An internal error occurred. The details were logged without request content.",
  NOT_FOUND: "The requested resource does not exist.",
  METHOD_NOT_ALLOWED: "Method not allowed.",
};

const checkLabels = {
  nonceMatched: "Nonce matches this request",
  requestHashMatched: "Request hash (exact request bytes)",
  responseHashMatched: "Response hash (exact response bytes)",
  signatureValid: "Ed25519 signature valid",
  fresh: "Receipt fresh (≤ 300 s, 60 s skew)",
  attestationValid: "Attestation binding resolved",
};

function el(id) {
  return document.getElementById(id);
}

function setText(element, value) {
  element.textContent = value;
}

function showError(code, message, retryAfterSeconds) {
  const card = el("error-card");
  const banner = el("error-banner");
  const base = message && message.length > 0 ? message : (errorMessages[code] || "Something went wrong.");
  let text = base;
  if (code === "RATE_LIMITED" && retryAfterSeconds) {
    text += ` Retry in ~${retryAfterSeconds}s.`;
  }
  banner.textContent = "";
  const chip = document.createElement("span");
  chip.className = "code-chip";
  chip.textContent = code;
  banner.appendChild(chip);
  banner.appendChild(document.createTextNode(text));
  card.hidden = false;
  card.scrollIntoView({ behavior: "smooth", block: "center" });
}

function clearError() {
  el("error-card").hidden = true;
}

function statusIcon(value) {
  if (value === true) return { icon: "✓", cls: "ok" };
  if (value === false) return { icon: "✗", cls: "bad" };
  return { icon: "—", cls: "unknown" };
}

function formatPrice(perMillion) {
  if (perMillion === null || perMillion === undefined) return null;
  const usd = Number(perMillion);
  if (!Number.isFinite(usd)) return null;
  return `$${usd.toFixed(2)} / 1M tokens`;
}

async function loadCatalog() {
  const response = await fetch("/api/models", { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error("model catalog unavailable");
  const data = await response.json();
  const select = el("model");
  select.textContent = "";
  for (const model of data.models) {
    const option = document.createElement("option");
    option.value = model.id;
    const price = formatPrice(model.promptPriceUsdPerMillion);
    option.textContent = price ? `${model.name} — ${price}` : model.name;
    select.appendChild(option);
  }
  if (data.models.length === 0) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No eligible Telnyx ZDR models available";
    select.appendChild(option);
  }
  const meta = el("catalog-meta");
  const sourceLabel = data.source === "live" ? "live catalog" : data.source === "cached" ? "cached catalog" : "fallback data";
  const when = data.fetchedAt ? new Date(data.fetchedAt).toLocaleString() : "unknown";
  setText(meta, `Source: ${sourceLabel} · fetched ${when} · ${data.models.length} eligible model(s)`);
  el("fallback-card").hidden = data.source !== "fallback";
  el("token-required-note").classList.toggle("hidden", !data.inferenceAuthRequired);
  el("token-optional-note").classList.toggle("hidden", data.inferenceAuthRequired);
}

function renderResponse(data) {
  el("response-card").hidden = false;
  setText(el("output"), data.output && data.output.length > 0 ? data.output : "(no text returned)");
  const meta = el("response-meta");
  meta.textContent = "";
  const rows = [
    ["Requested model", data.requestedModel],
    ["Selected model (verified receipt)", data.selectedModel ?? "not established"],
    ["Provider (verified receipt)", data.provider ?? "not established"],
    ["Request duration", `${data.durationMs} ms`],
    [
      "Token usage",
      data.usage
        ? `${data.usage.promptTokens ?? "?"} prompt · ${data.usage.completionTokens ?? "?"} completion · ${data.usage.totalTokens ?? "?"} total`
        : "not reported",
    ],
  ];
  for (const [key, value] of rows) {
    const dt = document.createElement("dt");
    const dd = document.createElement("dd");
    setText(dt, key);
    setText(dd, String(value));
    meta.appendChild(dt);
    meta.appendChild(dd);
  }
}

function renderVerification(verification, receipt) {
  el("verification-card").hidden = false;
  const state = el("verification-state");
  if (verification.verified) {
    state.className = "verification-state ok";
    state.textContent = "";
    state.appendChild(document.createTextNode("Verified — receipt integrity and routing proven"));
    const small = document.createElement("small");
    setText(small, `Issued ${verification.issuedAt ?? "?"} · verified ${verification.verifiedAt}`);
    state.appendChild(small);
  } else {
    state.className = "verification-state bad";
    state.textContent = "";
    state.appendChild(document.createTextNode("Verification failed"));
    const small = document.createElement("small");
    setText(
      small,
      `${verification.failureCode ?? "UNKNOWN"} — ${verification.failureMessage ?? "The receipt could not be verified."}`
    );
    state.appendChild(small);
  }

  const list = el("verification-checklist");
  list.textContent = "";
  for (const [key, label] of Object.entries(checkLabels)) {
    const { icon, cls } = statusIcon(verification[key]);
    const li = document.createElement("li");
    const spanIcon = document.createElement("span");
    spanIcon.className = `icon ${cls}`;
    spanIcon.textContent = icon;
    const spanLabel = document.createElement("span");
    spanLabel.textContent = label;
    li.appendChild(spanIcon);
    li.appendChild(spanLabel);
    list.appendChild(li);
  }
  const issuedRow = document.createElement("li");
  const issuedIcon = document.createElement("span");
  issuedIcon.className = "icon unknown";
  issuedIcon.textContent = "·";
  const issuedLabel = document.createElement("span");
  issuedLabel.textContent = `Receipt issued: ${verification.issuedAt ?? "unknown"} · verification time: ${verification.verifiedAt}`;
  issuedRow.appendChild(issuedIcon);
  issuedRow.appendChild(issuedLabel);
  list.appendChild(issuedRow);

  setText(el("verification-claims"), JSON.stringify(receipt.claims ?? null, null, 2));
  setText(el("verification-compact"), receipt.compact && receipt.compact.length > 0 ? receipt.compact : "(no receipt present)");
}

async function submitInference() {
  clearError();
  const button = el("submit-btn");
  if (button.disabled) return;
  const model = el("model").value;
  const prompt = el("prompt").value;
  if (!model) {
    showError("UNKNOWN_MODEL", "Select a model first.");
    return;
  }
  if (prompt.trim().length === 0) {
    showError("INVALID_INPUT", "Enter a prompt before submitting.");
    return;
  }
  button.disabled = true;
  setText(button, "Running…");
  try {
    const headers = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };
    const token = sessionStorage.getItem(TOKEN_STORAGE_KEY) ?? "";
    if (token.length > 0) headers.Authorization = `Bearer ${token}`;
    const response = await fetch("/api/inference", {
      method: "POST",
      headers,
      body: JSON.stringify({ model, prompt }),
    });
    const payload = await response.json().catch(() => null);
    if (response.status === 401) {
      const code = payload && payload.error ? payload.error.code : "MISSING_TOKEN";
      showError(code, payload && payload.error ? payload.error.message : null);
      el("access-token").focus();
      return;
    }
    if (!response.ok) {
      const err = payload && payload.error ? payload.error : {};
      showError(err.code ?? "INTERNAL", err.message ?? null, Number(response.headers.get("Retry-After") ?? 0) || null);
      if (payload && payload.verification) {
        renderVerification(payload.verification, { compact: "", claims: payload.receipt ? payload.receipt.claims : null });
      }
      return;
    }
    renderResponse(payload);
    renderVerification(payload.verification, payload.receipt ?? { compact: "", claims: null });
    el("response-card").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    showError("NETWORK_ERROR", "The request to this application failed. Check your connection and retry.");
  } finally {
    button.disabled = false;
    setText(button, "Run inference & verify receipt");
  }
}

function bindEvents() {
  el("submit-btn").addEventListener("click", submitInference);
  el("sample-btn").addEventListener("click", () => {
    el("prompt").value = SAMPLE_PROMPT;
    updateCounter();
  });
  const prompt = el("prompt");
  prompt.addEventListener("input", updateCounter);

  const tokenInput = el("access-token");
  tokenInput.addEventListener("input", () => {
    sessionStorage.setItem(TOKEN_STORAGE_KEY, tokenInput.value);
  });
  const stored = sessionStorage.getItem(TOKEN_STORAGE_KEY);
  if (stored) tokenInput.value = stored;

  prompt.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      submitInference();
    }
  });
}

function updateCounter() {
  const prompt = el("prompt");
  setText(el("char-counter"), `${prompt.value.length} / ${PROMPT_MAX_FALLBACK}`);
}

async function init() {
  bindEvents();
  updateCounter();
  try {
    await loadCatalog();
  } catch {
    el("fallback-card").hidden = false;
    const meta = el("catalog-meta");
    setText(meta, "The model catalog could not be loaded. Reload to retry.");
  }
}

init();
