import {UserError,userMessage} from './user-error.ts';
import {mkdir,readFile,writeFile,rename,copyFile,access} from 'node:fs/promises';
import path from 'node:path';
import type {MountState} from './contracts.ts';
/** Install only for file managers already present. Never installs a different desktop. */
export async function installLinuxShell(home:string,source:string){
  const data=process.env.XDG_DATA_HOME??path.join(home,'.local','share');
  for(const manager of ['nautilus','nemo']){
    try{await access('/usr/share/'+manager);}catch{continue;}
    const target=path.join(data,manager+'-python','extensions','gcp-drive.py');
    const content=await readFile(source,'utf8');
    let existing:string|undefined;try{existing=await readFile(target,'utf8');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
    if(existing===content)continue;
    if(existing&&!existing.startsWith('# GCP-Drive owned extension:'))throw new UserError('Extensão existente pertence a outro aplicativo.');
    await mkdir(path.dirname(target),{recursive:true,mode:0o700});if(existing)await copyFile(target,target+'.bak');await writeFile(target,content,{mode:0o600});
  }
}
export async function writeLinuxShellState(home:string,executable:string,mounts:MountState[]){
  const folder=path.join(process.env.XDG_STATE_HOME??path.join(home,'.local','state'),'gcp-drive');
  await mkdir(folder,{recursive:true,mode:0o700});
  const status:Record<string,string>={};
  for(const mount of mounts)for(const item of mount.transfers??[])status[path.join(mount.path,item.path)]=item.phase;
  const content=JSON.stringify({timestamp:Date.now()/1000,executable,roots:mounts.filter(m=>m.phase==='running').map(m=>m.path),status});
  const target=path.join(folder,'shell.json');await writeFile(target+'.tmp',content,{mode:0o600});await rename(target+'.tmp',target);
}
