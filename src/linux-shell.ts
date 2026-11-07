import {UserError,userMessage} from './user-error.ts';
import {mkdir,readFile,writeFile,rename,copyFile,access} from 'node:fs/promises';
import path from 'node:path';
import type {MountState} from './contracts.ts';
import type {CacheScan} from './cache-state.ts';
/** Install only for file managers already present. Never installs a different desktop. */
export async function installLinuxShell(home:string,source:string){
  const data=process.env.XDG_DATA_HOME??path.join(home,'.local','share');
  const installed:string[]=[];
  for(const manager of ['nautilus','nemo']){
    try{await access('/usr/share/'+manager);}catch{continue;}
    const target=path.join(data,manager+'-python','extensions','gcp-drive.py');
    const content=await readFile(source,'utf8');
    let existing:string|undefined;try{existing=await readFile(target,'utf8');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
    if(existing===content)continue;
    if(existing&&!existing.startsWith('# GCP-Drive owned extension:'))throw new UserError('Extensão existente pertence a outro aplicativo.');
    await mkdir(path.dirname(target),{recursive:true,mode:0o700});if(existing)await copyFile(target,target+'.bak');await writeFile(target,content,{mode:0o600});
    installed.push(manager);
  }
  return installed;
}
/** Bounded so the file-manager extension can read the manifest on every refresh. */
const shellEntries=20000;
export async function writeLinuxShellState(home:string,executable:string,mounts:{state:MountState;cache?:CacheScan}[]){
  const folder=path.join(process.env.XDG_STATE_HOME??path.join(home,'.local','state'),'gcp-drive');
  await mkdir(folder,{recursive:true,mode:0o700});
  const status:Record<string,string>={};
  const cache:Record<string,string>={};let count=0;
  const complete:string[]=[];
  for(const {state:mount,cache:scan} of mounts){
    if(mount.phase!=='running')continue;
    for(const item of mount.transfers??[])status[path.join(mount.path,item.path)]=item.phase;
    if(!scan)continue;
    let truncated=false;
    for(const [key,value] of scan.states){if(count>=shellEntries){truncated=true;break;}cache[path.join(mount.path,...key.split('/'))]=value;count++;}
    if(scan.complete&&!truncated)complete.push(mount.path);
  }
  const content=JSON.stringify({timestamp:Date.now()/1000,executable,roots:mounts.filter(m=>m.state.phase==='running').map(m=>m.state.path),complete,status,cache});
  const target=path.join(folder,'shell.json');await writeFile(target+'.tmp',content,{mode:0o600});await rename(target+'.tmp',target);
}
