import {UserError,userMessage} from './user-error.ts';
import {executeCommand} from './command.ts';
import path from 'node:path';
const base='HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\DriveIcons';
/** Per-user icon only. Never writes files to the cloud or changes another volume's label. */
export async function setDriveIcon(letter:string,icon:string):Promise<void>{
  if(process.platform!=='win32')return;
  if(!/^[A-Z]:$/.test(letter)||!path.isAbsolute(icon))throw new UserError('Unidade inválida.');
  const registry=path.join(process.env.SystemRoot??'C:\\Windows','System32','reg.exe');
  const key=`${base}\\${letter[0]}\\DefaultIcon`;
  const existing=await executeCommand(registry,['query',key,'/ve'],{timeout:5000}).catch(()=>undefined);
  if(existing && !existing.includes(icon))return;
  await executeCommand(registry,['add',key,'/ve','/t','REG_SZ','/d',icon,'/f'],{timeout:5000});
}
export async function removeDriveIcon(letter:string,icon:string){
  if(process.platform!=='win32'||! /^[A-Z]:$/.test(letter))return;
  const registry=path.join(process.env.SystemRoot??'C:\\Windows','System32','reg.exe'),key=`${base}\\${letter[0]}\\DefaultIcon`;
  const existing=await executeCommand(registry,['query',key,'/ve'],{timeout:5000}).catch(()=>undefined);
  if(existing?.includes(icon))await executeCommand(registry,['delete',key,'/ve','/f'],{timeout:5000});
}
