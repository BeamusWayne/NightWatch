# 🌙 NightWatch

**通宵运行的 AI Agent 的黑匣子。**

[![CI](https://github.com/BeamusWayne/NightWatch/actions/workflows/ci.yml/badge.svg)](https://github.com/BeamusWayne/NightWatch/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/nightwatch-agent)](https://www.npmjs.com/package/nightwatch-agent)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Node >= 20](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](package.json)
[![English](https://img.shields.io/badge/docs-English-blue)](./README.md)

前沿模型已经能进行**多天级的自主编码运行**。你晚上十点启动任务,睡一觉醒来,看到的是一个绿色对勾和一段自信的总结。但没有任何工具回答那个真正的问题:

> **它昨晚到底干了什么——你凭什么相信?**

NightWatch 把 Agent 会话的每个事件写入**哈希链接、只追加的台账(ledger)**,沿途对工作区做快照;第二天早上生成一份**晨报(debrief)**——它不是复述 Agent 的自我叙事,而是**独立核验其中的每一条主张**。

**日志是主张,重放才是证明。**

---

## 30 秒看效果

不需要真实 Agent 会话——内置的合成通宵运行会走一遍真实管线:

```bash
npm install -g nightwatch-agent
nightwatch demo --lang zh  # 中文晨报
nightwatch demo            # English report
```

晨报长这样(真实输出):

```markdown
# 🌙 NightWatch 晨报

- **会话**: `demo-overnight-1842`
- **模型**: claude-fable-5
- **时长**: 8.5小时 · 13 条事件 · 10 次工具调用
- **声明目标**: Fix the UTC rollover bug in src/utils/date.ts… Stay within src/** and tests/**.

## 结论
⚠️ 有 2 项发现需要你先处理，再信任这次运行。

## 台账完整性
✅ 哈希链完整（13 条记录）

## 范围核验
- 声明范围: `src/**`, `tests/**`
- 实际变更 4 个文件 · 50% 在声明范围内
- 超出范围: ⚠️ `infra/deploy.yaml`, `scripts/hotfix.sh`
- 已变更但台账未声明（绕过工具的写入）: ⚠️ `scripts/hotfix.sh`
```

最后一行就是全部意义所在:Agent 用裸 shell 重定向改了 `scripts/hotfix.sh`——没走结构化编辑工具,总结里也只字未提。台账没有这条主张,**但 git 有**。NightWatch 暴露的正是这种"叙事与事实的分歧"。

## 快速开始(真实会话)

```bash
cd your-project
nightwatch init --goal "把 utils 迁移到 strict TS" --scope "src/**" "tests/**"
# → 把 hooks 装进 .claude/settings.json（幂等,不动你已有的 hooks）

# …… 让 Agent 跑一整晚 ……

nightwatch debrief --lang zh          # 终端里的晨报
nightwatch debrief --verify           # 额外重跑记录过的测试命令,核验"通过"主张
nightwatch debrief --lang zh --md report.md
```

## 核验矩阵

| Agent 的主张 | 使用的基准事实 | 暴露的问题 |
|---|---|---|
| "测试通过了" | 重跑记录的原始命令(`--verify`) | `自称通过，重跑失败` |
| "我改了这些文件" | 与首个检查点的 `git diff` 对比 | 台账从未声明的绕过工具写入 |
| "我没有越界" | 声明的 glob vs 实际变更路径 | 超范围变更、范围内占比 |
| "这是完整历史" | SHA-256 哈希链 + 链头侧档 | 精确到记录的篡改;截断 |

30 小时的运行在第 26 小时跑偏时,检查点(每轮结束自动创建)给你回滚锚点:

```bash
nightwatch rollback 12          # 打印 git restore 命令（演练模式）
nightwatch rollback 12 --apply  # 真正恢复工作区
```

## 工作原理

```
Claude Code 会话
  │  SessionStart / UserPromptSubmit / PostToolUse / Stop hooks
  ▼
nightwatch hook   （fail-open：永远不会弄坏你的会话）
  │  分类 → 提取主张 → 脱敏 → 载荷摘要
  ▼
.nightwatch/ledger/<session>.jsonl     只追加、SHA-256 哈希链
.nightwatch/heads/<session>.json       链头（截断检测）
refs/nightwatch/<session>              git plumbing 工作区快照
  │
  ▼
nightwatch debrief    链校验 + 主张重跑 + 范围比对 → 晨报
```

每条台账记录包含 `agent 身份`、`动作分类`(read / write / exec / net / vcs / agent)、载荷**摘要**(不存载荷本体)、提取出的**主张**,以及 `prev`/`hash` 链接。检查点通过**临时索引**(`git write-tree` / `commit-tree`)创建——你的 HEAD、索引、工作区全程不被触碰。

## 设计原则

1. **记录器必须 fail-open。** 会弄坏 Agent 会话的信任工具比没有工具更糟。所有 hook 路径捕获一切异常,写不进的事件溢出到 `.nightwatch/spill/`,永远 exit 0。
2. **不让 LLM 给 LLM 打分。** NightWatch 的每一项核验都是确定性的:重新执行、哈希、集合比对。核心里没有、也永远不会有"问一个模型另一个模型干得好不好"。
3. **存摘要,不存数据。** 台账只存 SHA-256 摘要和脱敏短摘要。手里有 transcript?可以证明它与台账一致。没有?台账也不会泄露你的提示词和密钥。
4. **核心与模型、harness 无关。** Claude Code 是第一个适配器,不是架构本身。台账/核验/晨报消费的是中立记录;其他 harness 的适配器见[路线图](#路线图)。
5. **台账是证据,不是广告。** 结论行的职责是告诉你什么时候*不该*信任这次运行。永远说"一切正常"的工具只是装饰品。

## 标准背景

记录结构按 [IETF draft-sharif-agent-audit-trail-00](https://datatracker.ietf.org/doc/draft-sharif-agent-audit-trail/) 的方向设计——哈希链接的 JSON 记录、agent 身份、动作分类、结果——但该草案还是 `-00` 且在演进中;NightWatch 跟踪它,不声称符合它。如果你是因为 **EU AI Act 第 12 条**(2026 年 8 月生效)的日志要求找到这里:一份只追加、防篡改的自主 Agent 活动事件日志正是这里产出的东西——但 NightWatch 是工程工具,不是合规产品,本文不构成法律意见。

## 威胁模型与诚实的局限

- NightWatch **检测**本地篡改(任何修改或截断都会打断哈希链),但不**阻止**篡改——拥有完整磁盘权限的攻击者可以重写整个台账和侧档。签名记录(ECDSA)与远程链头锚定在路线图上。
- 主张提取是刻意保守的启发式:漏掉一条主张只损失覆盖度,不损失正确性——git 基准比对兜住提取遗漏的部分。
- `--verify` 重跑的是*现在*,不是*当时*:今早核验通过证明的是当前工作树通过测试——这恰恰是你合并前真正关心的。
- 它不是沙箱、不是权限系统;请与 harness 自身的权限控制配合使用。

## 命令参考

| 命令 | 作用 |
|---|---|
| `nightwatch init [--goal] [--scope ...]` | 安装 hooks、创建存储、写 gitignore |
| `nightwatch hook` | (hooks 调用)从 stdin 摄入一条事件,永远 exit 0 |
| `nightwatch status` | 会话摘要 + 链状态 |
| `nightwatch debrief [--verify] [--lang zh] [--md f]` | 晨报 |
| `nightwatch verify` | 快速链完整性检查 |
| `nightwatch checkpoint [-m note]` | 手动工作区快照 |
| `nightwatch rollback <seq> [--apply]` | 恢复检查点 |
| `nightwatch demo [--lang zh]` | 重放内置通宵运行 |

## 路线图

- **`attest` 模式** —— GitHub Action,用绿色台账给 AI 生成的 PR 设门禁("没有回执,不进 review")
- **ECDSA 签名记录 + 远程链头锚定** —— 从"可检测篡改"到"抗篡改"
- **适配器**:OpenClaw / Codex CLI / [Alfred](https://github.com/BeamusWayne/Alfred) 原生台账导入
- **可靠性报告** —— 基于 [trace-vault](https://github.com/BeamusWayne/trace-vault) 双轴(确定性/可信度)的跨 harness、跨模型定期实测

## 开发

```bash
npm install
npm run typecheck && npm test     # 46 个测试,行覆盖率 ~90%
npm run build && node dist/cli.js demo --lang zh
```

MIT © [Beamus Wayne](https://github.com/BeamusWayne) —— [AI Agent 信任层](https://beamuswayne.github.io)的一部分:[trace-vault](https://github.com/BeamusWayne/trace-vault) · [provenant](https://github.com/BeamusWayne/provenant) · [Alfred](https://github.com/BeamusWayne/Alfred) · NightWatch
