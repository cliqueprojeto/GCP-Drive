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
