// Nocap approval pop-up (FR-H1..H5). Agent-supplied text is only ever set with textContent.
(function () {
  const vscode = acquireVsCodeApi();
  const card = document.getElementById('card');
  const MIN_READ_MS = 2000; // FR-H3: no approving in the first 2 seconds
  let openedAt = performance.now();
  let busy = false;

  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = String(text);
    return n;
  };
  const kbd = (t) => el('kbd', '', t);

  function header(title, sub, logo) {
    const h = el('div', 'head');
    if (logo) {
      const img = document.createElement('img');
      img.src = logo;
      img.alt = '';
      h.append(img);
    }
    const t = el('div');
    t.append(el('div', 'title', title), el('div', 'sub', sub));
    h.append(t);
    return h;
  }

  let ctx = null;

  function renderAsk(errorText) {
    card.className = 'card';
    card.replaceChildren(header('Nocap needs your OK', `${ctx.agent} wants to run this`, ctx.logo));
    card.append(el('div', 'label', 'Command'), el('pre', 'command', ctx.command));
    if (ctx.task) card.append(el('div', 'label', 'Your task'), el('div', 'task', ctx.task));
    card.append(el('div', 'question', 'What do you expect this to do?'));
    const box = el('textarea');
    box.placeholder = 'In your own words, e.g. "delete the QA test accounts"';
    const err = el('div', 'error', errorText || '');
    const actions = el('div', 'actions');
    const hint = el('span', 'hint', 'Nocap compares your answer with what the command really does.');
    const buttons = el('div', 'buttons');
    const decline = el('button', 'secondary', 'Decline');
    decline.append(kbd('Esc'));
    const approve = el('button', 'primary', 'Approve');
    approve.append(kbd('↵'));
    const wait = Math.max(0, MIN_READ_MS - (performance.now() - openedAt));
    if (wait > 0) {
      approve.disabled = true;
      const fill = el('span', 'fill');
      fill.style.animationDuration = `${wait}ms`;
      approve.append(fill);
      setTimeout(() => {
        approve.disabled = false;
        fill.remove();
      }, wait);
    }
    decline.onclick = declineNow;
    approve.onclick = () => submitAnswer(box.value, approve);
    box.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (!approve.disabled) submitAnswer(box.value, approve);
      }
    });
    buttons.append(decline, approve);
    actions.append(hint, buttons);
    card.append(box, err, actions);
    box.focus();
  }

  function renderMismatch(m, errorText) {
    card.className = 'card cap';
    card.replaceChildren(header('CAP DETECTED', "That's not what this command does", ctx.logo));
    card.append(el('div', 'label', 'Command'), el('pre', 'command', ctx.command));
    const compare = el('div', 'compare');
    const a = el('div');
    a.append(el('b', '', 'You expected'), document.createTextNode(m.expected));
    const b = el('div', 'actual');
    b.append(el('b', '', 'It actually'), document.createTextNode(m.actual));
    compare.append(a, b);
    card.append(compare);
    const word = m.confirm_number;
    card.append(el('div', 'question', `To run it anyway, type ${word}`));
    const input = el('input');
    input.placeholder = word;
    const err = el('div', 'error', errorText || '');
    const actions = el('div', 'actions');
    const buttons = el('div', 'buttons');
    const decline = el('button', 'secondary', 'Decline');
    decline.append(kbd('Esc'));
    const run = el('button', 'danger', 'Run anyway');
    decline.onclick = declineNow;
    run.onclick = () => submitConfirm(input.value, run);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submitConfirm(input.value, run);
    });
    buttons.append(decline, run);
    actions.append(el('span', 'hint', 'Declining blocks the command and tells the agent.'), buttons);
    card.append(input, err, actions);
    input.focus();
  }

  function renderState(kind, text) {
    card.className = 'card' + (kind === 'ok' ? ' ok' : kind === 'no' ? ' cap' : '');
    card.replaceChildren(header('Nocap', ctx ? ctx.command : '', ctx && ctx.logo));
    const s = el('div', 'state');
    if (kind === 'wait') s.append(el('div', 'spinner'));
    s.append(document.createTextNode(text));
    card.append(s);
  }

  function submitAnswer(text, button) {
    if (busy || !text.trim()) return;
    busy = true;
    button.disabled = true;
    vscode.postMessage({ type: 'answer', answer: text.trim(), ms: Math.round(performance.now() - openedAt) });
    renderState('wait', 'Checking your answer against the command…');
  }

  function submitConfirm(text, button) {
    if (busy) return;
    busy = true;
    button.disabled = true;
    vscode.postMessage({ type: 'confirm', confirm: text.trim(), ms: Math.round(performance.now() - openedAt) });
  }

  function declineNow() {
    if (busy) return;
    busy = true;
    vscode.postMessage({ type: 'decline' });
    renderState('no', 'Declined. The command was blocked and the agent was told.');
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      declineNow();
    }
  });

  let lastMismatch = null;
  window.addEventListener('message', ({ data: m }) => {
    busy = false;
    if (m.type === 'init') {
      ctx = m;
      openedAt = performance.now();
      renderAsk();
    } else if (m.type === 'refused') {
      renderAsk(m.message);
    } else if (m.type === 'mismatch') {
      lastMismatch = m;
      renderMismatch(m);
    } else if (m.type === 'confirm-refused') {
      renderMismatch(lastMismatch, m.message);
    } else if (m.type === 'approved') {
      busy = true;
      renderState('ok', 'Approved. The command is running.');
    } else if (m.type === 'closed') {
      busy = true;
      renderState('no', m.message || 'This request was already handled.');
    }
  });

  vscode.postMessage({ type: 'ready' });
})();
