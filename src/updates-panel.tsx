import React from 'react';
import type {Operations,Snapshot} from './contracts.ts';
import {UPDATE_REPOSITORY} from './update-channel.ts';
import {RefreshCw} from './system-icons.tsx';
type Props={snapshot?:Snapshot;busy:boolean;language:string;invoke:<K extends keyof Operations>(operation:K,input:Operations[K]['input'])=>Promise<Operations[K]['output']>;action:(work:()=>Promise<unknown>)=>Promise<void>};
export function UpdatesPanel({snapshot,busy,language,invoke,action}:Props){
  const state=snapshot?.updates;
  return <section className="updates-settings">
    <h3>Atualizações</h3>
    <p>Versão instalada: {snapshot?.version}. As novas versões vêm do GitHub ({UPDATE_REPOSITORY}).</p>
    <p>{state?.message}{snapshot?.preferences.lastUpdateCheck?' · Última verificação: '+new Date(snapshot.preferences.lastUpdateCheck).toLocaleString(language):''}</p>
    <label>Verificar atualizações automaticamente <select aria-label="Periodicidade de atualizações" value={snapshot?.preferences.updateFrequency??'launch'} onChange={event=>void action(()=>invoke('updateSettings',{frequency:event.target.value as NonNullable<Snapshot['preferences']['updateFrequency']>}))}>
      <option value="daily">Todos os dias</option><option value="weekly">A cada semana</option><option value="fortnightly">A cada duas semanas</option><option value="monthly">A cada mês</option><option value="launch">Sempre que abrir o programa</option><option value="never">Nunca</option>
    </select></label>
    <div className="update-actions">
      <button className="secondary" disabled={busy} onClick={()=>void action(()=>invoke('checkUpdates',null))}><RefreshCw size={16}/>Verificar agora</button>
      {state?.phase==='available'&&<>
        <button className="primary" disabled={busy} onClick={()=>void action(()=>invoke('downloadUpdate',{format:'deb'}))}>Baixar {state.version}{snapshot?.platform==='linux'?' (.deb)':''}</button>
        {snapshot?.platform==='linux'&&<>
          <button className="secondary" disabled={busy} onClick={()=>void action(()=>invoke('downloadUpdate',{format:'rpm'}))}>Baixar .rpm</button>
          <button className="secondary" disabled={busy} onClick={()=>void action(()=>invoke('downloadUpdate',{format:'appimage'}))}>Baixar AppImage</button>
        </>}
      </>}
      {state?.phase==='downloading'&&<><progress value={state.downloaded??0} max={state.total??1}/><span>{Math.round((state.downloaded??0)/1048576)} / {Math.round((state.total??0)/1048576)} MB</span></>}
      {(state?.phase==='checking'||state?.phase==='downloading')&&<button className="secondary" onClick={()=>void action(()=>invoke('cancelUpdate',null))}>Cancelar atualização</button>}
      {state?.phase==='ready'&&<button className="primary" disabled={busy} onClick={()=>void action(()=>invoke('installUpdate',null))}>Instalar atualização verificada</button>}
    </div>
    <p>Canal público de atualizações: nenhum login ou chave do GitHub é necessário.</p>
  </section>;
}
