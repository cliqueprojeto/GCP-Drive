import React,{useState} from 'react';
import {Folder,Users,ShieldCheck,Check,Globe} from './system-icons.tsx';
import {providers} from './providers.ts';
import type {Provider} from './contracts.ts';
type Props={provider:Provider;label:string;onLabel:(value:string)=>void;accountLabel:string;placeholder:string;user:string;password:string;otp:string;mailbox:string;onUser:(value:string)=>void;onPassword:(value:string)=>void;onOtp:(value:string)=>void;onMailbox:(value:string)=>void};
export function ConnectionFields(props:Props){
  const [showPassword,setShowPassword]=useState(false),[showMailbox,setShowMailbox]=useState(false);
  return <div className="connection-fields">
    <div className="connection-field"><label htmlFor="account-label">{props.accountLabel}</label><div className="field-control"><Folder size={19}/><input id="account-label" autoFocus maxLength={80} value={props.label} onChange={e=>props.onLabel(e.target.value)} placeholder={props.placeholder}/></div><small>Um nome para reconhecer esta conta no computador.</small></div>
    {!providers[props.provider].oauth&&<fieldset className="credential-fields"><legend><ShieldCheck size={17}/> Acesso protegido</legend>
      <p className="credential-note">Suas credenciais ficam protegidas no cofre deste computador.</p>
      {props.provider==='protondrive'&&<details className="provider-compatibility"><summary>Proton Drive · integração em testes</summary><p>Algumas contas e desafios adicionais de autenticação ainda podem ser incompatíveis.</p></details>}
      <div className="connection-field"><label htmlFor="provider-user">Usuário ou e-mail</label><div className="field-control"><Users size={19}/><input id="provider-user" autoComplete="username" placeholder="seu@email.com" value={props.user} onChange={e=>props.onUser(e.target.value)}/></div></div>
      <div className="connection-field"><label htmlFor="provider-password">Senha</label><div className="field-control"><ShieldCheck size={19}/><input id="provider-password" type={showPassword?'text':'password'} autoComplete="current-password" placeholder="Sua senha de acesso" value={props.password} onChange={e=>props.onPassword(e.target.value)}/><button type="button" aria-label={showPassword?'Ocultar senha':'Mostrar senha'} onClick={()=>setShowPassword(v=>!v)}>{showPassword?'Ocultar':'Mostrar'}</button></div></div>
      <div className="connection-field"><label htmlFor="provider-otp">Código de duas etapas <small>Opcional</small></label><div className="field-control"><Check size={19}/><input id="provider-otp" inputMode="numeric" maxLength={10} autoComplete="one-time-code" placeholder="Código do seu autenticador" value={props.otp} onChange={e=>props.onOtp(e.target.value)}/></div></div>
      {props.provider==='protondrive'&&<div className="connection-field"><label htmlFor="provider-mailbox">Senha adicional da caixa postal <small>Se configurada</small></label><div className="field-control"><Globe size={19}/><input id="provider-mailbox" type={showMailbox?'text':'password'} autoComplete="off" placeholder="Apenas se você usa duas senhas no Proton" value={props.mailbox} onChange={e=>props.onMailbox(e.target.value)}/><button type="button" aria-label={showMailbox?'Ocultar senha adicional':'Mostrar senha adicional'} onClick={()=>setShowMailbox(v=>!v)}>{showMailbox?'Ocultar':'Mostrar'}</button></div></div>}
    </fieldset>}
  </div>;
}
