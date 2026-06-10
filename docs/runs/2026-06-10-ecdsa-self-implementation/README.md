# Run archive: NightWatch implements its own ECDSA signing, recorded by NightWatch

**The recursive dogfood:** on 2026-06-10 we pointed the black box at itself. A headless
Claude Code session (recorded by the published `nightwatch-agent@0.1.0`, frozen so the
subject couldn't modify its own recorder) was asked to implement the first roadmap item —
optional ECDSA signing of ledger records — inside this very repository.

这是一次自指实验:用已发布的 `nightwatch-agent@0.1.0`(版本冻结,被记录者无法修改记录器)
记录一个 headless Claude Code 会话,任务是给 NightWatch 自己实现 ECDSA 签名。

## The run / 运行数据

| | |
|---|---|
| Session | `80b67054-28e4-457a-9470-1fe9a19d5709` |
| Duration | 0.4 h (≈24 min) — the 2-hour budget was not needed |
| Ledger | **94 hash-chained records**, chain intact ✅ |
| Tool calls | 90 (read 22 · write 31 · exec 25 · other 12) |
| Baseline | repo HEAD `8533158`, clean worktree |
| Result | 46 → **71 tests**, coverage 90.69 → **91.77 %**, `tsc --strict` clean |

## Claims, verified / 主张核验

`nightwatch debrief --verify` re-ran every test command the agent had executed.
**9 test-run claims: 7 verified green on re-run; 2 recorded as failures that now pass** —
those two are the TDD red phases (tests written before the implementation), fossilized in
the ledger exactly where they should be.

Scope: 16 files actually changed vs. baseline — every one inside `src/**`, `tests/**`
plus the task-permitted `CHANGELOG.md`. No out-of-band writes. No git commands (the
contract forbade them; a human reviewed and committed).

## What the run caught in the recorder itself / 黑匣子抓出了黑匣子的三个 bug

The most valuable output wasn't the feature — it was three real bugs in NightWatch 0.1.0
that only a real run could expose (the synthetic demo was too polite to trigger them):

1. **`2>&1` misclassified as a file write.** The bash-sniffing regex treated stderr
   redirection as `> file`, so several test runs show up in this archive's timeline as
   `write` phases. Classification noise only — claims were unaffected.
2. **No baseline checkpoint at session start.** Auto-checkpoints fired only on `Stop`;
   a single-turn headless run therefore got its *first* checkpoint at the very end, and
   the scope check diffed against the end state — hiding all 12 modified tracked files
   from the report (the 4 new untracked files still surfaced). The debriefs archived here
   preserve that blind spot honestly; the corrected ground truth is `git diff HEAD`.
3. **Absolute vs. repo-relative paths.** Real Claude Code sends absolute `file_path`s;
   git speaks repo-relative. The claimed-vs-actual comparison never matched, so the four
   new files were flagged as "changed but never claimed" — false positives.

All three are fixed in the commit that follows this archive, with regression tests.
That is the point of the exercise: **logs are claims, replays are proofs, and dogfood
is debugging.**

## Files / 文件

- `ledger.jsonl` — the raw 94-record hash chain (digests + redacted summaries only; safe to publish by design)
- `ledger.head.json` — chain-tip sidecar
- `debrief.zh.md` / `debrief.en.md` — the morning reports exactly as `nightwatch-agent@0.1.0` produced them, blind spots included

Verify this archive yourself / 自行核验:

```bash
npm install nightwatch-agent
node --input-type=module -e "
import { parseLedgerLines, verifyChain } from 'nightwatch-agent';
import { readFileSync } from 'node:fs';
console.log(verifyChain(parseLedgerLines(readFileSync('ledger.jsonl', 'utf8'))));
"
# → { ok: true, length: 94 }
```
