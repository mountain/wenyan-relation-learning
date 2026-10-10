# 关系辨别证据接收合同 v0.1

方向：苑明理。合同、检查器与自审：Codex（OpenAI），2026-10-10。

本合同承接 2026-10-09 的当前源码复跑证据，只建立一个有界的**文档证据接收口**。
它不选择、不调用 Adva learner，也不把外部适配器的结果提升为原生语义 admission。

## 接受什么

输入固定为 [`evidence.replay-2026-10-09.json`](evidence.replay-2026-10-09.json)。
合同绑定文件 SHA-256、来源仓库与完整提交、八项 Git blob、有限结果计数、12 类对照、
旧证据保持不变以及四项已披露的源码摘要差异。

通过检查只产生 `DocumentaryAccepted`：

- 当前三种受控构式的三条监督样例和 9 个留出读法可复核；
- 9 个同义改写比较为 `SameRelation`；
- 9 个施事／受事反转比较为 `RoleReversal`；
- 证据仍声明自己是 external adapter，而非 native learn。

它不产生新语义事实，不证明一般文言理解，不证明六芽与六书同构，
不把 64 个三段论式称为 64 个重言式，也不证明上游 wenyan-lang 已接收交付。

## 拒绝什么

检查器对以下改动拒绝接收：

1. 来源提交、blob 身份或完整证据字节变化；
2. 正例、反转或对照数量变化；
3. 删除 `out-of-grammar` 等 Unknown／拒绝边界；
4. 把 scope 改写成 native admission；
5. 把合同权限提升为可调用 learner 或可推广语义声明。

负对照在 `--selftest` 中执行，不写入学习日志或旧证据。

## 复现

Node 24 或 26，从仓库根目录：

```sh
node tools/relations/check-receiving-contract.mjs --selftest
```

成功输出一行 `wenyan.relation-evidence-receipt.v1`，状态为
`DocumentaryAccepted`，并明确 `native_admission: false`。

## 下一道边界

若要进入 Adva，后续工作必须另行选择一个实际 learner 接口，并声明：
任务／观察者身份、监督来源、预算、Unknown 与反证的更新权限、状态迁移、
输出验证器及失败后保留策略。本合同只能作为该适配器的输入前置条件，
不能被改名为 native admission。
