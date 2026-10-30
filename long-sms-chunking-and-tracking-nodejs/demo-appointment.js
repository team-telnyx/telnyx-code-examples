#!/usr/bin/env node

const fs = require("fs");

function readEnvFile() {
  const values = {};
  const source = fs.readFileSync(".env", "utf8");
  for (const line of source.split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) values[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, "");
  }
  return values;
}

function buildAppointmentMessage() {
  const sections = [
    "Appointment scheduling update from Northstar Clinic. Your care team has reserved a visit and this message contains the complete preparation details.",
    "Appointment: Tuesday, November 17 at 10:30 AM Pacific Time. Location: Northstar Clinic, 2400 Market Street, Building B, Suite 410. Check in at the front desk when you arrive.",
    "Please arrive 15 minutes early with a photo ID, your insurance card, and a current medication list. If you use an assistive device or need language support, tell the front desk so we can prepare the right accommodations.",
    "Before the visit, complete the short intake form in your patient portal. Bring any recent test results or questions you want to discuss. Your clinician will review your goals, confirm the plan, and explain next steps.",
    "If you need to reschedule, reply to this message with RESCHEDULE or call the scheduling team at 415-555-0142. Please give us at least 24 hours notice so another patient can use the appointment time.",
    "If you are running late, call the clinic before you arrive. We will do our best to keep your visit on schedule, but arrivals more than 15 minutes late may need a new appointment time.",
    "For accessibility, parking is available in the garage beneath Building B, and the clinic entrance is step-free. Please do not reply with medical information, payment details, or other sensitive personal data.",
    "We look forward to seeing you. This is an automated scheduling message, but the care team will review replies during business hours and follow up when action is needed.",
  ];

  let message = sections.join("\n\n");
  const additions = [
    "Please keep this message for your records so the appointment time, location, and preparation instructions are easy to find.",
    "If your contact information has changed, update it in the patient portal before the visit so reminders reach you reliably.",
    "Thank you for helping us keep appointments running smoothly for every patient.",
  ];
  let index = 0;
  while (message.length <= 1530) {
    message += `\n\n${additions[index % additions.length]}`;
    index += 1;
  }
  return message;
}

async function main() {
  const env = readEnvFile();
  const to = env.DEMO_TO;
  const port = env.PORT || "5127";
  const message = buildAppointmentMessage();
  const sequence = [
    "Appointment confirmed: Tuesday, November 17 at 10:30 AM Pacific. Please save this message for your records. Your care team has reserved this time for your visit and will review your goals and next steps with you.",
    "Your appointment is at Northstar Clinic, 2400 Market Street, Building B, Suite 410. Please check in at the front desk when you arrive. Parking is available in the garage beneath Building B, and the clinic entrance is step-free.",
    "Please arrive 15 minutes early with a photo ID, your insurance card, and a current medication list. Bring any recent test results and questions you want your care team to review during the appointment.",
    "Need to change the time? Reply RESCHEDULE or call the scheduling team at 415-555-0142. Please give us at least 24 hours notice when possible so another patient can use the appointment time.",
  ];

  if (!to) throw new Error("DEMO_TO is missing from .env");
  if (process.argv.includes("--sequence")) {
    for (const text of sequence) {
      const response = await fetch(`http://127.0.0.1:${port}/sms/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to, text }),
      });
      const result = await response.json();
      console.log(JSON.stringify({ http_status: response.status, ...result }));
      if (!response.ok) process.exitCode = 1;
    }
    return;
  }
  if (process.argv.includes("--dry-run")) {
    console.log(JSON.stringify({ demo: "appointment-scheduling", text_length: message.length }));
    return;
  }

  const response = await fetch(`http://127.0.0.1:${port}/sms/send-long`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ to, text: message }),
  });
  const result = await response.json();
  console.log(JSON.stringify({ http_status: response.status, ...result }));
  if (!response.ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
