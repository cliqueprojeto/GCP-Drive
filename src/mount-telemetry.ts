import type { MountState } from './contracts.ts';
import { relativePath } from './core.ts';
const number = (n:unknown) => typeof n==='number' && Number.isFinite(n) && n>=0 ? n : 0;
/** Own the RC projection. Counters and active items are observations, never per-file success claims. */
export function mountTelemetry(vfs: any, stats: any, queue: any,completed?:any): Pick<MountState,'transfers'|'cache'> {
  const items = new Map<string,NonNullable<MountState['transfers']>[number]>();
  for(const row of Array.isArray(completed?.transferred)?completed.transferred:[]){
    if(typeof row?.name!=='string'||row.checked||row.error||row.what!=='transferring'||typeof row.timestamp!=='number'||Date.now()-row.timestamp>60000)continue;
    try{relativePath(row.name);}catch{continue;}
    items.set(row.name,{path:row.name,bytes:number(row.bytes),size:number(row.size),speed:0,phase:'complete'});
  }
  for (const row of Array.isArray(queue?.queue)?queue.queue:[]) {
    if(typeof row?.name!=='string')continue;
    try {relativePath(row.name);} catch {continue;}
    items.set(row.name,{path:row.name,bytes:0,size:number(row.size),speed:0,phase:row.tries>1?'problem':row.uploading?'transferring':'queued'});
  }
  for(const row of Array.isArray(stats?.transferring)?stats.transferring:[]) {
    if(typeof row?.name!=='string')continue;
    try {relativePath(row.name);} catch {continue;}
    items.set(row.name,{path:row.name,bytes:number(row.bytes),size:number(row.size),speed:number(row.speed),phase:'transferring'});
  }
  const disk=vfs?.diskCache;
  return {transfers:[...items.values()].slice(0,200),cache:disk?{bytes:number(disk.bytesUsed),files:number(disk.files),queued:number(disk.uploadsQueued),uploading:number(disk.uploadsInProgress),errors:number(disk.erroredFiles)}:undefined};
}
