import type {Entry} from './contracts.ts';
/** Short-lived metadata reuse, bounded and coalesced. Never caches failed requests. */
export class ListingCache {
  private data=new Map<string,{at:number;entries:Entry[]}>();
  private pending=new Map<string,Promise<Entry[]>>();
  private epoch=0;
  private ttl:number;private limit:number;
  constructor(ttl=10000,limit=80){this.ttl=ttl;this.limit=limit;}
  async get(key:string,load:()=>Promise<Entry[]>):Promise<Entry[]> {
    const cached=this.data.get(key);
    if(cached && Date.now()-cached.at<this.ttl)return cached.entries;
    const inflight=this.pending.get(key);if(inflight)return inflight;
    const epoch=this.epoch;
    const job=load().then(entries=>{if(epoch===this.epoch){this.data.delete(key);if(entries.length<=10000)this.data.set(key,{at:Date.now(),entries});while(this.data.size>this.limit||[...this.data.values()].reduce((sum,value)=>sum+value.entries.length,0)>20000)this.data.delete(this.data.keys().next().value!);}return entries;});
    this.pending.set(key,job);
    try{return await job;}finally{if(this.pending.get(key)===job)this.pending.delete(key);}
  }
  clear(){this.epoch++;this.data.clear();this.pending.clear();}
}
