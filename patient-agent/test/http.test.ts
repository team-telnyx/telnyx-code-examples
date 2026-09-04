import {it,expect,vi} from "vitest";
import {PatientAgent,DemoClinic,type Env} from "../src/patient";
import worker from "../src/index";
import {context} from "./harness";
it("uses the authenticated clinic HTTP API when the actor lacks sibling bindings",async()=>{
 const patient=context("fallback-patient"),clinic=context("fallback-patient");
 const front={SECRETS:{get:async(name:string)=>({ADMIN_TOKEN:"a".repeat(64),DEMO_RECIPIENT:"+12025550123",FROM_NUMBER:"+12025550124",CLINIC_BASE_URL:"https://example.com"}[name]||"")}} as unknown as Env;
 const c=new DemoClinic(clinic.ctx,front);front.CLINIC={idFromName:()=>c} as unknown as Env["CLINIC"];
 const actorEnv={SECRETS:front.SECRETS,TELNYX:{messages:{send:vi.fn().mockResolvedValue({data:{id:"m-1"}})}}} as unknown as Env;const a=new PatientAgent(patient.ctx,actorEnv);
 vi.stubEnv("CLINIC_BASE_URL","");vi.stubGlobal("fetch",(url:URL,init:RequestInit)=>worker.fetch(new Request(url,init),front));
 try{await patient.ready();await clinic.ready();await a.enroll({phone:"+12025550123",consent:true,appointmentAt:new Date(Date.now()+90000).toISOString(),mode:"demo",demoDurationSeconds:900});expect((await a.snapshot()).enrolled).toBe(true);expect((await c.read())?.status).toBe("booked");expect((await a.preflight()).CLINIC_READ).toBe("ok");}
 finally{vi.unstubAllGlobals();vi.unstubAllEnvs();}
});
it("enrolls via the authenticated HTTP request used by the live demo",async()=>{
 const patient=context("patient-demo-1"),clinic=context("patient-demo-1");
 const env={SECRETS:{get:async(name:string)=>({ADMIN_TOKEN:"a".repeat(64),DEMO_RECIPIENT:"+12025550123",FROM_NUMBER:"+12025550124"}[name]||"")},TELNYX:{messages:{send:vi.fn().mockResolvedValue({data:{id:"test-message"}})}}} as unknown as Env;
 const c=new DemoClinic(clinic.ctx,env);const a=new PatientAgent(patient.ctx,env);
 env.CLINIC={idFromName:()=>c} as unknown as Env["CLINIC"];env.AGENT={idFromName:()=>a} as unknown as Env["AGENT"];
 await patient.ready();await clinic.ready();
 const response=await worker.fetch(new Request("https://example.com/api/patients/patient-demo-1/enroll",{method:"POST",headers:{Authorization:"Bearer "+"a".repeat(64),"Content-Type":"application/json"},body:JSON.stringify({phone:"+12025550123",consent:true,appointmentAt:new Date(Date.now()+90000).toISOString(),mode:"demo",medicationIntervalSeconds:180,demoDurationSeconds:900})}),env);
 expect(response.status).toBe(200);const state=await response.json();expect(state.enrolled).toBe(true);expect(state.demoEndsAt).toBeGreaterThan(Date.now());expect(state.schedules).toHaveLength(4);
});
