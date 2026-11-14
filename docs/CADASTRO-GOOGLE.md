# Cadastro no Google para o GCP-Drive

Para entrar numa Conta do Google, o Google exige que todo aplicativo tenha um cadastro. O instalador do GCP-Drive não traz um cadastro pronto: cada pessoa cria o seu, gratuitamente, na própria Conta do Google. Leva cerca de 10 minutos e é feito uma vez só. O mesmo passo a passo está dentro do aplicativo, no painel, em **Cadastro no Google › Ver o passo a passo ilustrado**, com botões que abrem cada página.

O arquivo do cadastro fica só no seu computador. Ele identifica o seu cadastro e não deve ser publicado.

As figuras são desenhos simplificados das telas do Google; cores e posição dos botões podem variar.

## 1. Crie um projeto

Abra <https://console.cloud.google.com/projectcreate> e entre com a sua Conta do Google. No alto da página, clique em **Selecionar projeto** e em **Novo projeto**. Dê o nome **GCP-Drive** e clique em **Criar**. Espere alguns segundos e escolha o projeto criado. Não é preciso informar cartão.

![Novo projeto](../native/panel/guia/1-projeto.svg)

## 2. Ative o Google Drive nesse projeto

Abra <https://console.cloud.google.com/apis/library/drive.googleapis.com>, confira se o projeto **GCP-Drive** aparece no alto e clique em **Ativar**.

![Ativar a Google Drive API](../native/panel/guia/2-drive-api.svg)

## 3. Preencha os dados do aplicativo

Abra <https://console.cloud.google.com/auth/overview> (Plataforma de autenticação do Google) e clique em **Começar**. Em **Nome do app** escreva **GCP-Drive**, escolha o seu e-mail como suporte, em **Público-alvo** marque **Externo**, informe o seu e-mail de contato, aceite a política e clique em **Criar**.

![Dados do aplicativo](../native/panel/guia/3-autenticacao.svg)

## 4. Publique o aplicativo

No menu **Público-alvo**, clique em **Publicar app** e confirme. Sem este passo o Google desconecta a conta a cada 7 dias. Não é preciso pedir a verificação ao Google.

![Publicar app](../native/panel/guia/4-publicar.svg)

## 5. Crie o cliente e baixe o arquivo

No menu **Clientes**, clique em **Criar cliente**. Em **Tipo de aplicativo** escolha **App para computador**, dê um nome qualquer e clique em **Criar**. Na janela que aparece, clique em **Fazer o download do JSON**. O arquivo vai para a pasta Downloads, com um nome que começa com `client_secret`.

![Criar cliente e baixar o JSON](../native/panel/guia/5-cliente.svg)

## 6. Entregue o arquivo ao GCP-Drive

No painel do GCP-Drive, no quadro **Cadastro no Google**, clique em **Escolher arquivo** e selecione o arquivo baixado. Depois clique em **Adicionar conta**.

![Escolher arquivo no painel](../native/panel/guia/6-painel.svg)

## 7. No primeiro login, passe pelo aviso do Google

Ao adicionar uma conta, o Google mostra **"O Google não verificou este app"**. É esperado: o cadastro é seu e não passou pela verificação do Google, um processo pago voltado a empresas. O aviso não indica um problema no aplicativo, cujo código é aberto para quem quiser conferir. Clique em **Avançado** e em **Acessar GCP-Drive (não seguro)**, depois permita o acesso ao Drive.

![Aviso do Google](../native/panel/guia/7-aviso.svg)

Cada cadastro não verificado aceita até 100 Contas do Google.

## O que foi conferido

Os nomes das páginas e dos botões foram conferidos na documentação pública do Google em 14 de novembro de 2026 ("Configurar a tela de permissão OAuth" e "Criar credenciais de acesso"). O percurso não foi feito de ponta a ponta numa conta, e o Google muda essas telas de tempos em tempos.
