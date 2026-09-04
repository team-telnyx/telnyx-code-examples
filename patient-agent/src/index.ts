import { PatientAgent, DemoClinic, type Env } from "./patient";

export { PatientAgent, DemoClinic };

type Json = Record<string, unknown>;

function statusFor(e: unknown): number {
  if(!(e instanceof Error))return 500;
  if(e.message==="invalid_request")return 400;
  if(e.message==="operation_failed"||e.message.startsWith("clinic_"))return 502;
  return 500;
}
const jsonResponse=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json"}});

async function verifyTelnyxSignature(req:Request,raw:string,env:Env):Promise<boolean> {
  const sig=req.headers.get("telnyx-signature-ed25519")||"";
  const ts=req.headers.get("telnyx-signature-timestamp")||"";
  if(!sig||!ts)return false;
  const keyB64=await env.SECRETS.get("WEBHOOK_PUBLIC_KEY");
  if(!keyB64)return false;
  try {
    const keyBytes=Uint8Array.from(atob(keyB64),c=>c.charCodeAt(0));
    const msgBytes=new TextEncoder().encode(`${ts}.${raw}`);
    const sigBytes=Uint8Array.from(atob(sig),c=>c.charCodeAt(0));
    const cryptoKey=await crypto.subtle.importKey("raw",keyBytes,"Ed25519",false,["verify"]);
    return await crypto.subtle.verify("Ed25519",cryptoKey,sigBytes,msgBytes);
  } catch { return false; }
}

function normalizeTelnyxPayload(body:Json):Json {
  const data=(body.data??{}) as Json;
  const payload=(data.payload??data) as Json;
  const str=(v:unknown)=>typeof v==="string"?v:((v as Json|undefined)?.phone_number as string|undefined)??"";
  const eventType=String(data.event_type??(payload.call_control_id?"call.initiated":"message.received"));
  if(eventType.startsWith("call.")){
    return {id:String(data.id??payload.call_control_id??""),type:eventType,callId:String(payload.call_control_id??""),from:str(payload.from),to:str(payload.to),direction:String(payload.direction??"")};
  }
  return {id:String(data.id??payload.id??""),from:str(payload.from),to:str(payload.to),text:String(payload.text??"")};
}

export default {
  async fetch(req:Request,env:Env):Promise<Response> {
    const url=new URL(req.url);
    const clinicRoute=url.pathname.match(/^\/api\/clinic\/([a-z0-9-]+)$/);
    if(clinicRoute){
      const bearer=req.headers.get("Authorization")||"";
      if(bearer!=="Bearer "+await env.SECRETS.get("ADMIN_TOKEN"))return jsonResponse({error:"unauthorized"},401);
      const clinic=env.CLINIC.idFromName(clinicRoute[1]);
      if(req.method==="GET")return jsonResponse(await clinic.read()??null);
      if(req.method==="POST"){const body:Json=await req.json().catch(()=>({}));return jsonResponse(await clinic.book(body));}
      if(req.method==="PATCH"){const body:Json=await req.json().catch(()=>({}));return jsonResponse(await clinic.status(body.status));}
      return jsonResponse({error:"method_not_allowed"},405);
    }
    const route=url.pathname.match(/^\/(api|webhooks)\/patients\/([a-z0-9-]+)(?:\/(enroll|clinic-status|nurse-reply|stop|preflight))?$/);
    if(!route)return jsonResponse({error:"not_found"},404);
    const kind=route[1],patientId=route[2],action=route[3];
    const agent=env.AGENT.idFromName(patientId);

    if(kind==="webhooks"){
      if(req.method!=="POST")return jsonResponse({error:"method_not_allowed"},405);
      const raw=await req.text();
      if(!await verifyTelnyxSignature(req,raw,env))return jsonResponse({error:"invalid_signature"},401);
      let parsed:Json;try{parsed=JSON.parse(raw) as Json;}catch{return jsonResponse({error:"bad_request"},400);}
      const event=(parsed.data as Json|undefined)?.event_type;
      if(typeof event==="string"&&event.startsWith("message.")&&event!=="message.received")return jsonResponse({ok:true,ignored:event});
      const payload=normalizeTelnyxPayload(parsed);
      if(typeof payload.callId==="string"&&payload.callId)return jsonResponse(await agent.call(payload));
      return jsonResponse(await agent.receiveSMS(payload));
    }

    const bearer=req.headers.get("Authorization")||"";
    const expected=action==="nurse-reply"?"Bearer "+await env.SECRETS.get("NURSE_TOKEN"):"Bearer "+await env.SECRETS.get("ADMIN_TOKEN");
    if(!expected.slice(7)||bearer!==expected)return jsonResponse({error:"unauthorized"},401);

    try {
      if(req.method==="GET"&&!action)return jsonResponse(await agent.snapshot());
      if(req.method==="GET"&&action==="preflight")return jsonResponse(await agent.preflight());
      if(req.method==="POST"){
        const body:Json=await req.json().catch(()=>({}));
        if(action==="enroll")return jsonResponse(await agent.enroll(body));
        if(action==="stop")return jsonResponse(await agent.stop());
        if(action==="clinic-status")return jsonResponse(await agent.clinicStatus(body.status));
        if(action==="nurse-reply")return jsonResponse(await agent.nurseReply(body));
      }
      return jsonResponse({error:"not_found"},404);
    } catch(e) {
      return jsonResponse({error:e instanceof Error?e.message:"unknown"},statusFor(e));
    }
  }
};
