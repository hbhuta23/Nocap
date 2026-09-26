// Shared contracts (BRD §6). Both the daemon and the extension import this file.
// Changing anything here after the contracts session needs both devs to agree.

// ---------- Enums ----------

export type Verdict = 'allow' | 'warn' | 'block' | 'ask';
export type Category = 'data' | 'spend' | 'test_cheat' | 'secrets' | 'prod' | 'security' | 'safe';
export type Source = 'shim' | 'claude_hook' | 'commit_shim';
export type AgentName = 'claude-code' | 'codex' | 'gemini-cli' | 'unknown';
export type Tool = 'bash' | 'edit' | 'write';
export type Severity = 'low' | 'medium' | 'high';
export type VerdictMode = 'full' | 'rules_only';
export type HumanCheckMode = 'risky' | 'blocked_only' | 'off';

// ---------- §6.2 Check request ----------

export interface FileEdit {
  file: string;
  old: string;
  new: string;
}

export interface CheckRequest {
  session_id: string;
  source: Source;
  agent: AgentName;
  cwd: string;
  tool: Tool;
  command: string;
  /** Only present for file edits. */
  edit?: FileEdit;
  /** null when the agent gave none. */
  intent: string | null;
}

// ---------- §6.3 Verdict response ----------

export interface Fact {
  label: string;
  value: string;
  severity: Severity;
}

export interface LayerResult {
  ok: boolean;
  why: string;
}

export interface VerdictResponse {
  check_id: string;
  verdict: Verdict;
  category: Category;
  headline: string;
  facts: Fact[];
  layers: {
    task_fit: LayerResult;
    intent_effect: LayerResult;
  };
  reason_for_agent: string;
  mode: VerdictMode;
  latency_ms: number;
}

// ---------- §6.1 Other endpoints ----------

export interface TaskRequest {
  session_id: string;
  task: string;
  source: 'claude_hook' | 'panel' | 'cli';
}

export interface HumanIntentRequest {
  check_id: string;
  /** The human's typed expectation (first step). */
  answer?: string;
  /** The typed confirm number on the mismatch screen (FR-H5). */
  confirm?: string;
  /** How long the pop-up was open before submit, for FR-H3 / FR-H6. */
  ms_since_open: number;
}

export interface HumanIntentResponse {
  accepted: boolean;
  /** Set when the answer was refused (reflex answer, wrong confirm number). */
  message?: string;
  /** After the judge compares: did the expectation match the measured effect? */
  match?: boolean;
  /** On mismatch: what the action actually does, and the number to type to override. */
  mismatch?: { expected: string; actual: string; confirm_number: string };
}

export interface HealthResponse {
  ok: true;
  version: string;
}

// ---------- WS /v1/stream events ----------

export type StreamEvent =
  | { type: 'check.started'; check_id: string; request: CheckRequest; at: number }
  | { type: 'check.finished'; check_id: string; request: CheckRequest; response: VerdictResponse; at: number }
  | { type: 'task.updated'; session_id: string; task: string; source: TaskRequest['source']; at: number }
  | {
      type: 'human.needed';
      check_id: string;
      /** FR-H2: only the command and task, never the measured numbers. */
      command: string;
      task: string | null;
      category: Category;
      at: number;
    }
  | { type: 'human.answered'; check_id: string; outcome: HumanOutcome; at: number };

/** How a human intent check ended (FR-H5/H6). Shared by the stream event and the audit log. */
export type HumanOutcome = 'match' | 'mismatch' | 'override' | 'timeout' | 'refused';

// ---------- §6.5 Plug-in interfaces inside the daemon ----------

export interface Ctx {
  config: NocapConfig;
  /** Current task for this session, if any. */
  task: string | null;
  workspaceRoot: string;
}

export interface Measurement {
  /** Shown in the panel. */
  facts: Fact[];
  /** What the judge sees. Must never contain redacted columns or secrets (FR-G7). */
  judgeContext: object;
  /** Rule-based block reason; skips the judge. */
  hardBlock?: string;
}

export interface Measurer {
  category: Category;
  /** Cheap, no I/O. */
  matches(req: CheckRequest): boolean;
  measure(req: CheckRequest, ctx: Ctx): Promise<Measurement>;
}

export interface JudgeInput {
  task: string | null;
  /** The agent's stated intent, or the human's typed expectation. */
  intent: string | null;
  /** Who wrote `intent`. The human path (FR-H4) uses the same judge. */
  speaker: 'agent' | 'human';
  category: Category;
  judgeContext: object;
}

export interface JudgeResult {
  task_fit: LayerResult;
  intent_effect: LayerResult;
  suggested_verdict: Verdict;
  headline: string;
  reason_for_agent: string;
  mode: VerdictMode;
}

export interface Judge {
  judge(input: JudgeInput): Promise<JudgeResult>;
}

// ---------- §6.6 .nocap.yml ----------

export interface NocapConfig {
  version: 1;
  database?: {
    url_env?: string;
    protected_tables?: string[];
    sensitive_rows?: { table: string; where: string }[];
    redact_columns?: string[];
  };
  human_check: HumanCheckMode;
  budget: { per_command_usd: number; per_session_usd: number };
  tests: { globs: string[] };
  production?: { hosts?: string[]; kube_contexts?: string[] };
  network?: { allow_domains?: string[] };
}

// ---------- §6.7 MongoDB Atlas collections (from Role B) ----------

/** `sessions`: one document per agent session. */
export interface SessionDoc {
  session_id: string;
  agent: AgentName;
  task: string | null;
  repo: string;
  /** ISO timestamp. */
  started_at: string;
  spend_usd: number;
}

/** `checks`: one document per risky action checked. */
export interface CheckDoc {
  check_id: string;
  request: CheckRequest;
  response: VerdictResponse;
  /** ISO timestamp. */
  created_at: string;
}

/** `human_checks`: one document per human intent pop-up. */
export interface HumanCheckDoc {
  check_id: string;
  answer: string;
  seconds_to_answer: number;
  rejected_attempts: number;
  outcome: HumanOutcome;
}
