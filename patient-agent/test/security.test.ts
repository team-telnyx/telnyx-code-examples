import {it,expect,vi} from "vitest";
import nodeCrypto from "node:crypto";
import {PatientAgent,DemoClinic,type Env} from "../src/patient";
import worker from "../src/index";
import {context} from "./harness";

function signPayload(payload:string,privateKey:nodeCrypto.KeyObject,timestamp:number){
  const signature=nodeCrypto.sign(null,Buffer.from(`${timestamp}.${payload}`),privateKey);
  return {sig:signature.toString("base64"),ts:String(timestamp)};
}
function rawPublicBase64(publicKey:nodeCrypto.KeyObject){
  const jwk=publicKey.export({format:"jwk"}) as {x:string};
  return Buffer.from(jwk.x,"base64url").toString("base64");
}

it("accepts a validly signed Telnyx webhook and rejects tampered or unsigned ones",async()=>{
  const {publicKey,privateKey}=nodeCrypto.generateKeyPairSync("ed25519");
  const patient=context("patient-demo-4"),clinic=context("patient-demo-4");
  const env={SECRETS:{get:async(k:string)=>({ADMIN_TOKEN:"a".repeat(64),NURSE_TOKEN:"n".repeat(64),DEMO_RECIPIENT:"+12025550123",FROM_NUMBER:"+12025550124",WEBHOOK_PUBLIC_KEY:rawPublicBase64(publicKey)}[k]||"")},TELNYX:{messages:{send:vi.fn().mockResolvedValue({data:{id:"m-1"}})}}} as unknown as Env;
  const c=new DemoClinic(clinic.ctx,env);const a=new PatientAgent(patient.ctx,env);
  env.CLINIC={idFromName:()=>c} as unknown as Env["CLINIC"];env.AGENT={idFromName:()=>a} as unknown as Env["AGENT"];
  await patient.ready();await clinic.ready();
  await a.enroll({phone:"+12025550123",consent:true,appointmentAt:new Date(Date.now()+3600000).toISOString(),mode:"demo",medicationIntervalSeconds:180,demoDurationSeconds:900});
  const payload=JSON.stringify({data:{event_type:"message.received",id:"evt-1",payload:{id:"evt-1",from:{phone_number:"+12025550123"},to:{phone_number:"+12025550124"},text:"RESCHEDULE"}}});
  const {sig,ts}=signPayload(payload,privateKey,Date.now());
  const signed=await worker.fetch(new Request("https://demo/webhooks/patients/patient-demo-4",{method:"POST",headers:{"Content-Type":"application/json","telnyx-signature-ed25519":sig,"telnyx-signature-timestamp":ts},body:payload}),env);
  expect(signed.status).toBe(200);
  const tampered=await worker.fetch(new Request("https://demo/webhooks/patients/patient-demo-4",{method:"POST",headers:{"Content-Type":"application/json","telnyx-signature-ed25519":sig.slice(0,-4)+"AAAA","telnyx-signature-timestamp":ts},body:payload}),env);
  expect(tampered.status).toBe(401);
  const unsigned=await worker.fetch(new Request("https://demo/webhooks/patients/patient-demo-4",{method:"POST",headers:{"Content-Type":"application/json"},body:payload}),env);
  expect(unsigned.status).toBe(401);
});
