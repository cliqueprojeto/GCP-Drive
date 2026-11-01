import {UserError,userMessage} from './user-error.ts';
import path from 'node:path';
import {executeCommand} from './command.ts';
/** Explorer namespace entries stay pinned independently of idle drive enumeration. */
export async function windowsNavigation(account:{id:string;label:string},mount:string,icon:string,remove=false){
  if(process.platform!=='win32')return;
  if(!/^gcp-[0-9a-f-]{36}$/i.test(account.id)||! /^[A-Z]:\\$/.test(mount))throw new UserError('Atalho de unidade inválido.');
  const payload=Buffer.from(JSON.stringify({id:account.id,label:'GCP-Drive · '+account.label,mount,icon,remove})).toString('base64');
  const script=`$ErrorActionPreference='Stop'
$p=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}'))|ConvertFrom-Json
$guid='{'+$p.id.Substring(4)+'}'
$cu=[Microsoft.Win32.Registry]::CurrentUser
$cls='Software\\Classes\\CLSID\\'+$guid
$ns='Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Desktop\\NameSpace\\'+$guid
$old=$cu.OpenSubKey($cls)
if($old){$owner=$old.GetValue('GCPOwner');$old.Close();if($owner -ne $p.id){throw 'Atalho existente pertence a outro aplicativo.'}}
if($p.remove){$cu.DeleteSubKeyTree($ns,$false);$cu.DeleteSubKeyTree($cls,$false)}else{
 function Put($key,$name,$value,$kind){$k=$cu.CreateSubKey($key);try{$k.SetValue($name,$value,$kind)}finally{$k.Close()}}
 $str=[Microsoft.Win32.RegistryValueKind]::String;$dw=[Microsoft.Win32.RegistryValueKind]::DWord
 Put $cls 'GCPOwner' $p.id $str
 Put $cls '' $p.label $str
 Put $cls 'System.IsPinnedToNameSpaceTree' 1 $dw
 Put $cls 'SortOrderIndex' 66 $dw
 Put ($cls+'\\DefaultIcon') '' $p.icon $str
 Put ($cls+'\\InProcServer32') '' ($env:SystemRoot+'\\System32\\shell32.dll') $str
 Put ($cls+'\\Instance') 'CLSID' '{0E5AAE11-A475-4c5b-AB00-C66DE400274E}' $str
 Put ($cls+'\\Instance\\InitPropertyBag') 'Attributes' 17 $dw
 Put ($cls+'\\Instance\\InitPropertyBag') 'TargetFolderPath' $p.mount $str
 Put ($cls+'\\ShellFolder') 'Attributes' ([int]-260046771) $dw
 Put $ns '' $p.label $str
}
Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class GCPNotify { [DllImport("shell32.dll")] public static extern void SHChangeNotify(uint e,uint f,IntPtr a,IntPtr b); }'
[GCPNotify]::SHChangeNotify(0x08000000,0,[IntPtr]::Zero,[IntPtr]::Zero)`;
  await executeCommand(path.join(process.env.SystemRoot??'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe'),['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{timeout:15000});
}
