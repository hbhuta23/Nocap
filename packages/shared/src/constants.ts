export const DAEMON_HOST = '127.0.0.1';
export const DAEMON_PORT = Number(process.env.NOCAP_PORT ?? 7777);

/** Exit code the shims use when nocap blocks a command (§6.4). */
export const SHIM_BLOCK_EXIT_CODE = 86;

export const SAFE_LATENCY_BUDGET_MS = 50; // FR-G1
export const DEEP_CHECK_BUDGET_MS = 5_000;
export const JUDGE_TIMEOUT_MS = 4_000; // FR-G5
export const HUMAN_CHECK_TIMEOUT_MS = 300_000; // FR-H1
export const OVERRIDE_WINDOW_MS = 60_000; // FR-G3

export const DEFAULT_TEST_GLOBS = ['**/*.test.*', '**/*.spec.*', '**/test_*.py', 'tests/**'];
