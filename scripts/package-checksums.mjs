import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { readdir, writeFile, readFile } from "node:fs/promises";
const files = (await readdir("release")).filter((name) =>
  /\.(exe|deb|rpm|dmg|AppImage)$/.test(name),
);
if (!files.length) throw new Error("Nenhum pacote de teste foi produzido.");
const lines = [];
for (const file of files) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream("release/" + file))
    hash.update(chunk);
  lines.push(hash.digest("hex") + "  " + file);
}
await writeFile("release/SHA256SUMS", lines.join("\n") + "\n");
const pkg = JSON.parse(await readFile("package.json", "utf8"));
await writeFile(
  "release/LEIA-ME-TESTES.txt",
  `GCP-Drive ${pkg.version}\n\nPacotes experimentais para homologacao. Compilacao e testes automatizados nao substituem testes com contas reais, drivers, aplicativos externos e gerenciadores de arquivos.\n\nWindows: o WinFsp e necessario para criar unidades no Explorer; o aplicativo inclui o instalador oficial verificado e pede sua aprovacao para abri-lo.\nLinux: use um gerenciador de pacotes que resolva as dependencias FUSE e bibliotecas. O aplicativo aparece na categoria Internet.\nmacOS: o macFUSE deve ser instalado/autorizado pelo usuario. Pacote ainda sem certificado de distribuicao/notarizacao.\n\nConfira os limites e a validacao em docs/VALIDACAO.md no repositorio do projeto.\n`,
);
console.log("Checksums dos pacotes de teste gerados.");
