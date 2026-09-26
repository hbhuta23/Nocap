/**
 * nocap — shared/src/types.ts
 *
 * Single source of truth for the daemon <-> extension <-> shims contract.
 * Import this file from both packages/daemon and packages/extension so
 * nothing drifts once hour 2 has passed (see BRD section 6).
 */

// ---------------------------------------------------------------------------
// Enums / literal unions
// ---------------------------------------------------------------------------

export type Category =
  | "data"
  | "spend"
  | "test_cheat"
  | "secrets"
  | "prod"
  | "security"
  | "safe";

export type Verdict = "allow" | "warn" | "block" | "ask";

export type Source = "shim" | "claude_hook" | "commit_shim";

export type Agent = "claude-code" | "codex" | "gemini-cli" | "unknown";

export type Tool = "bash" | "edit" | "write";

export type JudgeMode = "full" | "rules_only";

export type Severity = "low" | "medium" | "high";

export type HumanCheckMode = "risky" | "blocked_only" | "off";

// ---------------------------------------------------------------------------
// 6.2 — Check request (POST /v1/check)
// ---------------------------------------------------------------------------

export interface EditPayload {
  file: string;
  old: string;
  new: string;
}

export interface CheckRequest {
  session_id: string;
  source: Source;
  agent: Agent;
  cwd: string;
  tool: Tool;
  command: string;
  /** Present only for file edits (tool === "edit" | "write"). */
  edit?: EditPayload;
  /** Null when the agent gave no stated intent. */
  intent: string | null;
}

// ---------------------------------------------------------------------------
// 6.3 — Verdict response
// ---------------------------------------------------------------------------

export interface Fact {
  label: string;
  value: string;
  severity: Severity;
}

export interface LayerResult {
  ok: boolean;
  why: string;
}

export interface VerdictLayers {
  task_fit: LayerResult;
  intent_effect: LayerResult;
}

export interface VerdictResponse {
  check_id: string;
  verdict: Verdict;
  category: Category;
  headline: string;
  facts: Fact[];
  layers: VerdictLayers;
  reason_for_agent: string;
  mode: JudgeMode;
  latency_ms: number;
}

// ---------------------------------------------------------------------------
// POST /v1/task
// ---------------------------------------------------------------------------

export interface SetTaskRequest {
  session_id: string;
  task: string;
}

// ---------------------------------------------------------------------------
// POST /v1/humanintent
// ---------------------------------------------------------------------------

export interface HumanIntentRequest {
  check_id: string;
  /** The human's typed expectation, or the typed confirm number on mismatch. */
  answer: string;
  /** Milliseconds between the pop-up opening and this answer being submitted. */
  seconds_to_answer: number;
}

export interface HumanCheckResult {
  check_id: string;
  answer: string;
  seconds_to_answer: number;
  rejected_attempts: number;
  outcome: Verdict;
}

// ---------------------------------------------------------------------------
// GET /v1/health
// ---------------------------------------------------------------------------

export interface HealthResponse {
  status: "ok";
  uptime_ms: number;
}

// ---------------------------------------------------------------------------
// WS /v1/stream — live events
// ---------------------------------------------------------------------------

export type StreamEventType =
  | "check.started"
  | "check.finished"
  | "task.updated"
  | "human.needed"
  | "human.answered";

export interface CheckStartedEvent {
  type: "check.started";
  check_id: string;
  request: CheckRequest;
}

export interface CheckFinishedEvent {
  type: "check.finished";
  check_id: string;
  response: VerdictResponse;
}

export interface TaskUpdatedEvent {
  type: "task.updated";
  session_id: string;
  task: string;
}

export interface HumanNeededEvent {
  type: "human.needed";
  check_id: string;
  command: string;
}

export interface HumanAnsweredEvent {
  type: "human.answered";
  check_id: string;
  result: HumanCheckResult;
}

export type StreamEvent =
  | CheckStartedEvent
  | CheckFinishedEvent
  | TaskUpdatedEvent
  | HumanNeededEvent
  | HumanAnsweredEvent;

// ---------------------------------------------------------------------------
// 6.5 — Plug-in interfaces inside the daemon
// ---------------------------------------------------------------------------

/** Whatever a Measurer needs beyond the raw request (config, db handles, etc). */
export interface Ctx {
  config: NocapConfig;
  /** Freeform bag for measurer-specific dependencies (db pool, git client, ...). */
  [key: string]: unknown;
}

export interface Measurement {
  /** Shown in the panel. */
  facts: Fact[];
  /** What the judge sees. Must never contain secrets or redacted columns (FR-G7). */
  judgeContext: object;
  /** Rule-based block reason. When set, skips the judge entirely. */
  hardBlock?: string;
}

export interface Measurer {
  category: Category;
  /** Cheap, synchronous, no I/O. */
  matches(req: CheckRequest): boolean;
  measure(req: CheckRequest, ctx: Ctx): Promise<Measurement>;
}

export interface JudgeInput {
  task: string | null;
  intent: string | null;
  category: Category;
  judgeContext: object;
}

export interface JudgeResult {
  task_fit: LayerResult;
  intent_effect: LayerResult;
  suggested_verdict: Verdict;
  reason_for_agent: string;
}

export interface Judge {
  judge(input: JudgeInput): Promise<JudgeResult>;
}

// ---------------------------------------------------------------------------
// 6.6 — .nocap.yml
// ---------------------------------------------------------------------------

export interface SensitiveRowRule {
  table: string;
  where: string;
}

export interface DatabaseConfig {
  url_env: string;
  protected_tables: string[];
  sensitive_rows: SensitiveRowRule[];
  redact_columns: string[];
}

export interface BudgetConfig {
  per_command_usd: number;
  per_session_usd: number;
}

export interface TestsConfig {
  globs: string[];
}

export interface ProductionConfig {
  hosts: string[];
  kube_contexts: string[];
}

export interface NetworkConfig {
  allow_domains: string[];
}

export interface NocapConfig {
  version: number;
  database: DatabaseConfig;
  human_check: HumanCheckMode;
  budget: BudgetConfig;
  tests: TestsConfig;
  production: ProductionConfig;
  network: NetworkConfig;
}

// ---------------------------------------------------------------------------
// 6.7 — MongoDB Atlas collections
// ---------------------------------------------------------------------------

export interface SessionDoc {
  session_id: string;
  agent: Agent;
  task: string | null;
  repo: string;
  started_at: string; // ISO timestamp
  spend_usd: number;
}

export interface CheckDoc {
  check_id: string;
  request: CheckRequest;
  response: VerdictResponse;
  created_at: string; // ISO timestamp
}

export interface HumanCheckDoc {
  check_id: string;
  answer: string;
  seconds_to_answer: number;
  rejected_attempts: number;
  outcome: Verdict;
}
