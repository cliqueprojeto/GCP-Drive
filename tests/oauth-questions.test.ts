import { test } from "node:test";
import assert from "node:assert/strict";
import { localizeQuestion } from "../src/oauth-questions.ts";
import type { Question } from "../src/contracts.ts";
test("the observed shared-client question is Portuguese without changing OAuth values or state", () => {
  const raw: Question = {
    State: "same-state",
    Option: {
      Name: "config_shared_client_id",
      Help: "rclone's shared Google Drive client_id is being retired",
      Type: "bool",
      Default: false,
      Examples: [
        { Value: "true", Help: "Yes" },
        { Value: "false", Help: "No" },
      ],
    },
  };
  const q = localizeQuestion(raw, "pt-BR", "drive");
  assert.equal(q.State, raw.State);
  assert.equal(q.Title, "Credencial do Google Drive");
  assert.equal(q.Option?.Default, false);
  assert.deepEqual(q.Option?.Examples, [
    { Value: "true", Help: "Sim" },
    { Value: "false", Help: "Não" },
  ]);
  assert.ok(!q.Description?.includes("rclone's"));
  assert.equal(
    raw.Option?.Help,
    "rclone's shared Google Drive client_id is being retired",
  );
});
test("unknown provider prose is not exposed as an untranslated interface instruction", () => {
  const q = localizeQuestion(
    {
      State: "s",
      Option: {
        Name: "new_question",
        Help: "An untranslated instruction",
        Default: "",
      },
    },
    "pt-BR",
    "drive",
  );
  assert.equal(q.Title, "Concluir a conexão");
  assert.ok(!q.Description?.includes("untranslated"));
  assert.ok(!q.Title?.includes("new_question"));
});
