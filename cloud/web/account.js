// The Vidalune account pages: sign up or in, link a server with its code, see and unlink servers.
(() => {
  const nl = (navigator.language || '').toLowerCase().startsWith('nl');
  document.documentElement.lang = nl ? 'nl' : 'en';
  const T = nl
    ? {
        title: 'Vidalune-account', intro: 'Met een Vidalune-account vind je je eigen servers terug, ook buiten je thuisnetwerk.',
        email: 'E-mailadres', password: 'Wachtwoord', signIn: 'Inloggen', signUp: 'Account maken', toSignUp: 'Nog geen account? Maak er een', toSignIn: 'Al een account? Log in',
        newPassword: 'Wachtwoord (minstens 8 tekens)', servers: 'Jouw servers', none: 'Nog geen servers gekoppeld.', link: 'Server koppelen',
        linkIntro: 'Zet op je server “Koppelen aan Vidalune-account” aan (Beheer → Vidalune-account) en vul de code in die je server toont.',
        code: 'Code', linkButton: 'Koppelen', linked: 'Gekoppeld: {name}.', online: 'online', offline: 'offline — laatst gezien {when}', unlink: 'Ontkoppelen',
        unlinkConfirm: '{name} ontkoppelen van je account?', signOut: 'Uitloggen', delete: 'Account verwijderen', deleteConfirm: 'Vul je wachtwoord in om je account te verwijderen. Je servers worden ontkoppeld.',
        deleteButton: 'Definitief verwijderen', version: 'versie {v}', privacy: 'Vidalune bewaart alleen je e-mailadres, een versleuteld wachtwoord en per server de naam, versie en het adres. Nooit je media of wat je kijkt.',
        failed: 'Dat lukte niet. Probeer het opnieuw.',
        openServer: 'Openen', opening: 'Openen…', leave: 'Verlaten', leaveConfirm: '{name} uit je lijst halen? Je kunt dan niet meer met je Vidalune-account op deze server inloggen.',
        member: 'gedeeld met jou', unreachable: '{name} is nu niet bereikbaar. Staat hij aan?', noAddress: 'Deze server heeft nog geen adres: zet op de server de relay aan of stel zijn adres in.',
        join: 'Server toevoegen', joinIntro: 'Gebruik je de server van iemand anders? Ga daar naar Account → Profiel → Vidalune-account en vul de code in die je daar krijgt.',
        joined: '{name} staat nu in je lijst.', choose: 'Andere server kiezen',
        remoteOn: 'Toegang op afstand: actief', remoteUntil: 'Toegang op afstand: actief tot {date}', remoteOff: 'Toegang op afstand via Vidalune (relay en app.vidalune.com) is niet actief. Thuis, en op een eigen adres, werken je servers gewoon.',
        adminLink: 'Beheer',
        viewerOn: 'Toegang op afstand als kijker: actief', viewerUntil: 'Toegang op afstand als kijker: actief tot {date}',
        invited: 'Je bent uitgenodigd', invitedText: 'Je bent uitgenodigd om te kijken op {server}. Maak een Vidalune-account of log in om de uitnodiging aan te nemen.',
        inviteGone: 'Deze uitnodiging is niet (meer) geldig. Vraag om een nieuwe.', accepted: 'Je kunt nu kijken op {name}. Open hem hieronder.',
      }
    : {
        title: 'Vidalune account', intro: 'With a Vidalune account you find your own servers again, also outside your home network.',
        email: 'Email address', password: 'Password', signIn: 'Sign in', signUp: 'Create account', toSignUp: 'No account yet? Create one', toSignIn: 'Already have an account? Sign in',
        newPassword: 'Password (at least 8 characters)', servers: 'Your servers', none: 'No servers linked yet.', link: 'Link a server',
        linkIntro: 'On your server, turn on “Link to a Vidalune account” (Admin → Vidalune account) and enter the code it shows.',
        code: 'Code', linkButton: 'Link', linked: 'Linked: {name}.', online: 'online', offline: 'offline — last seen {when}', unlink: 'Unlink',
        unlinkConfirm: 'Unlink {name} from your account?', signOut: 'Sign out', delete: 'Delete account', deleteConfirm: 'Enter your password to delete your account. Your servers are unlinked.',
        deleteButton: 'Delete for good', version: 'version {v}', privacy: 'Vidalune keeps only your email address, an encrypted password and, per server, its name, version and address. Never your media or what you watch.',
        failed: 'That did not work. Try again.',
        openServer: 'Open', opening: 'Opening…', leave: 'Leave', leaveConfirm: 'Remove {name} from your list? You can then no longer sign in there with your Vidalune account.',
        member: 'shared with you', unreachable: '{name} cannot be reached right now. Is it on?', noAddress: 'This server has no address yet: turn the relay on or set its address on the server.',
        join: 'Add a server', joinIntro: 'Using someone else\'s server? There, go to Account → Profile → Vidalune account and enter the code you get.',
        joined: '{name} is in your list now.', choose: 'Choose another server',
        remoteOn: 'Remote access: active', remoteUntil: 'Remote access: active until {date}', remoteOff: 'Remote access through Vidalune (relay and app.vidalune.com) is not active. At home, and at an address of your own, your servers work as always.',
        adminLink: 'Admin',
        viewerOn: 'Remote access as a viewer: active', viewerUntil: 'Remote access as a viewer: active until {date}',
        invited: 'You are invited', invitedText: 'You are invited to watch on {server}. Create a Vidalune account or sign in to accept.',
        inviteGone: 'This invitation is not valid (any more). Ask for a new one.', accepted: 'You can watch on {name} now. Open it below.',
      };
  // On app.vidalune.com these pages live under /_vl (the rest of that site is the chosen server).
  const BASE = location.pathname === '/_vl' || location.pathname.startsWith('/_vl/') ? '/_vl' : '';
  const page = location.pathname.slice(BASE.length) || '/';
  // The website's links (home, install) belong to vidalune.com, not to app.vidalune.com.
  if (BASE) document.querySelector('.site-links')?.remove();
  const t = (key, vars = {}) => T[key].replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
  const view = document.getElementById('view');
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
  async function api(method, url, body) {
    const res = await fetch(BASE + url, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || t('failed')), { status: res.status });
    return data;
  }
  // A code handed over in the address (/link#K7F3-Q9MA), kept until someone is signed in.
  const pendingCode = () => (location.hash.length > 1 ? decodeURIComponent(location.hash.slice(1)) : '');
  const when = (ms) => new Date(ms).toLocaleString(nl ? 'nl-NL' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' });
  /** "Remote access: active until …", "… as a viewer …", or not active. */
  const planText = (remote) => {
    if (!remote || !remote.active) return t('remoteOff');
    const viewer = remote.kind === 'viewer';
    return remote.until ? t(viewer ? 'viewerUntil' : 'remoteUntil', { date: day(remote.until) }) : t(viewer ? 'viewerOn' : 'remoteOn');
  };
  const day = (ms) => new Date(ms).toLocaleDateString(nl ? 'nl-NL' : 'en-GB', { dateStyle: 'medium' });

  const LAST = 'vidalune.lastServer';
  const remember = (id) => { try { localStorage.setItem(LAST, id); } catch { /* private window */ } };
  const lastServer = () => { try { return localStorage.getItem(LAST); } catch { return null; } };

  /** Whether this browser reaches an address (any answer counts; a network error does not). */
  async function reachable(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2500);
    try {
      await fetch(`${url}/api/server/info`, { mode: 'no-cors', cache: 'no-store', signal: controller.signal });
      return true;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Opens a server, signed in. On app.vidalune.com: right here, through its relay (the choice is
   * remembered). Elsewhere, or without the relay: a one-time ticket, at its own address when this
   * browser reaches it, else at its relay address.
   */
  async function openServer(s, me) {
    if (s.relayUrl && s.relayConnected) {
      remember(s.id);
      if (BASE) return location.assign(`${BASE}/open?server=${encodeURIComponent(s.id)}`);
      // From vidalune.com: on to app.vidalune.com, signed in there, with this server chosen.
      if (me && me.appUrl) return location.assign((await api('POST', '/api/handoff', { server: s.id })).url);
    }
    const { ticket, addresses } = await api('POST', `/api/servers/${encodeURIComponent(s.id)}/open`);
    if (!addresses.length) throw new Error(t('noAddress'));
    let target = addresses[addresses.length - 1];
    for (const a of addresses.slice(0, -1)) if (await reachable(a)) { target = a; break; }
    remember(s.id);
    location.assign(`${target}/sso?ticket=${encodeURIComponent(ticket)}`);
  }

  function form(fields, submitLabel, onSubmit) {
    const error = el('p', { class: 'error', role: 'alert' });
    const button = el('button', { type: 'submit' }, submitLabel);
    const f = el('form', {
      onsubmit: async (e) => {
        e.preventDefault();
        error.textContent = '';
        button.disabled = true;
        try {
          await onSubmit(Object.fromEntries(new FormData(f)));
        } catch (err) {
          error.textContent = err.message;
        } finally {
          button.disabled = false;
        }
      },
    }, fields, error, button);
    return f;
  }

  /** An invitation link (/invite#…): which server, then signing up or in to accept it. */
  const inviting = () => page === '/invite' && pendingCode();
  async function invitePage() {
    let info;
    try {
      info = await api('POST', '/api/invite', { token: pendingCode() });
    } catch {
      return show(el('h1', {}, t('invited')), el('p', { class: 'error', role: 'alert' }, t('inviteGone')), el('a', { href: `${BASE}/account` }, t('title')));
    }
    signIn('up', [el('h1', {}, t('invited')), el('p', {}, t('invitedText', { server: info.server }))]);
  }

  function signIn(mode = 'in', header = null) {
    const up = mode === 'up';
    show(
      header ?? [el('h1', {}, t('title')), el('p', {}, t('intro'))],
      el('div', { class: 'card' },
        form([
          el('label', {}, t('email'), el('input', { name: 'email', type: 'email', autocomplete: 'email', required: true })),
          el('label', {}, up ? t('newPassword') : t('password'), el('input', { name: 'password', type: 'password', autocomplete: up ? 'new-password' : 'current-password', minlength: up ? 8 : null, required: true })),
        ], up ? t('signUp') : t('signIn'), async (v) => {
          await api('POST', up ? '/api/account' : '/api/login', v);
          await home();
        }),
      ),
      el('button', { class: 'link', type: 'button', onclick: () => signIn(up ? 'in' : 'up', header) }, up ? t('toSignIn') : t('toSignUp')),
      el('p', { class: 'small' }, t('privacy')),
    );
  }

  async function home(message = '', problem = '') {
    let me;
    try {
      me = await api('GET', '/api/account');
    } catch {
      if (inviting()) return invitePage();
      return signIn(pendingCode() || new URLSearchParams(location.search).has('new') ? 'up' : 'in');
    }
    if (inviting()) {
      // Accepted: straight into the server (it makes a user for this account there).
      let s;
      try {
        s = await api('POST', '/api/invite/accept', { token: pendingCode() });
      } catch (err) {
        history.replaceState(null, '', `${BASE}/servers`);
        return home('', err.status === 404 ? t('inviteGone') : err.message);
      }
      history.replaceState(null, '', `${BASE}/servers`);
      try {
        if (s.url || s.relayUrl) return await openServer(s, me);
      } catch {
        /* the list, with the server in it */
      }
      return home(t('accepted', { name: s.name }));
    }
    const list = await api('GET', '/api/servers');
    const joining = page === '/join';
    // Straight into the server used last time (app.vidalune.com), unless asked to choose.
    const params = new URLSearchParams(location.search);
    // Back from app.vidalune.com/_vl/open: the server chosen could not be reached through its relay.
    const offline = list.find((s) => s.id === params.get('offline'));
    const warning = problem || (!message && offline ? t('unreachable', { name: offline.name }) : '');
    // The server used last time; with only one server, that one.
    const openable = list.filter((s) => s.url || s.relayUrl);
    const last = openable.find((s) => s.id === lastServer()) ?? (list.length === 1 ? openable[0] : undefined);
    if (!message && !warning && !offline && !joining && !pendingCode() && !params.has('choose') && location.hostname.startsWith('app.') && last) {
      try {
        return await openServer(last, me);
      } catch {
        /* show the list instead */
      }
    }
    const joinCard = el('div', { class: 'card' },
      el('h1', {}, t('join')),
      el('p', {}, t('joinIntro')),
      form([el('label', {}, t('code'), el('input', { name: 'code', class: 'code', autocomplete: 'off', value: joining ? pendingCode() : '', maxlength: 12, required: true }))], t('linkButton'), async (v) => {
        const s = await api('POST', '/api/join', v);
        history.replaceState(null, '', `${BASE}/servers`);
        await home(t('joined', { name: s.name }));
      }),
    );
    const linkCard = el('div', { class: 'card' },
      el('h1', {}, t('link')),
      el('p', {}, t('linkIntro')),
      form([el('label', {}, t('code'), el('input', { name: 'code', class: 'code', autocomplete: 'off', value: joining ? '' : pendingCode(), maxlength: 12, required: true }))], t('linkButton'), async (v) => {
        const s = await api('POST', '/api/link', v);
        history.replaceState(null, '', `${BASE}/servers`);
        await home(t('linked', { name: s.name }));
      }),
    );
    show(
      el('div', { class: 'row' },
        el('span', { class: 'small' }, me.email),
        el('span', { class: 'actions' },
          me.ceo && !BASE ? el('a', { href: '/admin' }, t('adminLink')) : null,
          el('button', { class: 'link', type: 'button', onclick: async () => { await api('POST', '/api/logout'); signIn(); } }, t('signOut')),
        ),
      ),
      el('p', { class: 'small' }, planText(me.remote)),
      message ? el('p', { class: 'ok', role: 'status' }, message) : null,
      warning ? el('p', { class: 'error', role: 'alert' }, warning) : null,
      el('div', { class: 'card' },
        el('h1', {}, t('servers')),
        list.length === 0
          ? el('p', {}, t('none'))
          : el('ul', { class: 'servers' }, list.map((s) =>
              el('li', {},
                el('div', { class: 'row' },
                  el('strong', {}, s.name, s.role === 'member' ? el('span', { class: 'small' }, ` · ${t('member')}`) : null),
                  el('span', { class: 'actions' },
                    el('button', {
                      type: 'button',
                      disabled: !(s.url || s.relayUrl),
                      onclick: async (e) => {
                        const b = e.currentTarget;
                        b.disabled = true;
                        b.textContent = t('opening');
                        try {
                          await openServer(s, me);
                        } catch (err) {
                          b.disabled = false;
                          b.textContent = t('openServer');
                          alert(err.message || t('unreachable', { name: s.name }));
                        }
                      },
                    }, t('openServer')),
                    el('button', {
                      class: 'ghost',
                      type: 'button',
                      onclick: async () => {
                        if (confirm(t(s.role === 'member' ? 'leaveConfirm' : 'unlinkConfirm', { name: s.name }))) {
                          await api('DELETE', `/api/servers/${encodeURIComponent(s.id)}`);
                          await home();
                        }
                      },
                    }, s.role === 'member' ? t('leave') : t('unlink')),
                  ),
                ),
                el('div', { class: 'small' },
                  el('span', { class: s.online ? 'dot on' : 'dot' }),
                  s.online ? t('online') : t('offline', { when: when(s.lastSeenAt) }), ' · ', t('version', { v: s.version }),
                  !(s.url || s.relayUrl) ? [' · ', t('noAddress')] : null,
                ),
              ))),
      ),
      joining ? joinCard : el('details', {}, el('summary', {}, t('join')), joinCard),
      (pendingCode() && !joining) || list.length === 0 ? linkCard : el('details', {}, el('summary', {}, t('link')), linkCard),
      el('details', {},
        el('summary', { class: 'small' }, t('delete')),
        el('div', { class: 'card' },
          el('p', {}, t('deleteConfirm')),
          form([el('label', {}, t('password'), el('input', { name: 'password', type: 'password', autocomplete: 'current-password', required: true }))], t('deleteButton'), async (v) => {
            await api('DELETE', '/api/account', v);
            signIn('up');
          }),
        ),
      ),
    );
  }

  void home();
})();
