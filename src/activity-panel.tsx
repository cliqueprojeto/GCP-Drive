import React,{useState} from 'react';
import type {Activity,Operations,Snapshot} from './contracts.ts';
import {Activity as ActivityIcon,FileIcon,Folder,RefreshCw,X,ExternalLink} from './system-icons.tsx';
type Props={snapshot?:Snapshot;language:string;busy:boolean;invoke:<K extends keyof Operations>(operation:K,input:Operations[K]['input'])=>Promise<Operations[K]['output']>;action:(work:()=>Promise<unknown>)=>Promise<void>};
const bytes=(value:number)=>new Intl.NumberFormat('pt-BR',{maximumFractionDigits:1}).format(value>=1048576?value/1048576:value/1024)+(value>=1048576?' MB':' KB');
export function ActivityPanel({snapshot,language,busy,invoke,action}:Props){
  const [older,setOlder]=useState<Activity[]>([]),[cursor,setCursor]=useState<string>();
  const rows=[...(snapshot?.activity??[]),...older].filter((item,index,all)=>all.findIndex(other=>(other.id??other.at+other.message)===(item.id??item.at+item.message))===index);
  const next=older.length?cursor:snapshot?.activityCursor;
  return <>
    <div className="page-title"><div><span className="eyebrow">Transferências e histórico</span><h1>Atividades</h1><p>Os registros dos últimos 7 dias ficam salvos neste computador.</p></div><button className="secondary" disabled={busy} onClick={()=>void action(async()=>{await invoke('clearActivity',null);setOlder([]);setCursor(undefined);})}><X size={16}/>Limpar histórico</button></div>
    <section className="panel activity-panel">
      {snapshot?.mounts.map(m=><section className="transfer-group" key={m.accountId}>
        <h3>{snapshot.preferences.accounts.find(a=>a.id===m.accountId)?.label}<span className={'dot '+(m.sync==='problem'?'red':m.sync==='transferring'?'orange':m.sync==='idle'?'green':'gray')}/></h3>
        <p>{m.phase==='running'?(m.sync==='idle'?'Sem transferências pendentes':m.sync==='problem'?'Uma transferência requer atenção':m.sync==='unknown'?'Consultando a unidade':'Transferindo arquivos'):m.message??'Preparando unidade'}</p>
        {m.message&&m.phase==='running'&&<p className="connection-note">{m.message}</p>}
        {m.transfers?.map(item=><div className="transfer-row" key={item.path}><FileIcon iconKey={'file:.'+(item.path.split('.').at(-1)??'')}/><div><strong>{item.path.split('/').at(-1)}</strong><small>{item.path}</small><progress value={item.bytes} max={Math.max(item.size,1)}/><small>{bytes(item.bytes)} / {bytes(item.size)} · {bytes(item.speed)}/s · {item.phase==='queued'?'Aguardando envio':item.phase==='problem'?'Tentando novamente':item.phase==='complete'?'Transferência concluída':'Transferindo'}</small></div><button className="icon-button" title="Abrir pasta na unidade" onClick={()=>void action(()=>invoke('open',{accountId:m.accountId,path:item.path.split('/').slice(0,-1).join('/')}))}><Folder size={19}/></button><button className="icon-button" title="Ver na nuvem" onClick={()=>void action(()=>invoke('web',{accountId:m.accountId,path:item.path}))}><ExternalLink size={19}/></button></div>)}
      </section>)}
      <div className="history-heading"><h3>Histórico recente</h3><small>Limpeza automática após 7 dias</small></div>
      {rows.map((item,index)=><div className="activity-row" key={item.id??item.at+index}><span className={'stat-icon '+(item.level==='error'?'peach':'mint')}>{item.kind==='file'?<FileIcon iconKey={'file:.'+(item.path?.split('.').at(-1)??'')}/>:item.kind==='folder'?<Folder size={20}/>:<ActivityIcon size={19}/>}</span><div className="history-message"><strong>{item.message}</strong>{item.path&&<small>{item.path}</small>}</div><time>{new Date(item.at).toLocaleString(language,{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}</time>{item.accountId&&item.path!==undefined&&<button className="icon-button" title="Abrir pasta" onClick={()=>void action(()=>invoke('open',{accountId:item.accountId!,path:item.kind==='folder'?item.path!:item.path!.split('/').slice(0,-1).join('/')}))}><Folder size={17}/></button>}</div>)}
      {!rows.length&&<div className="empty-state"><RefreshCw size={34}/><h3>Suas próximas atividades aparecerão aqui.</h3></div>}
      {next&&<button className="secondary history-more" disabled={busy} onClick={()=>void action(async()=>{const page=await invoke('activityHistory',{before:next});setOlder(value=>[...value,...page.items]);setCursor(page.cursor);})}>Carregar atividades anteriores</button>}
    </section>
  </>;
}
