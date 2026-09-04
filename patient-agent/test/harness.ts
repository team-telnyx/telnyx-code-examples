import type { ActorContext, ActorStorage, ListOptions } from "@telnyx/edge-runtime";
export function context(id = "demo-1") {
 const values=new Map<string,unknown>(); let alarm:number|null=null;
 const storage={
  async get<T>(key:string){return structuredClone(values.get(key)) as T|undefined;},
  async put<T>(key:string,value:T){values.set(key,structuredClone(value));},
  async delete(key:string){return values.delete(key);},
  async list<T>(opts:ListOptions={}){let rows=[...values].filter(([k])=>(!opts.prefix||k.startsWith(opts.prefix))&&(!opts.startAfter||k>opts.startAfter)&&(!opts.start||k>=opts.start)&&(!opts.end||k<opts.end)).sort(([a],[b])=>a.localeCompare(b));if(opts.reverse)rows.reverse();return new Map(rows.slice(0,opts.limit??128).map(([k,v])=>[k,structuredClone(v) as T]));},
  async transaction<T>(fn:(s:ActorStorage)=>Promise<T>){return fn(storage as unknown as ActorStorage);},
  async setAlarm(n:number){alarm=n;},async getAlarm(){return alarm;},async deleteAlarm(){alarm=null;},
  async deleteAll(){values.clear();}
 };
 const init:Promise<unknown>[]=[];
 const ctx={id,storage,blockConcurrencyWhile<T>(fn:()=>Promise<T>){const p=fn();init.push(p);return p;},setAlarm:storage.setAlarm,count:()=>0,broadcast:()=>0,sockets:()=>[]} as unknown as ActorContext;
 return {ctx,values,ready:()=>Promise.all(init)};
}
