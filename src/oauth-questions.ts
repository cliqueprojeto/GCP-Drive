import type { Language, Provider, Question } from "./contracts.ts";
const pt: Record<string, [string, string]> = {
  config_shared_client_id: [
    "Credencial do Google Drive",
      "O Google está desativando a credencial compartilhada usada nesta versão. Continuar com ela pode funcionar temporariamente, mas a versão de distribuição do GCP-Drive precisará de uma credencial própria. Deseja continuar com a credencial compartilhada?",
  ],
  config_is_local: [
    "Autorizar no navegador",
    "Abra o navegador deste computador para autorizar o acesso à sua conta. O GCP-Drive não pede sua senha.",
  ],
  config_change_team_drive: [
    "Acesso aos drives compartilhados",
    "O GCP-Drive apresenta Meu Drive e os drives compartilhados juntos. Não é necessário configurar uma conta separada para cada drive compartilhado.",
  ],
  config_team_drive: [
    "Selecione o drive compartilhado",
    "Escolha a unidade à qual deseja conceder acesso.",
  ],
  config_type: [
    "Tipo de conta Microsoft",
    "Escolha onde estão os arquivos que deseja acessar.",
  ],
  config_driveid: [
    "Selecione sua unidade",
    "Escolha a unidade que deseja conectar ao GCP-Drive.",
  ],
  config_drive_id: [
    "Selecione sua unidade",
    "Escolha a unidade que deseja conectar ao GCP-Drive.",
  ],
  config_drive_ok: [
    "Confirmar unidade",
    "Deseja conectar a unidade selecionada?",
  ],
  config_site_url: [
    "Endereço do SharePoint",
    "Informe o endereço do site do SharePoint que deseja conectar.",
  ],
  config_site: [
    "Selecione o site",
    "Escolha o site que contém os seus documentos.",
  ],
  config_token: [
    "Concluir a autorização",
    "A autorização não foi concluída automaticamente. Volte ao navegador ou cancele a conexão para tentar novamente.",
  ],
  client_id: [
    "Identificador do aplicativo Google",
    "Informe a credencial própria do aplicativo, se você a configurou.",
  ],
  client_secret: [
    "Chave do aplicativo",
    "Informe a chave da credencial do aplicativo.",
  ],
};
const knownExamples: Record<string, string> = {
  Yes: "Sim",
  No: "Não",
  "OneDrive Personal or Business": "OneDrive pessoal ou corporativo",
  "OneDrive Personal": "OneDrive pessoal",
  "OneDrive Business": "OneDrive corporativo",
  "SharePoint site": "Site do SharePoint",
  "Search a SharePoint site": "Pesquisar um site do SharePoint",
  "Type in driveID": "Informar o identificador da unidade",
  "Type in SiteID": "Informar o identificador do site",
};
export function localizeQuestion(
  question: Question,
  language: Language,
  provider: Provider,
): Question {
  if (!question.Option) return question;
  const original = question.Option;
  if (language !== "pt-BR")
    return {
      ...question,
      Title:
        original.Name === "config_is_local"
          ? language === "es"
            ? "Autorizar en el navegador"
            : "Authorize in browser"
          : language === "es"
            ? "Conectar cuenta"
            : "Connect account",
      Description: original.Help,
    };
  const copy = pt[original.Name] ?? [
    "Concluir a conexão",
    `O ${provider === "drive" ? "Google Drive" : provider === "onedrive" ? "OneDrive" : "Dropbox"} precisa de uma confirmação adicional. Escolha uma opção ou cancele para tentar novamente.`,
  ];
  return {
    ...question,
    Title: copy[0],
    Description: copy[1],
    Option: {
      ...original,
      Help: copy[1],
      Examples: original.Examples?.map((example, index) => ({
        ...example,
        Help:
          knownExamples[example.Help] ??
          (original.Type === "bool" ||
          example.Value === "true" ||
          example.Value === "false"
            ? example.Value === "true"
              ? "Sim"
              : "Não"
            : original.Name === "config_type"
              ? ({
                  onedrive: "OneDrive pessoal ou corporativo",
                  sharepoint: "Site do SharePoint",
                  url: "Endereço do SharePoint",
                  search: "Pesquisar site",
                  driveid: "Identificador da unidade",
                  siteid: "Identificador do site",
                  path: "Caminho do site",
                }[example.Value] ?? `Opção ${index + 1}`)
              : example.Help),
      })),
    },
  };
}
