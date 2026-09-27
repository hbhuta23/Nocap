// Nocap side panel (B17–B20). Plain DOM; everything from agents is inserted with textContent, never innerHTML.
(function () {
  const vscode = acquireVsCodeApi();
  const $ = (id) => document.getElementById(id);

  const AGENTS = { 'claude-code': 'Claude Code', codex: 'Codex', 'gemini-cli': 'Gemini CLI', antigravity: 'Antigravity', 'vscode-chat': 'VS Code chat', cursor: 'Cursor', unknown: 'Terminal' };
  const SOURCES = { claude_hook: 'Claude Code', codex_hook: 'Codex', gemini_hook: 'Gemini CLI', antigravity_hook: 'Antigravity', vscode_hook: 'VS Code chat', cursor_hook: 'Cursor', panel: 'you', cli: 'the CLI' };
  const state = { online: true, checks: [], tasks: new Map(), rules: [], blindPrevented: 0, selectedId: null };

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = String(text);
    return n;
  }
  const risky = (c) => c.response.category !== 'safe' || c.response.verdict !== 'allow';
  const ago = (at) => {
    const s = Math.max(0, Math.round((Date.now() - at) / 1000));
    return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)}m ago` : `${Math.round(s / 3600)}h ago`;
  };
  const truncate = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

  // ---------- render ----------

  function renderHeader() {
    const status = $('status');
    status.textContent = state.online ? 'on' : 'offline';
    status.className = 'status' + (state.online ? '' : ' offline');
    const riskyChecks = state.checks.filter(risky);
    $('stat-checked').textContent = riskyChecks.length;
    $('stat-blocked').textContent = riskyChecks.filter((c) => c.response.verdict === 'block').length;
    $('stat-blind').textContent = state.blindPrevented;
    $('stat-blocked-box').classList.toggle('alert', riskyChecks.some((c) => c.response.verdict === 'block'));
  }

  function currentTask() {
    let latest = null;
    for (const t of state.tasks.values()) if (!latest || t.at > latest.at) latest = t;
    return latest;
  }

  function renderTask() {
    const t = currentTask();
    const text = $('task-text');
    text.textContent = t ? t.task : "No task yet. It's picked up from your prompt to the agent, or set it here.";
    text.className = 'task-text' + (t ? '' : ' muted');
    $('task-meta').textContent = t ? `from ${SOURCES[t.source] || t.source} · ${ago(t.at)}` : '';
  }

  function renderRules() {
    const list = $('rules');
    list.replaceChildren();
    if (!state.rules.length) {
      list.append(el('li', 'muted', 'No team rules yet. Add standards the AI must never break.'));
      return;
    }
    state.rules.forEach((rule, index) => {
      const li = el('li');
      li.append(el('span', '', rule));
      const remove = el('button', 'link', 'remove');
      remove.title = 'Remove this rule';
      remove.onclick = () => vscode.postMessage({ type: 'remove-rule', index });
      li.append(remove);
      list.append(li);
    });
  }

  function renderCap() {
    const box = $('cap');
    box.replaceChildren();
    const c = state.checks.find((x) => x.check_id === state.selectedId) || [...state.checks].reverse().find((x) => x.response.verdict === 'block');
    if (!c) return;
    const r = c.response;
    const q = c.request;
    const blocked = r.verdict !== 'allow' && r.verdict !== 'warn';
    const card = el('section', 'cap' + (blocked ? '' : ' allowed'));

    const head = el('div', 'cap-head');
    head.append(el('span', 'cap-title', blocked ? 'CAP DETECTED' : 'CHECKED'), el('span', 'muted', `${AGENTS[q.agent] || q.agent} · ${ago(c.at)}`));
    card.append(head, el('div', 'cap-headline', r.headline.replace(/^CAP DETECTED:\s*/i, '')));

    // Task / Agent says / Actually does
    const task = state.tasks.get(q.session_id) || currentTask();
    const layers = el('div', 'layers');
    const layer = (label, text, ok, why) => {
      const d = el('div', 'layer');
      const l = el('div', 'layer-label');
      l.append(el('span', '', label), el('span', ok ? 'ok' : 'bad', ok ? '✓' : '✗'));
      d.append(l, el('div', 'layer-text', text));
      if (why) d.title = why;
      return d;
    };
    layers.append(
      layer('Task', task ? truncate(task.task.split('\n')[0], 120) : 'no task set', true),
      layer('Agent says', q.intent ? truncate(q.intent, 120) : 'no reason given', r.layers.task_fit.ok, r.layers.task_fit.why),
      layer('Actually does', truncate(r.layers.intent_effect.why || q.command, 160), r.layers.intent_effect.ok, q.command),
    );
    card.append(layers);

    // Big numbers for high-severity facts, the rest as a list
    const high = r.facts.filter((f) => f.severity === 'high');
    if (high.length) {
      const nums = el('div', 'bignums');
      for (const f of high.slice(0, 3)) {
        const b = el('div', 'bignum');
        b.append(el('b', '', f.value), el('span', '', f.label));
        nums.append(b);
      }
      card.append(nums);
    }
    const rest = r.facts.filter((f) => f.severity !== 'high' || high.indexOf(f) >= 3);
    if (rest.length) {
      const facts = el('div', 'facts');
      for (const f of rest) {
        const row = el('div', 'fact');
        row.append(el('span', 'muted', f.label), el('span', f.severity === 'high' ? 'high' : '', f.value));
        facts.append(row);
      }
      card.append(facts);
    }

    const cmd = el('div', 'agent-msg');
    cmd.append(el('span', 'muted', 'Command'), el('p', 'mono', q.command));
    card.append(cmd);
    if (r.reason_for_agent) {
      const msg = el('div', 'agent-msg');
      msg.append(el('span', 'muted', 'Told the agent'), el('p', '', r.reason_for_agent));
      card.append(msg);
    }

    const foot = el('div', 'cap-foot');
    const meta = el('span', 'muted', `${r.latency_ms} ms`);
    if (r.mode === 'rules_only') meta.append(' ', el('span', 'badge', 'rules only'));
    if (r.human_confirmed) meta.append(' ', el('span', 'badge', 'confirmed by you'));
    const copy = el('button', 'link', 'copy message');
    copy.onclick = () => vscode.postMessage({ type: 'copy', text: r.reason_for_agent || r.headline });
    foot.append(meta, copy);
    card.append(foot);
    box.append(card);
  }

  function renderFeed() {
    const feed = $('feed');
    feed.replaceChildren();
    const riskyChecks = state.checks.filter(risky).slice(-40).reverse();
    const safe = state.checks.length - state.checks.filter(risky).length;
    if (!state.checks.length) {
      feed.append(el('p', 'muted', 'Nothing checked yet. Risky agent actions will show up here.'));
      return;
    }
    if (safe) feed.append(el('div', 'safe-count muted', `✓ ${safe} safe action${safe === 1 ? '' : 's'} passed straight through`));
    for (const c of riskyChecks) {
      const r = c.response;
      const row = el('button', `feed-row ${r.verdict}${c.check_id === state.selectedId ? ' selected' : ''}`);
      const top = el('div', 'feed-top');
      top.append(el('span', 'verdict', r.verdict === 'allow' ? 'allowed' : r.verdict === 'block' ? 'blocked' : r.verdict), el('span', 'muted', `${AGENTS[c.request.agent] || c.request.agent} · ${ago(c.at)}`));
      row.append(top, el('div', 'mono', truncate(c.request.command, 90)));
      if (r.headline && r.category !== 'safe') row.append(el('div', 'feed-headline muted', r.headline));
      row.onclick = () => {
        state.selectedId = c.check_id;
        renderCap();
        renderFeed();
      };
      feed.append(row);
    }
  }

  function renderAll() {
    renderHeader();
    renderTask();
    renderRules();
    renderCap();
    renderFeed();
  }

  // ---------- events ----------

  function addCheck(e) {
    if (state.checks.some((c) => c.check_id === e.check_id)) return;
    state.checks.push(e);
    if (state.checks.length > 300) state.checks.shift();
    if (e.response.verdict === 'block') state.selectedId = e.check_id; // newest block takes the spotlight
  }

  window.addEventListener('message', ({ data: m }) => {
    switch (m.type) {
      case 'init':
        state.online = m.online;
        state.rules = m.rules || [];
        for (const t of (m.recent && m.recent.tasks) || []) state.tasks.set(t.session_id, t);
        for (const c of (m.recent && m.recent.checks) || []) addCheck(c);
        state.blindPrevented = ((m.recent && m.recent.human) || []).filter((h) => h.outcome === 'refused' || h.outcome === 'mismatch').length;
        break;
      case 'status':
        state.online = m.online;
        break;
      case 'rules':
        state.rules = m.rules || [];
        break;
      case 'task.updated':
        state.tasks.set(m.session_id, m);
        break;
      case 'check.finished':
        addCheck(m);
        break;
      case 'human.answered':
        if (m.outcome === 'refused' || m.outcome === 'mismatch') state.blindPrevented++;
        break;
      default:
        return;
    }
    renderAll();
  });

  $('task-set').onclick = () => {
    const input = $('task-input');
    if (input.value.trim()) vscode.postMessage({ type: 'set-task', task: input.value.trim() });
    input.value = '';
  };
  // addEventListener, not onkeydown: an onkeydown handler that returns false cancels every keystroke.
  $('task-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('task-set').click();
  });
  $('rule-add').onclick = () => vscode.postMessage({ type: 'add-rule' });
  setInterval(() => (renderTask(), renderFeed()), 30_000); // refresh the "Xm ago" labels

  renderAll();
  vscode.postMessage({ type: 'ready' });
})();
