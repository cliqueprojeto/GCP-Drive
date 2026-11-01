# Componentes de terceiros

O aplicativo usa rclone (MIT), Electron (MIT e licenças dos componentes Chromium/Node.js), React (MIT) e SQLite (domínio público). O QR Code é gerado no desenvolvimento com node-qrcode (MIT). As dependências e versões estão no package-lock.json. Preserve as licenças incluídas nos pacotes e instaladores. Os símbolos de provedores identificam as integrações; suas marcas pertencem aos respectivos titulares. Os ícones de ações e associações de arquivos são consultados no próprio sistema.

## rclone

O instalador Windows inclui o instalador oficial **WinFsp 2.1.25156**, assinado por NAVIMATICS LLC. O assistente explica a instalação do componente e solicita consentimento; o Windows confirma a elevação de privilégios. Um componente já instalado é reutilizado. O driver compartilhado não é removido na desinstalação do GCP-Drive. A licença acompanha o instalador original; código-fonte, licença e versões: https://github.com/winfsp/winfsp e https://winfsp.dev/. SHA-256 da versão de MSI validada: `073a70e00f77423e34bed98b86e600def93393ba5822204fac57a29324db9f7a`.

Fonte: https://github.com/rclone/rclone · https://rclone.org/licence/

The MIT License (MIT)

Copyright (C) 2012 by Nick Craig-Wood https://www.craig-wood.com/nick/

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
