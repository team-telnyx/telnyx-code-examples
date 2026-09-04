import {it,expect,vi} from 'vitest';
import {createContext,runInContext} from 'node:vm';
import {page} from '../src/ui';
class Element {
 textContent='';value='';disabled=false;hidden=false;checked=false;children:Element[]=[];
 className='';classList={toggle:vi.fn()};onclick?:()=>Promise<void>;onsubmit?:unknown;
 append(...children:Element[]){this.children.push(...children);}replaceChildren(){this.children=[];}
}
function app(){
 const els=new Map<string,Element>();for(const m of page.matchAll(/id="([^"]+)"/g))els.set(m[1],new Element());
 const fetch=vi.fn();const context=createContext({document:{getElementById:(id:string)=>els.get(id),createElement:()=>new Element()},fetch,AbortSignal,Date,console,confirm:()=>true,setInterval:vi.fn(),clearInterval:vi.fn(),location:{reload:vi.fn()}});
 runInContext(page.match(/<script>([\s\S]*?)<\/script>/i)![1],context);
 return {els,fetch,context,render:(state:unknown)=>{context.fixture=state;runInContext("state=fixture;activeId='test-patient';admin='a'.repeat(64);render()",context);}};
}
const base={enrolled:true,phone:'+12025550123',consent:true,history:[],schedules:[],demoEndsAt:Date.now()+900000};
it('renders actual no-show state, masks the phone, and does not invent pending jobs',()=>{
 const a=app();a.render({...base,appointment:{id:'appointment-1',at:new Date().toISOString(),status:'noshow'}});
 expect(a.els.get('appointmentBadge')!.textContent).toBe('Missed appointment');
 expect(a.els.get('nextAction')!.textContent).toContain('RESCHEDULE');
 expect(a.els.get('recipient')!.textContent).toBe('•••• 0123');
 expect(a.els.get('raw')!.textContent).not.toContain(base.phone);
 expect(a.els.get('jobs')!.children[0].textContent).toContain('No scheduled actions');
 expect(a.els.get('enroll')!.disabled).toBe(true);expect(a.fetch).not.toHaveBeenCalled();
});
it('renders sorted durable schedules and explains why each accepted SMS occurred',()=>{
 const a=app();a.render({...base,schedules:[{name:'_stop',due:300},{name:'_medication',due:100,everyMs:420000}],history:[{at:new Date().toISOString(),event:'SMS accepted: missed-appointment-1'}]});
 expect(a.els.get('jobs')!.children[0].children[0].textContent).toBe('Medication reminder');
 expect(a.els.get('timeline')!.children[0].children[2].textContent).toContain('no-show');
});
it('shows pending human review as text, not HTML, and requires the separate capability',()=>{
 const a=app();a.render({...base,escalation:{id:'one',status:'waiting',message:'<img src=x onerror=alert(1)>',summary:'Unverified summary'}});
 expect(a.els.get('review')!.hidden).toBe(false);expect(a.els.get('reviewBadge')!.textContent).toBe('Needs human review');
 expect(a.els.get('reviewText')!.textContent).toBe('<img src=x onerror=alert(1)>');
 expect(a.els.get('resolve')!.disabled).toBe(false);
 expect(page).toContain("nurse?el('nurse').value:admin");expect(page).toContain("!el('approval').checked");
});
it('disables nurse sends for expired or opted-out patients',()=>{
 const a=app();a.render({...base,demoEndsAt:Date.now()-1000,escalation:{id:'one',status:'waiting'}});
 expect(a.els.get('resolve')!.disabled).toBe(true);expect(a.els.get('nextAction')!.textContent).toContain('has ended');
 a.render({...base,consent:false,escalation:{id:'one',status:'waiting'}});expect(a.els.get('resolve')!.disabled).toBe(true);
});
it('permits booking only for an unenrolled loaded patient and always includes expiry',()=>{
 const a=app();a.render({enrolled:false,consent:false,history:[],schedules:[]});
 expect(a.els.get('enroll')!.disabled).toBe(false);expect(a.els.get('appointmentBadge')!.textContent).toBe('Not booked');
 expect(page).toContain("payload.demoDurationSeconds=Number(el('duration').value)");expect(page).not.toMatch(/localStorage|sessionStorage|\.innerHTML/);
});
it('keeps the last saved view and displays an error when refresh fails',async()=>{
 const a=app();a.render(base);a.fetch.mockResolvedValue(new Response('unavailable',{status:503}));
 await runInContext('refresh()',a.context);
 expect(a.els.get('connectionStatus')!.textContent).toContain('503');expect(a.els.get('recipient')!.textContent).toBe('•••• 0123');
});
it('books with explicit consent, a bounded duration, and the selected future time',async()=>{
 const a=app();a.render({enrolled:false,consent:false,history:[],schedules:[]});
 for(const [id,value] of Object.entries({phone:'+12025550123',at:'2099-01-01T10:00',mode:'demo',interval:'180',duration:'900'}))a.els.get(id)!.value=value;
 a.els.get('consent')!.checked=true;
 a.fetch.mockResolvedValue(new Response(JSON.stringify(base),{status:200,headers:{'Content-Type':'application/json'}}));
 runInContext("el('enrollForm').onsubmit({preventDefault(){}})",a.context);
 await vi.waitFor(()=>expect(a.fetch).toHaveBeenCalledTimes(2));
 const [url,options]=a.fetch.mock.calls[0];expect(url).toBe('/api/patients/test-patient/enroll');
 expect(JSON.parse(options.body)).toMatchObject({phone:'+12025550123',consent:true,mode:'demo',medicationIntervalSeconds:180,demoDurationSeconds:900});
 expect(options.headers.Authorization).toBe('Bearer '+'a'.repeat(64));
});
it('books with production timing fields and sends no demo compression fields',async()=>{
 const a=app();a.render({enrolled:false,consent:false,history:[],schedules:[]});
 for(const [id,value] of Object.entries({phone:'+12025550123',at:'2099-01-01T10:00',mode:'production',medhour:'20',tzoff:'-420'}))a.els.get(id)!.value=value;
 a.els.get('consent')!.checked=true;
 a.fetch.mockResolvedValue(new Response(JSON.stringify(base),{status:200,headers:{'Content-Type':'application/json'}}));
 runInContext("el('enrollForm').onsubmit({preventDefault(){}})",a.context);
 await vi.waitFor(()=>expect(a.fetch).toHaveBeenCalledTimes(2));
 const [url,options]=a.fetch.mock.calls[0];expect(url).toBe('/api/patients/test-patient/enroll');
 const body=JSON.parse(options.body);
 expect(body).toMatchObject({phone:'+12025550123',consent:true,mode:'production',medicationHourLocal:20,utcOffsetMinutes:-420});
 expect(body).not.toHaveProperty('medicationIntervalSeconds');expect(body).not.toHaveProperty('demoDurationSeconds');
});
it('requires human approval before a nurse send and uses the nurse token, not admin',async()=>{
 const a=app();a.render({...base,escalation:{id:'concern-1',status:'waiting'}});
 a.els.get('followup')!.value='60';a.els.get('nurse')!.value='n'.repeat(64);a.els.get('reply')!.value='A human-approved synthetic test reply.';
 runInContext("el('reviewForm').onsubmit({preventDefault(){}})",a.context);expect(a.fetch).not.toHaveBeenCalled();
 a.els.get('approval')!.checked=true;a.fetch.mockResolvedValue(new Response(JSON.stringify(base),{status:200}));
 runInContext("el('reviewForm').onsubmit({preventDefault(){}})",a.context);
 await vi.waitFor(()=>expect(a.fetch).toHaveBeenCalledTimes(2));
 const [url,options]=a.fetch.mock.calls[0];expect(url).toBe('/api/patients/test-patient/nurse-reply');expect(options.headers.Authorization).toBe('Bearer '+'n'.repeat(64));
 expect(JSON.parse(options.body)).toMatchObject({escalationId:'concern-1',followUpSeconds:60});
});
it('rejects a follow-up that would fall after the demo expires',()=>{
 const a=app();a.render({...base,escalation:{id:'one',status:'waiting'}});a.els.get('followup')!.value='604800';a.els.get('approval')!.checked=true;
 runInContext("el('reviewForm').onsubmit({preventDefault(){}})",a.context);
 expect(a.fetch).not.toHaveBeenCalled();expect(a.els.get('connectionStatus')!.textContent).toContain('after the demo expires');
});
