# 我让 Fable 5 无人值守改造我的工具,黑匣子记录并核验了一切——还抓出黑匣子自己五个 bug

---

## 一觉醒来,绿色对勾

6 月 9 日,Anthropic 发布了 Fable 5——第一个公开的 Mythos 级模型。SWE-bench Verified 95.5%,官方主打的能力是**多天级自主任务**。早期测试里 Stripe 说它"把数月工程压缩成几天":一支团队要做两个多月的全库迁移,它一天跑完。

所有人都在讨论"它能跑多久"。没有人讨论那个第二天早上必然出现的场景:

你晚上十点把任务交给 Agent,睡觉。醒来后看到一个绿色对勾和一段自信的总结:"已完成迁移,所有测试通过。"

**你凭什么相信?**

人类的审查速度没有变快。Agent 一晚上产出的工作量,你需要一整天才能逐行看完——而你不会逐行看,你会扫一眼总结,合并,祈祷。生成能力每翻一倍,验证就更瓶颈一分。这不是 Fable 5 的缺陷,这是它的能力直接制造出来的新问题。

## 日志不是证据

现有的回答是"看日志"。transcript、trace、observability 面板——它们有一个共同的结构性缺陷:**全是 Agent 的自述**。

"我跑了测试,通过了"——是模型说的。
"我只改了这些文件"——是模型说的。
监管层已经注意到这件事:EU AI Act 第 12 条(2026 年 8 月生效)要求高风险 AI 系统记录事件日志,IETF 出现了 agent 审计日志格式草案(draft-sharif-agent-audit-trail-00),NIST 二月启动了 AI Agent 标准计划。但它们都停在"把主张记下来"这一层。

记下来的主张仍然是主张。**日志是主张,重放才是证明。**

## 所以我写了 NightWatch

一句话:**通宵运行的 AI Agent 的黑匣子**。

https://github.com/BeamusWayne/NightWatch

它做三件事:

1. **记录** —— Claude Code hooks 把每个事件写入 SHA-256 哈希链的只追加台账:动作分类、载荷摘要(不存载荷,存指纹)、从输出里提取的"主张"(跑了什么测试、改了哪些文件、做了哪些 git 操作)。密钥先脱敏再落盘。
2. **快照** —— 每轮结束用 git plumbing(临时索引 + write-tree)给工作区拍照,不碰你的 HEAD、索引和工作区。30 小时的运行在第 26 小时跑偏,你回到第 24 小时,而不是归零。
3. **核验** —— 第二天早上 `nightwatch debrief`:不复述 Agent 的故事,而是**独立核验**它——哈希链完整性(有没有篡改/截断)、测试主张(重跑原命令)、范围核验(声明的 glob vs 台账主张 vs **git 基准事实**三方比对)。

第三层是灵魂。其中最锋利的一条是:

> **已变更但台账未声明（绕过工具的写入）: ⚠️ `scripts/hotfix.sh`**

Agent 用裸 shell 重定向改了一个文件——没走结构化编辑工具,总结里只字未提。台账没有这条主张,但 git 看见了。NightWatch 暴露的正是这种"叙事与事实的分歧"。

## 真实数据:黑匣子的第一次实战,对象是它自己

发布当天我们做了一个自指实验:让一个全新的无人值守 Claude Code 会话(Fable 5)给 NightWatch **自己**实现路线图第一项——ECDSA 记录签名。记录它的,正是几小时前刚发布到 npm 的 `nightwatch-agent@0.1.0`,**版本冻结:被记录者无法修改记录器**。预算两小时,权限是窄白名单(只有 vitest/tsc/npm run,禁 git、禁装包)。

