"""Replay the pinned PR #13 predictions and the public development controls."""

from collections import Counter, defaultdict
from hashlib import sha1, sha256
from itertools import permutations, product
import json
from pathlib import Path
import subprocess
import sys


ROOT = Path(__file__).resolve().parent
WORKER = ROOT / "frozen/experiments/postfreeze_relation_v0/worker.py"
PUBLISHED = ROOT / "published"
KNOWN = "KnownFiniteGrammar"
UNKNOWN = "Unknown"
OUTSIDE = {"status": UNKNOWN, "reason": "outside-profile"}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def read_json(path):
    return json.loads(path.read_bytes())


def verify_sources():
    for source in read_json(ROOT / "sources.json"):
        raw = (ROOT / source["path"]).read_bytes()
        blob_header = f"blob {len(raw)}\0".encode("ascii")
        require(
            sha1(blob_header + raw).hexdigest() == source["git_blob_sha1"]
            and sha256(raw).hexdigest() == source["sha256"],
            f"Source bytes differ: {source['path']}",
        )


def call_worker(payload):
    command = [sys.executable, "-I", "-B"]
    if sys.flags.optimize:
        command.append("-O")
    return subprocess.run(
        [*command, str(WORKER)],
        input=payload,
        capture_output=True,
        cwd=WORKER.parent,
        timeout=5,
    )


def encode(request):
    return json.dumps(request, ensure_ascii=False).encode("utf-8")


def known(roles):
    return {"status": KNOWN, "roles": list(roles)}


def case(case_id, group, text, roles, expected, **notes):
    return {
        "id": case_id,
        "group": group,
        "text": text,
        "expected_roles": None if roles is None else list(roles),
        "expected_frozen_answer": expected,
        **notes,
    }


def rewrite(case_id, family, direction, text, roles, words, syntax,
            original=None, single_word_of_two=False):
    if single_word_of_two:
        cell = "one-receipt-verb-plus-syntax" if syntax else "one-receipt-verb"
    elif words:
        cell = "both" if syntax else "lexicon-only"
    else:
        cell = "syntax-only" if syntax else "neither"
    return case(
        case_id, "lexicon-syntax", text, roles,
        OUTSIDE if words or syntax else known(roles),
        family=family, direction=direction, cell=cell, verb_edits=words,
        syntax_edit=syntax, original_query_id=original,
    )


def receipt_cases():
    directions = [
        ("forward", "兰舟", "石泉", "q-e6377d79bcb74477"),
        ("reverse", "石泉", "兰舟", "q-b936b6f926f9e2ab"),
    ]
    for direction, agent, recipient, original in directions:
        roles = (agent, recipient, "玉筹")
        for receive, give, marker in product(("获", "得"), ("授", "赠"), ("", "之")):
            words = []
            if receive == "得":
                words.append("获→得")
            if give == "赠":
                words.append("授→赠")
            text = f"「{recipient}」{receive}「{agent}」所{give}{marker}「玉筹」。"
            yield rewrite(
                f"receipt-{direction}-{receive}{give}{marker}", "得/赠/之",
                direction, text, roles, words, "插入之" if marker else None,
                original if len(words) == 2 and marker else None,
                single_word_of_two=len(words) == 1,
            )


