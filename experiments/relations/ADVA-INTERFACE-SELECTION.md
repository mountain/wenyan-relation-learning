# Adva learner 接口选择审计 v0.1

日期：2026-10-11。作者与自审：Codex（OpenAI）。这是一次有界的当前主线盘点，
不是全历史不存在性证明，也不授予任何接收端权限。

## 结论

PR #4 合并后，关系实验已经能产生受限的 `DocumentaryAccepted` 文档收据；
但在 `mountain/adva@1b9bd090b2c4710916b6a0ccca0ad88fb7d323bd` 当前主线中，
本次盘点没有找到能够直接接收该收据的合格 learner 接口。因此没有选择或调用 learner，
状态保持 `NotRun`，写入权限与 native admission 均为 false。

## 两个最接近的候选

1. [`experiments/finite_learner/calibration.py`](https://github.com/mountain/adva/blob/1b9bd090b2c4710916b6a0ccca0ad88fb7d323bd/experiments/finite_learner/calibration.py)
   是可执行的外部 F7 二次式校准。它固定接受算术任务与 trial/search 记录，源码明确声明
   “无原生 Adva 类型、身份或命令”。它不接受文言关系收据，也没有跨任务更新权限。
2. [`experiments/six_relation_queries/plan.json`](https://github.com/mountain/adva/blob/1b9bd090b2c4710916b6a0ccca0ad88fb7d323bd/experiments/six_relation_queries/plan.json)
   在题型上更接近关系学习，但仍为 `PreparationOnly`：未冻结、未实现、不可运行，
   campaign runs 为 0，G0 仍 Open，六项实验均为 `NotRun`。其任务是外部 F5
   关系查询方案，不是当前文言证据的适配器。

Adva 的 [`SEMANTIC_SCOPE.md`](https://github.com/mountain/adva/blob/1b9bd090b2c4710916b6a0ccca0ad88fb7d323bd/docs/SEMANTIC_SCOPE.md)
也保留“尚无稳定 learner 或一般收敛检测器”的边界。本审计把这三份源码和 Research 0131
的 Git blob 固定在机器可检合同中；它只防止在本仓库内悄悄提升结论，不会联网认证上游。

## 复现

Node 24 或 26，从仓库根目录运行：

```sh
node tools/relations/check-adva-interface-selection.mjs --selftest
```

检查器会确认两个候选均不合格、没有选择或调用、接收收据没有被提升为原生 admission，
并执行 11 个负对照。

## 解除阻塞的最小行动

由 Adva 接收端维护者选择或实现一个**确切版本**的 learner 接口，并一次冻结：任务／观察者
身份、监督来源与训练／留出隔离、工作／时间／证据预算、Accepted／Refuted／Unknown／NotRun
迁移、失败和部分证据保留、独立输出验证器、调用与更新权限。完成前，现有文档收据最多只能
作为输入前置条件，不能改名为 native admission，也不能触发状态写入。
