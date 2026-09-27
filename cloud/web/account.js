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
        deleteButton: 'Definitief verwijderen', cancel: 'Annuleren', version: 'versie {v}', open: 'Openen', privacy: 'Vidalune bewaart alleen je e-mailadres, een versleuteld wachtwoord en per server de naam, versie en het adres. Nooit je media of wat je kijkt.',
        failed: 'Dat lukte niet. Probeer het opnieuw.',
      }
    : {
        title: 'Vidalune account', intro: 'With a Vidalune account you find your own servers again, also outside your home network.',
        email: 'Email address', password: 'Password', signIn: 'Sign in', signUp: 'Create account', toSignUp: 'No account yet? Create one', toSignIn: 'Already have an account? Sign in',
        newPassword: 'Password (at least 8 characters)', servers: 'Your servers', none: 'No servers linked yet.', link: 'Link a server',
        linkIntro: 'On your server, turn on “Link to a Vidalune account” (Admin → Vidalune account) and enter the code it shows.',
        code: 'Code', linkButton: 'Link', linked: 'Linked: {name}.', online: 'online', offline: 'offline — last seen {when}', unlink: 'Unlink',
        unlinkConfirm: 'Unlink {name} from your account?', signOut: 'Sign out', delete: 'Delete account', deleteConfirm: 'Enter your password to delete your account. Your servers are unlinked.',
        deleteButton: 'Delete for good', cancel: 'Cancel', version: 'version {v}', open: 'Open', privacy: 'Vidalune keeps only your email address, an encrypted password and, per server, its name, version and address. Never your media or what you watch.',
        failed: 'That did not work. Try again.',
      };
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
    const res = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || t('failed')), { status: res.status });
    return data;
  }
  // A code handed over in the address (/link#K7F3-Q9MA), kept until someone is signed in.
  const pendingCode = () => (location.hash.length > 1 ? decodeURIComponent(location.hash.slice(1)) : '');
  const when = (ms) => new Date(ms).toLocaleString(nl ? 'nl-NL' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' });

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

  function signIn(mode = 'in') {
    const up = mode === 'up';
    show(
      el('h1', {}, t('title')),
      el('p', {}, t('intro')),
      el('div', { class: 'card' },
        form([
          el('label', {}, t('email'), el('input', { name: 'email', type: 'email', autocomplete: 'email', required: true })),
          el('label', {}, up ? t('newPassword') : t('password'), el('input', { name: 'password', type: 'password', autocomplete: up ? 'new-password' : 'current-password', minlength: up ? 8 : null, required: true })),
        ], up ? t('signUp') : t('signIn'), async (v) => {
          await api('POST', up ? '/api/account' : '/api/login', v);
          await home();
        }),
      ),
      el('button', { class: 'link', type: 'button', onclick: () => signIn(up ? 'in' : 'up') }, up ? t('toSignIn') : t('toSignUp')),
      el('p', { class: 'small' }, t('privacy')),
    );
  }

  async function home(message = '') {
    let me;
    try {
      me = await api('GET', '/api/account');
    } catch {
      return signIn(pendingCode() ? 'up' : 'in');
    }
    const list = await api('GET', '/api/servers');
    const linkCard = el('div', { class: 'card' },
      el('h1', {}, t('link')),
      el('p', {}, t('linkIntro')),
      form([el('label', {}, t('code'), el('input', { name: 'code', class: 'code', autocomplete: 'off', value: pendingCode(), maxlength: 12, required: true }))], t('linkButton'), async (v) => {
        const s = await api('POST', '/api/link', v);
        history.replaceState(null, '', '/servers');
        await home(t('linked', { name: s.name }));
      }),
    );
    show(
      el('div', { class: 'row' }, el('span', { class: 'small' }, me.email), el('button', { class: 'link', type: 'button', onclick: async () => { await api('POST', '/api/logout'); signIn(); } }, t('signOut'))),
      message ? el('p', { class: 'ok', role: 'status' }, message) : null,
      el('div', { class: 'card' },
        el('h1', {}, t('servers')),
        list.length === 0
          ? el('p', {}, t('none'))
          : el('ul', { class: 'servers' }, list.map((s) =>
              el('li', {},
                el('div', { class: 'row' },
                  el('strong', {}, s.name),
                  el('button', { class: 'ghost', type: 'button', onclick: async () => { if (confirm(t('unlinkConfirm', { name: s.name }))) { await api('DELETE', `/api/servers/${encodeURIComponent(s.id)}`); await home(); } } }, t('unlink')),
                ),
                el('div', { class: 'small' },
                  el('span', { class: s.online ? 'dot on' : 'dot' }),
                  s.online ? t('online') : t('offline', { when: when(s.lastSeenAt) }), ' · ', t('version', { v: s.version }),
                  s.url ? [' · ', el('a', { href: s.url, rel: 'noopener' }, t('open'))] : null,
                ),
              ))),
      ),
      pendingCode() || list.length === 0 ? linkCard : el('details', {}, el('summary', {}, t('link')), linkCard),
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
