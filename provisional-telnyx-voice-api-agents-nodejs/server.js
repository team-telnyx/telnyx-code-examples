#!/usr/bin/env node
"use strict";

/**
 * Provisional Agents with Telnyx Voice API.
 *
 * One reusable Telnyx AI Assistant is started on Telnyx Voice API calls
 * with runtime instructions and greeting selected from the called number.
 */

require("dotenv").config();

const crypto = require("crypto");
const express = require("express");
const fs = require("fs/promises");
const path = require("path");

const app = express();
const PORT = parseInt(process.env.PORT || "5000", 10);
const TELNYX_API_BASE_URL = "https://api.telnyx.com/v2";

const BUSINESS_CONFIGS = [
  "smile-dental",
  "northside-medical",
  "brightcare-physical-therapy",
];

const projectRoot = __dirname;
const promptTemplatePath = path.join(
  projectRoot,
  "prompts",
  "appointment-scheduling-assistant.md"
);
const numberRoutingPath = path.join(projectRoot, "examples", "number-routing.json");

async function main() {
  const [command, slug] = process.argv.slice(2);

  if (command === "--preview") {
    await printPreview(slug || "smile-dental");
    return;
  }

  if (command === "--call") {
    await startOutboundTestCall(slug || "smile-dental");
    return;
  }

  startServer();
}

function startServer() {
  app.post("/webhooks/voice", express.raw({ type: "*/*" }), async (req, res) => {
    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from("");

    if (!verifyTelnyxSignature(rawBody.toString(), req.headers)) {
      return res.status(401).json({ error: "invalid signature" });
    }

    let event;
    try {
      event = JSON.parse(rawBody.toString());
    } catch {
      return res.status(400).json({ error: "invalid json payload" });
    }

    if (!event || !event.data) {
      return res.status(400).json({ error: "invalid webhook payload" });
    }

    try {
      const result = await handleVoiceWebhook(event.data);
      return res.status(200).json(result);
    } catch (error) {
      console.error("webhook error:", error.message);
      return mapErrorToResponse(res, error);
    }
  });

  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      webhook: "/webhooks/voice",
      configs: BUSINESS_CONFIGS,
    });
  });

  app.listen(PORT, () => {
    console.log(`Provisional Agents with Telnyx Voice API server listening on port ${PORT}`);
    console.log("Configure your Telnyx Voice API webhook URL: https://your-domain.com/webhooks/voice");
  });
}

async function handleVoiceWebhook(event) {
  const eventType = event.event_type;
  const payload = event.payload || {};
  const callControlId = payload.call_control_id;

  if (!callControlId) {
    throw new BadRequestError("missing call_control_id in webhook event");
  }

  console.log(`event: ${eventType}`);

  if (eventType === "call.initiated") {
    if (isInboundCall(payload)) {
      await telnyxRequest(`/calls/${encodeURIComponent(callControlId)}/actions/answer`, {});
      return { status: "answering", call_control_id: callControlId };
    }

    return { status: "ignored_outbound_initiated", call_control_id: callControlId };
  }

  if (eventType !== "call.answered") {
    return {
      status: "acknowledged",
      event_type: eventType,
      call_control_id: callControlId,
    };
  }

  if (!process.env.BASE_ASSISTANT_ID) {
    throw new BadRequestError("BASE_ASSISTANT_ID is required for live calls");
  }

  const route = await resolveBusinessRoute(payload);
  const preview = await buildAssistantPayload(route.businessConfigSlug, {
    baseAssistantId: process.env.BASE_ASSISTANT_ID,
  });

  console.log(`business selection source: ${route.source}`);
  console.log(`selected business config: ${route.businessConfigSlug}`);
  console.log("starting Telnyx Voice API provisional agent with runtime AI Assistant configuration");
  console.log(JSON.stringify(preview.assistantPayload, null, 2));

  await telnyxRequest(
    `/calls/${encodeURIComponent(callControlId)}/actions/ai_assistant_start`,
    preview.assistantPayload
  );

  return {
    status: "ai_assistant_started",
    call_control_id: callControlId,
    business_config: route.businessConfigSlug,
    business_name: preview.businessName,
  };
}

