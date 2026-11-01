import { test } from "node:test";
import assert from "node:assert/strict";
import { FileIndex } from "../src/index-store.ts";
const file = (name: string) => ({
  Name: name,
  Path: name,
  Size: 1,
  IsDir: false,
  ModTime: "2026-11-01T00:00:00Z",
});
test("index searches prefixes and accents without mixing accounts", () => {
  const index = new FileIndex(":memory:");
  try {
    index.replaceFolder("pessoal", "Projetos", [
      file("Prestação de contas.pdf"),
    ]);
    index.replaceFolder("trabalho", "Projetos", [
      file("Prestação de contas.pdf"),
    ]);
    const hits = index.search("prestacao cont", "pessoal");
    assert.equal(hits.length, 1);
    assert.equal(hits[0].accountId, "pessoal");
    assert.equal(hits[0].path, "Projetos/Prestação de contas.pdf");
    assert.deepEqual(index.search("prestacao", "outra-conta"), []);
    assert.deepEqual(index.search('" OR * --', "pessoal"), []);
  } finally {
    index.close();
  }
});
test("replacing a visited folder removes its deleted entries and account removal drops index rows", () => {
  const index = new FileIndex(":memory:");
  try {
    index.replaceFolder("a", "", [file("Arquivo antigo.pdf")]);
    index.replaceFolder("a", "", [file("Arquivo novo.pdf")]);
    assert.deepEqual(index.search("antigo", "a"), []);
    assert.equal(index.search("novo", "a").length, 1);
    index.removeAccount("a");
    assert.deepEqual(index.search("novo", "a"), []);
  } finally {
    index.close();
  }
});
test("a removed directory invalidates previously indexed descendants without matching similarly named folders", () => {
  const index = new FileIndex(":memory:");
  try {
    index.replaceFolder("a", "", [{ ...file("Documentos"), IsDir: true }]);
    index.replaceFolder("a", "Documentos", [file("Comprovante.pdf")]);
    index.replaceFolder("a", "Documentos extras", [file("Comprovante.pdf")]);
    index.replaceFolder("a", "", []);
    const hits = index.search("Comprovante", "a");
    assert.equal(hits.length, 1);
    assert.equal(hits[0].path, "Documentos extras/Comprovante.pdf");
  } finally {
    index.close();
  }
});
