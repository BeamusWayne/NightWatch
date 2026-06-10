# Changelog

The format follows [Keep a Changelog](https://keepachangelog.com/) and the
project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- Optional ECDSA signing of ledger records (P-256, `node:crypto` only — no new
  dependencies). `nightwatch keygen` creates `.nightwatch/keys/signing.pem`
  (private, mode 0600) and `signing.pub.pem`; from the next append on, each
  record carries a `sig` field — a base64 DER signature over the record hash.
  Because re-hashed records cannot be re-signed without the private key, a
  full rewrite-and-relink attack that defeats the hash chain alone now fails
  signature verification: the ledger graduates from tamper-evident to
  tamper-resistant. `keygen` refuses to overwrite existing keys without
  `--force`.
- `nightwatch verify` additionally verifies every record signature when a
  public key is configured, reporting `signed: n/m verified` and exiting
  non-zero on any invalid signature. Unsigned records in a keyed store are a
  warning count (they predate the key), not an error.
- Morning debrief: the Ledger integrity section gains a signature line
  (verified count, invalid seqs, unsigned-pre-key count) in both English and
  Chinese; invalid signatures count as a finding in the verdict.
- Public API: `generateKeyPair`, `signRecordHash`, `verifyRecordSignature`,
  `verifyLedgerSignatures`, `readSigningConfig`, `writeSigningKeys`,
  `signingKeyFiles` and the `KeyPairPem` / `SignatureCheck` / `SigningConfig`
  types.

### Compatibility
- Fully backward compatible: records without `sig` (every pre-existing
  ledger) parse and verify exactly as before. `sig` is deliberately excluded
  from the hashed content — the signature is computed over the hash, so
  signed and unsigned records share one hash rule and mixed ledgers verify
  end to end.
- A keyed store never silently downgrades to unsigned appends: a broken or
  empty key file makes the append fail (the hook layer spills the event and
  the debrief surfaces it) rather than writing an unsigned record.

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
