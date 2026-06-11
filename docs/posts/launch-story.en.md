# I let Fable 5 modify my black box recorder, unattended. The black box caught five of its own bugs.

---

## You wake up to a green checkmark

On June 9, Anthropic shipped Fable 5 — the first publicly available Mythos-class model. 95.5% on SWE-bench Verified, and the headline capability is **multi-day autonomous runs**. In early testing, Stripe reported it compressed months of engineering into days: a codebase-wide migration that would have taken a team two months, done in one.

Everyone is talking about how long these models can run. Nobody is talking about the scene that plays out the next morning:

You hand the agent a task at 10 PM and go to sleep. You wake up to a green checkmark and a confident summary: *"Migration complete. All tests passing."*

**Why should you believe it?**

Human review speed did not double. A night of agent output takes you a full day to actually read — so you won't. You'll skim the summary, merge, and hope. Every doubling of generation capacity makes verification more of a bottleneck. This isn't a flaw in Fable 5; it's a new problem manufactured directly by its capability.

## A log is not evidence

The current answer is "check the logs." Transcripts, traces, observability dashboards — all of which share one structural flaw: **they are the agent's own account of events.**

"I ran the tests and they passed" — the model said that.
"I only touched these files" — the model said that.

Regulators have noticed. EU AI Act Article 12 (effective August 2026) mandates event logging for high-risk AI systems; the IETF has a draft format for agent audit trails (draft-sharif-agent-audit-trail-00); NIST launched an AI agent standards initiative in February. But all of it stops at the same layer: *writing the claims down.*

A claim written down is still a claim. **Logs are claims. Replays are proofs.**

## So I built NightWatch

One sentence: **a black box recorder for overnight AI agents.**

https://github.com/BeamusWayne/NightWatch

It does three things:

1. **Record** — Claude Code hooks write every event into an append-only, SHA-256 hash-chained ledger: action class, payload *digests* (fingerprints, not contents), and the **claims** extracted from output — which tests ran, which files changed, which git operations happened. Credentials are redacted before anything touches disk.
2. **Snapshot** — at every turn end, the worktree is photographed via git plumbing (temporary index + `write-tree`), without touching your HEAD, index, or working files. When a 30-hour run goes sideways at hour 26, you roll back to hour 24 instead of to zero.
3. **Verify** — in the morning, `nightwatch debrief` doesn't retell the agent's story. It **independently checks it**: chain integrity (tampering, truncation), test claims (by re-running the exact recorded commands), and a three-way scope check — declared globs vs. ledger claims vs. **git ground truth**.

The third layer is the soul of it. The sharpest line it produces:

> **CHANGED BUT NEVER CLAIMED (out-of-band writes): ⚠️ `scripts/hotfix.sh`**

The agent modified a file through a raw shell redirect — no structured edit tool, no mention in the summary. The ledger never claimed it. **Git saw it anyway.** That disagreement between narrative and reality is exactly what NightWatch exists to surface.

## Real data: the black box's first live run — pointed at itself

On launch day we ran the recursive experiment: a fresh, unattended Claude Code session (Fable 5) was asked to implement NightWatch's first roadmap item — ECDSA record signing — **inside NightWatch itself**. The recorder was the `nightwatch-agent@0.1.0` published to npm hours earlier, **version-frozen so the subject couldn't modify its own recorder**. Budget: two hours. Permissions: a narrow allowlist (vitest/tsc/npm run only; no git, no installs).

