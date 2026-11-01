import {UserError,userMessage} from './user-error.ts';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {randomBytes} from 'node:crypto';
import {once} from 'node:events';
import {CommandFailure} from './command.ts';
/** Credentials travel in an authenticated loopback request, never command arguments or logs. */
export async function createPrivateRemote(executable:string,config:string,env:NodeJS.ProcessEnv,name:string,type:'mega'|'protondrive',parameters:Record<string,string>,signal:AbortSignal){
  const server=createServer();server.listen(0,'127.0.0.1');await once(server,'listening');
  const address=server.address();if(!address||typeof address==='string')throw new UserError('Conexão local indisponível.');
  const port=address.port;await new Promise<void>(resolve=>server.close(()=>resolve()));
  if(signal.aborted)throw new CommandFailure('cancelled','Conexão cancelada.');
  const password=randomBytes(32).toString('hex');
  const child=spawn(executable,['rcd','--config',config,'--rc-addr',`127.0.0.1:${port}`,'--log-level','ERROR'],{windowsHide:true,shell:false,env:{...env,RCLONE_RC_USER:'gcp-auth',RCLONE_RC_PASS:password},stdio:['ignore','ignore','pipe']});
  child.stderr?.on('data',()=>{});
  let spawnError=false;child.once('error',()=>spawnError=true);
  let closed=false;const closing=new Promise<void>(resolve=>child.once('close',()=>{closed=true;resolve();}));
  const abort=()=>{if(!closed)child.kill();};signal.addEventListener('abort',abort,{once:true});
  async function call(action:string,body:unknown,timeout:number){
    const response=await fetch(`http://127.0.0.1:${port}/${action}`,{method:'POST',headers:{Authorization:'Basic '+Buffer.from('gcp-auth:'+password).toString('base64'),'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.any([signal,AbortSignal.timeout(timeout)])});
    if(!response.ok)throw new UserError('O provedor não aceitou a conexão. Verifique usuário, senha, autenticação em duas etapas e compatibilidade da conta.');
    return response.json();
  }
  try{
    let ready=false;
    for(let attempt=0;attempt<30&&!ready;attempt++){
      if(signal.aborted)throw new CommandFailure('cancelled','Conexão cancelada.');
      if(closed||spawnError)throw new UserError('Não foi possível preparar a conexão segura.');
      try{await call('core/version',{},1000);ready=true;}catch{await new Promise(resolve=>setTimeout(resolve,100));}
    }
    if(!ready)throw new UserError('A conexão local não respondeu. Tente novamente.');
    const result=await call('config/create',{name,type,parameters,opt:{nonInteractive:true,obscure:true}},120000);
    if(result?.State||result?.Error)throw new UserError('O provedor solicitou uma etapa adicional não suportada nesta versão. A conta não foi conectada.');
  }finally{
    signal.removeEventListener('abort',abort);
    if(!closed){await call('core/quit',{},1000).catch(()=>{});if(!closed)child.kill();}
    await closing;
  }
}
