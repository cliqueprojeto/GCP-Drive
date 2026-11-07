import type { MountState } from './contracts.ts';
import { relativePath } from './core.ts';
const number = (n:unknown) => typeof n==='number' && Number.isFinite(n) && n>=0 ? n : 0;
export type EngineCounters = {bytes:number;checks:number;transfers:number;listed:number};
/** Opening, listing, downloading and uploading all advance core/stats counters; any advance or open item is activity. */
export function engineActivity(stats:any,previous?:EngineCounters):{active:boolean;advanced:boolean;counters:EngineCounters}{
  const counters={bytes:number(stats?.bytes),checks:number(stats?.checks),transfers:number(stats?.transfers),listed:number(stats?.listed)};
  const open=(Array.isArray(stats?.transferring)&&stats.transferring.length>0)||(Array.isArray(stats?.checking)&&stats.checking.length>0);
  const advanced=previous!==undefined&&(Object.keys(counters) as (keyof EngineCounters)[]).some(key=>counters[key]>previous[key]);
  return {active:open||advanced,advanced,counters};
}
type Transfer = NonNullable<MountState['transfers']>[number];
/** Track only continuously observed work. A pause can be normal for files opened through VFS. */
export class TransferProgress {
  private samples = new Map<string,{bytes:number;since:number}>();

  observe(items:Transfer[], now = performance.now()):boolean {
    const next = new Map<string,{bytes:number;since:number}>();
    let advanced = false;
    for (const item of items) {
      if (item.phase !== 'transferring') continue;
      const previous = this.samples.get(item.path);
      if (previous && item.bytes > previous.bytes) advanced = true;
      const sample = previous?.bytes === item.bytes ? previous : {bytes:item.bytes,since:now};
      next.set(item.path,sample);
      if (now - sample.since >= 30_000) {
        item.phase = 'waiting';
        item.speed = 0;
      }
    }
    this.samples = next;
    return advanced;
  }
}
/** Own the RC projection. Counters and active items are observations, never per-file success claims. */
export function mountTelemetry(vfs: any, stats: any, queue: any,completed?:any): {transfers:Transfer[];cache:MountState['cache']} {
  const items = new Map<string,Transfer>();
  const now = Date.now();
  for(const row of Array.isArray(completed?.transferred)?completed.transferred:[]){
    if(typeof row?.name!=='string'||row.checked||row.error||row.what!=='transferring'||typeof row.completed_at!=='string')continue;
    const endedAt = Date.parse(row.completed_at);
    if(!Number.isFinite(endedAt)||endedAt>now||now-endedAt>60000)continue;
    if(!Number.isFinite(row.size)||row.size<0||!Number.isFinite(row.bytes)||row.bytes<row.size)continue;
    try{relativePath(row.name);}catch{continue;}
    items.set(row.name,{path:row.name,bytes:number(row.bytes),size:number(row.size),speed:0,phase:'complete'});
  }
  for (const row of Array.isArray(queue?.queue)?queue.queue:[]) {
    if(typeof row?.name!=='string')continue;
    try {relativePath(row.name);} catch {continue;}
    items.set(row.name,{path:row.name,bytes:0,size:number(row.size),speed:0,phase:row.uploading?'transferring':row.tries>1?'problem':'queued'});
  }
  for(const row of Array.isArray(stats?.transferring)?stats.transferring:[]) {
    if(typeof row?.name!=='string')continue;
    try {relativePath(row.name);} catch {continue;}
    items.set(row.name,{path:row.name,bytes:number(row.bytes),size:number(row.size),speed:number(row.speed),phase:'transferring'});
  }
  const disk=vfs?.diskCache;
  const rows=[...items.values()];
  return {transfers:rows.filter(item=>item.phase!=='complete').concat(rows.filter(item=>item.phase==='complete')).slice(0,200),cache:disk?{bytes:number(disk.bytesUsed),files:number(disk.files),queued:number(disk.uploadsQueued),uploading:number(disk.uploadsInProgress),errors:number(disk.erroredFiles)}:undefined};
}
