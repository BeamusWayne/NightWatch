export type Lang = 'en' | 'zh';

/** Report strings. Keys are stable; both languages must define every key. */
const STRINGS = {
  title: { en: '🌙 NightWatch Debrief', zh: '🌙 NightWatch 晨报' },
  session: { en: 'Session', zh: '会话' },
  model: { en: 'Model', zh: '模型' },
  duration: { en: 'Duration', zh: '时长' },
  hours: { en: 'h', zh: '小时' },
  events: { en: 'events', zh: '条事件' },
  toolUses: { en: 'tool calls', zh: '次工具调用' },
  goal: { en: 'Declared goal', zh: '声明目标' },
  firstPrompt: { en: 'First prompt', zh: '首条指令' },
  chainTitle: { en: 'Ledger integrity', zh: '台账完整性' },
  chainOk: { en: 'hash chain intact ({n} records)', zh: '哈希链完整（{n} 条记录）' },
  chainBroken: { en: 'CHAIN BROKEN at seq {seq}: {reason}', zh: '哈希链在 seq {seq} 处断裂：{reason}' },
  chainTruncated: { en: 'TRUNCATION SUSPECTED: {reason}', zh: '疑似被截断：{reason}' },
  sigVerified: { en: 'signatures: {verified}/{signed} verified', zh: '签名核验：{verified}/{signed} 通过' },
  sigInvalid: { en: 'SIGNATURE INVALID on {n} record(s) (seq {seqs})', zh: '{n} 条记录签名无效（seq {seqs}）' },
  sigUnsigned: { en: '{n} unsigned record(s) predate the key', zh: '{n} 条记录早于密钥，未签名' },
  spilled: { en: '{n} event(s) spilled (see .nightwatch/spill/)', zh: '{n} 条事件溢出（见 .nightwatch/spill/）' },
  timelineTitle: { en: 'Timeline', zh: '时间线' },
  claimsTitle: { en: 'Claims — verified, not trusted', zh: '主张核验 — 验证而非信任' },
  testClaim: { en: 'test run', zh: '测试运行' },
  claimVerified: { en: 'verified by re-run', zh: '重跑核实通过' },
  claimNowFailing: { en: 'CLAIMED PASS, NOW FAILING', zh: '自称通过，重跑失败' },
  claimMismatch: { en: 'claimed failure, passes now', zh: '记录为失败，现已通过' },
  claimSkipped: { en: 'not re-run', zh: '未重跑' },
  claimError: { en: 're-run errored', zh: '重跑出错' },
  noTestClaims: { en: 'No test-run claims recorded.', zh: '未记录任何测试运行主张。' },
  gitTitle: { en: 'Git operations', zh: 'Git 操作' },
  noGitOps: { en: 'No git operations recorded.', zh: '未记录 git 操作。' },
  scopeTitle: { en: 'Scope check', zh: '范围核验' },
  scopeNoGit: { en: 'git ground truth unavailable — showing ledger claims only', zh: '无 git 基准 — 仅显示台账主张' },
  scopeDeclared: { en: 'Declared scope', zh: '声明范围' },
  scopeNone: { en: '(no scope declared — reporting distribution only)', zh: '（未声明范围 — 仅报告分布）' },
  filesChanged: { en: '{n} file(s) actually changed', zh: '实际变更 {n} 个文件' },
  inScope: { en: '{pct}% inside declared scope', zh: '{pct}% 在声明范围内' },
  outOfScope: { en: 'OUT OF SCOPE', zh: '超出范围' },
  unclaimed: { en: 'CHANGED BUT NEVER CLAIMED (out-of-band writes)', zh: '已变更但台账未声明（绕过工具的写入）' },
  noneFlag: { en: 'none 🎉', zh: '无 🎉' },
  checkpointsTitle: { en: 'Checkpoints', zh: '检查点' },
  noCheckpoints: { en: 'No checkpoints recorded.', zh: '未记录检查点。' },
  restoreHint: { en: 'restore with', zh: '恢复命令' },
  classRead: { en: 'read', zh: '读取' },
  classWrite: { en: 'write', zh: '写入' },
  classExec: { en: 'exec', zh: '执行' },
  classNet: { en: 'network', zh: '网络' },
  classVcs: { en: 'git', zh: 'git' },
  classAgent: { en: 'subagent', zh: '子代理' },
  classOther: { en: 'other', zh: '其他' },
  generatedAt: { en: 'Generated', zh: '生成时间' },
  verdictTitle: { en: 'Verdict', zh: '结论' },
  verdictClean: {
    en: 'Chain intact, claims hold, changes within scope. Reviewable.',
    zh: '哈希链完整、主张成立、变更在范围内。可以放心审查。',
  },
  verdictAttention: { en: '{n} finding(s) need your attention before trusting this run.', zh: '有 {n} 项发现需要你先处理，再信任这次运行。' },
} as const;

export type StringKey = keyof typeof STRINGS;

export function t(key: StringKey, lang: Lang, vars: Record<string, string | number> = {}): string {
  let text: string = STRINGS[key][lang];
  for (const [name, value] of Object.entries(vars)) {
    text = text.replaceAll(`{${name}}`, String(value));
  }
  return text;
}

export function classLabel(cls: string, lang: Lang): string {
  const key = (`class${cls.charAt(0).toUpperCase()}${cls.slice(1)}`) as StringKey;
  return key in STRINGS ? t(key, lang) : cls;
}
