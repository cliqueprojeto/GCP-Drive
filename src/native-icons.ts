import {UserError,userMessage} from './user-error.ts';
import { app, nativeImage } from 'electron';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { nativeIconNames } from './native-icon-names.ts';
import type { NativeIconName } from './native-icon-names.ts';
type Execute = (executable:string,args:string[])=>Promise<string>;
const linuxNames:Record<NativeIconName,string>={cloud:'folder-remote-symbolic',home:'user-home-symbolic',folder:'folder-symbolic',favorite:'non-starred-symbolic','favorite-selected':'starred-symbolic',activity:'view-refresh-symbolic',settings:'emblem-system-symbolic',search:'edit-find-symbolic',add:'list-add-symbolic',external:'window-new-symbolic',right:'go-next-symbolic',check:'emblem-ok-symbolic',shield:'security-high-symbolic',drive:'drive-harddisk-symbolic',close:'window-close-symbolic',chevron:'go-next-symbolic',world:'network-workgroup-symbolic',refresh:'view-refresh-symbolic',users:'system-users-symbolic',help:'help-about-symbolic',notifications:'preferences-system-notifications-symbolic','folder-sync':'folder-remote-symbolic',computer:'computer-symbolic','check-all':'emblem-ok-symbolic'};
const macNames:Record<NativeIconName,string>={cloud:'NSNetwork',home:'NSHomeTemplate',folder:'NSFolder',favorite:'NSBookmarksTemplate','favorite-selected':'NSMenuOnStateTemplate',activity:'NSRefreshTemplate',settings:'NSActionTemplate',search:'NSSearchTemplate',add:'NSAddTemplate',external:'NSFollowLinkFreestandingTemplate',right:'NSGoRightTemplate',check:'NSMenuOnStateTemplate',shield:'NSLockLockedTemplate',drive:'NSComputer',close:'NSStopProgressTemplate',chevron:'NSGoRightTemplate',world:'NSNetwork',refresh:'NSRefreshTemplate',users:'NSUserGroup',help:'NSInfo',notifications:'NSStatusAvailable','folder-sync':'NSRefreshTemplate',computer:'NSComputer','check-all':'NSMenuOnStateTemplate'};
/** OS lookups use local empty lookup files, never open/hydrate the user's cloud files for icons. */
export class NativeIcons {
  private root:string;private execute:Execute;
  private actions=new Map<string,Promise<string|undefined>>();
  private files=new Map<string,Promise<string>>();
  private gtkPaths?:Promise<Record<string,string>>;
  private initialize?:Promise<void>;
  constructor(root:string,execute:Execute){this.root=root;this.execute=execute;}
  private ready(){return this.initialize??=mkdir(path.join(this.root,'folder'),{recursive:true,mode:0o700}).then(()=>{});}
  key(name:string,directory:boolean){if(directory)return'folder';const ext=path.posix.extname(name);return'file:'+(process.platform==='win32'?ext.toLowerCase():ext);}
  private async gtk(){
    const code=`import sys,json\ntry:\n import gi\n gi.require_version('Gtk','3.0')\n from gi.repository import Gtk\n ok,argv=Gtk.init_check([])\n if not ok: print('{}'); sys.exit(0)\n theme=Gtk.IconTheme.get_default()\n result={}\n for name in json.loads(sys.argv[1]):\n  icon=theme.lookup_icon(name,32,Gtk.IconLookupFlags.FORCE_SYMBOLIC)\n  if icon and icon.get_filename(): result[name]=icon.get_filename()\n print(json.dumps(result))\nexcept Exception:\n print('{}')`;
    try{const result:unknown=JSON.parse(await this.execute('/usr/bin/python3',['-c',code,JSON.stringify([...new Set(Object.values(linuxNames))])]));if(result&&typeof result==='object'&&!Array.isArray(result)&&Object.values(result).every(v=>typeof v==='string'&&path.isAbsolute(v)))return result as Record<string,string>;}catch{/* Optional OS bindings unavailable: use installed stock-theme assets below. */}
    return{};
  }
  private async linuxImage(name:NativeIconName){
    const paths=await(this.gtkPaths??=this.gtk());const stock=linuxNames[name];const candidates=paths[stock]?[paths[stock]]:[];
    for(const theme of ['Adwaita','hicolor'])for(const size of ['symbolic','scalable','32x32','24x24','16x16'])for(const category of ['actions','places','devices','status','categories'])candidates.push(`/usr/share/icons/${theme}/${size}/${category}/${stock}.${size==='symbolic'||size==='scalable'?'svg':'png'}`);
    for(const candidate of candidates)try{const data=await readFile(candidate);if(data.length>128*1024)continue;if(candidate.endsWith('.svg'))return'data:image/svg+xml;base64,'+data.toString('base64');const image=nativeImage.createFromBuffer(data);if(!image.isEmpty())return image.resize({width:32,height:32}).toDataURL();}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT'&&(e as NodeJS.ErrnoException).code!=='EACCES')throw e;}
    return undefined;
  }
  async actionIcons(values:unknown):Promise<Partial<Record<NativeIconName,string>>>{
    if(!Array.isArray(values)||values.length>nativeIconNames.length||!values.every(v=>typeof v==='string'&&nativeIconNames.includes(v as NativeIconName)))throw new UserError('Solicitação de ícones inválida.');
    const output:Partial<Record<NativeIconName,string>>={};
    await Promise.all([...new Set(values as NativeIconName[])].map(async name=>{
      let pending=this.actions.get(name);if(!pending){pending=(async()=>{if(process.platform==='darwin'){const image=nativeImage.createFromNamedImage(macNames[name]);return image.isEmpty()?undefined:image.resize({width:32,height:32}).toDataURL();}if(process.platform==='linux')return this.linuxImage(name);return undefined;})();this.actions.set(name,pending);}
      const data=await pending;if(data)output[name]=data;
    }));return output;
  }
  async fileIcons(values:unknown):Promise<Record<string,string>>{
    if(!Array.isArray(values)||values.length>200||!values.every(v=>typeof v==='string'&&(v==='folder'||v.startsWith('file:'))&&v.length<=260))throw new UserError('Solicitação de ícones de arquivo inválida.');
    await this.ready();const output:Record<string,string>={};
    for(const key of [...new Set(values as string[])]){
      let pending=this.files.get(key);
      if(!pending){
        const effective=this.files.size>=256?'file:':key;
        pending=this.files.get(effective);
        if(!pending){pending=(async()=>{
          let target=path.join(this.root,'folder');
          if(effective!=='folder'){
            const extension=effective.slice(5);
            const valid=!extension||(extension.startsWith('.')&&!/[\\/\x00-\x1f<>:"|?*]/u.test(extension)&&!/[. ]$/.test(extension)&&Buffer.byteLength('lookup'+extension,'utf8')<=255);
            const filename=valid?'lookup'+extension:'lookup';target=path.join(this.root,filename);
            const existing=await readdir(this.root);if(!existing.includes(filename)&&existing.length>=257)target=path.join(this.root,'lookup');
            try{await writeFile(target,'',{flag:'wx',mode:0o600});}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;}
          }
          const image=await app.getFileIcon(target,{size:'normal'});return image.isEmpty()?'':image.resize({width:32,height:32}).toDataURL();
        })();this.files.set(effective,pending);}
      }
      output[key]=await pending;
    }return output;
  }
}
