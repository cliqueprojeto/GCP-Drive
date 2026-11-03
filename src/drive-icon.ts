import {UserError,userMessage} from './user-error.ts';
import {executeCommand} from './command.ts';
import path from 'node:path';
const base='HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\DriveIcons';
/** Explorer records network volumes as \\server\<volume>; its per-user label replaces the "(\\server)" suffix. */
const labelKey=(volume:string)=>`HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\MountPoints2\\##server#${volume}`;
const registry=()=>path.join(process.env.SystemRoot??'C:\\Windows','System32','reg.exe');
const invalidVolume=(volume:string)=>!volume||/[\\\x00-\x1f]/.test(volume);
/** Per-user icon and label only. Never writes files to the cloud or changes another volume's label. */
export async function setDriveIcon(letter:string,icon:string,volume?:string):Promise<void>{
  if(process.platform!=='win32')return;
  if(!/^[A-Z]:$/.test(letter)||!path.isAbsolute(icon)||(volume!==undefined&&invalidVolume(volume)))throw new UserError('Unidade inválida.');
  const key=`${base}\\${letter[0]}\\DefaultIcon`;
  const existing=await executeCommand(registry(),['query',key,'/ve'],{timeout:5000}).catch(()=>undefined);
  if(!existing||existing.includes(icon))await executeCommand(registry(),['add',key,'/ve','/t','REG_SZ','/d',icon,'/f'],{timeout:5000});
  if(volume===undefined)return;
  const label=await executeCommand(registry(),['query',labelKey(volume),'/v','_LabelFromReg'],{timeout:5000}).catch(()=>undefined);
  if(!label)await executeCommand(registry(),['add',labelKey(volume),'/v','_LabelFromReg','/t','REG_SZ','/d',volume,'/f'],{timeout:5000});
}
export async function removeDriveIcon(letter:string,icon:string){
  if(process.platform!=='win32'||! /^[A-Z]:$/.test(letter))return;
  const key=`${base}\\${letter[0]}\\DefaultIcon`;
  const existing=await executeCommand(registry(),['query',key,'/ve'],{timeout:5000}).catch(()=>undefined);
  if(existing?.includes(icon))await executeCommand(registry(),['delete',key,'/ve','/f'],{timeout:5000});
}
