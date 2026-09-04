import { describe,it,expect,vi } from "vitest";
import { PatientAgent,DemoClinic,type Env } from "../src/patient";
import worker from "../src/index";
import { context } from "./harness";
const phone="+12025550123",from="+12025550124";
async function setup(extra:Record<string,unknown>={}){
 const store=context("patient-42"), clinicStore=context("patient-42");let now=Date.parse("2026-09-01T00:00:00Z");
 const send=vi.fn().mockResolvedValue({data:{id:"message-1"}});
 const completion=vi.fn().mockResolvedValue({choices:[{message:{content:"Reports feeling worse."}}]});
 const env={TELNYX:{messages:{send},ai:{openai:{chat:{createCompletion:completion}}}},SECRETS:{get:async(k:string)=>({DEMO_RECIPIENT:phone,FROM_NUMBER:from,ADMIN_TOKEN:"a".repeat(32),NURSE_TOKEN:"n".repeat(32)}[k]||"")}} as unknown as Env;
 const clinic=new DemoClinic(clinicStore.ctx,env);env.CLINIC={idFromName:()=>clinic} as unknown as Env["CLINIC"];
 class TestPatient extends PatientAgent { protected now(){return now;} }
 const agent=new TestPatient(store.ctx,env);env.AGENT={idFromName:()=>agent} as unknown as Env["AGENT"];
 await store.ready();await clinicStore.ready();
 const base:Record<string,unknown>={phone,consent:true,appointmentAt:new Date(now+86400000).toISOString()};
 if(extra.mode!=="production"){base.mode="demo";base.medicationIntervalSeconds=86400;}
 await agent.enroll({...base,...extra});
 return {agent,env,send,completion,store,advance:(ms:number)=>{now+=ms;},restart:()=>new TestPatient(store.ctx,env)};
}
describe("patient entity workflow",()=>{
 it("expires bounded demos, cancels reminders, and rejects START after expiry",async()=>{const t=await setup({demoDurationSeconds:120});const before=t.send.mock.calls.length;t.advance(121000);await t.agent.alarm({retryCount:0,isRetry:false});expect((await t.agent.snapshot()).consent).toBe(false);expect((await t.agent.snapshot()).schedules).toHaveLength(0);expect(t.send.mock.calls.length).toBe(before);await t.agent.receiveSMS({id:"restart",from:phone,to:from,text:"START"});expect((await t.agent.snapshot()).consent).toBe(false);});
 it("allows an operator to stop the test and cancel all jobs",async()=>{const t=await setup();const before=t.send.mock.calls.length;await t.agent.stop();expect((await t.agent.snapshot()).schedules).toHaveLength(0);await t.agent._medication();expect(t.send.mock.calls.length).toBe(before);});
 it("persists after reactivation and wakes for reminders/no-show",async()=>{const t=await setup();const before=t.send.mock.calls.length;t.advance(86341000);await t.agent.alarm({retryCount:0,isRetry:false});expect(t.send.mock.calls.length).toBe(before+1);t.advance(1120000);await t.agent.alarm({retryCount:0,isRetry:false});expect((await t.restart().snapshot()).appointment?.status).toBe("noshow");expect(t.send.mock.calls.length).toBe(before+3);});
 it("offers reschedule slots, books the chosen one, re-times medication to 30s, triages with real adapter contract, waits for nurse, wakes again",async()=>{const t=await setup();await t.agent.receiveSMS({id:"one",from:phone,to:from,text:"RESCHEDULE"});const offered=await t.agent.snapshot();expect(offered.rescheduleOptions).toHaveLength(3);expect(t.send.mock.calls.some(c=>c[0].text.includes("Pick a new appointment time"))).toBe(true);await t.agent.receiveSMS({id:"two",from:phone,to:from,text:"2"});const booked=await t.agent.snapshot();expect(booked.appointment?.id).toBe("rescheduled-two");expect(booked.rescheduleOptions).toBeUndefined();const med=booked.schedules.find(s=>s.name==="_medication");expect(med?.everyMs).toBeUndefined();expect(med?.due).toBeLessThanOrEqual(Date.now()+35000);expect(booked.schedules.some(s=>s.id==="medication"&&s.everyMs)).toBe(false);await t.agent.receiveSMS({id:"three",from:phone,to:from,text:"feeling worse"});expect(t.completion).toHaveBeenCalled();expect((await t.agent.snapshot()).escalation?.status).toBe("waiting");await t.agent.nurseReply({escalationId:"three",text:"Please call the demo care team.",followUpSeconds:60});t.advance(61000);await t.agent.alarm({retryCount:0,isRetry:false});expect(t.send.mock.calls.some(c=>c[0].text.toLowerCase().includes("follow-up"))).toBe(true);});
 it("tolerates punctuation and casing in commands",async()=>{const t=await setup();await t.agent.receiveSMS({id:"one",from:phone,to:from,text:"Reschedule. "});expect((await t.agent.snapshot()).rescheduleOptions).toHaveLength(3);await t.agent.receiveSMS({id:"two",from:phone,to:from,text:"2"});expect((await t.agent.snapshot()).appointment?.id).toBe("rescheduled-two");});
 it("tolerates punctuation and casing in commands",async()=>{const t=await setup();await t.agent.receiveSMS({id:"one",from:phone,to:from,text:"Reschedule. "});expect((await t.agent.snapshot()).rescheduleOptions).toHaveLength(3);await t.agent.receiveSMS({id:"two",from:phone,to:from,text:"2"});expect((await t.agent.snapshot()).appointment?.id).toBe("rescheduled-two");});
 it("simulated operator replies drive the same state machine in demo mode",async()=>{const t=await setup();await t.agent.simulateInbound({text:"RESCHEDULE"});expect((await t.agent.snapshot()).rescheduleOptions).toHaveLength(3);await t.agent.simulateInbound({text:"1"});const afterSlot=await t.agent.snapshot();expect(afterSlot.appointment?.status).toBe("booked");expect(afterSlot.appointment?.id).toContain("rescheduled-");expect(afterSlot.schedules.some(s=>s.name==="_medication"&&!s.everyMs)).toBe(true);await t.agent.simulateInbound({text:"TAKEN"});expect((await t.agent.snapshot()).medicationAcknowledgedAt).toBeTruthy();await t.agent.simulateInbound({text:"feeling worse"});expect((await t.agent.snapshot()).escalation?.status).toBe("waiting");});
 it("rejects simulation outside demo mode and for unenrolled actors",async()=>{const t=await setup({mode:"production",medicationHourLocal:1,utcOffsetMinutes:0});await expect(t.agent.simulateInbound({text:"RESCHEDULE"})).rejects.toThrow();const store=context("unenrolled-sim"),clinicStore2=context("unenrolled-sim");const env2={TELNYX:t.env.TELNYX,SECRETS:t.env.SECRETS,CLINIC:{idFromName:()=>new DemoClinic(clinicStore2.ctx,t.env)}} as unknown as Env;const fresh=new PatientAgent(store.ctx,env2);await store.ready();await expect(fresh.simulateInbound({text:"RESCHEDULE"})).rejects.toThrow();});
 it("deduplicates provider events and honors STOP",async()=>{const t=await setup();const before=t.send.mock.calls.length;const e={id:"one",from:phone,to:from,text:"feeling worse"};await t.agent.receiveSMS(e);await t.agent.receiveSMS(e);expect(t.completion).toHaveBeenCalledTimes(1);await t.agent.receiveSMS({...e,id:"stop",text:"STOP"});await t.agent._medication();expect(t.send.mock.calls.length).toBe(before+1);});
 it("fails closed to nurse when inference fails",async()=>{const t=await setup();t.completion.mockRejectedValue(new Error("secret provider detail"));await t.agent.receiveSMS({id:"one",from:phone,to:from,text:"concern"});expect((await t.agent.snapshot()).escalation?.status).toBe("waiting");});
 it("does not repeatedly send after ambiguous provider failure",async()=>{const t=await setup();const before=t.send.mock.calls.length;t.send.mockRejectedValue(new Error("timeout"));await expect(t.agent._sms("test","hi")).rejects.toThrow();await t.agent._sms("test","hi");expect(t.send.mock.calls.length).toBe(before+1);});
 it("rejects unknown senders, missing auth, unsigned webhooks, and wrong nurse capability",async()=>{const t=await setup();await expect(t.agent.receiveSMS({id:"one",from:"+12025550999",to:from,text:"hi"})).rejects.toThrow();expect((await worker.fetch(new Request("https://demo/api/patients/patient-42"),t.env)).status).toBe(401);expect((await worker.fetch(new Request("https://demo/webhooks/patients/patient-42",{method:"POST",body:"{}"}),t.env)).status).toBe(401);expect((await worker.fetch(new Request("https://demo/api/patients/patient-42/nurse-reply",{method:"POST",headers:{Authorization:"Bearer "+"a".repeat(32)},body:"{}"}),t.env)).status).toBe(401);expect((await worker.fetch(new Request("https://demo/api/patients/patient-42/simulate-inbound",{method:"POST",headers:{Authorization:"Bearer "+"n".repeat(32)},body:JSON.stringify({text:"RESCHEDULE"})}),t.env)).status).toBe(401);});
 it("production timing: confirmation SMS, 15-minute no-show grace, daily medication anchor, no auto-stop",async()=>{
  const t=await setup({mode:"production",medicationHourLocal:1,utcOffsetMinutes:0});
  const snap=await t.agent.snapshot();
  expect(snap.mode).toBe("production");expect(snap.noShowGraceSeconds).toBe(900);
  expect(snap.schedules.some(s=>s.name==="_medicationDaily")).toBe(true);
  expect(snap.schedules.some(s=>s.name==="_stop")).toBe(false);
  expect(t.send).toHaveBeenCalledTimes(1);expect(t.send.mock.calls[0][0].text).toContain("appointment is set for");
  t.advance(86400000+899000);await t.agent.alarm({retryCount:0,isRetry:false});
  expect((await t.agent.snapshot()).appointment?.status).toBe("booked");
  t.advance(2000);await t.agent.alarm({retryCount:0,isRetry:false});
  expect((await t.agent.snapshot()).appointment?.status).toBe("noshow");
 });
 it("production medication fires at the daily anchor hour and re-arms for the next day",async()=>{
  const t=await setup({mode:"production",medicationHourLocal:1,utcOffsetMinutes:0});
  t.advance(3601000);await t.agent.alarm({retryCount:0,isRetry:false});
  expect(t.send.mock.calls.some(c=>c[0].text.includes("prescription"))).toBe(true);
  const after=await t.agent.snapshot();
  expect(after.schedules.some(s=>s.name==="_medicationDaily")).toBe(true);
 });
 it("rejects demo compression fields in production mode and vice versa",async()=>{
  const t=await setup({mode:"production",medicationHourLocal:1,utcOffsetMinutes:0});
  await expect(t.agent.enroll({phone,consent:true,appointmentAt:new Date(Date.now()+86400000).toISOString(),mode:"production",demoDurationSeconds:900})).rejects.toThrow();
  await expect(t.agent.enroll({phone,consent:true,appointmentAt:new Date(Date.now()+86400000).toISOString(),mode:"demo",medicationHourLocal:20})).rejects.toThrow();
 });
});