async function resolveBusinessRoute(payload) {
  const businessFromClientState = decodeClientStateBusiness(payload.client_state);

  if (businessFromClientState) {
    assertKnownConfig(businessFromClientState);
    return {
      source: "client_state",
      businessConfigSlug: businessFromClientState,
    };
  }

  const calledNumber = getCalledNumber(payload);
  const routing = JSON.parse(await fs.readFile(numberRoutingPath, "utf8"));
  const businessConfigSlug = routing[calledNumber];

  if (!businessConfigSlug) {
    throw new BadRequestError(`no business config mapped for called number ${calledNumber}`);
  }

  assertKnownConfig(businessConfigSlug);

  return {
    source: "called_number",
    calledNumber,
    businessConfigSlug,
  };
}

async function buildAssistantPayload(slug, options = {}) {
  const business = await loadBusinessConfig(slug);
  const instructions = await renderPrompt(business);
  const baseAssistantId = options.baseAssistantId || process.env.BASE_ASSISTANT_ID;
  const assistant = {
    ...(baseAssistantId ? { id: baseAssistantId } : {}),
    instructions,
    greeting: business.first_message,
  };

  return {
    slug,
    businessName: business.business_name,
    greeting: business.first_message,
    instructions,
    assistantPayload: { assistant },
  };
}

async function loadBusinessConfig(slug) {
  assertKnownConfig(slug);
  const configPath = path.join(projectRoot, "examples", `${slug}.json`);
  const config = JSON.parse(await fs.readFile(configPath, "utf8"));

  validateBusinessConfig(config, slug);
  return config;
}

async function renderPrompt(config) {
  const template = await fs.readFile(promptTemplatePath, "utf8");
  const services = config.services.map((service) => `- ${service}`).join("\n");

  return template
    .replaceAll("{{business_name}}", config.business_name)
    .replaceAll("{{agent_article}}", getArticle(config.agent_role))
    .replaceAll("{{agent_role}}", config.agent_role)
    .replaceAll("{{tone}}", config.tone)
    .replaceAll("{{business_hours}}", config.business_hours)
    .replaceAll("{{services}}", services)
    .replaceAll("{{first_message}}", config.first_message);
}

async function printPreview(slug) {
  const preview = await buildAssistantPayload(slug);

  console.log("=== Provisional Agents with Telnyx Voice API preview ===");
  console.log(`business: ${preview.businessName}`);
  console.log("");
  console.log("greeting:");
  console.log(preview.greeting);
  console.log("");
  console.log("instructions:");
  console.log(preview.instructions);
  console.log("");
  console.log("Telnyx Voice API ai_assistant_start payload:");
  console.log(JSON.stringify(preview.assistantPayload, null, 2));
}

async function startOutboundTestCall(slug) {
  const business = await loadBusinessConfig(slug);
  const requestBody = {
    connection_id: requiredEnv("TELNYX_CONNECTION_ID"),
    from: requiredEnv("TELNYX_FROM_NUMBER"),
    to: requiredEnv("TEST_TO_NUMBER"),
    client_state: Buffer.from(JSON.stringify({ business_config: slug }), "utf8").toString("base64"),
  };

  console.log("=== starting optional Telnyx Voice API outbound provisional-agent test call ===");
  console.log(`business: ${business.business_name}`);
  console.log(`selected config: ${slug}`);

  const response = await telnyxRequest("/calls", requestBody);
  console.log(JSON.stringify(response, null, 2));
}