def transfer_cases():
    families = [
        ("deliver", "付", "于", "银钥", [
            ("forward", "沧弦", "墨川", "q-b7d71879aae4a4d8"),
            ("reverse", "墨川", "沧弦", "q-5ee209a427cf32fd"),
        ]),
        ("give", "予", "以", "玄印", [
            ("forward", "岑渚", "洛衡", "q-326532c796b43b7b"),
            ("reverse", "洛衡", "岑渚", "q-a3ce7b24278401dd"),
        ]),
    ]
    for family_id, new_verb, marker, theme, directions in families:
        for direction, agent, recipient, original in directions:
            roles = (agent, recipient, theme)
            for verb, syntax_changed in product(("授", new_verb), (False, True)):
                syntax = None
                if not syntax_changed:
                    text = f"「{agent}」{verb}「{recipient}」「{theme}」。"
                elif marker == "于":
                    text = f"「{agent}」{verb}「{theme}」于「{recipient}」。"
                    syntax = "受领者移到转交物之后并加于"
                else:
                    text = f"「{agent}」以「{theme}」{verb}「{recipient}」。"
                    syntax = "以引出转交物并移至动词之前"
                yield rewrite(
                    f"{family_id}-{direction}-{verb}{marker if syntax_changed else ''}",
                    f"{new_verb}/{marker}", direction, text, roles,
                    [f"授→{verb}"] if verb != "授" else [], syntax,
                    original if verb == new_verb and syntax_changed else None,
                )


def role_cases():
    for index, roles in enumerate(permutations(("青岫", "澄浦", "白圭")), start=1):
        agent, recipient, theme = roles
        texts = {
            "授": f"「{agent}」授「{recipient}」「{theme}」。",
            "把-交给": f"「{agent}」把「{theme}」交给「{recipient}」。",
            "获-所授": f"「{recipient}」获「{agent}」所授「{theme}」。",
        }
        for construction, text in texts.items():
            yield case(
                f"role-{index}-{construction}", "role-order", text, roles,
                known(roles), permutation=index, construction=construction,
            )


def scope_cases():
    negatives = [
        ("negation", "「岑渚」未授「洛衡」「玄印」。", "否定该事件"),
        ("intent", "「岑渚」欲授「洛衡」「玄印」。", "仅有意图"),
        ("question", "「岑渚」授「洛衡」「玄印」？", "以问句提出该事件"),
        ("pronoun", "「岑渚」授其「玄印」。", "缺少先行语境，受领者未定"),
        ("alternatives", "「岑渚」授「洛衡」或「疏钟」「玄印」。", "两个候选受领者"),
        ("two-events", "「岑渚」授「洛衡」「玄印」，「洛衡」授「岑渚」「玄印」。", "两个方向不同的事件"),
        ("deliver-alternatives", "「沧弦」付「银钥」于「墨川」或「疏钟」。", "于结构有两个候选受领者"),
        ("show", "「岑渚」以「玄印」示「洛衡」。", "展示不蕴含交付"),
        ("receipt-negation", "「石泉」未得「兰舟」所赠之「玉筹」。", "否定收得"),
    ]
    for name, text, rationale in negatives:
        yield case(f"scope-{name}", "semantic-boundary", text, None, OUTSIDE,
                   rationale=rationale)


def literal_cases():
    for value, mate in (("其", "pronoun"), ("洛衡或疏钟", "alternatives")):
        roles = ("岑渚", value, "玄印")
        yield case(
            f"literal-{mate}", "opaque-literal", f"「岑渚」授「{value}」「玄印」。",
            roles, known(roles), paired_boundary_case=f"scope-{mate}",
        )


def replay_published():
    lock = read_json(PUBLISHED / "lock.json")
    bytes_by_name = {name: (PUBLISHED / f"{name}.json").read_bytes()
                     for name in ("queries", "request", "predictions")}
    for name, raw in bytes_by_name.items():
        require(sha256(raw).hexdigest() == lock[f"{name}_sha256"], f"Prediction lock: {name}")
    request = json.loads(bytes_by_name["request"])
    queries = json.loads(bytes_by_name["queries"])
    require(request["queries"] == [row["text"] for row in queries], "Query text and request differ")
    run = call_worker(bytes_by_name["request"])
    require(run.returncode == 0, run.stderr.decode("utf-8", errors="replace"))
    require(run.stdout == bytes_by_name["predictions"], "Locked prediction bytes differ")
    prediction = json.loads(run.stdout)
    reveal = read_json(PUBLISHED / "revealed-results.json")
    by_id = {row["id"]: row for row in reveal["rows"]}
    require(len(by_id) == len(reveal["rows"]) == len(queries) == len(prediction["answers"]) == 48,
            "Published row counts")
    require(len({row["id"] for row in queries}) == len(queries), "Duplicate published query ID")
    counts = defaultdict(Counter)
    for query, answer in zip(queries, prediction["answers"]):
        row = by_id[query["id"]]
        require(answer == row["prediction"], query["id"])
        counts[row["arm"]][answer["status"]] += 1
        if row["arm"] == "in_profile":
            require(answer == known(row["intended_roles"]), f"Published roles: {query['id']}")
        else:
            require(answer == OUTSIDE, f"Published abstention: {query['id']}")
    original_rows = {query["id"]: (query["text"], by_id[query["id"]]) for query in queries}
    return request, prediction, original_rows, {
        "prediction_sha256": sha256(run.stdout).hexdigest(),
        "byte_identical": True,
        "counts_by_arm": counts,
    }


