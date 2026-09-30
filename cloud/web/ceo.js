// The CEO panel: customers, access, relays and figures over time. Only the CEO gets data from
// /api/ceo (the service checks it on every call); everyone else sees why not.
(() => {
  const nl = (navigator.language || '').toLowerCase().startsWith('nl');
  document.documentElement.lang = nl ? 'nl' : 'en';
  const T = nl
    ? {
        tabs: { dashboard: 'Overzicht', customers: 'Klanten', access: 'Toegang', relays: 'Relays', statistics: 'Statistieken' },
        only: 'Alleen voor de CEO van Vidalune.', signIn: 'Log eerst in met je Vidalune-account.', toAccount: 'Naar je account', failed: 'Dat lukte niet. Probeer het opnieuw.',
        customers: 'Klanten', total: 'Totaal', active: 'Actief (30 dagen)', new7: 'Nieuw (7 dagen)', new30: 'Nieuw (30 dagen)', growth: 'Groei (30 dagen)', growthNone: 'n.v.t.',
        access: 'Toegang', withAccess: 'Met toegang', expiring: 'Loopt af binnen 14 dagen', types: { customer: 'Klant', beta: 'Beta', test: 'Test', free: 'Gratis' },
        plans: { remote: 'Toegang op afstand', viewer: 'Kijker' }, relays: 'Relays', capacity: 'Capaciteit', now: 'Nu', usage: 'Belasting', connected: 'Verbonden',
        servers: 'Servers', online: 'Online (2 uur)', nearQuota: '{name}: {used} van {quota} GB deze maand; daarna {mbps} Mbit/s.', noRevenue: 'Omzet verschijnt hier zodra betalingen via Vidalune lopen; toegang wordt nu met de hand gegeven.',
        search: 'Zoeken op e-mailadres', typeAll: 'Alle typen', typeNone: 'Zonder toegang', statusAll: 'Iedereen', statusActive: 'Actief', statusInactive: 'Niet actief', statusNew: 'Nieuw (30 dagen)',
        since: 'sinds {date}', lastActive: 'laatst actief {date}', never: 'nog niet actief', until: 'tot {date}', noEnd: 'geen einddatum', oldPlan: 'plan van vóór het CEO-paneel (geen type)',
        give: 'Toegang geven', email: 'E-mailadres', type: 'Type', plan: 'Wat', days: 'Dagen (leeg: geen einddatum)', note: 'Notitie', giveButton: 'Geven', given: 'Toegang gegeven aan {email}.',
        extend: 'Verlengen', extend30: '+30 dagen', extend365: '+1 jaar', revoke: 'Intrekken', revokeConfirm: 'Toegang van {email} intrekken?', revoked: 'Ingetrokken.', extended: 'Verlengd tot {date}.',
        showActive: 'Actief', showExpiring: 'Loopt af', showAll: 'Alles (met geschiedenis)', by: 'door {who}', revokedBy: 'ingetrokken door {who}', none: 'Niets gevonden.',
        more: 'Meer', page: 'Pagina {page} van {pages}',
        mainRelay: 'hoofdrelay', relayOff: 'uit', quota: 'Maandlimiet', unlimited: 'onbeperkt', thisMonth: 'deze maand {used} GB', month30: '30 dagen: {out} · {requests} verzoeken · {errors} fouten',
        register: 'Relay registreren', name: 'Naam', region: 'Regio', url: 'Adres (https)', capacityMbps: 'Capaciteit (Mbit/s)', quotaGb: 'Verkeer per maand (GB, leeg: onbeperkt)', overMbps: 'Snelheid daarna (Mbit/s)',
        registered: 'Relay geregistreerd: {name}.', open: 'Details', back: 'Terug naar relays', turnOff: 'Uitzetten', turnOn: 'Aanzetten', moveHere: 'Klant hierheen verplaatsen (e-mailadres)', move: 'Verplaatsen', moved: '{n} server(s) verplaatst.',
        removeServer: 'Van deze relay af', traffic: 'Verkeer per dag (GB)', errors: 'Fouten per dag', noServersHere: 'Nog geen servers op deze relay.', owner: 'van {email}',
        stats: 'Statistieken', range: 'Periode', d30: '30 dagen', d90: '90 dagen', d365: '1 jaar', chartAccounts: 'Accounts (totaal)', chartNew: 'Nieuwe accounts per dag', chartActive: 'Actieve accounts per dag',
        chartAccess: 'Accounts met toegang', chartRelay: 'Relayverkeer per dag (GB)', chartErrors: 'Relayfouten per dag', table: 'Als tabel', day: 'Dag', value: 'Waarde',
      }
    : {
        tabs: { dashboard: 'Overview', customers: 'Customers', access: 'Access', relays: 'Relays', statistics: 'Statistics' },
        only: 'Only for the CEO of Vidalune.', signIn: 'Sign in with your Vidalune account first.', toAccount: 'To your account', failed: 'That did not work. Try again.',
        customers: 'Customers', total: 'Total', active: 'Active (30 days)', new7: 'New (7 days)', new30: 'New (30 days)', growth: 'Growth (30 days)', growthNone: 'n/a',
        access: 'Access', withAccess: 'With access', expiring: 'Ending within 14 days', types: { customer: 'Customer', beta: 'Beta', test: 'Test', free: 'Free' },
        plans: { remote: 'Remote access', viewer: 'Viewer' }, relays: 'Relays', capacity: 'Capacity', now: 'Now', usage: 'Load', connected: 'Connected',
        servers: 'Servers', online: 'Online (2 hours)', nearQuota: '{name}: {used} of {quota} GB this month; then {mbps} Mbit/s.', noRevenue: 'Revenue appears here once payments go through Vidalune; access is given by hand for now.',
        search: 'Search by email address', typeAll: 'All types', typeNone: 'Without access', statusAll: 'Everyone', statusActive: 'Active', statusInactive: 'Not active', statusNew: 'New (30 days)',
        since: 'since {date}', lastActive: 'last active {date}', never: 'not active yet', until: 'until {date}', noEnd: 'no end date', oldPlan: 'plan from before the CEO panel (no type)',
        give: 'Give access', email: 'Email address', type: 'Type', plan: 'What', days: 'Days (empty: no end date)', note: 'Note', giveButton: 'Give', given: 'Access given to {email}.',
        extend: 'Extend', extend30: '+30 days', extend365: '+1 year', revoke: 'Take back', revokeConfirm: 'Take back the access of {email}?', revoked: 'Taken back.', extended: 'Extended until {date}.',
        showActive: 'Active', showExpiring: 'Ending', showAll: 'All (with history)', by: 'by {who}', revokedBy: 'taken back by {who}', none: 'Nothing found.',
        more: 'More', page: 'Page {page} of {pages}',
        mainRelay: 'main relay', relayOff: 'off', quota: 'Monthly allowance', unlimited: 'unlimited', thisMonth: 'this month {used} GB', month30: '30 days: {out} · {requests} requests · {errors} errors',
        register: 'Register a relay', name: 'Name', region: 'Region', url: 'Address (https)', capacityMbps: 'Capacity (Mbit/s)', quotaGb: 'Traffic per month (GB, empty: unlimited)', overMbps: 'Speed beyond it (Mbit/s)',
        registered: 'Relay registered: {name}.', open: 'Details', back: 'Back to relays', turnOff: 'Turn off', turnOn: 'Turn on', moveHere: 'Move a customer here (email address)', move: 'Move', moved: '{n} server(s) moved.',
        removeServer: 'Off this relay', traffic: 'Traffic per day (GB)', errors: 'Errors per day', noServersHere: 'No servers on this relay yet.', owner: 'of {email}',
        stats: 'Statistics', range: 'Period', d30: '30 days', d90: '90 days', d365: '1 year', chartAccounts: 'Accounts (total)', chartNew: 'New accounts per day', chartActive: 'Active accounts per day',
        chartAccess: 'Accounts with access', chartRelay: 'Relay traffic per day (GB)', chartErrors: 'Relay errors per day', table: 'As a table', day: 'Day', value: 'Value',
      };
  const t = (key, vars = {}) => String(key.split('.').reduce((o, k) => o?.[k], T) ?? key).replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
  const view = document.getElementById('view');
  const tabs = document.getElementById('tabs');
  const tip = document.getElementById('tip');
  const show = (...nodes) => view.replaceChildren(...nodes.flat().filter((n) => n !== null && n !== undefined && n !== false));
  const el = (tag, attrs = {}, ...children) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else if (v !== false && v !== null && v !== undefined) e.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) e.append(c);
    return e;
  };
  const svg = (tag, attrs = {}, ...children) => {
    const e = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined) e.setAttribute(k, v);
    for (const c of children.flat()) if (c) e.append(c);
    return e;
  };
  async function api(method, url, body) {
    const res = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || t('failed')), { status: res.status });
    return data;
  }
  const locale = nl ? 'nl-NL' : 'en-GB';
  const num = (n) => Number(n).toLocaleString(locale);
  const date = (ms) => new Date(ms).toLocaleDateString(locale, { dateStyle: 'medium' });
  const gb = (b) => (b / 1e9).toLocaleString(locale, { maximumFractionDigits: 1 });
  const size = (b) => (b >= 1e9 ? `${gb(b)} GB` : `${Math.round(b / 1e6)} MB`);
  const message = (text, error = false) => el('p', { class: error ? 'error' : 'notice', role: error ? 'alert' : 'status' }, text);

  // ---- charts: one series each (no legend needed: the title names it), hover and keyboard tooltips, a table view.
  function chart(title, days, value, format = num, kind = 'bars') {
    const W = 420, H = 170, P = { l: 40, r: 8, t: 12, b: 24 };
    const values = days.map(value);
    const max = Math.max(1, ...values);
    const step = (W - P.l - P.r) / Math.max(1, days.length);
    const y = (v) => H - P.b - (v / max) * (H - P.t - P.b);
    const g = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', 'aria-label': title });
    // Recessive grid: three lines with their values.
    for (const f of [0, 0.5, 1]) {
      const v = max * f;
      g.append(svg('line', { x1: P.l, x2: W - P.r, y1: y(v), y2: y(v), class: 'grid' }), svg('text', { x: P.l - 6, y: y(v) + 4, class: 'axis', 'text-anchor': 'end' }, format(Math.round(v * 10) / 10)));
    }
    // First and last day under the axis.
    if (days.length) {
      g.append(svg('text', { x: P.l, y: H - 6, class: 'axis' }, date(Date.parse(days[0].day))));
      g.append(svg('text', { x: W - P.r, y: H - 6, class: 'axis', 'text-anchor': 'end' }, date(Date.parse(days.at(-1).day))));
    }
    const say = (d, v, x) => {
      tip.textContent = `${date(Date.parse(d.day))}: ${format(v)}`;
      tip.hidden = false;
      const box = g.getBoundingClientRect();
      tip.style.left = `${Math.min(window.innerWidth - 180, Math.max(8, box.left + (x / W) * box.width - 60))}px`;
      tip.style.top = `${window.scrollY + box.top + 2}px`;
    };
    const hide = () => (tip.hidden = true);
    if (kind === 'line') {
      const pts = values.map((v, i) => `${P.l + step * i + step / 2},${y(v)}`).join(' ');
      g.append(svg('polyline', { points: pts, class: 'line' }));
    }
    days.forEach((d, i) => {
      const v = values[i];
      const x = P.l + step * i;
      if (kind === 'bars' && v > 0) {
        const w = Math.max(1, step - 2);
        const h = Math.max(1, H - P.b - y(v));
        g.append(svg('rect', { x: x + 1, y: H - P.b - h, width: w, height: h, rx: Math.min(4, w / 2), class: 'bar' }));
      }
      // A hit target over the whole day, bigger than the mark.
      const hit = svg('rect', { x, y: P.t, width: step, height: H - P.t - P.b, class: 'hit', tabindex: i === days.length - 1 ? 0 : -1 });
      hit.addEventListener('mouseenter', () => say(d, v, x + step / 2));
      hit.addEventListener('focus', () => say(d, v, x + step / 2));
      hit.addEventListener('mouseleave', hide);
      hit.addEventListener('blur', hide);
      hit.addEventListener('keydown', (e) => {
        const next = e.key === 'ArrowLeft' ? hit.previousElementSibling : e.key === 'ArrowRight' ? hit.nextElementSibling : null;
        if (next?.classList.contains('hit')) next.focus();
      });
      g.append(hit);
    });
    const table = el('details', {}, el('summary', { class: 'small' }, t('table')),
      el('table', { class: 'data' }, el('thead', {}, el('tr', {}, el('th', {}, t('day')), el('th', {}, t('value')))),
        el('tbody', {}, days.map((d, i) => el('tr', {}, el('td', {}, date(Date.parse(d.day))), el('td', {}, format(values[i])))))));
    return el('figure', { class: 'card chart-card' }, el('figcaption', {}, title), g, table);
  }

  const tile = (label, value, sub) => el('div', { class: 'tile' }, el('span', { class: 'small' }, label), el('strong', {}, value), sub ? el('span', { class: 'small' }, sub) : null);

  // ---- pages
  const PAGES = ['dashboard', 'customers', 'access', 'relays', 'statistics'];
  const current = () => {
    const h = location.hash.replace('#', '').split('/');
    return { page: PAGES.includes(h[0]) ? h[0] : 'dashboard', arg: h[1] ?? null };
  };
  function renderTabs() {
    const { page } = current();
    tabs.replaceChildren(...PAGES.map((p) => el('a', { href: `#${p}`, 'aria-current': p === page ? 'page' : null }, t(`tabs.${p}`))));
  }

  async function dashboard(note) {
    const d = await api('GET', '/api/ceo/dashboard');
    const g = d.customers.growth30;
    show(
      note,
      el('h1', {}, t('tabs.dashboard')),
      el('h2', {}, t('customers')),
      el('div', { class: 'tiles' },
        tile(t('total'), num(d.customers.total)),
        tile(t('active'), num(d.customers.active)),
        tile(t('new7'), num(d.customers.new7)),
        tile(t('new30'), num(d.customers.new30)),
        tile(t('growth'), g === null ? t('growthNone') : `${g > 0 ? '+' : ''}${g.toLocaleString(locale)} %`),
      ),
      el('h2', {}, t('access')),
      el('div', { class: 'tiles' },
        tile(t('withAccess'), num(d.access.total)),
        ...Object.keys(T.types).map((k) => tile(t(`types.${k}`), num(d.access.byType[k]))),
        tile(t('expiring'), num(d.access.expiringIn14Days)),
      ),
      el('p', { class: 'small' }, t('noRevenue')),
      el('h2', {}, t('relays')),
      el('div', { class: 'tiles' },
        tile(t('relays'), num(d.relays.nodes)),
        tile(t('capacity'), `${num(d.relays.capacityMbps)} Mbit/s`),
        tile(t('now'), `${d.relays.mbpsNow.toLocaleString(locale)} Mbit/s`, `${t('usage')} ${d.relays.usage.toLocaleString(locale)} %`),
        tile(t('connected'), num(d.relays.tunnels)),
        tile(t('servers'), num(d.servers.total), `${t('online')}: ${num(d.servers.online)}`),
      ),
      d.relays.nearQuota.map((r) => message(t('nearQuota', { name: r.name, used: r.usedGb, quota: r.monthlyGb, mbps: r.overQuotaMbps ?? '?' }), true)),
    );
  }

  let customerQuery = { q: '', type: 'all', status: 'all', page: 1 };
  async function customers(note) {
    const d = await api('GET', `/api/ceo/customers?${new URLSearchParams(customerQuery)}`);
    const pages = Math.max(1, Math.ceil(d.total / d.pageSize));
    const filters = el('form', { class: 'filters', onsubmit: (e) => { e.preventDefault(); const f = new FormData(e.target); customerQuery = { q: f.get('q'), type: f.get('type'), status: f.get('status'), page: 1 }; void go(); } },
      el('input', { name: 'q', type: 'search', placeholder: t('search'), 'aria-label': t('search'), value: customerQuery.q }),
      el('select', { name: 'type', 'aria-label': t('type'), onchange: (e) => e.target.form.requestSubmit() },
        [['all', t('typeAll')], ...Object.keys(T.types).map((k) => [k, t(`types.${k}`)]), ['none', t('typeNone')]].map(([v, l]) => el('option', { value: v, selected: v === customerQuery.type }, l))),
      el('select', { name: 'status', 'aria-label': 'Status', onchange: (e) => e.target.form.requestSubmit() },
        [['all', t('statusAll')], ['active', t('statusActive')], ['inactive', t('statusInactive')], ['new', t('statusNew')]].map(([v, l]) => el('option', { value: v, selected: v === customerQuery.status }, l))),
    );
    show(
      note,
      el('h1', {}, t('tabs.customers'), el('span', { class: 'small' }, ` · ${num(d.total)}`)),
      filters,
      d.customers.length === 0 ? el('p', {}, t('none')) : null,
      el('ul', { class: 'servers' }, d.customers.map((c) =>
        el('li', {},
          el('div', { class: 'row' },
            el('strong', {}, c.email),
            c.access ? el('span', { class: `badge ${c.access.type}` }, t(`types.${c.access.type}`)) : null,
          ),
          el('div', { class: 'small' },
            [t('since', { date: date(c.createdAt) }), c.lastActive ? t('lastActive', { date: date(Date.parse(c.lastActive)) }) : t('never'),
              c.access ? `${t(`plans.${c.access.plan}`)} · ${c.access.endsAt ? t('until', { date: date(c.access.endsAt) }) : t('noEnd')}` : c.plan ? `${t(`plans.${c.plan.plan}`)} · ${t('oldPlan')}` : null,
              c.servers.length ? `${t('servers')}: ${c.servers.map((s) => s.name).join(', ')}` : null].filter(Boolean).join(' · ')),
        ))),
      pages > 1 ? el('p', { class: 'row' },
        el('span', { class: 'small' }, t('page', { page: d.page, pages })),
        d.page < pages ? el('button', { class: 'ghost', onclick: () => { customerQuery.page++; void go(); } }, t('more')) : null) : null,
    );
  }

  let accessShow = 'active';
  async function access(note) {
    const d = await api('GET', `/api/ceo/access?show=${accessShow}`);
    const give = el('form', { class: 'card', onsubmit: async (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      try {
        const r = await api('POST', '/api/ceo/access', { email: f.get('email'), type: f.get('type'), plan: f.get('plan'), days: f.get('days') ? Number(f.get('days')) : null, note: f.get('note') || null });
        await go(message(t('given', { email: r.email })));
      } catch (err) {
        e.target.querySelector('.error').textContent = err.message;
      }
    } },
      el('h2', {}, t('give')),
      el('label', {}, t('email'), el('input', { name: 'email', type: 'email', required: true, autocomplete: 'off' })),
      el('div', { class: 'row' },
        el('label', {}, t('type'), el('select', { name: 'type' }, Object.keys(T.types).map((k) => el('option', { value: k }, t(`types.${k}`))))),
        el('label', {}, t('plan'), el('select', { name: 'plan' }, Object.keys(T.plans).map((k) => el('option', { value: k }, t(`plans.${k}`))))),
      ),
      el('label', {}, t('days'), el('input', { name: 'days', type: 'number', min: 1, max: 3650 })),
      el('label', {}, t('note'), el('input', { name: 'note', maxlength: 300 })),
      el('p', { class: 'error', role: 'alert' }),
      el('button', { type: 'submit' }, t('giveButton')),
    );
    const act = async (fn, done) => {
      try {
        const r = await fn();
        await go(message(done(r)));
      } catch (err) {
        await go(message(err.message, true));
      }
    };
    show(
      note,
      el('h1', {}, t('tabs.access')),
      give,
      el('div', { class: 'filters' }, [['active', t('showActive')], ['expiring', t('showExpiring')], ['all', t('showAll')]].map(([v, l]) =>
        el('button', { class: v === accessShow ? '' : 'ghost', onclick: () => { accessShow = v; void go(); } }, l))),
      d.grants.length === 0 ? el('p', {}, t('none')) : null,
      el('ul', { class: 'servers' }, d.grants.map((g) =>
        el('li', {},
          el('div', { class: 'row' }, el('strong', {}, g.email), el('span', { class: `badge ${g.type}` }, t(`types.${g.type}`))),
          el('div', { class: 'small' }, [t(`plans.${g.plan}`), g.endsAt ? t('until', { date: date(g.endsAt) }) : t('noEnd'), t('by', { who: g.grantedBy }), g.note, g.revokedAt ? t('revokedBy', { who: g.revokedBy }) : null].filter(Boolean).join(' · ')),
          g.revokedAt ? null : el('div', { class: 'row actions' },
            el('button', { class: 'ghost', onclick: () => act(() => api('PUT', `/api/ceo/access/${g.id}`, { addDays: 30 }), (r) => t('extended', { date: date(r.endsAt) })) }, t('extend30')),
            el('button', { class: 'ghost', onclick: () => act(() => api('PUT', `/api/ceo/access/${g.id}`, { addDays: 365 }), (r) => t('extended', { date: date(r.endsAt) })) }, t('extend365')),
            el('button', { class: 'ghost danger', onclick: () => confirm(t('revokeConfirm', { email: g.email })) && act(() => api('DELETE', `/api/ceo/access/${g.id}`), () => t('revoked')) }, t('revoke')),
          ),
        ))),
    );
  }

  const relayLine = (r) => [
    `${t('capacity')} ${num(r.capacityMbps)} Mbit/s`,
    `${t('now')} ${r.mbpsNow.toLocaleString(locale)} Mbit/s (${r.usage.toLocaleString(locale)} %)`,
    `${t('servers')} ${num(r.servers)} · ${t('customers')} ${num(r.customers)} · ${t('connected')} ${num(r.connected)}`,
    `${t('quota')}: ${r.quota.monthlyGb ? `${num(r.quota.monthlyGb)} GB · ${t('thisMonth', { used: r.quota.usedGb.toLocaleString(locale) })}` : t('unlimited')}`,
    t('month30', { out: size(r.month.out), requests: num(r.month.requests), errors: num(r.month.errors) }),
  ].join(' · ');

  async function relays(note, id) {
    if (id) return relayDetail(note, id);
    const d = await api('GET', '/api/ceo/relays');
    const register = el('form', { class: 'card', onsubmit: async (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      const n = (k) => (f.get(k) ? Number(f.get(k)) : null);
      try {
        const r = await api('POST', '/api/ceo/relays', { name: f.get('name'), region: f.get('region') || null, url: f.get('url'), capacityMbps: n('capacity'), monthlyQuotaGb: n('quota'), overQuotaMbps: n('over'), note: f.get('note') || null });
        await go(message(t('registered', { name: r.name })));
      } catch (err) {
        e.target.querySelector('.error').textContent = err.message;
      }
    } },
      el('h2', {}, t('register')),
      el('div', { class: 'row' }, el('label', {}, t('name'), el('input', { name: 'name', required: true, maxlength: 60 })), el('label', {}, t('region'), el('input', { name: 'region', maxlength: 60 }))),
      el('label', {}, t('url'), el('input', { name: 'url', type: 'url', required: true, placeholder: 'https://' })),
      el('div', { class: 'row' },
        el('label', {}, t('capacityMbps'), el('input', { name: 'capacity', type: 'number', min: 1, required: true })),
        el('label', {}, t('quotaGb'), el('input', { name: 'quota', type: 'number', min: 1 })),
        el('label', {}, t('overMbps'), el('input', { name: 'over', type: 'number', min: 1 })),
      ),
      el('label', {}, t('note'), el('input', { name: 'note', maxlength: 300 })),
      el('p', { class: 'error', role: 'alert' }),
      el('button', { type: 'submit' }, t('register')),
    );
    show(
      note,
      el('h1', {}, t('tabs.relays')),
      el('ul', { class: 'servers' }, d.relays.map((r) =>
        el('li', {},
          el('div', { class: 'row' },
            el('strong', {}, r.name, r.region ? el('span', { class: 'small' }, ` · ${r.region}`) : null, r.main ? el('span', { class: 'small' }, ` · ${t('mainRelay')}`) : null, r.active ? null : el('span', { class: 'small' }, ` · ${t('relayOff')}`)),
            el('a', { href: `#relays/${r.id}` }, t('open')),
          ),
          el('div', { class: 'small' }, relayLine(r)),
        ))),
      register,
    );
  }

  async function relayDetail(note, id) {
    const r = await api('GET', `/api/ceo/relays/${id}`);
    const move = el('form', { class: 'row', onsubmit: async (e) => {
      e.preventDefault();
      const email = new FormData(e.target).get('email');
      try {
        const list = await api('GET', `/api/ceo/customers?q=${encodeURIComponent(email)}`);
        const c = list.customers.find((x) => x.email === String(email).toLowerCase().trim());
        if (!c) throw new Error(t('none'));
        const res = await api('POST', `/api/ceo/relays/${id}/assign`, { accountId: c.id });
        await go(message(t('moved', { n: res.moved })));
      } catch (err) {
        await go(message(err.message, true));
      }
    } },
      el('input', { name: 'email', type: 'email', required: true, placeholder: t('moveHere'), 'aria-label': t('moveHere') }),
      el('button', { type: 'submit' }, t('move')),
    );
    show(
      note,
      el('p', {}, el('a', { href: '#relays' }, `← ${t('back')}`)),
      el('h1', {}, r.name, r.region ? el('span', { class: 'small' }, ` · ${r.region}`) : null),
      el('p', { class: 'small' }, relayLine(r)),
      r.main ? null : el('p', {}, el('button', { class: 'ghost', onclick: async () => { await api('PUT', `/api/ceo/relays/${id}`, { active: !r.active }); await go(); } }, r.active ? t('turnOff') : t('turnOn'))),
      r.active ? move : null,
      el('div', { class: 'charts' }, chart(t('traffic'), r.days, (d) => d.out / 1e9, (v) => v.toLocaleString(locale, { maximumFractionDigits: 1 })), chart(t('errors'), r.days, (d) => d.errors)),
      el('h2', {}, t('servers')),
      r.serverList.length === 0 ? el('p', {}, t('noServersHere')) : null,
      el('ul', { class: 'servers' }, r.serverList.map((s) =>
        el('li', {},
          el('div', { class: 'row' },
            el('strong', {}, s.name, s.owner ? el('span', { class: 'small' }, ` · ${t('owner', { email: s.owner })}`) : null),
            el('span', { class: 'small' }, el('span', { class: s.connected ? 'dot on' : 'dot' }), `${s.mbpsNow.toLocaleString(locale)} Mbit/s`),
          ),
          r.main ? null : el('button', { class: 'link', onclick: async () => { await api('DELETE', `/api/ceo/relays/${id}/servers/${encodeURIComponent(s.id)}`); await go(); } }, t('removeServer')),
        ))),
    );
  }

  let statDays = 90;
  async function statistics(note) {
    const d = await api('GET', `/api/ceo/statistics?days=${statDays}`);
    show(
      note,
      el('h1', {}, t('stats')),
      el('div', { class: 'filters', role: 'group', 'aria-label': t('range') }, [[30, t('d30')], [90, t('d90')], [365, t('d365')]].map(([v, l]) =>
        el('button', { class: v === statDays ? '' : 'ghost', 'aria-pressed': v === statDays ? 'true' : 'false', onclick: () => { statDays = v; void go(); } }, l))),
      el('div', { class: 'charts' },
        chart(t('chartAccounts'), d.days, (x) => x.accounts, num, 'line'),
        chart(t('chartAccess'), d.days, (x) => x.withAccess, num, 'line'),
        chart(t('chartNew'), d.days, (x) => x.newAccounts),
        chart(t('chartActive'), d.days, (x) => x.activeAccounts),
        chart(t('chartRelay'), d.days, (x) => x.relayOut / 1e9, (v) => v.toLocaleString(locale, { maximumFractionDigits: 1 })),
        chart(t('chartErrors'), d.days, (x) => x.relayErrors),
      ),
    );
  }

  async function go(note = null) {
    renderTabs();
    tip.hidden = true;
    const { page, arg } = current();
    try {
      await { dashboard, customers, access, relays, statistics }[page](note, arg);
    } catch (err) {
      tabs.replaceChildren();
      show(el('p', {}, err.status === 401 ? t('signIn') : err.status === 403 ? t('only') : err.message), el('a', { href: '/servers' }, t('toAccount')));
    }
  }
  window.addEventListener('hashchange', () => void go());
  void go();
})();
