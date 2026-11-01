import {UserError,userMessage} from './user-error.ts';
import {mkdir,open,rename,rm} from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {UPDATE_REPOSITORY} from './update-channel.ts';
export {UPDATE_REPOSITORY} from './update-channel.ts';
export type UpdateFrequency='launch'|'daily'|'weekly'|'fortnightly'|'monthly'|'never';
export type UpdateState={phase:'idle'|'checking'|'available'|'downloading'|'ready'|'error';message:string;checkedAt?:string;version?:string;releaseURL?:string;downloaded?:number;total?:number};
type Asset={id:number;name:string;size:number;url:string};
type Release={version:string;url:string;assets:Asset[]};
const frequencies:Record<UpdateFrequency,number>={launch:0,daily:86400000,weekly:604800000,fortnightly:1209600000,monthly:2592000000,never:Infinity};
export function updateDue(frequency:UpdateFrequency,last?:string,launch=false,now=Date.now()){
  if(frequency==='never'||frequency==='launch'&&!launch)return false;
  const timestamp=last?Date.parse(last):NaN;return !Number.isFinite(timestamp)||now-timestamp>=frequencies[frequency];
}
function versionParts(value:string){const match=/^v?(\d+)\.(\d+)\.(\d+)(?:-(alpha|beta|rc)\.(\d+))?$/.exec(value);return match?[Number(match[1]),Number(match[2]),Number(match[3]),match[4]?{alpha:0,beta:1,rc:2}[match[4]]!:3,Number(match[5]??0)]:undefined;}
export function newerVersion(candidate:string,current:string){const a=versionParts(candidate),b=versionParts(current);if(!a||!b)return false;for(let i=0;i<a.length;i++){if(a[i]!==b[i])return a[i]>b[i];}return false;}
export function checksumFor(manifest:string,name:string){
  const entries=manifest.split(/\r?\n/).map(line=>/^([a-f0-9]{64})\s{2}(.+)$/i.exec(line)).filter((value):value is RegExpExecArray=>!!value).filter(value=>value[2]===name);
  if(entries.length!==1)throw new UserError('O pacote não possui um checksum único publicado na versão.');return entries[0][1].toLowerCase();
}
export function parseReleases(value:unknown):Release[]{
  if(!Array.isArray(value))throw new UserError('Resposta de atualizações inválida.');
  return value.flatMap(item=>{
    if(!item||item.draft||typeof item.tag_name!=='string'||!versionParts(item.tag_name)||typeof item.html_url!=='string'||!item.html_url.startsWith('https://github.com/'+UPDATE_REPOSITORY+'/releases/')||!Array.isArray(item.assets))return[];
    const assets:Asset[]=item.assets.flatMap((asset:any)=>typeof asset?.name==='string'&&/^GCP[-_.a-zA-Z0-9 ()]*\.(exe|deb|rpm|dmg|AppImage)$/i.test(asset.name)||asset?.name==='SHA256SUMS'?[asset]:[]).map((asset:any)=>{
      if(!Number.isSafeInteger(asset.id)||asset.id<=0||!Number.isSafeInteger(asset.size)||asset.size<=0||asset.size>1024*1024*1024||typeof asset.url!=='string'||asset.url!==`https://api.github.com/repos/${UPDATE_REPOSITORY}/releases/assets/${asset.id}`)throw new UserError('Pacote de atualização incompatível.');
      return{id:asset.id,name:asset.name,size:asset.size,url:asset.url};
    });return[{version:item.tag_name.replace(/^v/,''),url:item.html_url,assets}];
  });
}
export class AppUpdates{
  private root:string;private version:string;
  private transport:typeof fetch;private owner?:Promise<void>;private controller?:AbortController;
  private release?:Release;private verified?:string;
  state:UpdateState={phase:'idle',message:'Verifique as atualizações do GCP-Drive.'};
  constructor(root:string,version:string,transport:typeof fetch=fetch){this.root=root;this.version=version;this.transport=transport;}
  private async request(url:string,binary:boolean,signal:AbortSignal){
    const response=await this.transport(url,{headers:{Accept:binary?'application/octet-stream':'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'},signal:AbortSignal.any([signal,AbortSignal.timeout(binary?300000:30000)])});
    if(!response.ok)throw new UserError('O canal público de atualizações não está disponível agora. Tente novamente mais tarde.');
    return response;
  }
  private async work(task:(signal:AbortSignal)=>Promise<void>){
    if(this.owner)throw new UserError('Uma operação de atualização já está em andamento.');
    const controller=new AbortController();this.controller=controller;
    const job=(async()=>{try{await task(controller.signal);}catch(error){this.state={...this.state,phase:controller.signal.aborted?'idle':'error',message:controller.signal.aborted?'Atualização cancelada.':userMessage(error)};if(!controller.signal.aborted)throw error;}})();
    this.owner=job;try{await job;}finally{if(this.owner===job){this.owner=undefined;this.controller=undefined;}}
  }
  async check(){return this.work(async signal=>{
    this.state={phase:'checking',message:'Consultando as versões do projeto no GitHub...'};
    const response=await this.request(`https://api.github.com/repos/${UPDATE_REPOSITORY}/releases?per_page=20`,false,signal);
    const releases=parseReleases(await response.json());
    this.release=releases.filter(r=>newerVersion(r.version,this.version)).sort((a,b)=>newerVersion(a.version,b.version)?-1:newerVersion(b.version,a.version)?1:0)[0];
    this.verified=undefined;
    this.state={phase:this.release?'available':'idle',message:this.release?'Uma nova versão está disponível.':'Você está usando a versão mais recente disponível neste canal.',version:this.release?.version,releaseURL:this.release?.url,checkedAt:new Date().toISOString()};
  });}
  async download(platform:string,arch:string,format?:string){return this.work(async signal=>{
    if(!this.release)throw new UserError('Verifique as atualizações antes de baixar.');
    const extension=platform==='win32'?'.exe':platform==='darwin'?'.dmg':format==='rpm'?'.rpm':format==='appimage'?'.AppImage':'.deb';
    const candidates=this.release.assets.filter(a=>a.name.endsWith(extension)&&!a.name.includes('__uninstaller')&&(platform==='linux'?(arch==='x64'?/x64|amd64|x86_64/.test(a.name):arch==='arm64'?/arm64|aarch64/.test(a.name):false):(arch==='arm64'?a.name.includes('arm64'):arch==='x64'&&!a.name.includes('arm64'))));
    if(candidates.length!==1)throw new UserError('Não há um pacote único compatível com este sistema na versão publicada.');
    const asset=candidates[0],manifest=this.release.assets.find(a=>a.name==='SHA256SUMS');
    if(!manifest||manifest.size>128*1024)throw new UserError('A versão não possui manifesto de integridade.');
    const checksum=checksumFor(await(await this.request(manifest.url,true,signal)).text(),asset.name);
    this.state={...this.state,phase:'downloading',message:'Baixando e verificando a atualização...',downloaded:0,total:asset.size};
    await mkdir(this.root,{recursive:true,mode:0o700});const partial=path.join(this.root,randomUUID()+'.partial'),target=path.join(this.root,asset.name);
    const handle=await open(partial,'wx',0o600);let bytes=0;const hash=createHash('sha256');
    try{
      const response=await this.request(asset.url,true,signal);if(!response.body)throw new UserError('O GitHub não retornou o pacote.');
      for await(const chunk of response.body){bytes+=chunk.length;if(bytes>asset.size)throw new UserError('O tamanho do pacote excedeu o manifesto.');hash.update(chunk);await handle.writeFile(chunk);this.state={...this.state,downloaded:bytes};}
      await handle.close();
      if(bytes!==asset.size||hash.digest('hex')!==checksum)throw new UserError('A integridade do pacote não foi confirmada. A atualização foi descartada.');
      await rename(partial,target);this.verified=target;this.state={...this.state,phase:'ready',message:'Pacote verificado. Pronto para instalar.'};
    }catch(error){await handle.close().catch(()=>{});await rm(partial,{force:true});throw error;}
  });}
  get verifiedPackage(){if(this.state.phase!=='ready'||!this.verified)throw new UserError('Nenhuma atualização verificada está pronta.');return this.verified;}
  async cancel(){this.controller?.abort();await this.owner?.catch(()=>{});}
}
