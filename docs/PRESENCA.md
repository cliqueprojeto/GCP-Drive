# Presença opcional entre clientes GCP-Drive — desenho autorizado

O proprietário autorizou **o desenho** de um serviço opcional de presença. Isso não autoriza implantar um serviço em produção, transmitir dados automaticamente nem reutilizar credenciais de outros produtos. Nesta versão o serviço não foi implantado e a interface continua declarando presença desconhecida.

## O que o indicador pode afirmar

Separar sessão declarada pelo usuário, abertura solicitada pelo cliente, handle observado no VFS e bloqueio reportado pelo provedor. Um horário de modificação, uma permissão de edição ou um arquivo temporário não prova presença atual. TTL expirado significa observação vencida, não prova de que ninguém está editando. Clientes Google/Microsoft/Dropbox e outros aplicativos fora do GCP-Drive podem continuar com presença desconhecida.

As APIs revisadas não estabeleceram um contrato universal de presença para esses três provedores. A [API files do Google Drive](https://developers.google.com/workspace/drive/api/reference/rest/v3/files) fornece metadados/última alteração. O [driveItem beta da Microsoft](https://learn.microsoft.com/en-us/graph/api/resources/driveitem?view=graph-rest-beta) possui informações de bloqueio em cenários específicos; isso não deve ser tratado como suporte universal ou estável. As [notificações Dropbox](https://docs.dropboxapi.com/dropbox-api/docs/detecting-changes) informam alterações. Essa conclusão é uma inferência de cobertura das interfaces examinadas, não uma afirmação sobre toda funcionalidade interna dos provedores.

## Protocolo proposto

- Serviço HTTPS separado, desligado por padrão; ativação explícita por equipe e conta. Sem enviar conteúdo, nomes ou caminhos de arquivos, senhas e tokens de acesso aos provedores.
- Autenticação própria do serviço, com audiência, emissor, escopos e expiração verificados. Não usar um ID de arquivo, e-mail, PID ou caminho como prova de autorização.
- Identidade de arquivo derivada por HMAC com chave da equipe sobre namespace do provedor, identidade estável da unidade e identidade estável do item. O mesmo nome em duas contas não identifica o mesmo objeto.
- Leases efêmeros: `POST /v1/leases`, renovação e `DELETE /v1/leases/{id}`; consulta/subscrição limitada aos recursos autorizados da equipe. TTL sugerido de 60 segundos, renovação de 15 segundos apenas enquanto houver evidência válida. Esses parâmetros ainda precisam de medição e revisão de capacidade.
- Registro mínimo: equipe, identificador pseudônimo de arquivo, identificador de sessão, tipo da observação, instante, validade e identificação de exibição consentida. Não registrar requisições com segredos em logs. Limitar participantes, assinaturas e tamanho dos eventos antes de alocar recursos.
- Eventos incluem a fonte: `declarado pelo usuário`, `abertura solicitada`, `handle VFS observado` ou `bloqueio do provedor`. O cliente mostra a fonte e a validade; nunca converte uma intenção ou ausência de eventos em edição confirmada.

## Pendências antes da integração

Definir infraestrutura e proprietário do serviço, orçamento, autenticação/equipes, política de retenção, convite/revogação, distribuição das chaves e fontes observáveis de abertura/fechamento em Windows/Linux/macOS. `shell.openPath` não entrega posse de um processo editor nem confirma que o arquivo permaneceu aberto; não renovar leases indefinidamente a partir desse retorno.

Validar autorização entre equipes, enumeração de identificadores, expiração, perda de conexão, relógio divergente, logout, troca de conta e clientes sem suporte. Testes com dois clientes reais devem demonstrar os rótulos observados e a mudança para desconhecido após perda de evidência. Não há código de envio de presença habilitado nesta versão.
