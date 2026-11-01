import {UserError,userMessage} from './user-error.ts';
import {executeCommand} from './command.ts';
import path from 'node:path';
/** Static verbs launch the isolated app; no DLL or cloud calls run inside Explorer. */
export async function windowsContext(executable:string,icon:string,letters:string[],remove=false){
  if(process.platform!=='win32')return;
  if(!path.isAbsolute(executable)||!path.isAbsolute(icon)||letters.some(l=>! /^[A-Z]:\\$/.test(l)))throw new UserError('Integração inválida.');
  const payload=Buffer.from(JSON.stringify({executable,icon,letters,remove})).toString('base64');
  const script=`$ErrorActionPreference='Stop'
$p=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}'))|ConvertFrom-Json
$cu=[Microsoft.Win32.Registry]::CurrentUser
$actions=@(@('open','Abrir com GCP-Drive'),@('web','Abrir na nuvem'),@('share','Compartilhar no provedor'),@('favorite','Fixar ou desafixar nos favoritos'),@('download','Baixar uma cópia'))
foreach($type in @('*','Directory','Drive')){
 $base='Software\\Classes\\'+$type+'\\shell\\GCPDrive'
 $old=$cu.OpenSubKey($base)
 if($old){$owner=$old.GetValue('GCPOwner');$old.Close();if($owner -ne 'br.com.gestaoculturalpro.drive'){throw 'Menu existente pertence a outro aplicativo.'}}
 if($p.remove -or $p.letters.Count -eq 0){$cu.DeleteSubKeyTree($base,$false);continue}
 $key=$cu.CreateSubKey($base)
 try{
  $key.SetValue('GCPOwner','br.com.gestaoculturalpro.drive')
  $key.SetValue('MUIVerb','GCP-Drive');$key.SetValue('Icon',$p.icon);$key.SetValue('SubCommands','')
  $paths=@($p.letters|ForEach-Object {'System.ItemPathDisplay:~<"'+$_+'"'}) -join ' OR '
  $key.SetValue('AppliesTo',$paths)
 }finally{$key.Close()}
 foreach($action in $actions){
  $key=$cu.CreateSubKey($base+'\\shell\\'+$action[0]);try{$key.SetValue('MUIVerb',$action[1]);$key.SetValue('Icon',$p.icon)}finally{$key.Close()}
  $key=$cu.CreateSubKey($base+'\\shell\\'+$action[0]+'\\command')
  try{$key.SetValue('','"'+$p.executable+'" --gcp-native-action='+$action[0]+' "--gcp-native-path=%1"')}finally{$key.Close()}
 }
}`;
  await executeCommand(path.join(process.env.SystemRoot??'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe'),['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{timeout:10000});
}
