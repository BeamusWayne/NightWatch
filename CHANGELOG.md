# Changelog

The format follows [Keep a Changelog](https://keepachangelog.com/) and the
project adheres to [Semantic Versioning](https://semver.org/).

## [0.1.0] — 2026-06-10

Initial release.

### Added
- Hash-chained, append-only JSONL run ledger with canonical JSON
  serialization, per-session head sidecar (truncation detection), and
  cross-process locking for parallel tool-call hooks.
- Claude Code hook ingestion (`SessionStart` / `UserPromptSubmit` /
  `PostToolUse` / `Stop` / `SessionEnd`) — fail-open by construction: spills
  unappendable events to `.nightwatch/spill/` and always exits 0.
- Claim extraction: test runs (vitest/jest/pytest/go/cargo/bun/npm/…),
  structured file edits, git operations, shell-side writes; credential-shaped
  strings redacted before persistence; payloads stored as SHA-256 digests.
- Worktree checkpoints via git plumbing (temporary index + `write-tree` /
  `commit-tree` under `refs/nightwatch/*`) — HEAD, index and worktree
  untouched; auto-checkpoint at every turn end; `rollback` with dry-run
  default.
- Morning debrief (English + 中文): condensed timeline, chain integrity,
  test-claim re-runs (`--verify`), scope check against git ground truth
  (out-of-scope changes, out-of-band writes), checkpoint inventory, verdict.
- `nightwatch demo` — bundled synthetic overnight run replayed through the
  real ingest/checkpoint/debrief pipeline in a throwaway git repo.
- 46-test vitest suite (~90% line coverage) and a typed public API
  (`nightwatch-agent` package exports).
