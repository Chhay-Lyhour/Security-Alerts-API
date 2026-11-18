// Analyst console for the Security Alerts API. Plain browser JavaScript, no
// build step. Same origin as the API, so no CORS. Every value from the server
// is escaped before it touches the page.
'use strict';
{
  // ------------------------------------------------------------------ state
  const S = {
    token: null,
    refresh: null,
    user: null,
    sources: new Map(), // id -> name
    rules: [],
    config: null,
    tab: 'live',
    seen: new Set(), // alert/block/lockout ids already shown
    primed: false, // first live load done (no toasts for old events)
    timers: [],
    page: { alerts: 1, attempts: 1, audit: 1 },
  };
  const SESSION_KEY = 'sa-dashboard-session';
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const isAdmin = () => S.user?.role === 'admin';

  const esc = (v) =>
    String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  // ------------------------------------------------------------------ labels
  const LOGIN_SIGNALS = {
    brute_force: 'Excessive failed logins',
    credential_stuffing: 'IP password spraying',
    possible_compromise: 'Possible account compromise',
    new_device: 'New / unknown device',
    new_country: 'New country',
    account_enumeration: 'Account enumeration',
    unusual_time: 'Abnormal login time',
    post_lockout_attempt: 'Login right after lockout',
    new_ip: 'New IP address',
    rapid_logins: 'Rapid logins',
    returning_device: 'Returning device',
  };
  const SEVERITIES = ['low', 'medium', 'high', 'critical'];
  const rank = (s) => SEVERITIES.indexOf(s);

  // ------------------------------------------------------------------ time
  const ago = (iso) => {
    const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
    if (s < 60) return `${s}s ago`;
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    return `${Math.floor(s / 86400)}d ago`;
  };
  const until = (iso) => {
    if (!iso) return 'until lifted';
    const s = Math.round((new Date(iso).getTime() - Date.now()) / 1000);
    if (s <= 0) return 'ending';
    if (s < 60) return `${s}s left`;
    if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s left`;
    return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m left`;
  };
  const clock = (iso) =>
    new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const windowText = (sec) => (sec % 60 === 0 ? `${sec / 60} min` : `${sec}s`);

  // ------------------------------------------------------------------ api
  class ApiError extends Error {
    constructor(status, message) {
      super(message);
      this.status = status;
    }
  }

  async function api(path, { method = 'GET', body, retried = false } = {}) {
    const res = await fetch(path, {
      method,
      headers: {
        ...(body !== undefined && { 'Content-Type': 'application/json' }),
        ...(S.token && { Authorization: `Bearer ${S.token}` }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status === 401 && S.refresh && !retried && !path.startsWith('/auth/')) {
      if (await refreshSession()) return api(path, { method, body, retried: true });
      signOut('Your session ended. Sign in again.');
      throw new ApiError(401, 'Session ended');
    }
    if (res.status === 204) return null;
    const text = await res.text();
    const data = text ? safeJson(text) : null;
    if (!res.ok) {
      const msg = Array.isArray(data?.message) ? data.message.join(', ') : data?.message || res.statusText;
      throw new ApiError(res.status, msg);
    }
    return data;
  }
  const safeJson = (t) => {
    try {
      return JSON.parse(t);
    } catch {
      return null;
    }
  };
  const qs = (o) =>
    new URLSearchParams(Object.entries(o).filter(([, v]) => v !== '' && v !== undefined && v !== null && v !== false)).toString();

  async function refreshSession() {
    try {
      const res = await fetch('/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: S.refresh }),
      });
      if (!res.ok) return false;
      saveSession(await res.json());
      return true;
    } catch {
      return false;
    }
  }

  function saveSession(auth) {
    S.token = auth.accessToken;
    S.refresh = auth.refreshToken;
    S.user = auth.user ?? S.user;
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify({ token: S.token, refresh: S.refresh, user: S.user }));
    } catch {
      /* private mode: session lasts until reload */
    }
  }

  function loadSession() {
    try {
      const s = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null');
      if (s?.token && s?.refresh && s?.user) Object.assign(S, s);
    } catch {
      /* ignore */
    }
  }

  // ------------------------------------------------------------------ toasts
  function toast(kind, text, sev = 'high') {
    const el = document.createElement('div');
    el.className = `toast sev-${sev}`;
    el.innerHTML = `<b>${esc(kind)}</b>${esc(text)}`;
    $('#toasts').prepend(el);
    setTimeout(() => el.remove(), 7000);
    while ($('#toasts').children.length > 4) $('#toasts').lastElementChild.remove();
  }

  // ------------------------------------------------------------------ auth screen
  async function submitAuth(e) {
    e.preventDefault();
    const email = $('#auth-email').value.trim();
    const password = $('#auth-password').value;
    const msg = $('#auth-msg');
    msg.className = 'msg';
    if (!email || !password) return (msg.textContent = 'Enter your email and password.');
    const btn = $('#auth-submit');
    btn.disabled = true;
    const slow = setTimeout(() => {
      msg.className = 'msg ok';
      msg.textContent = 'Waking up the server. The first request after a quiet spell can take up to a minute…';
    }, 4000);
    try {
      const auth = await api('/auth/login', { method: 'POST', body: { email, password } });
      saveSession(auth);
      $('#auth-password').value = '';
      start();
    } catch (err) {
      msg.className = 'msg';
      msg.textContent =
        err.status === 429
          ? 'Too many attempts: the login engine has locked this email or IP for now. Try again later.'
          : err.status === 403
            ? 'Access denied: this IP is blocked by the firewall.'
            : err.status === 401
              ? 'Wrong email or password.'
              : err.message || 'Could not reach the server.';
    } finally {
      clearTimeout(slow);
      btn.disabled = false;
    }
  }

  function signOut(message) {
    if (S.refresh) fetch('/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken: S.refresh }) }).catch(() => {});
    S.timers.forEach(clearInterval);
    S.timers = [];
    Object.assign(S, { token: null, refresh: null, user: null, primed: false, seen: new Set() });
    try {
      sessionStorage.removeItem(SESSION_KEY);
    } catch {
      /* ignore */
    }
    $('#app').hidden = true;
    $('#auth').hidden = false;
    $('#auth-msg').className = 'msg';
    $('#auth-msg').textContent = message || '';
  }

  // ------------------------------------------------------------------ boot
  async function start() {
    $('#auth').hidden = true;
    $('#app').hidden = false;
    $('#me').innerHTML = `${esc(S.user.email)}<b>${esc(S.user.role)}</b>`;
    $$('[data-admin]').forEach((el) => (el.hidden = !isAdmin()));
    await loadReference();
    showTab(location.hash.slice(1) || 'live');
    S.timers.push(setInterval(() => !document.hidden && S.tab === 'live' && loadLive(), 4000));
    S.timers.push(setInterval(() => !document.hidden && S.tab !== 'live' && watch(), 8000));
    S.timers.push(setInterval(() => !document.hidden && ['firewall', 'logins'].includes(S.tab) && loadTab(S.tab), 10000));
  }

  async function loadReference() {
    const [sources, rules, config] = await Promise.all([
      api('/sources').catch(() => []),
      api('/rules').catch(() => []),
      api('/detection/config').catch(() => null),
    ]);
    S.sources = new Map((sources ?? []).map((s) => [s.id, s.name]));
    S.rules = Array.isArray(rules) ? rules : (rules?.data ?? []);
    S.config = config;
    const opts = [...S.sources].map(([id, name]) => `<option value="${esc(id)}">${esc(name)}</option>`).join('');
    for (const sel of [$('#live-source'), $('#alert-filters [name=sourceId]')]) {
      const keep = sel.value;
      sel.innerHTML = `<option value="">All sources</option>${opts}`;
      sel.value = keep;
    }
  }

  function showTab(tab) {
    if (!$(`#tab-${tab}`) || (['audit', 'users'].includes(tab) && !isAdmin())) tab = 'live';
    S.tab = tab;
    history.replaceState(null, '', `#${tab}`);
    $$('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
    $$('.tab').forEach((t) => (t.hidden = t.id !== `tab-${tab}`));
    loadTab(tab);
  }

  function loadTab(tab) {
    const run = { live: loadLive, alerts: loadAlerts, firewall: loadFirewall, logins: loadLogins, rules: loadRules, users: loadUsers, audit: loadAudit }[tab];
    return run?.().catch(showLoadError);
  }

  function showLoadError(err) {
    if (err?.status === 401) return;
    $('#pulse').className = 'pulse down';
    $('#updated').textContent = `Can't reach the API: ${err?.message ?? err}`;
  }
  function markUpdated() {
    $('#pulse').className = 'pulse live';
    $('#updated').textContent = `Updated ${new Date().toLocaleTimeString()}`;
  }

  // ------------------------------------------------------------------ shared bits
  const sourceName = (id) => S.sources.get(id) ?? (id ? `source ${id.slice(0, 8)}` : '');
  const sevPill = (s) => `<span class="pill sev-${esc(s)}">${esc(s)}</span>`;
  const ipBtn = (ip) => (ip ? `<button type="button" class="ip" data-ip="${esc(ip)}">${esc(ip)}</button>` : '<span class="meta">no IP</span>');
  const isEscalation = (a) => typeof a?.payload?.ruleId === 'string';
  const empty = (text) => `<div class="empty">${esc(text)}</div>`;

  // ------------------------------------------------------------------ LIVE
  async function fetchLiveData() {
    const sourceId = $('#live-source').value;
    const since = new Date(Date.now() - 24 * 3600_000).toISOString();
    const [alerts, openHigh, openCritical, blocks, lockouts, attempts] = await Promise.all([
      api(`/alerts?${qs({ from: since, limit: 100, sourceId })}`),
      api(`/alerts?${qs({ status: 'open', severity: 'high', limit: 1, sourceId })}`),
      api(`/alerts?${qs({ status: 'open', severity: 'critical', limit: 1, sourceId })}`),
      api('/firewall/blocked-ips'),
      api('/detection/lockouts'),
      api('/detection/login-attempts?flagged=true&limit=15'),
    ]);
    return { alerts, openHigh, openCritical, blocks, lockouts, attempts, sourceId };
  }

  async function loadLive() {
    const d = await fetchLiveData();
    renderLive(d);
    notifyNew(d);
    markUpdated();
  }

  /** On other tabs: keep toasts coming without redrawing the live view. */
  async function watch() {
    try {
      notifyNew(await fetchLiveData());
    } catch {
      /* the visible tab reports errors */
    }
  }

  function notifyNew({ alerts, blocks, lockouts }) {
    const fresh = [];
    for (const a of alerts.data) if (isEscalation(a) && !S.seen.has(a.id)) fresh.push(['Rule fired', `${a.payload.ruleName} · ${a.ipAddress ?? 'no IP'}`, a.severity, a.id]);
    for (const b of blocks) if (!S.seen.has(b.id)) fresh.push(['IP blocked', `${b.network} · ${b.origin === 'auto' ? 'automatic' : 'manual'}`, 'critical', b.id]);
    for (const l of lockouts) if (!S.seen.has(l.id)) fresh.push(['Login locked', `${l.targetType} ${l.target} · ${LOGIN_SIGNALS[l.reason] ?? l.reason}`, 'high', l.id]);
    for (const [kind, text, sev, id] of fresh) {
      if (S.primed) toast(kind, text, sev);
      S.seen.add(id);
    }
    S.primed = true;
  }

  function renderLive({ alerts, openHigh, openCritical, blocks, lockouts, attempts, sourceId }) {
    const list = alerts.data;
    // Login-engine alerts are already on screen as scored sign-ins.
    const raw = list.filter((a) => !isEscalation(a) && a.payload?.engine !== 'login');
    const fired = list.filter(isEscalation);
    const activeBlocks = blocks;

    // KPIs
    const kpis = [
      [alerts.total, 'Alerts in the last 24 h'],
      [openHigh.total + openCritical.total, 'Open high and critical', openHigh.total + openCritical.total > 0],
      [fired.length + (alerts.total > 100 ? '+' : ''), 'Rules fired (24 h)'],
      [activeBlocks.length, 'IPs blocked now', activeBlocks.length > 0],
      [lockouts.length, 'Logins locked now', lockouts.length > 0],
    ];
    $('#kpis').innerHTML = kpis
      .map(([n, label, hot]) => `<div class="kpi${hot ? ' hot' : ''}"><b>${esc(n)}</b><span>${esc(label)}</span></div>`)
      .join('');

    // 01 Detect: raw events from apps + attempts the login engine flagged
    const detect = [
      ...raw.slice(0, 14).map((a) => ({ at: a.createdAt, id: a.id, html: detectAlert(a) })),
      ...(sourceId ? [] : attempts.data.map((t) => ({ at: t.createdAt, id: `att-${t.id}`, html: detectAttempt(t) }))),
    ]
      .sort((x, y) => new Date(y.at) - new Date(x.at))
      .slice(0, 14);
    paint('#feed-detect', detect, 'Nothing detected in the last 24 hours. Send an event, or try a few wrong passwords.');

    // 02 Score: live progress towards each rule, per IP
    paint('#feed-meters', meters(raw), 'No IP is counting towards a rule right now.');
    const scored = [
      ...fired.map((a) => ({ at: a.createdAt, id: `fire-${a.id}`, html: firedItem(a) })),
      ...(sourceId ? [] : attempts.data.filter((t) => t.riskScore > 0).map((t) => ({ at: t.createdAt, id: `score-${t.id}`, html: scoreItem(t) }))),
    ]
      .sort((x, y) => new Date(y.at) - new Date(x.at))
      .slice(0, 10);
    paint('#feed-score', scored, 'No rule has fired yet.');

    // 03 Protect
    const protect = [
      ...activeBlocks.map((b) => ({ at: b.createdAt, id: `blk-${b.id}`, html: blockItem(b) })),
      ...lockouts.map((l) => ({ at: l.createdAt, id: `lck-${l.id}`, html: lockItem(l) })),
    ].sort((x, y) => new Date(y.at) - new Date(x.at));
    paint('#feed-protect', protect, 'Nobody is blocked or locked. All traffic is allowed.');
  }

  /** Re-renders a feed; items not seen before get a short highlight. */
  const painted = new Map(); // feed selector -> Set of ids
  function paint(sel, items, emptyText) {
    const el = $(sel);
    const before = painted.get(sel);
    el.innerHTML = items.length
      ? items.map((i) => i.html.replace('class="item', `data-k="${esc(i.id)}" class="item${before && !before.has(i.id) ? ' fresh' : ''}`)).join('')
      : empty(emptyText);
    painted.set(sel, new Set(items.map((i) => i.id)));
  }

  function detectAlert(a) {
    return `<div class="item sev-${esc(a.severity)}">
      <div class="row">${sevPill(a.severity)}<code>${esc(a.type)}</code><span class="grow"></span><span class="meta">${ago(a.createdAt)}</span></div>
      <div class="row"><span class="title">${esc(a.title)}</span></div>
      <div class="row meta">${esc(sourceName(a.sourceId))} · ${ipBtn(a.ipAddress)}</div>
    </div>`;
  }

  function detectAttempt(t) {
    const result = t.blocked ? 'refused by lockout' : t.success ? 'correct password' : 'wrong password';
    const sigs = t.signals.map((s) => `<span class="chip">${esc(LOGIN_SIGNALS[s.type] ?? s.type)}</span>`).join('');
    return `<div class="item sev-${esc(t.blocked ? 'high' : t.riskLevel === 'none' ? 'low' : t.riskLevel)}">
      <div class="row"><span class="pill plain">Login engine</span><span class="meta">${esc(result)}</span><span class="grow"></span><span class="meta">${ago(t.createdAt)}</span></div>
      <div class="row"><span class="title">${esc(t.email)}</span></div>
      <div class="row meta">${ipBtn(t.ip)} ${sigs}</div>
    </div>`;
  }

  /** For every enabled rule, how far each IP is towards its threshold. */
  function meters(raw) {
    const now = Date.now();
    const out = [];
    for (const rule of S.rules.filter((r) => r.isEnabled)) {
      const inWindow = raw.filter((a) => a.type === rule.type && now - new Date(a.createdAt).getTime() <= rule.windowSeconds * 1000);
      const byOrigin = new Map();
      for (const a of inWindow) {
        const key = a.ipAddress ?? `source:${a.sourceId}`;
        const g = byOrigin.get(key) ?? { ip: a.ipAddress, sourceId: a.sourceId, n: 0, last: a.createdAt };
        g.n += 1;
        byOrigin.set(key, g);
      }
      for (const g of byOrigin.values()) out.push({ rule, ...g, ratio: g.n / rule.threshold });
    }
    return out
      .sort((x, y) => y.ratio - x.ratio || new Date(y.last) - new Date(x.last))
      .slice(0, 8)
      .map((m) => {
        const done = m.n >= m.rule.threshold;
        const blocks = rank(m.rule.severity) >= rank('high');
        const pct = Math.min(100, Math.round(m.ratio * 100));
        return {
          at: m.last,
          id: `m-${m.rule.id}-${m.ip ?? m.sourceId}-${done}`,
          html: `<div class="item sev-${done ? esc(m.rule.severity) : 'low'}">
            <div class="row"><span class="title grow">${esc(m.rule.name)}</span>${done ? `<span class="fired">fired → ${esc(m.rule.severity)}</span>` : ''}</div>
            <div class="row meta">${m.ip ? ipBtn(m.ip) : esc(sourceName(m.sourceId))} · <span class="count">${m.n} / ${esc(m.rule.threshold)}</span> ${esc(m.rule.type)} in ${esc(windowText(m.rule.windowSeconds))}${blocks ? ' · blocks the IP' : ' · flags only'}</div>
            <div class="meter sev-${done ? esc(m.rule.severity) : 'low'}"><i style="--w:${pct}%"></i></div>
          </div>`,
        };
      });
  }

  function firedItem(a) {
    const p = a.payload;
    return `<div class="item sev-${esc(a.severity)}">
      <div class="row"><span class="pill sev-${esc(a.severity)}">Rule fired · ${esc(a.severity)}</span><span class="grow"></span><span class="meta">${ago(a.createdAt)}</span></div>
      <div class="row"><span class="title">${esc(p.ruleName)}</span></div>
      <div class="row meta">${ipBtn(a.ipAddress)} · ${esc(p.matchedCount)} of ${esc(p.threshold)} needed in ${esc(windowText(p.windowSeconds))} · ${esc(sourceName(a.sourceId))}</div>
    </div>`;
  }

  function scoreItem(t) {
    const lvl = t.riskLevel === 'none' ? 'low' : t.riskLevel;
    const parts = t.signals.map((s) => `${esc(LOGIN_SIGNALS[s.type] ?? s.type)} +${S.config?.severityWeights?.[s.severity] ?? '?'}`).join(' · ');
    return `<div class="item sev-${esc(lvl)}">
      <div class="row"><span class="pill sev-${esc(lvl)}">Login risk · ${esc(t.riskLevel)}</span><span class="grow"></span><span class="meta">${ago(t.createdAt)}</span></div>
      <div class="row"><span class="title">Score ${esc(t.riskScore)}</span><span class="meta">${parts}</span></div>
      <div class="row meta">${esc(t.email)} · ${ipBtn(t.ip)}</div>
      <div class="meter sev-${esc(lvl)}"><i style="--w:${Math.min(100, t.riskScore)}%"></i></div>
    </div>`;
  }

  function blockItem(b) {
    return `<div class="item sev-critical">
      <div class="row"><span class="pill sev-critical">Firewall · ${b.origin === 'auto' ? 'auto' : 'manual'}</span><span class="grow"></span><span class="meta nowrap">${esc(until(b.expiresAt))}</span></div>
      <div class="row"><span class="title">${ipBtn(b.network.replace(/\/(32|128)$/, ''))}</span>${isAdmin() ? `<span class="grow"></span><button type="button" class="btn ghost xs" data-unblock="${esc(b.id)}">Unblock</button>` : ''}</div>
      <div class="row meta">${esc(b.reason ?? 'No reason given')}</div>
    </div>`;
  }

  function lockItem(l) {
    return `<div class="item sev-high">
      <div class="row"><span class="pill sev-high">Login lockout · ${esc(l.targetType)}</span><span class="grow"></span><span class="meta nowrap">${esc(until(l.lockedUntil))}</span></div>
      <div class="row"><span class="title">${l.targetType === 'ip' ? ipBtn(l.target) : esc(l.target)}</span>${isAdmin() ? `<span class="grow"></span><button type="button" class="btn ghost xs" data-lift="${esc(l.id)}">Lift</button>` : ''}</div>
      <div class="row meta">${esc(LOGIN_SIGNALS[l.reason] ?? l.reason)} · from ${esc(l.ip)}</div>
    </div>`;
  }

  // ------------------------------------------------------------------ IP story
  async function openIp(ip) {
    openDrawer(`IP ${ip}`, '<p class="muted">Loading…</p>');
    const [alerts, attempts, blocks, lockouts] = await Promise.all([
      api(`/alerts?${qs({ ipAddress: ip, limit: 50 })}`).catch(() => ({ data: [] })),
      api(`/detection/login-attempts?${qs({ ip, limit: 30 })}`).catch(() => ({ data: [] })),
      api('/firewall/blocked-ips').catch(() => []),
      api('/detection/lockouts').catch(() => []),
    ]);
    const block = blocks.find((b) => b.network === ip || b.network === `${ip}/32` || b.network === `${ip}/128`);
    const lock = lockouts.find((l) => l.target === ip);

    const events = [
      ...alerts.data.map((a) =>
        isEscalation(a)
          ? { at: a.createdAt, sev: a.severity, stage: '02 Score', html: `<b>${esc(a.payload.ruleName)}</b> fired: ${esc(a.payload.matchedCount)} of ${esc(a.payload.threshold)} ${esc(a.type)} in ${esc(windowText(a.payload.windowSeconds))} → ${sevPill(a.severity)}` }
          : { at: a.createdAt, sev: a.severity, stage: '01 Detect', html: `${sevPill(a.severity)} <code>${esc(a.type)}</code> ${esc(a.title)} <span class="meta">· ${esc(sourceName(a.sourceId))}</span>`, alert: a },
      ),
      ...attempts.data.map((t) => ({
        at: t.createdAt,
        sev: t.blocked ? 'high' : t.riskLevel === 'none' ? 'low' : t.riskLevel,
        stage: t.riskScore > 0 ? '02 Score' : '01 Detect',
        html: `Login as <b>${esc(t.email)}</b>: ${t.blocked ? 'refused by lockout' : t.success ? 'correct password' : 'wrong password'}${t.riskScore > 0 ? ` · score <b>${esc(t.riskScore)}</b> ${sevPill(t.riskLevel)} ${t.signals.map((s) => `<span class="chip">${esc(LOGIN_SIGNALS[s.type] ?? s.type)}</span>`).join('')}` : ''}`,
      })),
      ...(block ? [{ at: block.createdAt, sev: 'critical', stage: '03 Protect', html: `<b>Blocked by the firewall</b> (${block.origin === 'auto' ? 'automatically' : 'by an admin'}), ${esc(until(block.expiresAt))}. ${esc(block.reason ?? '')}` }] : []),
      ...(lock ? [{ at: lock.createdAt, sev: 'high', stage: '03 Protect', html: `<b>Locked by the login engine</b> (${esc(LOGIN_SIGNALS[lock.reason] ?? lock.reason)}), ${esc(until(lock.lockedUntil))}` }] : []),
    ].sort((x, y) => new Date(y.at) - new Date(x.at));

    const status = block
      ? `<span class="pill sev-critical">Blocked · ${esc(until(block.expiresAt))}</span>`
      : lock
        ? `<span class="pill sev-high">Login locked · ${esc(until(lock.lockedUntil))}</span>`
        : '<span class="pill sev-ok">Allowed</span>';
    const actions = isAdmin()
      ? block
        ? `<button type="button" class="btn ghost sm" data-unblock="${esc(block.id)}" data-reopen="${esc(ip)}">Unblock</button>`
        : `<button type="button" class="btn danger sm" data-block-ip="${esc(ip)}">Block for 60 min</button>`
      : '';

    $('#drawer-body').innerHTML = `
      <div class="verdict card">${status}<span class="meta">${alerts.data.length} alerts · ${attempts.data.length} logins</span>${actions}</div>
      ${events.length ? `<ol class="timeline">${events.map((e) => `<li class="sev-${esc(e.sev)}"><div class="item sev-${esc(e.sev)}"><div class="row"><span class="stage-tag">${esc(e.stage)}</span><span class="grow"></span><span class="meta">${esc(clock(e.at))}</span></div><div class="row">${e.html}</div></div></li>`).join('')}</ol>` : empty('No activity recorded for this IP.')}`;
  }

  async function openAlert(id) {
    openDrawer('Alert', '<p class="muted">Loading…</p>');
    const a = await api(`/alerts/${encodeURIComponent(id)}`);
    const p = a.payload ?? {};
    const esc8 = isEscalation(a);
    $('#drawer-title').textContent = a.title;
    $('#drawer-body').innerHTML = `
      <dl class="kv">
        <dt>Severity</dt><dd>${sevPill(a.severity)}</dd>
        <dt>Status</dt><dd>${esc(a.status)}</dd>
        <dt>Type</dt><dd><code>${esc(a.type)}</code></dd>
        <dt>Source</dt><dd>${esc(sourceName(a.sourceId))}</dd>
        <dt>IP</dt><dd>${ipBtn(a.ipAddress)}</dd>
        <dt>Received</dt><dd>${esc(clock(a.createdAt))} (${ago(a.createdAt)})</dd>
        ${esc8 ? `<dt>Rule</dt><dd><b>${esc(p.ruleName)}</b>: ${esc(p.matchedCount)} of ${esc(p.threshold)} in ${esc(windowText(p.windowSeconds))}</dd><dt>Triggered by</dt><dd><button type="button" class="ip" data-alert="${esc(p.triggeredByAlertId)}">${esc(String(p.triggeredByAlertId).slice(0, 8))}…</button></dd>` : ''}
      </dl>
      <div class="actions">${alertActions(a)}</div>
      <h3 class="h3">Payload</h3><pre class="json">${esc(JSON.stringify(p, null, 2))}</pre>`;
  }

  function openDrawer(title, html) {
    $('#drawer-title').textContent = title;
    $('#drawer-body').innerHTML = html;
    $('#drawer').hidden = false;
    $('#drawer-close').focus();
  }
  const closeDrawer = () => ($('#drawer').hidden = true);

  // ------------------------------------------------------------------ ALERTS tab
  const alertActions = (a) =>
    [
      a.status === 'open' ? `<button type="button" class="btn ghost xs" data-status="acknowledged" data-id="${esc(a.id)}">Acknowledge</button>` : '',
      a.status !== 'resolved' ? `<button type="button" class="btn ghost xs" data-status="resolved" data-id="${esc(a.id)}">Resolve</button>` : '',
      isAdmin() ? `<button type="button" class="btn ghost xs" data-delete-alert="${esc(a.id)}">Delete</button>` : '',
    ].join('');

  async function loadAlerts() {
    const f = Object.fromEntries(new FormData($('#alert-filters')));
    const res = await api(`/alerts?${qs({ ...f, page: S.page.alerts, limit: 25 })}`);
    $('#alerts-table').innerHTML = `<thead><tr><th>Received</th><th>Severity</th><th>Type</th><th>Title</th><th>Source</th><th>IP</th><th>Status</th><th></th></tr></thead><tbody>${
      res.data
        .map(
          (a) => `<tr class="click" data-alert="${esc(a.id)}"><td class="nowrap">${esc(ago(a.createdAt))}</td><td>${sevPill(a.severity)}</td><td><code>${esc(a.type)}</code></td><td>${isEscalation(a) ? '<span class="pill plain">rule</span> ' : ''}${esc(a.title)}</td><td>${esc(sourceName(a.sourceId))}</td><td>${ipBtn(a.ipAddress)}</td><td>${esc(a.status)}</td><td><div class="actions">${alertActions(a)}</div></td></tr>`,
        )
        .join('') || `<tr><td colspan="8">${empty('No alerts match these filters.')}</td></tr>`
    }</tbody>`;
    pager('#alerts-pager', res, 'alerts');
    markUpdated();
  }

  function pager(sel, res, key) {
    const pages = Math.max(1, Math.ceil(res.total / res.limit));
    $(sel).innerHTML = `<span>${res.total} total · page ${res.page} of ${pages}</span>
      <button type="button" class="btn ghost sm" data-page="${key}" data-to="${res.page - 1}" ${res.page <= 1 ? 'disabled' : ''}>Previous</button>
      <button type="button" class="btn ghost sm" data-page="${key}" data-to="${res.page + 1}" ${res.page >= pages ? 'disabled' : ''}>Next</button>`;
  }

  // ------------------------------------------------------------------ FIREWALL tab
  async function loadFirewall() {
    const blocks = await api('/firewall/blocked-ips');
    $('#blocks-table').innerHTML = `<thead><tr><th>IP or range</th><th>How</th><th>Reason</th><th>Since</th><th>Ends</th><th></th></tr></thead><tbody>${
      blocks
        .map(
          (b) => `<tr><td>${ipBtn(b.network.replace(/\/(32|128)$/, ''))}${/\/(32|128)$/.test(b.network) ? '' : ` <code>${esc(b.network)}</code>`}</td><td><span class="pill ${b.origin === 'auto' ? 'sev-critical' : 'plain'}">${esc(b.origin)}</span></td><td>${esc(b.reason ?? '')}</td><td class="nowrap">${esc(ago(b.createdAt))}</td><td class="nowrap">${esc(until(b.expiresAt))}</td><td>${isAdmin() ? `<button type="button" class="btn ghost xs" data-unblock="${esc(b.id)}">Unblock</button>` : ''}</td></tr>`,
        )
        .join('') || `<tr><td colspan="6">${empty('No IP is blocked. Blocks appear here when a high or critical rule fires, or when an admin adds one.')}</td></tr>`
    }</tbody>`;
    markUpdated();
  }

  async function submitBlock(e) {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    const msg = $('#block-msg');
    try {
      await api('/firewall/blocked-ips', {
        method: 'POST',
        body: { ip: f.ip.trim(), ...(f.reason.trim() && { reason: f.reason.trim() }), ...(f.minutes && { expiresInMinutes: Number(f.minutes) }) },
      });
      msg.className = 'msg ok';
      msg.textContent = `Blocked ${f.ip.trim()}.`;
      e.target.reset();
      loadFirewall();
    } catch (err) {
      msg.className = 'msg';
      msg.textContent = err.message;
    }
  }

  // ------------------------------------------------------------------ LOGIN ENGINE tab
  async function loadLogins() {
    const f = Object.fromEntries(new FormData($('#attempt-filters')));
    const [lockouts, attempts] = await Promise.all([
      api('/detection/lockouts'),
      api(`/detection/login-attempts?${qs({ flagged: f.flagged === 'on', riskLevel: f.riskLevel, ip: f.ip, page: S.page.attempts, limit: 25 })}`),
    ]);
    renderExplain();
    $('#lockouts-table').innerHTML = `<thead><tr><th>Locked</th><th>Why</th><th>Caused by</th><th>Ends</th><th></th></tr></thead><tbody>${
      lockouts
        .map(
          (l) => `<tr><td>${esc(l.targetType)} ${l.targetType === 'ip' ? ipBtn(l.target) : `<b>${esc(l.target)}</b>`}</td><td>${esc(LOGIN_SIGNALS[l.reason] ?? l.reason)}</td><td>${ipBtn(l.ip)}</td><td class="nowrap">${esc(until(l.lockedUntil))}</td><td>${isAdmin() ? `<button type="button" class="btn ghost xs" data-lift="${esc(l.id)}">Lift</button>` : ''}</td></tr>`,
        )
        .join('') || `<tr><td colspan="5">${empty('No email or IP is locked.')}</td></tr>`
    }</tbody>`;
    $('#attempts-table').innerHTML = `<thead><tr><th>When</th><th>Email</th><th>IP</th><th>Result</th><th>Score</th><th>Rules that fired</th></tr></thead><tbody>${
      attempts.data
        .map((t) => {
          const lvl = t.riskLevel === 'none' ? 'low' : t.riskLevel;
          return `<tr><td class="nowrap">${esc(ago(t.createdAt))}</td><td>${esc(t.email)}</td><td>${ipBtn(t.ip)}</td><td>${t.blocked ? '<span class="pill sev-high">refused</span>' : t.success ? '<span class="pill sev-ok">success</span>' : '<span class="pill plain">wrong password</span>'}</td>
          <td class="score-cell"><b>${esc(t.riskScore)}</b> ${t.riskLevel !== 'none' ? sevPill(t.riskLevel) : ''}<div class="meter sev-${esc(lvl)}"><i style="--w:${Math.min(100, t.riskScore)}%"></i></div></td>
          <td>${t.signals.map((s) => `<span class="chip" title="${esc(s.message)}">${esc(LOGIN_SIGNALS[s.type] ?? s.type)} · ${esc(s.severity)}</span>`).join('') || '<span class="meta">none</span>'}</td></tr>`;
        })
        .join('') || `<tr><td colspan="6">${empty('No login attempts match.')}</td></tr>`
    }</tbody>`;
    pager('#attempts-pager', attempts, 'attempts');
    markUpdated();
  }

  function renderExplain() {
    const c = S.config;
    if (!c) return ($('#score-explain').innerHTML = '');
    const w = c.severityWeights;
    const t = c.scoreThresholds;
    $('#score-explain').innerHTML = `
      <div><h4>01 Detect</h4><p class="muted">Every sign-in is recorded and checked against the rules below.</p></div>
      <div><h4>02 Score: each fired rule adds</h4><div class="scale">${SEVERITIES.map((s) => `<span class="pill sev-${s}">${s} +${esc(w[s])}</span>`).join('')}</div>
        <p class="muted small">Total ≥ ${esc(t.medium)} is medium, ≥ ${esc(t.high)} high, ≥ ${esc(t.critical)} critical. Two lows make a medium.</p></div>
      <div><h4>03 Protect</h4><p class="muted small">Brute force and password spraying lock the email or IP for ${esc(c.rules.bruteForce.lockMinutes)} min (429), doubling on repeats. A critical score refuses the token (401). Possible compromise signs the user out everywhere.</p></div>`;
  }

  // ------------------------------------------------------------------ RULES tab
  async function loadRules() {
    await loadReference();
    $('#rules-table').innerHTML = `<thead><tr><th>Rule</th><th>Counts</th><th>Threshold</th><th>Raises</th><th>Effect</th><th>Enabled</th></tr></thead><tbody>${
      S.rules
        .map(
          (r) => `<tr><td><b>${esc(r.name)}</b></td><td><code>${esc(r.type)}</code></td><td class="nowrap">${esc(r.threshold)} in ${esc(windowText(r.windowSeconds))}</td><td>${sevPill(r.severity)}</td><td>${rank(r.severity) >= rank('high') ? 'Blocks the IP' : 'Flags for analysts'}</td>
          <td>${isAdmin() ? `<label class="check"><input type="checkbox" data-rule="${esc(r.id)}" ${r.isEnabled ? 'checked' : ''}> ${r.isEnabled ? 'on' : 'off'}</label>` : r.isEnabled ? 'on' : 'off'}</td></tr>`,
        )
        .join('') || `<tr><td colspan="6">${empty('No rules yet.')}</td></tr>`
    }</tbody>`;
    const R = S.config?.rules;
    const cards = R
      ? [
          ['Excessive failed logins', `${R.bruteForce.threshold}+ failures for one email or IP in ${windowText(R.bruteForce.windowSeconds)} → lock ${R.bruteForce.lockMinutes} min`, 'high'],
          ['IP password spraying', `One IP tries ${R.credentialStuffing.threshold}+ accounts in ${windowText(R.credentialStuffing.windowSeconds)} → IP locked`, 'high'],
          ['Possible account compromise', `Correct password after ${R.possibleCompromise.threshold}+ failures in ${windowText(R.possibleCompromise.windowSeconds)} → sessions revoked`, 'critical'],
          ['New / unknown device or country', 'Device or country never seen on this account', 'medium'],
          ['Account enumeration', `${R.accountEnumeration.threshold}+ tries on emails that don't exist in ${windowText(R.accountEnumeration.windowSeconds)}`, 'medium'],
          ['Abnormal login time', `An hour this user hasn't logged in during the last ${R.unusualTime.lookbackDays} days`, 'low'],
          ['Login right after lockout', `Within ${R.postLockout.graceSeconds}s of a lockout ending; the next lock is doubled`, 'medium'],
          ['New IP address', 'Login from an IP this user has never used', 'low'],
          ['Rapid logins', `${R.rapidLogins.threshold}+ successful logins in ${windowText(R.rapidLogins.windowSeconds)}`, 'low'],
        ]
      : [];
    $('#login-rules').innerHTML = cards
      .map(([name, text, sev]) => `<div class="card"><h4>${esc(name)} ${sevPill(sev)}</h4><p>${esc(text)}</p></div>`)
      .join('');
    markUpdated();
  }

  // ------------------------------------------------------------------ USERS tab
  async function loadUsers() {
    const users = await api('/users');
    $('#users-table').innerHTML = `<thead><tr><th>Email</th><th>Role</th><th>Created</th><th></th></tr></thead><tbody>${
      users
        .map((u) => {
          const self = u.id === S.user.id;
          const role = self
            ? `<span class="pill plain">${esc(u.role)}</span> <span class="meta">(you)</span>`
            : `<select data-user-role="${esc(u.id)}" aria-label="Role for ${esc(u.email)}">${['analyst', 'admin']
                .map((r) => `<option ${r === u.role ? 'selected' : ''}>${r}</option>`)
                .join('')}</select>`;
          const del = self ? '' : `<button type="button" class="btn ghost xs" data-delete-user="${esc(u.id)}" data-email="${esc(u.email)}">Delete</button>`;
          return `<tr><td><b>${esc(u.email)}</b></td><td>${role}</td><td class="nowrap">${esc(clock(u.createdAt))}</td><td>${del}</td></tr>`;
        })
        .join('') || `<tr><td colspan="4">${empty('No users.')}</td></tr>`
    }</tbody>`;
    markUpdated();
  }

  async function submitUser(e) {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    const msg = $('#user-msg');
    try {
      const user = await api('/users', { method: 'POST', body: { email: f.email.trim(), password: f.password, role: f.role } });
      msg.className = 'msg ok';
      msg.textContent = `Created ${user.email} as ${user.role}. Share the password privately.`;
      e.target.reset();
      loadUsers();
    } catch (err) {
      msg.className = 'msg';
      msg.textContent = err.status === 409 ? 'That email already has an account.' : err.message;
    }
  }

  // ------------------------------------------------------------------ AUDIT tab
  async function loadAudit() {
    const f = Object.fromEntries(new FormData($('#audit-filters')));
    const res = await api(`/audit?${qs({ ...f, page: S.page.audit, limit: 25 })}`);
    const tone = { success: 'sev-ok', denied: 'sev-critical', failed: 'sev-high' };
    $('#audit-table').innerHTML = `<thead><tr><th>When</th><th>Who</th><th>Action</th><th>Outcome</th><th>Target</th><th>Request</th><th>From</th></tr></thead><tbody>${
      res.data
        .map(
          (r) => `<tr><td class="nowrap">${esc(clock(r.createdAt))}</td><td>${esc(r.actorEmail ?? r.actorRole ?? 'system')}<div class="meta">${esc(r.actorRole ?? '')}</div></td><td><code>${esc(r.action)}</code></td><td><span class="pill ${tone[r.outcome] ?? 'plain'}">${esc(r.outcome)}</span></td><td>${esc(r.targetType ?? '')} <span class="meta mono">${esc(String(r.targetId ?? '').slice(0, 18))}</span></td><td class="nowrap"><code>${esc(r.method ?? '')} ${esc(r.path ?? '')}</code> <span class="meta">${esc(r.statusCode ?? '')}</span></td><td>${ipBtn(r.ip)}</td></tr>`,
        )
        .join('') || `<tr><td colspan="7">${empty('Nothing recorded yet.')}</td></tr>`
    }</tbody>`;
    pager('#audit-pager', res, 'audit');
    markUpdated();
  }

  // ------------------------------------------------------------------ actions
  async function act(fn, okText) {
    try {
      await fn();
      if (okText) toast('Done', okText, 'ok');
    } catch (err) {
      toast('Not allowed', err.message, 'critical');
    }
    loadTab(S.tab);
  }

  document.addEventListener('click', (e) => {
    const t = e.target.closest('button, tr.click, [data-tab]');
    if (!t) return;
    const d = t.dataset;
    if (d.tab) return showTab(d.tab);
    if (d.ip) {
      e.stopPropagation();
      return openIp(d.ip).catch(showLoadError);
    }
    if (d.status) {
      e.stopPropagation();
      return act(() => api(`/alerts/${d.id}/status`, { method: 'PATCH', body: { status: d.status } }), `Alert ${d.status}.`).then(() => !$('#drawer').hidden && openAlert(d.id));
    }
    if (d.deleteAlert) {
      e.stopPropagation();
      return act(() => api(`/alerts/${d.deleteAlert}`, { method: 'DELETE' }), 'Alert deleted.').then(closeDrawer);
    }
    if (d.unblock) return act(() => api(`/firewall/blocked-ips/${d.unblock}`, { method: 'DELETE' }), 'IP unblocked.').then(() => d.reopen && openIp(d.reopen));
    if (d.blockIp) return act(() => api('/firewall/blocked-ips', { method: 'POST', body: { ip: d.blockIp, reason: 'Blocked from the dashboard', expiresInMinutes: 60 } }), `Blocked ${d.blockIp}.`).then(() => openIp(d.blockIp));
    if (d.deleteUser) {
      if (!confirm(`Delete ${d.email}? They are signed out everywhere at once. This can't be undone.`)) return;
      return act(() => api(`/users/${d.deleteUser}`, { method: 'DELETE' }), `Deleted ${d.email}.`);
    }
    if (d.lift) return act(() => api(`/detection/lockouts/${d.lift}`, { method: 'DELETE' }), 'Lockout lifted.');
    if (d.page) {
      S.page[d.page] = Number(d.to);
      return loadTab(S.tab);
    }
    if (d.refresh) return loadTab(d.refresh);
    if (d.alert) return openAlert(d.alert).catch(showLoadError);
  });

  document.addEventListener('change', (e) => {
    const el = e.target;
    if (el.dataset.userRole) {
      return act(() => api(`/users/${el.dataset.userRole}/role`, { method: 'PATCH', body: { role: el.value } }), `Role changed to ${el.value}.`);
    }
    if (el.dataset.rule) {
      return act(() => api(`/rules/${el.dataset.rule}`, { method: 'PATCH', body: { isEnabled: el.checked } }), `Rule turned ${el.checked ? 'on' : 'off'}.`).then(loadReference);
    }
    if (el.id === 'live-source') {
      painted.clear();
      return loadLive().catch(showLoadError);
    }
    const form = el.closest('form');
    if (form?.id === 'alert-filters') (S.page.alerts = 1), loadAlerts().catch(showLoadError);
    if (form?.id === 'attempt-filters') (S.page.attempts = 1), loadLogins().catch(showLoadError);
    if (form?.id === 'audit-filters') (S.page.audit = 1), loadAudit().catch(showLoadError);
  });
  for (const id of ['alert-filters', 'attempt-filters', 'audit-filters']) $(`#${id}`).addEventListener('submit', (e) => (e.preventDefault(), e.target.dispatchEvent(new Event('change', { bubbles: true }))));

  $('#auth-form').addEventListener('submit', submitAuth);
  $('#user-form').addEventListener('submit', submitUser);
  $('#logout').addEventListener('click', () => signOut());
  $('#block-form').addEventListener('submit', submitBlock);
  $('#drawer-close').addEventListener('click', closeDrawer);
  $('#drawer').addEventListener('click', (e) => e.target.id === 'drawer' && closeDrawer());
  document.addEventListener('keydown', (e) => e.key === 'Escape' && closeDrawer());
  document.addEventListener('visibilitychange', () => !document.hidden && S.token && loadTab(S.tab));

  // ------------------------------------------------------------------ go
  loadSession();
  if (S.token) start().catch(() => signOut());
  else $('#auth').hidden = false;
}
