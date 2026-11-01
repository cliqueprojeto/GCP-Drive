# Navegação e Favoritos — 0.3.0-beta.2

## Alterações

- Contas e armazenamento tem uma página própria, acessível entre Visão geral e Meus arquivos na barra lateral, com ícone nativo de unidade.
- O painel de armazenamento aparece apenas nessa página. O avatar também abre essa página.
- Favoritos oferece Detalhes, Lista e Galeria, ordenação crescente ou decrescente por nome, conta, tipo, tamanho e modificação, busca por nome/caminho/conta e remoção direta.
- Tipo, tamanho e data utilizam os metadados observados na navegação. Favoritos antigos sem metadados mantêm campos desconhecidos, sem inventar informações ou realizar uma consulta remota para cada item.
- Pastas utilizam o ícone contextual nativo, sem consultar uma associação de unidade.

## Verificações executadas no Windows em 01/11/2026

- TypeScript: passou.
- 29 testes automatizados de fonte: passaram.
- Electron real com perfil isolado e configuração criptografada de uma pasta local: passou. Verificados ordem dos itens de navegação, isolamento do painel de armazenamento, modos Detalhes/Lista/Galeria, ordenação por tipo nos dois sentidos, busca sem resultados, remoção direta e estado vazio. O teste também verificou renomeação, desconexão e preservação dos arquivos locais.
- Capturas revisadas da galeria e dos detalhes usam somente dados fictícios do teste.
- Instalador Windows x64 gerado com sucesso. A tentativa adicional de automatizar o executável empacotado encerrou por já existir uma instância instalada; não foi considerada teste aprovado e a instância instalada não foi encerrada. O teste gráfico aprovado acima executou o código compilado via Electron com perfil isolado.

Essas verificações não constituem homologação de contas reais nem de desktops Linux/macOS.