The full archive — all 94 raw ledger records plus both debriefs — is public: [docs/runs/2026-06-10-ecdsa-self-implementation](https://github.com/BeamusWayne/NightWatch/tree/main/docs/runs/2026-06-10-ecdsa-self-implementation). The morning report:

- **It finished the entire two-hour spec in 24 minutes** — a footnote on what the Fable 5 era feels like
- **94 hash-chained records, chain intact ✅**, 90 tool calls (22 read / 31 write / 25 exec)
- The timeline fossilized the TDD rhythm: read the codebase (7 min) → write failing tests → implement core → layer by layer → e2e → gates. **Record seq 45 — "recorded as failed, passes now" — is the red phase, preserved in evidence.** The black box even witnessed the tests failing *on purpose*.
- **9 test-run claims, all re-executed by `--verify`: 7 verified green, 2 are the TDD-red fossils above.** Zero "claimed pass, now failing."
- Output: 46 → 71 tests, 91.77% line coverage, 16 changed files — every one inside the contract. No out-of-scope edits, no git commands.

But the most valuable output of the run wasn't the feature. It was this:

### The black box caught five bugs in the black box

The synthetic demo was too polite to trigger them; two real runs hit all five within hours:

1. **`2>&1` misclassified as a file write** — fd duplication isn't a file write, but the bash-sniffing regex painted several test runs as `write` phases in the timeline.
2. **The baseline blind spot** — auto-checkpoints fired only on `Stop`, so a single-turn headless run got its *first* checkpoint at the very *end*. The scope check diffed the end state against itself, and 12 modified files vanished from the report.
3. **Absolute vs. repo-relative paths** — real harnesses send absolute `file_path`s, git speaks repo-relative. Four perfectly legitimate edits were flagged as "changed but never claimed."
4. **Receipts weren't portable** — claims carried the recording machine's absolute paths, and `attest` on a GitHub runner refused our own archived run (a receipt that only verifies where it was born defeats the point); claims are now relativized at write time, `--root` covers legacy receipts.
5. **One session, two diaries** — in the second recorded run (a Mastra migration), the agent's shell cd'd into a subdirectory and the recorder followed, opening a second ledger there and "losing" 79 records; store resolution now walks up to the nearest store, like git.

All five fixes landed the same day, with regression tests ([commits](https://github.com/BeamusWayne/NightWatch/commits/main)). The archived debriefs **preserve the blind spots exactly as produced** — evidence doesn't get retouched.

That's the whole point of dogfooding: **logs are claims, replays are proofs, and self-reference is the best debugger.**

## Four design principles

1. **The recorder must fail open.** A trust tool that crashes your agent session is worse than no tool. Every hook path catches everything, spills unappendable events to disk, and exits 0.
2. **No LLM judges an LLM.** Every check is deterministic: re-execution, hashing, set comparison. "Ask a model whether the model did well" does not exist in the core and never will — the referee and the player must be different species.
3. **Digests, not data.** The ledger holds SHA-256 fingerprints and short redacted summaries. With the transcript, anyone can prove it matches the ledger. Without it, the ledger leaks neither your prompts nor your secrets.
4. **Model-agnostic core.** Fable 5 made this problem urgent, but the problem belongs to every long-horizon agent. Claude Code is the first adapter, not the architecture.

## Not "what's next" — already shipped

- **attest mode (live)** — `nightwatch attest` plus a one-line GitHub Action: AI-authored PRs must carry their ledger receipt, and any changed file without a claim backing it is a hard refusal. We ran it on the receipt of the recorded run above: **ATTESTED — 16 changed files, all backed; the single info finding correctly identified the temp file the agent created and deleted mid-run.**
- **ECDSA signing (live, see above)**; remote chain-tip anchoring still ahead
- Adapters (a neutral `nightwatch emit` JSON entry → Codex / OpenClaw / Alfred)
- This is the fourth piece of my "trust layer for AI agents" series, after [trace-vault](https://github.com/BeamusWayne/trace-vault) (record/replay reliability gates), [provenant](https://github.com/BeamusWayne/provenant) (cryptographic receipts), and [Alfred](https://github.com/BeamusWayne/Alfred) (a verifiable autonomous coding agent)

Try it in 30 seconds (no agent session needed — a synthetic overnight run ships in the box):

```bash
git clone https://github.com/BeamusWayne/NightWatch && cd NightWatch
npm install && npm run build
node dist/cli.js demo
```

If you're also letting agents work while you sleep — I'd genuinely like to hear how you review their work in the morning. Issues are open.
