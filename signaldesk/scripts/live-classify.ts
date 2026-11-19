import "dotenv/config";
import { classifyIncident } from "../src/lib/classify";

async function main() {
  const report =
    "Major issue: our payment gateway integration is failing for all customers in us-east-1. Every checkout attempt times out, started about 20 minutes ago.";
  const { classification, usage } = await classifyIncident(report, "+18005550123");
  console.log("MODEL IN USE:", process.env.AI_MODEL ?? "(default)");
  console.log(JSON.stringify(classification, null, 2));
  console.log("USAGE:", JSON.stringify(usage));
  process.exit(0);
}

main().catch((e) => { console.error("FAILED:", e?.message ?? e); process.exit(1); });
