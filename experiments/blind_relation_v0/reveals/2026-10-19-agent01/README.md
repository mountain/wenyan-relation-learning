# Blind reveal and score: 2026-10-19-agent01

Stage: `Scored`.

The prediction bytes were first locked on main at
`a75492d914d09524d8e8220ac80e196d8ad73ce7`, with SHA-256
`c084a7072c4f91f6c8015eef499a07f7c62a98cf3b64bcc68d07150d6d7d5d74`.
Only after that merge was the private opening package retrieved.

`score-blind-reveal.mjs` verifies the exact public query bytes, salted label
commitment, encrypted-envelope digest, AES-256-GCM authentication and
byte-identical decryption, and all 48 ID/text correspondences. It then scores
the already locked predictions under the preregistered metrics. The committed
`results.json` contains every row and is reproduced exactly in CI.

## Result

| Metric | Result |
| --- | --- |
| In-profile ordered-role accuracy | 36/36 |
| Agent/theme reversal consistency | 18/18 pairs |
| Paraphrase accepted in frozen grammar | 0/6 |
| Paraphrase `Unknown` | 6/6 |
| Boundary `Unknown` | 6/6 |
| False acceptances | 0/12 diagnostics |
| Execution failures | 0/48 |

The 36 in-profile successes validate the finite three-construction factorial
design on new entities. They do not establish general Wenyan understanding.
All six independently worded paraphrases returned `Unknown`: the experiment
therefore provides no positive synonym/paraphrase generalization result. The
six boundary refusals and zero false acceptances support the frozen parser's
declared abstention boundary only.

The supervisor was a task-isolated Codex agent from the same OpenAI/model
family. There is no independent human or organizational review. Native Adva
admission and state-write authority remain false. Any grammar, learner,
threshold, label or metric change after this reveal makes the cohort development
data and requires a fresh unseen cohort for another final evaluation.

## Reproduce

```sh
node tools/relations/score-blind-reveal.mjs > /tmp/blind-reveal-results.json
diff experiments/blind_relation_v0/reveals/2026-10-19-agent01/results.json \
  /tmp/blind-reveal-results.json
```

