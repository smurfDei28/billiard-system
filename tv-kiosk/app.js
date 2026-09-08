(() => {
  'use strict';
  const config = window.TV_KIOSK_CONFIG || {};
  const apiUrl = String(config.apiUrl || '').replace(/\/$/, '');
  const refreshMs = Math.max(5000, Number(config.refreshIntervalMs) || 10000);
  const PH_ZONE = 'Asia/Manila';
  const $ = (id) => document.getElementById(id);
  let accessToken = sessionStorage.getItem('tvAccessToken');
  let refreshToken = sessionStorage.getItem('tvRefreshToken');
  let refreshTimer = null;
  let requestInFlight = false;

  const request = async (path, options = {}, canRetry = true) => {
    const response = await fetch(`${apiUrl}${path}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}), ...(options.headers || {}) },
    });
    const body = await response.json().catch(() => ({}));
    if (response.status === 401 && body.code === 'TOKEN_EXPIRED' && refreshToken && canRetry) {
      const refreshed = await fetch(`${apiUrl}/api/auth/refresh`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken }) });
      if (!refreshed.ok) throw Object.assign(new Error('TV session expired. Please sign in again.'), { unauthorized: true });
      const tokens = await refreshed.json();
      accessToken = tokens.accessToken;
      refreshToken = tokens.refreshToken;
      sessionStorage.setItem('tvAccessToken', accessToken);
      sessionStorage.setItem('tvRefreshToken', refreshToken);
      return request(path, options, false);
    }
    if (!response.ok) throw Object.assign(new Error(body.error || 'Request failed'), { unauthorized: response.status === 401 || response.status === 403 });
    return body;
  };

  const formatTime = (value) => new Intl.DateTimeFormat('en-PH', { timeZone: PH_ZONE, hour: 'numeric', minute: '2-digit' }).format(new Date(value));
  const setText = (node, text) => { node.textContent = text; return node; };
  const element = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  const renderTables = (tables) => {
    const container = $('tables');
    container.replaceChildren();
    if (!tables.length) return container.append(element('p', 'empty', 'No tables configured'));
    tables.forEach((table) => {
      const card = element('article', `table-card ${String(table.status).toLowerCase()}`);
      const top = element('div', 'table-top');
      const identity = element('div');
      identity.append(element('div', 'table-number', `T${table.tableNumber}`), element('div', 'table-type', table.type === 'VIP' ? 'VIP TABLE' : 'STANDARD TABLE'));
      top.append(identity, element('span', 'status', String(table.status).replaceAll('_', ' ')));
      let detail = 'Ready for play';
      const active = table.sessions?.[0];
      if (active) detail = active.isWalkin && active.expectedEndTime ? `Expected until ${formatTime(active.expectedEndTime)}` : `Started ${formatTime(active.startTime)}`;
      else if (table.nextReservation) detail = `Next reservation ${formatTime(table.nextReservation.startTime)}`;
      card.append(top, element('p', 'table-detail', detail));
      container.append(card);
    });
    const available = tables.filter((table) => table.status === 'AVAILABLE').length;
    const occupied = tables.filter((table) => table.status === 'OCCUPIED').length;
    const summary = $('table-summary');
    summary.replaceChildren();
    const a = element('span'); a.append(setText(element('strong'), String(available)), document.createTextNode(' Available'));
    const o = element('span'); o.append(setText(element('strong'), String(occupied)), document.createTextNode(' Occupied'));
    summary.append(a, o);
  };

  const renderReservations = (items) => {
    const container = $('reservations');
    container.replaceChildren();
    if (!items.length) return container.append(element('p', 'empty', 'No current or upcoming reservations'));
    items.slice(0, 8).forEach((item) => {
      const row = element('div', 'reservation-row');
      row.append(element('div', 'reservation-table', `T${item.table?.tableNumber || '?'}`));
      const info = element('div');
      info.append(element('div', 'reservation-time', `${formatTime(item.startTime)} — ${item.user?.firstName || 'Member'}`), element('div', 'reservation-end', `Until ${formatTime(item.endTime)}`));
      row.append(info, element('span', 'badge', item.status));
      container.append(row);
    });
  };

  const playerName = (tournament, userId) => {
    const entry = tournament.entries?.find((item) => item.userId === userId);
    return entry?.user?.gamifiedProfile?.displayName || entry?.user?.firstName || 'Waiting';
  };
  const stageLabel = (stage) => ({ WINNERS: 'Winners Bracket', LOSERS: 'Losers Bracket', GRAND_FINAL: 'Grand Final', RESET_FINAL: 'Reset Final' }[stage] || 'Matches');
  const renderTournament = (tournament) => {
    const container = $('tournament');
    container.replaceChildren();
    if (!tournament) return container.append(element('p', 'empty', 'No active or recently completed tournament'));
    const title = element('div', 'tournament-title');
    const name = element('div');
    name.append(element('h3', '', tournament.name), element('div', 'tournament-meta', `${String(tournament.format).replaceAll('_', ' ')} · Race to ${tournament.raceTo} · ${tournament.entries?.length || 0} players`));
    title.append(name, element('span', 'badge', tournament.status));
    container.append(title);
    const matches = (tournament.matches || []).filter((match) => !(match.status === 'BYE' && !match.player1Id && !match.player2Id));
    const final = [...matches].reverse().find((match) => match.status === 'COMPLETED' && (match.isResetFinal || match.isGrandFinal));
    if (tournament.status === 'COMPLETED' && final?.winnerId) container.append(element('div', 'champion', `CHAMPION · ${playerName(tournament, final.winnerId)}`));
    const stages = tournament.format === 'DOUBLE_ELIMINATION' ? ['WINNERS', 'LOSERS', 'GRAND_FINAL', 'RESET_FINAL'] : ['WINNERS', 'GRAND_FINAL'];
    stages.forEach((stage) => {
      const stageMatches = matches.filter((match) => (match.bracketStage || 'WINNERS') === stage).filter((match) => !match.isResetFinal || match.player1Id || match.player2Id || match.status !== 'PENDING');
      if (!stageMatches.length) return;
      container.append(element('h4', 'stage-title', stageLabel(stage)));
      stageMatches.slice(-5).forEach((match) => {
        const row = element('div', 'match');
        row.append(element('span', '', playerName(tournament, match.player1Id)), element('strong', 'score', String(match.player1Score ?? 0)), element('span', 'right', playerName(tournament, match.player2Id)), element('strong', 'score', String(match.player2Score ?? 0)));
        if (match.status === 'IN_PROGRESS') row.append(element('span', 'live-dot', '● LIVE'));
        container.append(row);
      });
    });
  };

  const loadDashboard = async () => {
    if (requestInFlight) return;
    requestInFlight = true;
    try {
      const [tables, reservations, tournaments] = await Promise.all([request('/api/tables'), request('/api/queue'), request('/api/tournaments')]);
      const selected = tournaments.find((item) => item.status === 'IN_PROGRESS') || tournaments.find((item) => item.status === 'COMPLETED');
      const tournament = selected ? await request(`/api/tournaments/${encodeURIComponent(selected.id)}`) : null;
      renderTables(tables);
      renderReservations(reservations);
      renderTournament(tournament);
      $('connection').className = 'connection live';
      $('connection').textContent = '● LIVE';
      $('last-updated').textContent = `Updated ${formatTime(new Date())}`;
    } catch (error) {
      $('connection').className = 'connection offline';
      $('connection').textContent = '● RECONNECTING';
      if (error.unauthorized) showLogin(error.message);
    } finally { requestInFlight = false; }
  };

  const showDashboard = () => {
    $('login-view').classList.add('hidden');
    $('dashboard').classList.remove('hidden');
    clearInterval(refreshTimer);
    loadDashboard();
    refreshTimer = setInterval(loadDashboard, refreshMs);
    navigator.wakeLock?.request('screen').catch(() => {});
  };
  const showLogin = (message = '') => {
    clearInterval(refreshTimer);
    accessToken = null; refreshToken = null;
    sessionStorage.removeItem('tvAccessToken'); sessionStorage.removeItem('tvRefreshToken');
    $('dashboard').classList.add('hidden');
    $('login-view').classList.remove('hidden');
    $('login-error').textContent = message;
  };

  $('login-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = $('login-button');
    button.disabled = true; button.textContent = 'Signing in…'; $('login-error').textContent = '';
    try {
      const response = await fetch(`${apiUrl}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: $('email').value.trim(), password: $('password').value }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || body.errors?.[0]?.msg || 'Could not sign in');
      if (!['STAFF', 'ADMIN'].includes(body.user?.role)) throw new Error('The TV display requires a Staff or Admin account.');
      accessToken = body.accessToken; refreshToken = body.refreshToken;
      sessionStorage.setItem('tvAccessToken', accessToken); sessionStorage.setItem('tvRefreshToken', refreshToken);
      $('password').value = '';
      showDashboard();
    } catch (error) { $('login-error').textContent = error.message; }
    finally { button.disabled = false; button.textContent = 'Start TV Display'; }
  });
  $('logout').addEventListener('click', async () => {
    const oldRefresh = refreshToken;
    showLogin();
    if (oldRefresh) fetch(`${apiUrl}/api/auth/logout`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken: oldRefresh }) }).catch(() => {});
  });
  $('fullscreen').addEventListener('click', () => document.documentElement.requestFullscreen?.());
  document.addEventListener('visibilitychange', () => { if (!document.hidden && accessToken) loadDashboard(); });
  setInterval(() => {
    const now = new Date();
    $('clock').textContent = new Intl.DateTimeFormat('en-PH', { timeZone: PH_ZONE, hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(now);
    $('date').textContent = new Intl.DateTimeFormat('en-PH', { timeZone: PH_ZONE, weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(now) + ' · PH TIME';
  }, 1000);
  if (accessToken && refreshToken) showDashboard();
})();
