import {UserError,userMessage} from './user-error.ts';
import path from 'node:path';
import {executeCommand} from './command.ts';
/** Removes the navigation-pane shortcut earlier betas created; the drive letter alone represents the volume. */
export async function removeWindowsNavigation(account:{id:string}){
  if(process.platform!=='win32')return;
  if(!/^gcp-[0-9a-f-]{36}$/i.test(account.id))throw new UserError('Atalho de unidade inválido.');
  const script=`$ErrorActionPreference='Stop'
$id='${account.id}'
$guid='{'+$id.Substring(4)+'}'
$cu=[Microsoft.Win32.Registry]::CurrentUser
$cls='Software\\Classes\\CLSID\\'+$guid
$ns='Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Desktop\\NameSpace\\'+$guid
$old=$cu.OpenSubKey($cls)
if(-not $old){exit 0}
$owner=$old.GetValue('GCPOwner');$old.Close()
if($owner -ne $id){exit 0}
$cu.DeleteSubKeyTree($ns,$false);$cu.DeleteSubKeyTree($cls,$false)
Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class GCPNotify { [DllImport("shell32.dll")] public static extern void SHChangeNotify(uint e,uint f,IntPtr a,IntPtr b); }'
[GCPNotify]::SHChangeNotify(0x08000000,0,[IntPtr]::Zero,[IntPtr]::Zero)`;
  await executeCommand(path.join(process.env.SystemRoot??'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe'),['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{timeout:15000});
}
