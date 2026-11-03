import {readdir,readFile,stat} from 'node:fs/promises';
import path from 'node:path';
import type {CacheState} from './contracts.ts';
/** rclone 1.75.2 vfscache item.Info: Rs lists byte ranges present on disk; Dirty marks a local change not yet uploaded. */
export function cacheItemState(value:unknown):CacheState{
  if(!value||typeof value!=='object')return 'unknown';
  const info=value as Record<string,unknown>;
  if(info.Dirty===true)return 'pending';
  // rclone writes "Rs": null when no byte of the item is on disk.
  const ranges=info.Rs===null?[]:info.Rs;
  if(info.Dirty!==false||typeof info.Size!=='number'||!Array.isArray(ranges))return 'unknown';
  let covered=0;
  for(const range of ranges){
    if(!range||typeof range!=='object'||typeof range.Pos!=='number'||typeof range.Size!=='number')return 'unknown';
    if(range.Pos!==covered)break;
    covered+=range.Size;
  }
  return covered>=info.Size?'local':covered>0?'partial':'cloud';
}
export type CacheScan={states:Map<string,CacheState>;complete:boolean;files:Map<string,{mtimeMs:number;size:number;state:CacheState}>};
/** Walks one mount's metadata; unchanged files reuse the previous parse. Keys are '/'-separated OS-encoded paths. */
export async function scanCache(metaRoot:string,previous?:CacheScan,limit=20000):Promise<CacheScan>{
  const files:CacheScan['files']=new Map();const states=new Map<string,CacheState>();let complete=true;
  async function visit(directory:string,prefix:string):Promise<void>{
    let entries;try{entries=await readdir(directory,{withFileTypes:true});}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return;complete=false;return;}
    for(const entry of entries){
      if(files.size>=limit){complete=false;return;}
      const key=prefix?prefix+'/'+entry.name:entry.name,target=path.join(directory,entry.name);
      if(entry.isDirectory()){await visit(target,key);continue;}
      if(!entry.isFile()){complete=false;continue;}
      try{
        const info=await stat(target);const known=previous?.files.get(key);
        const state=known&&known.mtimeMs===info.mtimeMs&&known.size===info.size?known.state:info.size>512*1024?'unknown':cacheItemState(JSON.parse(await readFile(target,'utf8')));
        files.set(key,{mtimeMs:info.mtimeMs,size:info.size,state});states.set(key,state);
      }catch{states.set(key,'unknown');complete=false;}
    }
  }
  await visit(metaRoot,'');
  return {states,complete,files};
}
/** Windows mounts encode reserved characters, so those names cannot be matched against metadata keys. */
const encodedOnWindows=/[<>:"|?*\\＀-￯]|[ .]$/u;
/** A file absent from a complete scan is only in the cloud; folders carry no aggregated claim. */
export function entryCacheState(scan:CacheScan|undefined,remote:string,isDir:boolean,platform:NodeJS.Platform=process.platform):CacheState|undefined{
  if(isDir)return undefined;
  if(!scan||(platform==='win32'&&remote.split('/').some(part=>encodedOnWindows.test(part))))return 'unknown';
  return scan.states.get(remote)??(scan.complete?'cloud':'unknown');
}