def check_rewrite_anchors(cases, original_rows):
    covered = set()
    for item in cases:
        original = item.get("original_query_id")
        if original is None:
            continue
        text, row = original_rows[original]
        require(original not in covered and row["arm"] == "paraphrase"
                and text == item["text"] and row["intended_roles"] == item["expected_roles"],
                f"Paraphrase anchor: {original}")
        covered.add(original)
    require(covered == {key for key, (_, row) in original_rows.items() if row["arm"] == "paraphrase"},
            "Missing a published paraphrase")


def replay_development(request, prediction, original_rows, strict_verify):
    cases = [*receipt_cases(), *transfer_cases(), *role_cases(), *scope_cases(), *literal_cases()]
    require(len(cases) == len({item["id"] for item in cases}) == len({item["text"] for item in cases}) == 61,
            "Unexpected development coverage or duplicate fixture")
    check_rewrite_anchors(cases, original_rows)
    scoped_req = dict(request, queries=[item["text"] for item in cases])
    run = call_worker(encode(scoped_req))
    require(run.returncode == 0, run.stderr.decode("utf-8", errors="replace"))
    observed = json.loads(run.stdout)
    strict_verify(scoped_req, observed)
    require(observed["training"] == prediction["training"], "Training changed between batches")
    counts = defaultdict(Counter)
    rows = []
    for item, answer in zip(cases, observed["answers"]):
        require(answer == item["expected_frozen_answer"], f"Frozen answer: {item['id']}")
        counts[item.get("cell", item["group"])][answer["status"]] += 1
        rows.append(dict(item, observed=answer))
    return {"counts": counts, "rows": rows}


def probe_training_interface(request):
    variants = {
        "lexicon-only": "「乙」得「甲」所授「书」。",
        "syntax-only": "「乙」获「甲」所授之「书」。",
    }
    probes = {}
    for name, text in variants.items():
        training = list(request["training"])
        require(training[2]["text"] == "「乙」获「甲」所授「书」。", "Training anchor changed")
        training[2] = dict(training[2], text=text)
        run = call_worker(encode(dict(request, training=training, queries=[])))
        error = run.stderr.decode("utf-8").strip().splitlines()[-1] if run.stderr else ""
        require(run.returncode != 0 and not run.stdout
                and error == "ValueError: training outside profile", f"Training probe: {name}")
        probes[name] = {"row": training[2], "error": error}
    return probes


def main():
    verify_sources()
    sys.dont_write_bytecode = True
    sys.path.insert(0, str(WORKER.parent))
    from strict_check import verify

    request, prediction, original_rows, replay = replay_published()
    verify(request, prediction)
    training = prediction["training"]
    require(training["status"] == "Accepted" and training["checked"] == request["fuel"] == 18,
            "The original training should accept after 18 checks")
    result = {
        "published_replay": replay,
        "training": training,
        "development": replay_development(request, prediction, original_rows, verify),
        "training_interface_probes": probe_training_interface(request),
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
