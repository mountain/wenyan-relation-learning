# Prediction lock: 2026-10-19-agent01

Stage: `PredictionsCommitted`; label reveal and scoring: `NotRun`.

The frozen baseline at `cba40627ca9ce49dcbd89527f1d904debad14009`
was run against the 48 public query texts committed at
`5c1af139129f56f9870bcdab769f8589f6cd65d5`. The execution image contained
only the pinned learner/worker/checker files, approved training data and the
unlabelled request. It did not contain plaintext labels, an opening key or the
private opening bundle.

The process ran in new user, mount and network namespaces, inside a tmpfs
chroot. The frozen program and request were mounted read-only; the network
namespace exposed only an unconfigured loopback interface and an outbound
probe was blocked. The registered 4-second CPU, 5-second wall and 128 MiB
memory bounds were applied.

The exact output is `predictions.json`; its SHA-256 is
`c084a7072c4f91f6c8015eef499a07f7c62a98cf3b64bcc68d07150d6d7d5d74`.
Without consulting labels, it contains 36 `KnownFiniteGrammar` answers and 12
`Unknown` answers. The strict independent receiving check reconstructed the
training transcript and all 48 outputs and accepted them. These counts are not
accuracy or semantic scores.

The first clean-image attempt completed the producer and produced the same
prediction digest, but the receiving step could not import the frozen
`external_relation_v0/verify.py` dependency because it had been omitted from
the image. The second attempt added that exact baseline file only; request,
learner, worker and query bytes did not change, and the prediction bytes were
identical. Both events are retained in `lock.json` rather than erased.

No label, salt, key or opening package has been read or retrieved. The next
legitimate gate is to merge this prediction lock, then disclose the private
opening package, verify the commitment and score the already locked bytes.
Native admission and state-write authority remain false.

