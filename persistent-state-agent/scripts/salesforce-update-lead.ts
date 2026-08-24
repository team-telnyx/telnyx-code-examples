import { readFileSync, existsSync } from "node:fs";
import { resetSalesforceAuthCache, salesforceConfig, updateLeadDemoField } from "../src/salesforce.js";
import type { Env } from "../src/types.js";

loadDotEnv();

const env = createEnv();
const config = await salesforceConfig(env);

if (config.useMock) {
  console.error("USE_MOCK_SALESFORCE is not false. Set USE_MOCK_SALESFORCE=false to test real Salesforce.");
  process.exit(1);
}

const value = process.argv.slice(2).join(" ").trim()
  || `CustomerAgent demo update ${new Date().toISOString()}`;

try {
  resetSalesforceAuthCache();
  const result = await updateLeadDemoField(env, {
    lead_id: process.env.SF_LEAD_ID,
    field: process.env.SF_LEAD_UPDATE_FIELD || "reMQL_Source_Detail__c",
    value,
  });
  console.log(JSON.stringify({
    ok: true,
    lead_id: result.lead.id,
    lead_name: result.lead.name,
    field: result.field,
    value: result.value,
  }, null, 2));
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    error: error instanceof Error ? error.message : "unknown Salesforce update error",
  }, null, 2));
  process.exit(1);
}

function createEnv(): Env {
  return {
    USE_MOCK_SALESFORCE: process.env.USE_MOCK_SALESFORCE,
    SF_WRITE_MODE: process.env.SF_WRITE_MODE,
    SF_CLIENT_ID: process.env.SF_CLIENT_ID,
    SF_CLIENT_SECRET: process.env.SF_CLIENT_SECRET,
    SF_DOMAIN: process.env.SF_DOMAIN || "login",
    SF_API_VERSION: process.env.SF_API_VERSION || "v58.0",
    SF_DEMO_LEAD_EMAIL: process.env.SF_DEMO_LEAD_EMAIL,
    SECRETS: {
      async get(binding: string) {
        const value = process.env[binding];
        if (!value) throw new Error(`${binding} is not set`);
        return value;
      },
    },
  } as Env;
}

function loadDotEnv(): void {
  if (!existsSync(".env")) return;
  const text = readFileSync(".env", "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx <= 0) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    process.env[key] ??= value;
  }
}