完整档案(94 条原始台账 + 双语晨报)已公开:[docs/runs/2026-06-10-ecdsa-self-implementation](https://github.com/BeamusWayne/NightWatch/tree/main/docs/runs/2026-06-10-ecdsa-self-implementation)。晨报核心数据:

- **24 分钟跑完了两小时预算的全部 spec**——这本身就是 Fable 5 时代的注脚
- **94 条哈希链记录,链完整 ✅**,90 次工具调用(读 22 / 写 31 / 执行 25)
- 时间线把 TDD 节奏拍成了化石:读代码(7 分钟)→ 写失败测试 → 实现核心 → 逐层推进 → e2e → 门禁。**seq 45 那条"记录为失败,现已通过"就是红灯阶段的现场证据**——黑匣子连"先让测试失败"这个动作都替它作了证
- **9 条测试主张,`--verify` 全部重跑:7 条核实通过,2 条是上述 TDD 红灯化石**,零条"自称通过、重跑失败"
- 产出:46 → 71 个测试,覆盖率 91.77%,16 个变更文件全部在契约范围内,无越界、无 git 操作

但这次运行最值钱的产出不是功能,而是——

### 黑匣子抓出了黑匣子自己的五个 bug

合成 demo 太"礼貌"了,两次真实运行接连撞出了五个真 bug:

1. **`2>&1` 被误判为文件写入**——fd 复制不是写文件,时间线里好几条测试命令被错染成了"写入"
2. **基线检查点的盲区**——自动检查点只在 Stop 时打,单轮 headless 运行的第一个检查点出现在运行**结束**那一刻,范围核验拿终态对比终态,12 个被修改的文件凭空消失
3. **绝对路径 vs 相对路径**——真实 harness 传绝对路径,git 说相对路径,四个新文件的合法编辑被误报成"绕过工具的暗写入"
4. **回执不可移植**——主张里存着录制机器的绝对路径,attest 在 GitHub runner 上拒绝了我们自己的归档运行(回执只能在出生的机器上验证,违背回执的意义);修复后主张在写入时就相对化,旧回执用 `--root` 声明出生地
5. **一次会话,两本日记**——第二次实录(Mastra 迁移)中,Agent 的 shell `cd` 进子目录,记录器跟着在子目录另开了一本台账,79 条记录"失踪";修复后 store 解析像 git 一样向上寻根

五个修复连同回归测试全部当天合入([fix commit](https://github.com/BeamusWayne/NightWatch/commits/main))。归档的晨报**原样保留了这些盲点**——台账是证据,证据不能美颜。

这就是 dogfooding 的全部意义:**日志是主张,重放是证明,而自指是最好的调试器。**

## 四个设计原则

1. **记录器必须 fail-open。** 会弄坏 Agent 会话的信任工具比没有工具更糟。所有 hook 路径捕获一切异常,写不进的事件溢出到磁盘,永远 exit 0。
2. **不让 LLM 给 LLM 打分。** NightWatch 的每项核验都是确定性的:重新执行、哈希、集合比对。"问一个模型另一个模型干得好不好"在核心里不存在,也永远不会存在——裁判和运动员必须是不同的物种。
3. **存摘要,不存数据。** 台账只存 SHA-256 指纹和脱敏短摘要。有 transcript 的人可以证明它与台账一致;没有的人从台账里也偷不走你的提示词。
4. **核心与模型无关。** Fable 5 制造了这个问题的紧迫性,但问题本身属于所有长程 Agent。Claude Code 是第一个适配器,不是架构。

## 不是"接下来",是已经上线

- **attest 模式(已上线)**:`nightwatch attest` + 一行接入的 GitHub Action——AI 生成的 PR 必须带台账回执,任何"变更文件无主张背书"直接红灯。我们用它验证了上面那次实录运行自己的回执:**ATTESTED,16 个变更全部有据,唯一一条 info 还精确认出了 Agent 中途建了又删的临时文件**。
- **ECDSA 签名(已上线,见上文)**;远程链头锚定在路上
- 适配器(`nightwatch emit` 中立 JSON 入口 → Codex / OpenClaw / Alfred)
- 这是我"Agent 信任层"系列的第四件作品,前三件:[trace-vault](https://github.com/BeamusWayne/trace-vault)(录制/回放可靠性闸门)、[provenant](https://github.com/BeamusWayne/provenant)(密码学回执)、[Alfred](https://github.com/BeamusWayne/Alfred)(可验证自主编码 Agent)

30 秒体验(不需要 Agent 会话,内置合成通宵运行):

```bash
git clone https://github.com/BeamusWayne/NightWatch && cd NightWatch
npm install && npm run build
node dist/cli.js demo --lang zh
```

如果你也在让 Agent 通宵干活——欢迎来 issue 里聊你早上是怎么验收的。

