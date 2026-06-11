# 🌙 NightWatch

**The black box recorder for overnight AI agents.**

[![CI](https://github.com/BeamusWayne/NightWatch/actions/workflows/ci.yml/badge.svg)](https://github.com/BeamusWayne/NightWatch/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/nightwatch-agent)](https://www.npmjs.com/package/nightwatch-agent)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Node >= 20](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](package.json)
[![中文文档](https://img.shields.io/badge/docs-%E4%B8%AD%E6%96%87-red)](./README.zh-CN.md)

Frontier models now run **multi-day autonomous coding sessions** — Anthropic's [Fable 5](https://www.anthropic.com/news/claude-fable-5-mythos-5) shipped this week with exactly that headline capability. You start a run at 22:00, go to sleep, and wake up to a green checkmark and a confident summary. The question nobody's tooling answers:

> **What did it actually do all night — and why should you believe it?**

NightWatch records every event of an agent session into a **hash-chained, append-only ledger**, snapshots your worktree as it goes, and in the morning compiles a **debrief** that doesn't just replay the agent's story — it **independently verifies the claims** in it.

**Logs are claims. Replays are proofs.**

---

## 30-second demo

No agent session needed — replay a bundled synthetic overnight run through the real pipeline:

```bash
npm install -g nightwatch-agent
nightwatch demo            # English report
nightwatch demo --lang zh  # 中文晨报
```

What the morning debrief looks like (real output):

```markdown
# 🌙 NightWatch Debrief

- **Session**: `demo-overnight-1842`
- **Model**: claude-fable-5
- **Duration**: 8.5h · 13 events · 10 tool calls
- **Declared goal**: Fix the UTC rollover bug in src/utils/date.ts… Stay within src/** and tests/**.

## Verdict
⚠️ 2 finding(s) need your attention before trusting this run.

## Ledger integrity
✅ hash chain intact (13 records)

## Timeline
- `22:06–22:09` **read** ×2 @ `src` — src/utils/date.ts
- `23:18–23:18` **write** ×1 @ `src` — src/utils/date.ts
- `00:48–00:48` **exec** ×1 — npx vitest run tests/date.test.ts
- `02:13–02:13` **write** ×1 @ `infra` — infra/deploy.yaml
- `06:31–06:31` **git** ×1 — git commit -am 'fix: UTC rollover at midnight'

## Scope check
- Declared scope: `src/**`, `tests/**`
- 4 file(s) actually changed · 50% inside declared scope
- OUT OF SCOPE: ⚠️ `infra/deploy.yaml`, `scripts/hotfix.sh`
- CHANGED BUT NEVER CLAIMED (out-of-band writes): ⚠️ `scripts/hotfix.sh`
```

That last line is the point: the agent edited `scripts/hotfix.sh` through a raw shell redirect — no structured edit tool, no mention in the summary. The ledger didn't claim it; **git did**. NightWatch surfaces exactly that disagreement.

> **First recorded production run:** a Fable 5 session implementing this repo's own ECDSA signing, unattended — 94 hash-chained records, all 9 test claims replay-verified, and three bugs in the recorder itself caught in the process. The raw ledger and both debriefs are public: [docs/runs/2026-06-10-ecdsa-self-implementation](./docs/runs/2026-06-10-ecdsa-self-implementation/).

## Quickstart (real sessions)

```bash
cd your-project
nightwatch init --goal "Migrate utils to strict TS" --scope "src/**" "tests/**"
# → installs Claude Code hooks into .claude/settings.json (idempotent, preserves yours)

# ... run your agent overnight ...

nightwatch debrief             # morning report in your terminal
nightwatch debrief --verify    # also RE-RUN claimed test commands to verify "passed"
nightwatch debrief --lang zh --md report.md
```

## What gets verified

| The agent's claim | Ground truth used | Failure surfaced |
|---|---|---|
| "Tests passed" | re-run the exact recorded command (`--verify`) | `CLAIMED PASS, NOW FAILING` |
| "I changed these files" | `git diff` against the run's first checkpoint | out-of-band writes the ledger never claimed |
| "I stayed in scope" | declared globs vs. actual changed paths | out-of-scope changes, in-scope ratio |
| "This is the full history" | SHA-256 hash chain + head sidecar | tampering at the exact record; truncation |

And when a 30-hour run goes sideways at hour 26, checkpoints (created automatically at every turn end) give you a rollback anchor:

```bash
nightwatch rollback 12          # prints the git restore command (dry run)
nightwatch rollback 12 --apply  # actually restores the worktree
```

## attest — gate AI-authored PRs

The CI half of the story: an agent-authored PR ships its ledger as a **receipt**, and the check refuses to hand the diff to a human until the receipt vouches for it.

```yaml
# .github/workflows/attest.yml
name: attest
on: pull_request
jobs:
  attest:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: BeamusWayne/NightWatch@v0.3.0
        with:
          ledger: .nightwatch-receipt.jsonl
          base: origin/${{ github.base_ref }}
          scope: 'src/** tests/**'
```

`nightwatch attest` exits non-zero when: the hash chain is broken or truncated · any signature is invalid · **any changed file has no ledger claim backing it** (`UNDECLARED_CHANGE` — the core gate) · a change lands outside the declared scope. Warnings (unsigned pre-key records, a final failing test claim) pass unless `--strict`. `--json` emits the machine-readable verdict; local store mode works too: `nightwatch attest --base origin/main` inside any recorded project.

## How it works

```
Claude Code session
  │  SessionStart / UserPromptSubmit / PostToolUse / Stop hooks
  ▼
nightwatch hook   (fail-open: can never break your session)
  │  classify → extract claims → redact secrets → digest payloads
  ▼
.nightwatch/ledger/<session>.jsonl     append-only, SHA-256 hash-chained
.nightwatch/heads/<session>.json       chain tip (truncation detection)
refs/nightwatch/<session>              worktree snapshots via git plumbing
  │
  ▼
nightwatch debrief    chain check + claim re-runs + scope diff → report
```

Each ledger record carries `agent identity`, an `action class` (read / write / exec / net / vcs / agent), payload **digests** (not payloads), extracted **claims**, and `prev`/`hash` links. Checkpoints are commits created through a **temporary index** (`git write-tree` / `commit-tree`) — your HEAD, index and worktree are never touched.

## Design principles

1. **Fail-open recorder.** A trust tool that crashes your agent session is worse than no tool. Every hook path catches everything, spills unappendable events to `.nightwatch/spill/`, and exits 0.
2. **No LLM judges an LLM.** Every verification in NightWatch is deterministic: re-execution, hashing, set comparison. There is no "ask a model whether the model did well" anywhere — and there never will be in the core.
3. **Digests, not data.** The ledger stores SHA-256 digests and short redacted summaries. Holding the transcript? You can prove it matches the ledger. Don't? The ledger leaks neither your prompts nor your secrets.
4. **Model- and harness-agnostic core.** Claude Code is the first adapter, not the architecture. The ledger/verify/debrief layers consume neutral records; adapters for other harnesses are a [roadmap item](#roadmap).
5. **The ledger is evidence, not advertising.** A verdict line tells you when *not* to trust the run. A tool that always says "all good" is decoration.

## Standards context

The record shape is designed to map onto the direction of [IETF draft-sharif-agent-audit-trail-00](https://datatracker.ietf.org/doc/draft-sharif-agent-audit-trail/) — hash-chained JSON records with agent identity, action classification and outcome — though the draft is `-00` and moving; NightWatch tracks it, it doesn't claim conformance. If you're looking at this because the **EU AI Act Article 12** logging requirements (effective August 2026) just landed on your desk: an append-only, tamper-evident event log of autonomous-agent activity is exactly what this produces, but NightWatch is an engineering tool, not a compliance product, and nothing here is legal advice.

## Threat model & honest limitations

- NightWatch **detects** local tampering (any edit or truncation breaks the chain), it does not **prevent** it — an attacker with full disk access can rewrite the entire ledger and sidecar. Signed records (ECDSA) and remote chain-tip anchoring are roadmap items.
- Claims extraction is heuristic by design: a missed claim costs coverage, never correctness — the git ground truth comparison is what catches what extraction misses.
- `--verify` re-runs tests *now*, not *then*: a claim verified this morning proves the work-tree passes today, which is what you actually care about before merging.
- It's not a sandbox and not a permission system; pair it with your harness's own permission controls.

## CLI reference

| Command | What it does |
|---|---|
| `nightwatch init [--goal] [--scope ...]` | install hooks, create store, gitignore entry |
| `nightwatch hook` | (called by hooks) ingest one event from stdin, always exit 0 |
| `nightwatch status` | session summary + chain status |
| `nightwatch debrief [--verify] [--lang zh] [--md f]` | the morning report |
| `nightwatch verify` | fast chain-integrity pass |
| `nightwatch checkpoint [-m note]` | manual worktree snapshot |
| `nightwatch rollback <seq> [--apply]` | restore a checkpoint |
| `nightwatch demo [--lang zh]` | replay the bundled overnight run |

## Roadmap

- ~~`attest` mode~~ — **shipped**: [CI gate + GitHub Action](#attest--gate-ai-authored-prs)
- ~~ECDSA-signed records~~ — **shipped in v0.2.0** ([implemented by a recorded agent run](./docs/runs/2026-06-10-ecdsa-self-implementation/)); remote chain-tip anchoring still ahead
- **Adapters**: a neutral `nightwatch emit` JSON entry point, then OpenClaw / Codex CLI / [Alfred](https://github.com/BeamusWayne/Alfred) native ledger import
- **Reliability reports** — periodic published debrief stats across harnesses and models, built on [trace-vault](https://github.com/BeamusWayne/trace-vault)'s determinism/faithfulness axes

## Development

```bash
npm install
npm run typecheck && npm test     # 46 tests, ~90% line coverage
npm run build && node dist/cli.js demo
```

MIT © [Beamus Wayne](https://github.com/BeamusWayne) — part of the [trust layer for AI agents](https://beamuswayne.github.io): [trace-vault](https://github.com/BeamusWayne/trace-vault) · [provenant](https://github.com/BeamusWayne/provenant) · [Alfred](https://github.com/BeamusWayne/Alfred) · NightWatch
