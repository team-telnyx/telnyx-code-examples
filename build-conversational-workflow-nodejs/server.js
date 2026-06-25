const express = require("express");
const { randomUUID } = require("node:crypto");
require("dotenv").config();

const port = Number(process.env.PORT || 8787);
const toolSecret = process.env.CLAIM_TOOL_SECRET || "dev-secret";
const app = express();

const requiredCreateFields = [
  "caller_name",
  "caller_phone",
  "loss_type",
  "loss_date",
  "loss_location",
  "loss_description",
  "priority_flag",
  "consent_to_continue"
];

app.use(express.json());

app.get("/health", (_request, response) => {
  response.json({ status: "ok", service: "claim_intake_tools" });
});

app.use("/tools", (request, response, next) => {
  if (request.headers["x-tool-secret"] !== toolSecret) {
    response.status(401).json({ success: false, error: "unauthorized" });
    return;
  }

  next();
});

app.post("/tools/create-claim-intake", (request, response) => {
  const missingFields = validateRequired(request.body, requiredCreateFields);

  if (missingFields.length > 0) {
    response.status(422).json({
      success: false,
      error: "missing_required_fields",
      missing_fields: missingFields
    });
    return;
  }

  response.json({
    success: true,
    claim_intake_id: makeId("aci"),
    priority_flag: Boolean(request.body.priority_flag),
    next_step: "claims team follow-up"
  });
});

app.post("/tools/log-claim-intake-fallback", (request, response) => {
  const missingFields = validateRequired(request.body, ["reason", "summary"]);

  if (missingFields.length > 0) {
    response.status(422).json({
      success: false,
      error: "missing_required_fields",
      missing_fields: missingFields
    });
    return;
  }

  response.json({
    success: true,
    fallback_reference_id: makeId("acf"),
    next_step: "claims team manual review"
  });
});

app.post("/tools/flag-priority-follow-up", (request, response) => {
  const hasClaimReference = hasValue(request.body.claim_intake_id) || hasValue(request.body.fallback_reference_id);
  const missingFields = validateRequired(request.body, ["caller_phone"]);

  if (!hasClaimReference) {
    missingFields.unshift("claim_intake_id_or_fallback_reference_id");
  }

  if (missingFields.length > 0) {
    response.status(422).json({
      success: false,
      error: "missing_required_fields",
      missing_fields: missingFields
    });
    return;
  }

  response.json({
    success: true,
    priority_task_id: makeId("apt"),
    priority_status: "queued",
    priority_reasons: normalizePriorityReasons(request.body.priority_reasons)
  });
});

app.use((error, _request, response, _next) => {
  if (error instanceof SyntaxError) {
    response.status(400).json({ success: false, error: "invalid_json" });
    return;
  }

  response.status(500).json({ success: false, error: "internal_error" });
});

app.listen(port, () => {
  console.log(`claim intake tool server listening on http://localhost:${port}`);
});

function makeId(prefix) {
  return `${prefix}_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
}

function hasValue(value) {
  if (typeof value === "boolean") {
    return true;
  }

  if (value === null || value === undefined) {
    return false;
  }

  return String(value).trim() !== "";
}

function validateRequired(body, fields) {
  return fields.filter((field) => !hasValue(body[field]));
}

function normalizePriorityReasons(value) {
  if (Array.isArray(value)) {
    return value.filter(hasValue).map(String);
  }

  if (!hasValue(value)) {
    return [];
  }

  return [String(value)];
}
