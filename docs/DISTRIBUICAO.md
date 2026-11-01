# Distribuição — 0.3.0-beta.2

Pacotes gerados a partir do commit `f07382ee3e9ff133001822a05a661e3a7e5e358f`.

- [Verificações de fonte](https://github.com/cliqueprojeto/GCP-Drive/actions/runs/41336535750): passaram em Windows, Linux e macOS.
- [Empacotamento](https://github.com/cliqueprojeto/GCP-Drive/actions/runs/41336580937): quatro jobs aprovados, incluindo tipos, 29 testes de fonte, motor real com pastas locais e sincronização bidirecional local. O job Windows também executou os testes gráficos de autorização/cancelamento e desconexão com perfil isolado; não autenticou contas cloud reais.

| Sistema | Arquivo |
|---|---|
| Windows x64 | GCP-Drive-Setup-0.3.0-beta.2-x64.exe |
| Linux x64 | GCP-Drive-0.3.0-beta.2-linux-x64.deb |
| Linux x64 | GCP-Drive-0.3.0-beta.2-linux-x64.rpm |
| Linux x64 | GCP-Drive-0.3.0-beta.2-linux-x64.AppImage |
| macOS Intel | GCP-Drive-0.3.0-beta.2-macOS-x64.dmg |
| macOS Apple Silicon | GCP-Drive-0.3.0-beta.2-macOS-arm64.dmg |

Os instaladores e o manifesto SHA256SUMS são distribuídos pela [página de versões](https://github.com/cliqueprojeto/GCP-Drive/releases/tag/v0.3.0-beta.2), fora da árvore de código.

O empacotamento não comprova montagem, instalação, desempenho cloud nem integração com o gerenciador de arquivos no computador do usuário. Linux/macOS ainda precisam de homologação gráfica real. Não há certificado de distribuição Windows nem assinatura/notarização Apple. Consulte as dependências e limitações no README antes do primeiro teste.
