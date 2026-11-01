import {UserError,userMessage} from './user-error.ts';
import {readdir,readFile,lstat} from 'node:fs/promises';
import path from 'node:path';
/** rclone 1.75.2 vfscache item.Info persists Dirty independently of the upload queue. */
export async function assertCleanCache(cache:string){
  const metadata=path.join(cache,'vfsMeta');let count=0;
  const validated=new Set<string>();
  async function visit(directory:string):Promise<void>{
    let entries;try{entries=await readdir(directory,{withFileTypes:true});}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return;throw error;}
    for(const entry of entries){
      if(++count>50000)throw new UserError('Cache muito grande para limpeza automática segura. Os arquivos foram preservados.');
      const target=path.join(directory,entry.name);
      if(entry.isSymbolicLink())throw new UserError('Cache com vínculo inesperado. Os arquivos foram preservados.');
      if(entry.isDirectory())await visit(target);
      else{
        const info=await lstat(target);if(info.size>512*1024)throw new UserError('Metadados de cache incompatíveis.');
        let data;try{data=JSON.parse(await readFile(target,'utf8'));}catch{throw new UserError('Não foi possível validar o cache. Os arquivos foram preservados.');}
        if(data?.Dirty!==false)throw new UserError('Há alterações locais pendentes ou de estado desconhecido. O cache foi preservado.');
        validated.add(path.relative(metadata,target));
      }
    }
  }
  await visit(metadata);
  async function checkData(directory:string):Promise<void>{
    let entries;try{entries=await readdir(directory,{withFileTypes:true});}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return;throw error;}
    for(const entry of entries){
      if(++count>100000)throw new UserError('Cache muito grande para limpeza automática segura.');
      const target=path.join(directory,entry.name);
      if(entry.isSymbolicLink())throw new UserError('Cache com vínculo inesperado.');
      if(entry.isDirectory())await checkData(target);
      else if(!validated.has(path.relative(path.join(cache,'vfs'),target)))throw new UserError('Há arquivos sem metadados verificáveis. O cache foi preservado.');
    }
  }
  await checkData(path.join(cache,'vfs'));
}
