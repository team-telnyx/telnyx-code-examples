const baseUrl = process.env.DEMO_BASE_URL || "http://localhost:8787";
const incidentId = `INC-SMOKE-${Date.now()}`;

const response = await fetch(`${baseUrl}/api/demo`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    incidentId,
    title: "Smoke-test incident",
    description: "Total voice outage in the smoke-test region.",
    affectedServices: ["Voice", "Messaging"],
    affectedCustomers: ["+15555550101", "+15555550102"],
    liveMode: false,
    paceMs: 0,
  }),
});

const result = await response.json();
if (!response.ok) throw new Error(`demo failed (${response.status}): ${JSON.stringify(result)}`);
if (result.snapshot?.state?.status !== "resolved") throw new Error("incident did not reach resolved state");
if (result.snapshot?.state?.notificationsSent !== 8) throw new Error("unexpected simulated notification count");
if (!result.snapshot?.customers?.every((value) => value.startsWith("•••"))) throw new Error("customer numbers were not masked");
if (!result.rca?.path || !result.rca?.content?.includes(incidentId)) throw new Error("RCA artifact was not generated");

console.log(`Smoke test passed for ${incidentId}`);
