import {test} from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';import {createHash} from 'node:crypto';
import {AppUpdates,UPDATE_REPOSITORY,checksumFor,newerVersion,parseReleases,updateDue} from '../src/updates.ts';
import {builtinThemes,parseTheme} from '../src/themes.ts';
test('updates compare supported release versions and respect the selected schedule',()=>{
  assert.equal(newerVersion('v0.3.0-beta.10','0.3.0-beta.2'),true);assert.equal(newerVersion('0.3.0','0.3.0-rc.1'),true);assert.equal(newerVersion('0.3.0-beta.9','0.3.0'),false);assert.equal(newerVersion('unsafe','0.3.0'),false);
  assert.equal(updateDue('never',undefined,true),false);assert.equal(updateDue('launch',undefined,false),false);assert.equal(updateDue('launch',undefined,true),true);
  assert.equal(updateDue('weekly','2026-11-01T00:00:00Z',false,Date.parse('2026-11-02T00:00:00Z')),false);
  assert.equal(updateDue('daily','2026-11-01T00:00:00Z',false,Date.parse('2026-11-03T00:00:00Z')),true);
});
test('theme imports accept only color data and reject script, CSS and URL injection',()=>{
  const {name,mode,colors}=builtinThemes[0];assert.equal(parseTheme({name,mode,colors},'installed').id,'installed');
  assert.throws(()=>parseTheme({name,mode,colors,script:'execute'},'bad'));
  assert.throws(()=>parseTheme({name,mode,colors:{...colors,accent:'url(https://other.invalid)'}},'bad'));
  assert.throws(()=>parseTheme({name,mode,colors:{...colors,extra:'#ffffff'}},'bad'));
});
test('only project-owned release assets with one exact checksum can become installable',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'gcp-update-proof-'));const bytes=Buffer.from('installer fixture; never executed');
  const filename='GCP-Drive Setup 0.3.1-beta.1.exe',hash=createHash('sha256').update(bytes).digest('hex');
  const api=`https://api.github.com/repos/${UPDATE_REPOSITORY}`;
  const release={tag_name:'v0.3.1-beta.1',draft:false,html_url:`https://github.com/${UPDATE_REPOSITORY}/releases/tag/v0.3.1-beta.1`,assets:[{id:1,name:filename,size:bytes.length,url:api+'/releases/assets/1'},{id:2,name:'SHA256SUMS',size:hash.length+filename.length+3,url:api+'/releases/assets/2'}]};
  const foreign=structuredClone(release);foreign.assets[0].url='https://other.invalid/package';assert.throws(()=>parseReleases([foreign]));
  assert.throws(()=>checksumFor(`${hash}  ${filename}\n${hash}  ${filename}`,filename));
  let wrong=false;
  const transport:typeof fetch=async(url,options)=>{assert.equal((options?.headers as Record<string,string>).Authorization,undefined);if(String(url).endsWith('releases?per_page=20'))return new Response(JSON.stringify([release]));if(String(url).endsWith('/2'))return new Response(`${wrong?'0'.repeat(64):hash}  ${filename}\n`);return new Response(bytes);};
  try{
    const client=new AppUpdates(root,'0.3.0-beta.1',transport);await client.check();assert.equal(client.state.phase,'available');
    wrong=true;await assert.rejects(client.download('win32','x64'),/integridade/);assert.equal(client.state.phase,'error');assert.equal((await readdir(root)).length,0);assert.throws(()=>client.verifiedPackage);
    wrong=false;await client.check();await client.download('win32','x64');assert.equal(client.state.phase,'ready');assert.deepEqual(await readFile(client.verifiedPackage),bytes);
    const unavailable=new AppUpdates(root,'0.3.0',async()=>new Response('',{status:404}));await assert.rejects(unavailable.check(),/canal público/);
  }finally{await rm(root,{recursive:true,force:true});}
});
