import {mkdtemp,mkdir,writeFile,readFile,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';import path from 'node:path';import {spawn} from 'node:child_process';import {createServer} from 'node:net';import {randomBytes} from 'node:crypto';import {once} from 'node:events';import assert from 'node:assert/strict';
import {mountArgs} from '../src/core.ts';import {chooseDriveLetter,logicalDrives,pendingWrites} from '../src/mount-platform.ts';
if(process.platform!=='win32')throw Error('Este ensaio requer o driver Windows instalado.');
const root=await mkdtemp(path.join(tmpdir(),'gcp-mounted-'));const source=path.join(root,'source');await mkdir(source);await mkdir(path.join(source,'Documentos'));
for(let i=0;i<200;i++)await writeFile(path.join(source,'Documentos',`Documento ${i}.txt`),'conteúdo de teste '+i);
await writeFile(path.join(source,'Arquivo grande.bin'),Buffer.alloc(4*1024*1024,7));
const server=createServer();server.listen(0,'127.0.0.1');await once(server,'listening');const port=server.address().port;await new Promise(r=>server.close(r));
const letter=chooseDriveLetter(await logicalDrives(),'V:');const key=randomBytes(32).toString('hex');const config=path.join(root,'fixture.conf');await writeFile(config,'');
const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>!k.toUpperCase().startsWith('RCLONE_')));
const child=spawn(path.resolve('vendor/win32-x64/rclone.exe'),[...mountArgs({id:'fixture',label:'Ensaio GCP-Drive',provider:'dropbox',autoMount:false},letter,path.join(root,'cache'),source),'--config',config,'--rc','--rc-addr',`127.0.0.1:${port}`],{windowsHide:true,env:{...env,RCLONE_RC_USER:'fixture',RCLONE_RC_PASS:key},stdio:['ignore','ignore','pipe']});
let error='';child.stderr.on('data',v=>error=(error+v).slice(-2000));
const closed=once(child,'close');let exited=false;child.once('close',()=>exited=true);
async function rc(action,body={}){const result=await fetch(`http://127.0.0.1:${port}/${action}`,{method:'POST',headers:{Authorization:'Basic '+Buffer.from('fixture:'+key).toString('base64'),'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(5000)});if(!result.ok)throw Error(await result.text());return result.json();}
async function until(check){const deadline=Date.now()+20000;while(Date.now()<deadline){if(exited)throw Error('Mount exited: '+error);try{if(await check())return;}catch{}await new Promise(r=>setTimeout(r,150));}throw Error('Mount deadline: '+error);}
const timings={};async function timed(name,work){const start=performance.now();const result=await work();timings[name]=Math.round((performance.now()-start)*100)/100;return result;}
try{
  await until(async()=>!!(await rc('vfs/stats')));
  const files=await timed('coldDirectoryMs',()=>readdir(letter+'\\Documentos'));assert.equal(files.length,200);
  await timed('warmDirectoryMs',()=>readdir(letter+'\\Documentos'));
  assert.equal((await timed('coldFileMs',()=>readFile(letter+'\\Arquivo grande.bin'))).length,4*1024*1024);
  assert.equal((await timed('warmFileMs',()=>readFile(letter+'\\Arquivo grande.bin'))).length,4*1024*1024);
  await writeFile(letter+'\\Documentos\\Novo arquivo.txt','edição feita pela unidade');
  await until(async()=>!pendingWrites(await rc('vfs/stats')));
  assert.equal(await readFile(path.join(source,'Documentos','Novo arquivo.txt'),'utf8'),'edição feita pela unidade');
  await writeFile(path.join(source,'Documentos','Arquivo externo.txt'),'externo');await rc('vfs/refresh',{dir:'Documentos'});
  assert.ok((await readdir(letter+'\\Documentos')).includes('Arquivo externo.txt'));
  const report={passed:true,scope:'Unidade real WinFsp com origem local; não mede rede, nuvem nem interface do Explorer',directoryFiles:200,fileBytes:4194304,timings,platform:process.platform};
  await mkdir('.local',{recursive:true});await writeFile('.local/mount-benchmark.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{
  if(!exited){await rc('core/quit').catch(()=>{});await Promise.race([closed,new Promise(r=>setTimeout(r,10000))]);if(!exited)child.kill();}
  await closed;
}
