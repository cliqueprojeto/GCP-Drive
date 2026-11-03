import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ListingCache} from '../src/listing-cache.ts';
import {mountTelemetry} from '../src/mount-telemetry.ts';
import {FolderSyncManager} from '../src/folder-sync.ts';
import type {FolderPlan} from '../src/contracts.ts';
import {assertCleanCache} from '../src/cache-safety.ts';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';import path from 'node:path';
import {parseFolderListing} from '../src/core.ts';
test('CLI and persistent RC listings retain the same relative path and reject unrelated entries',()=>{
  const entry={Name:'Contrato.pdf',Path:'Pasta/Contrato.pdf',IsDir:false,Size:5,ModTime:''};
  assert.equal(parseFolderListing([entry],'Pasta')[0].Path,'Contrato.pdf');
  assert.equal(parseFolderListing([{...entry,Path:'Contrato.pdf'}],'Pasta')[0].Path,'Contrato.pdf');
  assert.throws(()=>parseFolderListing([{...entry,Path:'Outra/Contrato.pdf'}],'Pasta'));
});
test('cache clearing rejects dirty, malformed and orphaned data even without queued uploads',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'gcp-cache-proof-'));
  try{
    await mkdir(path.join(root,'vfsMeta','fixture'),{recursive:true});await mkdir(path.join(root,'vfs','fixture'),{recursive:true});
    const metadata=path.join(root,'vfsMeta','fixture','file.txt');await writeFile(path.join(root,'vfs','fixture','file.txt'),'preservar');
    await assert.rejects(assertCleanCache(root),/sem metadados/);
    await writeFile(metadata,JSON.stringify({Dirty:true}));await assert.rejects(assertCleanCache(root),/pendentes/);
    await writeFile(metadata,'broken');await assert.rejects(assertCleanCache(root),/validar/);
    await writeFile(metadata,JSON.stringify({Dirty:false}));await assertCleanCache(root);
  }finally{await rm(root,{recursive:true,force:true});}
});
test('metadata navigation coalesces work, isolates accounts and refresh invalidates it',async()=>{
  let loads=0;const cache=new ListingCache();const load=async()=>{loads++;await Promise.resolve();return [];};
  await Promise.all([cache.get('a/folder',load),cache.get('a/folder',load)]);assert.equal(loads,1);
  await cache.get('a/folder',load);assert.equal(loads,1);
  await cache.get('b/folder',load);assert.equal(loads,2);
  cache.clear();await cache.get('a/folder',load);assert.equal(loads,3);
  await assert.rejects(cache.get('broken',async()=>{throw Error('unavailable');}));await cache.get('broken',load);assert.equal(loads,4);
});
test('telemetry projects real queue and transfers without claiming every file is synced',()=>{
  const value=mountTelemetry({diskCache:{bytesUsed:800,files:3,uploadsQueued:1,uploadsInProgress:1,erroredFiles:0}},{transferring:[{name:'Meu Drive/Contrato.pdf',bytes:40,size:100,speed:12},{name:'../outside',bytes:4}]},{queue:[{name:'Meu Drive/Contrato.pdf',size:100,uploading:true},{name:'Meu Drive/Nota.txt',size:90,tries:2}]});
  assert.equal(value.transfers?.length,2);assert.equal(value.transfers?.[0].bytes,40);assert.equal(value.transfers?.[1].phase,'problem');assert.equal(value.cache?.bytes,800);
  assert.deepEqual(mountTelemetry({}, {}, {}),{transfers:[],cache:undefined});
});
test('removing a sync plan waits for finalization and preserves user data and recovery state',async()=>{
  const plans:FolderPlan[]=[{id:'sync-a',accountId:'a',localPath:'local',remotePath:'remote',initialized:true,enabled:false}];
  let release!:()=>void;const gate=new Promise<void>(resolve=>release=resolve);let persisted=0;
  const manager=new FolderSyncManager('internal',{plans:()=>plans,remote:async()=> 'cloud:remote',list:async()=>[],execute:async()=>gate,persist:async()=>{persisted++;},record:()=>{}});
  await manager.start('sync-a');let removed=false;const removing=manager.remove('sync-a').then(()=>{removed=true;});
  await Promise.resolve();assert.equal(removed,false);assert.equal(plans.length,1);assert.equal(plans[0].enabled,false);
  release();await removing;assert.equal(plans.length,0);assert.equal(manager.active,false);assert.ok(persisted>=3);manager.stopTimers();
});
test("engine activity follows open items and advancing counters, not a static total", async () => {
  const {engineActivity}=await import('../src/mount-telemetry.ts');
  const first=engineActivity({bytes:10,checks:0,transfers:1,listed:5});
  assert.equal(first.active,false);
  assert.equal(engineActivity({bytes:10,checks:0,transfers:1,listed:5},first.counters).active,false);
  assert.equal(engineActivity({bytes:10,checks:0,transfers:1,listed:9},first.counters).active,true);
  assert.equal(engineActivity({bytes:10,transferring:[{name:'a'}]},first.counters).active,true);
  assert.equal(engineActivity({bytes:-4,listed:'x'}).counters.bytes,0);
});
test("cache states come from engine metadata and absence is cloud only after a complete scan", async () => {
  const {cacheItemState,scanCache,entryCacheState}=await import('../src/cache-state.ts');
  const {tmpdir}=await import('node:os');const path=await import('node:path');
  assert.equal(cacheItemState({Size:10,Rs:[{Pos:0,Size:10}],Dirty:false}),'local');
  assert.equal(cacheItemState({Size:10,Rs:[{Pos:0,Size:4},{Pos:6,Size:4}],Dirty:false}),'partial');
  assert.equal(cacheItemState({Size:10,Rs:[],Dirty:true}),'pending');
  assert.equal(cacheItemState({Size:10,Rs:[]}),'unknown');
  assert.equal(cacheItemState({Size:165,Rs:null,Dirty:false}),'cloud');
  assert.equal(cacheItemState({Size:0,Rs:null,Dirty:false}),'local');
  const root=await mkdtemp(path.join(tmpdir(),'gcp-meta-'));
  try{
    await mkdir(path.join(root,'Meu Drive'),{recursive:true});
    await writeFile(path.join(root,'Meu Drive','a.pdf'),JSON.stringify({Size:3,Rs:[{Pos:0,Size:3}],Dirty:false}));
    await writeFile(path.join(root,'Meu Drive','b.pdf'),'{broken');
    const scan=await scanCache(root);
    assert.equal(scan.states.get('Meu Drive/a.pdf'),'local');
    assert.equal(scan.states.get('Meu Drive/b.pdf'),'unknown');
    assert.equal(scan.complete,false);
    assert.equal(entryCacheState(scan,'Meu Drive/c.pdf',false,'linux'),'unknown');
    await rm(path.join(root,'Meu Drive','b.pdf'));
    const again=await scanCache(root,scan);
    assert.equal(again.complete,true);
    assert.equal(entryCacheState(again,'Meu Drive/c.pdf',false,'linux'),'cloud');
    assert.equal(entryCacheState(again,'Meu Drive/a.pdf',false,'linux'),'local');
    assert.equal(entryCacheState(again,'Meu Drive',true,'linux'),undefined);
    assert.equal(entryCacheState(again,'Meu Drive/x：y.pdf',false,'win32'),'unknown');
    assert.equal((await scanCache(root,undefined,0)).complete,false);
  }finally{await rm(root,{recursive:true,force:true});}
});
test("Linux shell manifest carries cache states and marks only fully scanned roots complete", async () => {
  const {writeLinuxShellState}=await import('../src/linux-shell.ts');
  const {tmpdir}=await import('node:os');const path=await import('node:path');const {readFile}=await import('node:fs/promises');
  const home=await mkdtemp(path.join(tmpdir(),'gcp-shell-'));const previous=process.env.XDG_STATE_HOME;process.env.XDG_STATE_HOME=path.join(home,'state');
  try{
    const mount=(p:string)=>({accountId:'a',phase:'running' as const,path:p,sync:'idle' as const});
    await writeLinuxShellState(home,'/usr/bin/gcp-drive',[{state:mount('/m1'),cache:{states:new Map([['Pasta/a.pdf','local' as const]]),complete:true,files:new Map()}},{state:mount('/m2'),cache:{states:new Map(),complete:false,files:new Map()}}]);
    const value=JSON.parse(await readFile(path.join(home,'state','gcp-drive','shell.json'),'utf8'));
    assert.equal(value.cache[path.join('/m1','Pasta','a.pdf')],'local');
    assert.deepEqual(value.complete,['/m1']);
  }finally{if(previous===undefined)delete process.env.XDG_STATE_HOME;else process.env.XDG_STATE_HOME=previous;await rm(home,{recursive:true,force:true});}
});
