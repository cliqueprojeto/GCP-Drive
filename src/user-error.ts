/** Only intentional product messages cross the process boundary verbatim. */
export class UserError extends Error {
  constructor(message:string,options?:ErrorOptions){super(message,options);this.name='UserError';}
}
export function userMessage(error:unknown):string{
  if(error instanceof UserError)return error.message;
  if(error instanceof SyntaxError)return 'O conteúdo recebido está em um formato inválido. Confira o arquivo ou a configuração e tente novamente.';
  if(error&&typeof error==='object'){
    const value=error as {name?:string;code?:string|number};
    if(value.name==='TimeoutError'||value.code==='ETIMEDOUT'||value.code==='UND_ERR_CONNECT_TIMEOUT')return 'A conexão demorou mais do que o esperado. Verifique a internet e tente novamente. Você pode cancelar e reiniciar a autorização.';
    if(value.name==='AbortError'||value.code==='ABORT_ERR')return 'A operação foi cancelada. Você pode tentar novamente.';
    if(value.code==='ENOENT')return 'O arquivo ou componente necessário não foi encontrado. Verifique a instalação e tente novamente.';
    if(value.code==='EACCES'||value.code==='EPERM')return 'O sistema não permitiu esta operação. Confira as permissões do arquivo ou da pasta.';
    if(value.code==='ENOSPC')return 'O disco está sem espaço. Libere espaço para continuar.';
    if(value.code==='ENOTEMPTY')return 'A pasta contém arquivos. Escolha uma pasta vazia para continuar.';
    if(['ECONNRESET','ECONNREFUSED','ENOTFOUND','EAI_AGAIN'].includes(String(value.code)))return 'A conexão foi interrompida ou o serviço não respondeu. Verifique a internet e tente novamente.';
  }
  return 'Não foi possível concluir esta operação. Tente novamente. Se o problema continuar, consulte as notificações do aplicativo.';
}