async function telnyxRequest(apiPath, body) {
  const apiKey = requiredEnv("TELNYX_API_KEY");
  const response = await fetch(`${TELNYX_API_BASE_URL}${apiPath}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const responseText = await response.text();
  const responseBody = parseResponseBody(responseText);

  if (!response.ok) {
    throw new TelnyxApiError(response.status, responseBody);
  }

  return responseBody;
}

function verifyTelnyxSignature(rawBody, headers, toleranceSec = 300) {
  const publicKey = process.env.TELNYX_PUBLIC_KEY;

  if (!publicKey) {
    console.warn("TELNYX_PUBLIC_KEY is not set. skipping webhook signature verification for local development.");
    return true;
  }

  const signature = headers["telnyx-signature-ed25519"];
  const timestamp = headers["telnyx-timestamp"];

  if (!signature || !timestamp) {
    return false;
  }

  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > toleranceSec) {
    return false;
  }

  try {
    const derPrefix = Buffer.from("302a300506032b6570032100", "hex");
    const publicKeyBytes = Buffer.from(publicKey, "base64");
    const der = Buffer.concat([derPrefix, publicKeyBytes]);
    const key = crypto.createPublicKey({ key: der, format: "der", type: "spki" });
    const signedPayload = Buffer.from(`${timestamp}|${rawBody}`);

    return crypto.verify(null, signedPayload, key, Buffer.from(signature, "base64"));
  } catch {
    return false;
  }
}

function decodeClientStateBusiness(clientState) {
  if (!clientState) {
    return null;
  }

  try {
    const decoded = Buffer.from(clientState, "base64").toString("utf8");
    const parsed = JSON.parse(decoded);
    return parsed.business_config || null;
  } catch {
    throw new BadRequestError("client_state was present but could not be decoded");
  }
}

function getCalledNumber(payload) {
  const to = payload.to;

  if (typeof to === "string") {
    return to;
  }

  if (to && typeof to.number === "string") {
    return to.number;
  }

  if (typeof payload.to_e164 === "string") {
    return payload.to_e164;
  }

  throw new BadRequestError("call.answered webhook did not include a called number");
}

function isInboundCall(payload) {
  const direction = String(payload.direction || payload.call_direction || "").toLowerCase();
  return ["incoming", "inbound"].includes(direction);
}

function getArticle(phrase) {
  return /^[aeiou]/i.test(phrase.trim()) ? "an" : "a";
}

function validateBusinessConfig(config, slug) {
  const requiredStringFields = [
    "business_name",
    "agent_role",
    "tone",
    "business_hours",
    "first_message",
  ];

  for (const field of requiredStringFields) {
    if (typeof config[field] !== "string" || config[field].trim() === "") {
      throw new Error(`invalid ${slug} config: "${field}" must be a non-empty string`);
    }
  }

  if (
    !Array.isArray(config.services) ||
    config.services.length === 0 ||
    config.services.some((service) => typeof service !== "string" || service.trim() === "")
  ) {
    throw new Error(`invalid ${slug} config: "services" must be a non-empty string array`);
  }
}

function assertKnownConfig(slug) {
  if (!BUSINESS_CONFIGS.includes(slug)) {
    throw new BadRequestError(`unknown business config "${slug}". try one of: ${BUSINESS_CONFIGS.join(", ")}`);
  }
}

function requiredEnv(name) {
  const value = process.env[name];

  if (!value) {
    throw new BadRequestError(`${name} is required`);
  }

  return value;
}

function parseResponseBody(responseText) {
  if (!responseText) {
    return {};
  }

  try {
    return JSON.parse(responseText);
  } catch {
    return { raw: responseText };
  }
}

function mapErrorToResponse(res, error) {
  if (error instanceof BadRequestError) {
    return res.status(400).json({ error: error.message });
  }

  if (error instanceof TelnyxApiError) {
    return res.status(error.status).json({
      error: "telnyx api error",
      details: error.responseBody,
    });
  }

  return res.status(500).json({ error: "internal server error" });
}

class BadRequestError extends Error {}

class TelnyxApiError extends Error {
  constructor(status, responseBody) {
    super(`telnyx api error: ${status}`);
    this.status = status;
    this.responseBody = responseBody;
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
