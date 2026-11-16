import handler, { FluencyLab, clinicIdFor, parseStaffText } from "./src/index";

async function runSmokeTest(): Promise<void> {
  let failures = 0;
  const check = (name: string, cond: boolean): void => {
    if (cond) console.log(`\u2705 ${name}`);
    else { console.error(`\u274c ${name}`); failures++; }
  };

  check("default export has fetch", typeof handler.fetch === "function");
  check("FluencyLab is a class", typeof FluencyLab === "function");
  check("clinicIdFor is a function", typeof clinicIdFor === "function");
  check("parseStaffText is a function", typeof parseStaffText === "function");

  const alias = parseStaffText("Add Novocaine to the dictionary \u2014 NO-voh-kayn");
  check(
    "alias parse (em-dash form)",
    alias?.type === "alias" && alias.alias === "NO-voh-kayn" && alias.text === "Novocaine",
  );

  const phoneme = parseStaffText("add Dr. Ng -> /d\u0279.\u025b\u014b/");
  check(
    "phoneme parse (arrow + slashes)",
    phoneme?.type === "phoneme" && phoneme.phoneme === "d\u0279.\u025b\u014b" && phoneme.alphabet === "ipa",
  );

  check("invalid text returns null", parseStaffText("hello world") === null);

  const env = { CLINIC_NUMBERS: '{"+15551234567":"clinicA"}', INTAKE_NUMBER: "+15559999999" } as any;
  check("clinicIdFor mapped", clinicIdFor("+15551234567", env) === "clinicA");
  check("clinicIdFor fallback", clinicIdFor("+15550000000", env) === "riverbentalclinic");

  const proto = FluencyLab.prototype as any;
  check("receive method", typeof proto.receive === "function");
  check("applyEdit method", typeof proto.applyEdit === "function");
  check("canary method", typeof proto.canary === "function");
  check("getGreetingAudio method", typeof proto.getGreetingAudio === "function");

  if (failures > 0) {
    console.error(`\n${failures} check(s) failed`);
    process.exit(1);
  }
  console.log("\nAll smoke checks passed.");
}

runSmokeTest().catch((e) => { console.error(e); process.exit(1); });
