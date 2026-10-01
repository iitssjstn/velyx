// The Vidalune Control Center (/admin): customers, access, relays and figures over time, for the
// CEO and administrators. Only they get data from /api/ceo (the service checks it on every call);
// everyone else sees why not. Every figure comes from the service: nothing here is made up.
(() => {
  const nl = (navigator.language || '').toLowerCase().startsWith('nl');
  document.documentElement.lang = nl ? 'nl' : 'en';
  const T = nl
    ? {
        nav: { general: 'Algemeen', infrastructure: 'Infrastructuur', overview: 'Overzicht', customers: 'Klanten', access: 'Toegang', relays: 'Relays', subtitles: 'Ondertitels', statistics: 'Statistieken', activity: 'Activiteit', account: 'Account', signOut: 'Uitloggen' },
        subs: { intro: 'Gekoppelde Vidalune-servers zoeken en downloaden ondertitels via vidalune.com met deze OpenSubtitles-sleutel, zodat niemand een eigen sleutel nodig heeft. Opgehaalde bestanden worden hier bewaard. De sleutel en het wachtwoord worden gecontroleerd voordat ze worden opgeslagen en worden daarna nooit meer getoond.', status: 'Status', on: 'Aan, sleutel {hint}', onAccount: 'Aan, sleutel {hint}, ingelogd als {name}', off: 'Uit: servers kunnen geen ondertitels zoeken via vidalune.com', apiKey: 'OpenSubtitles API-sleutel', newKey: 'Nieuwe sleutel (laat leeg om de huidige te houden)', username: 'OpenSubtitles-gebruikersnaam', password: 'OpenSubtitles-wachtwoord', passwordKept: 'Laat leeg om het opgeslagen wachtwoord te houden', accountHint: 'Met een (VIP-)account zijn er meer downloads per dag.', save: 'Controleren en opslaan', saved: 'OpenSubtitles opgeslagen', turnOff: 'Uitzetten', turnOffText: 'Servers kunnen dan geen ondertitels meer zoeken via vidalune.com. De bewaarde bestanden blijven staan.', turnedOff: 'Ondertitels via vidalune.com staan uit', files: 'Bewaarde bestanden', served: 'Keer geleverd', perServer: 'Per server: 40 nieuwe bestanden per dag; bewaarde bestanden tellen niet mee.' },
        controlCenter: 'Vidalune Control Center', only: 'Alleen voor de CEO en beheerders van Vidalune.', signIn: 'Log eerst in met je Vidalune-account.', toAccount: 'Naar je account',
        failed: 'Dat lukte niet. Probeer het opnieuw.', loadFailed: 'Kon dit niet laden.', retry: 'Opnieuw proberen', na: 'n.v.t.', none: 'Niets gevonden.', noData: 'Nog geen gegevens.', noHistory: 'Nog geen historische gegevens.',
        cancel: 'Annuleren', save: 'Opslaan', close: 'Sluiten', back: 'Terug', open: 'Openen', viewAll: 'Alles bekijken', more: 'Meer laden', page: 'Pagina {page} van {pages}',
        payments: 'Betalingen zijn nog niet gekoppeld. Toegang wordt nu met de hand beheerd.',
        customers: 'Klanten', totalCustomers: 'Klanten totaal', activeCustomers: 'Actieve klanten', ofCustomers: '{pct} van de klanten', new7: 'Nieuwe klanten', new30: 'Nieuwe klanten', last7: 'Laatste 7 dagen', last30: 'Laatste 30 dagen', growth: 'Groei', growthSub: '30 dagen t.o.v. de 30 daarvoor', suspendedN: '{n} geblokkeerd',
        access: 'Toegang', withAccess: 'Met toegang', expiringSoon: 'Loopt binnenkort af', within14: 'Binnen 14 dagen', within7: 'Binnen 7 dagen', expired: 'Verlopen',
        types: { customer: 'Klant', beta: 'Beta', test: 'Test', free: 'Gratis' }, plans: { remote: 'Toegang op afstand', viewer: 'Kijker' }, noAccess: 'Geen toegang',
        status: { active: 'Actief', inactive: 'Niet actief', suspended: 'Geblokkeerd', scheduled: 'Gepland', expiring: 'Loopt af', expired: 'Verlopen', revoked: 'Ingetrokken', online: 'Online', degraded: 'Verminderd', offline: 'Offline', unknown: 'Nog niet gecontroleerd', disabled: 'Uit' },
        invited: 'Wacht op aanmelding',
        infra: 'Relay-infrastructuur', activeRelays: 'Actieve relays', onlineRelays: 'Online relays', ofRelays: 'van {n}', clients: 'Verbonden clients', clientsSub: 'apparaten, laatste 5 min.', connectedServers: 'Verbonden servers', capacity: 'Capaciteit', current: 'Huidige bandbreedte', load: 'Belasting', available: 'Beschikbaar', peak: 'Piek', uptime: 'Uptime', lastSeen: 'Laatst gezien {when}', lastHeartbeat: 'Laatste controle', neverChecked: 'nog niet gecontroleerd',
        health: 'Relay-status', mainRelay: 'hoofdrelay', nearQuota: '{name}: {used} van {quota} GB deze maand; daarna {mbps} Mbit/s.', recent: 'Recente activiteit', when: 'Tijdstip', action: 'Actie', target: 'Waarop', actor: 'Door', system: 'systeem',
        actions: {
          'customer.created': 'Klant toegevoegd', 'customer.updated': 'Klant gewijzigd', 'customer.suspended': 'Klant geblokkeerd', 'customer.unsuspended': 'Blokkade opgeheven',
          'access.granted': 'Toegang gegeven', 'access.changed': 'Toegang gewijzigd', 'access.extended': 'Toegang verlengd', 'access.revoked': 'Toegang ingetrokken',
          'relay.created': 'Relay toegevoegd', 'relay.updated': 'Relay gewijzigd', 'relay.enabled': 'Relay aangezet', 'relay.disabled': 'Relay uitgezet', 'relay.removed': 'Relay verwijderd',
          'relay.online': 'Relay weer online', 'relay.offline': 'Relay offline', 'relay.customerAssigned': 'Klant aan relay gekoppeld', 'relay.customerRemoved': 'Klant van relay gehaald',
          'relay.serverAssigned': 'Server aan relay gekoppeld', 'relay.serverRemoved': 'Server van relay gehaald', 'server.limitChanged': 'Serverlimiet gewijzigd',
        },
        search: 'Klanten zoeken', addCustomer: 'Klant toevoegen', filters: { all: 'Alle', active: 'Actief', inactive: 'Niet actief', expiring: 'Loopt af', none: 'Geen toegang', suspended: 'Geblokkeerd', invited: 'Wacht op aanmelding' },
        sort: 'Sorteren', sorts: { created: 'Aangemaakt', lastActive: 'Laatst actief', expires: 'Verloopt', name: 'Naam' }, asc: 'Oplopend', desc: 'Aflopend',
        col: { customer: 'Klant', email: 'E-mail', access: 'Toegang', status: 'Status', created: 'Aangemaakt', lastActive: 'Laatst actief', expires: 'Verloopt', relay: 'Relay', started: 'Gestart', type: 'Type', plan: 'Wat', server: 'Server', device: 'Apparaat', since: 'Verbonden sinds', usage: 'Verbruik', owner: 'Eigenaar', now: 'Nu', limit: 'Limiet' },
        never: 'nog nooit', noEnd: 'geen einddatum', name: 'Naam', email: 'E-mailadres', note: 'Notitie', notes: 'Notities', accessType: 'Soort toegang', accessStart: 'Begin', accessEnd: 'Einde (leeg: geen einddatum)', plan: 'Wat', relay: 'Relay', relayDefault: 'Hoofdrelay (vidalune.com)',
        addHint: 'De klant kiest een wachtwoord door zich op vidalune.com aan te melden met dit e-mailadres.', added: 'Klant toegevoegd: {email}.',
        overviewCard: 'Account', created: 'Aangemaakt', lastActive: 'Laatst actief', activeDays: 'Actieve dagen (30)', devices: 'Ingelogde apparaten', currentAccess: 'Huidige toegang', scheduledAccess: 'Gepland vanaf {date}', history: 'Geschiedenis van toegang', servers: 'Servers', noServers: 'Nog geen servers gekoppeld.', connected: 'verbonden', notConnected: 'niet verbonden',
        grant: 'Toegang geven', change: 'Toegang wijzigen', extend: 'Verlengen', extend30: '+30 dagen', extend365: '+1 jaar', revoke: 'Intrekken', suspend: 'Blokkeren', unsuspend: 'Blokkade opheffen', reason: 'Reden (optioneel)',
        revokeTitle: 'Toegang intrekken?', revokeText: 'Weet je zeker dat je de toegang van {who} wilt intrekken? Toegang op afstand stopt meteen: verbindingen via de relay worden gesloten. Het blijft in de geschiedenis staan.',
        suspendTitle: 'Klant blokkeren?', suspendText: '{who} wordt overal uitgelogd, kan niet meer inloggen en de servers van deze klant zijn niet meer bereikbaar via Vidalune, tot je de blokkade opheft.',
        granted: 'Toegang gegeven.', changed: 'Toegang gewijzigd.', extended: 'Verlengd tot {date}.', revoked: 'Toegang ingetrokken.', suspended: 'Klant geblokkeerd.', unsuspended: 'Blokkade opgeheven.', saved: 'Opgeslagen.',
        show: { active: 'Actief', expiring: 'Loopt af', scheduled: 'Gepland', expired: 'Verlopen', all: 'Alles' }, allTypes: 'Alle typen',
        addRelay: 'Relay toevoegen', editRelay: 'Relay wijzigen', region: 'Regio', url: 'Adres (https)', capacityMbps: 'Capaciteit (Mbit/s)', quotaGb: 'Verkeer per maand (GB, leeg: onbeperkt)', overMbps: 'Snelheid daarna (Mbit/s)',
        enable: 'Aanzetten', disable: 'Uitzetten', remove: 'Verwijderen', relayAdded: 'Relay toegevoegd: {name}.', relayUpdated: 'Relay bijgewerkt.', relayRemoved: 'Relay verwijderd.',
        removeTitle: 'Relay verwijderen?', removeText: 'Weet je zeker dat je {name} wilt verwijderen? De {n} server(s) en klanten op deze relay gaan terug naar de hoofdrelay. De metingen van deze relay verdwijnen.',
        disableTitle: 'Relay uitzetten?', disableText: 'De servers en klanten op {name} gaan terug naar de hoofdrelay.',
        totalCapacity: 'Totale capaciteit', currentUsage: 'Huidig gebruik', hostname: 'Adres', monthly: 'Maandlimiet', unlimited: 'onbeperkt', thisMonth: 'deze maand {used} GB',
        bandwidth: 'Bandbreedte (Mbit/s)', clientsOverTime: 'Verbonden clients', loadOverTime: 'Belasting (%)', trafficDay: 'Verkeer per dag (GB)', errorsDay: 'Fouten per dag',
        connectedClients: 'Verbonden clients', clientsHint: 'Apparaten van kijkers die via deze relay kijken (alleen het soort apparaat; niets anders wordt bewaard).', noClients: 'Nu geen clients verbonden.',
        customersHere: 'Klanten op deze relay', customersHint: 'Een klant op deze relay neemt al zijn servers mee, ook servers die later worden gekoppeld.', addClient: 'Klant toevoegen', noCustomersHere: 'Nog geen klanten op deze relay.',
        serversHere: 'Servers op deze relay', addServer: 'Server toevoegen', noServersHere: 'Nog geen servers op deze relay.', takeOff: 'Van deze relay af', limitDefault: 'standaard ({n})', noLimit: 'geen',
        customerEmail: 'E-mailadres van de klant', chooseServer: 'Server', findCustomer: 'Zoeken', moved: '{n} server(s) verplaatst.', limitSaved: 'Limiet opgeslagen.',
        range: 'Periode', ranges: { '1h': '1 uur', '6h': '6 uur', '24h': '24 uur', '7d': '7 dagen', '30d': '30 dagen', '90d': '90 dagen', '365d': '1 jaar' },
        stats: { customers: 'Klanten', active: 'Actief in periode', new: 'Nieuw in periode', growth: 'Groei t.o.v. vorige periode', accessStats: 'Toegang', relayStats: 'Relays', total: 'Relays', online: 'Online', offline: 'Offline', avgLoad: 'Gemiddelde belasting', since: 'Metingen sinds {date}' },
        chartAccounts: 'Accounts (totaal)', chartNew: 'Nieuwe accounts per dag', chartActive: 'Actieve accounts per dag', chartAccess: 'Accounts met toegang', chartHourly: 'Bandbreedte per uur (Mbit/s)', chartClients: 'Clients per uur',
        table: 'Als tabel', day: 'Dag', value: 'Waarde', ago: { now: 'zojuist', m: '{n} min. geleden', h: '{n} uur geleden', d: '{n} dagen geleden' },
      }
    : {
        nav: { general: 'General', infrastructure: 'Infrastructure', overview: 'Overview', customers: 'Customers', access: 'Access', relays: 'Relays', subtitles: 'Subtitles', statistics: 'Statistics', activity: 'Activity', account: 'Account', signOut: 'Sign out' },
        subs: { intro: 'Linked Vidalune servers search and download subtitles through vidalune.com with this OpenSubtitles key, so nobody needs a key of their own. Fetched files are kept here. The key and password are checked before they are saved and are never shown again.', status: 'Status', on: 'On, key {hint}', onAccount: 'On, key {hint}, signed in as {name}', off: 'Off: servers cannot search subtitles through vidalune.com', apiKey: 'OpenSubtitles API key', newKey: 'New key (leave empty to keep the current one)', username: 'OpenSubtitles username', password: 'OpenSubtitles password', passwordKept: 'Leave empty to keep the saved password', accountHint: 'A (VIP) account allows more downloads per day.', save: 'Check and save', saved: 'OpenSubtitles saved', turnOff: 'Turn off', turnOffText: 'Servers can then no longer search subtitles through vidalune.com. The kept files stay.', turnedOff: 'Subtitles through vidalune.com are off', files: 'Kept files', served: 'Times delivered', perServer: 'Per server: 40 new files a day; kept files do not count.' },
        controlCenter: 'Vidalune Control Center', only: 'Only for the CEO and administrators of Vidalune.', signIn: 'Sign in with your Vidalune account first.', toAccount: 'To your account',
        failed: 'That did not work. Try again.', loadFailed: 'Could not load this.', retry: 'Retry', na: 'N/A', none: 'Nothing found.', noData: 'No data available yet.', noHistory: 'No historical data available.',
        cancel: 'Cancel', save: 'Save', close: 'Close', back: 'Back', open: 'Open', viewAll: 'View all', more: 'Load more', page: 'Page {page} of {pages}',
        payments: 'Payments are not connected yet. Customer access is currently managed manually.',
        customers: 'Customers', totalCustomers: 'Total customers', activeCustomers: 'Active customers', ofCustomers: '{pct} of customers', new7: 'New customers', new30: 'New customers', last7: 'Last 7 days', last30: 'Last 30 days', growth: 'Growth', growthSub: '30 days against the 30 before', suspendedN: '{n} suspended',
        access: 'Access', withAccess: 'With access', expiringSoon: 'Expiring soon', within14: 'Within 14 days', within7: 'Within 7 days', expired: 'Expired',
        types: { customer: 'Customer', beta: 'Beta', test: 'Test', free: 'Free' }, plans: { remote: 'Remote access', viewer: 'Viewer' }, noAccess: 'No access',
        status: { active: 'Active', inactive: 'Inactive', suspended: 'Suspended', scheduled: 'Scheduled', expiring: 'Expiring', expired: 'Expired', revoked: 'Revoked', online: 'Online', degraded: 'Degraded', offline: 'Offline', unknown: 'Not checked yet', disabled: 'Off' },
        invited: 'Awaiting sign-up',
        infra: 'Relay infrastructure', activeRelays: 'Active relays', onlineRelays: 'Online relays', ofRelays: 'of {n}', clients: 'Connected clients', clientsSub: 'devices, last 5 min', connectedServers: 'Connected servers', capacity: 'Capacity', current: 'Current bandwidth', load: 'Relay load', available: 'Available', peak: 'Peak', uptime: 'Uptime', lastSeen: 'Last seen {when}', lastHeartbeat: 'Last heartbeat', neverChecked: 'not checked yet',
        health: 'Relay health', mainRelay: 'main relay', nearQuota: '{name}: {used} of {quota} GB this month; then {mbps} Mbit/s.', recent: 'Recent activity', when: 'Time', action: 'Action', target: 'Target', actor: 'Actor', system: 'system',
        actions: {
          'customer.created': 'Customer added', 'customer.updated': 'Customer changed', 'customer.suspended': 'Customer suspended', 'customer.unsuspended': 'Suspension lifted',
          'access.granted': 'Access granted', 'access.changed': 'Access changed', 'access.extended': 'Access extended', 'access.revoked': 'Access revoked',
          'relay.created': 'Relay added', 'relay.updated': 'Relay changed', 'relay.enabled': 'Relay enabled', 'relay.disabled': 'Relay disabled', 'relay.removed': 'Relay removed',
          'relay.online': 'Relay back online', 'relay.offline': 'Relay offline', 'relay.customerAssigned': 'Customer assigned to relay', 'relay.customerRemoved': 'Customer taken off relay',
          'relay.serverAssigned': 'Server assigned to relay', 'relay.serverRemoved': 'Server taken off relay', 'server.limitChanged': 'Server limit changed',
        },
        search: 'Search customers', addCustomer: 'Add customer', filters: { all: 'All', active: 'Active', inactive: 'Inactive', expiring: 'Expiring soon', none: 'No access', suspended: 'Suspended', invited: 'Awaiting sign-up' },
        sort: 'Sort', sorts: { created: 'Created', lastActive: 'Last active', expires: 'Expiration', name: 'Name' }, asc: 'Ascending', desc: 'Descending',
        col: { customer: 'Customer', email: 'Email', access: 'Access', status: 'Status', created: 'Created', lastActive: 'Last active', expires: 'Expires', relay: 'Relay', started: 'Started', type: 'Type', plan: 'Plan', server: 'Server', device: 'Device', since: 'Connected since', usage: 'Usage', owner: 'Owner', now: 'Now', limit: 'Limit' },
        never: 'never', noEnd: 'no end date', name: 'Name', email: 'Email address', note: 'Note', notes: 'Notes', accessType: 'Access type', accessStart: 'Access start', accessEnd: 'Access expiration (empty: no end)', plan: 'Plan', relay: 'Relay', relayDefault: 'Main relay (vidalune.com)',
        addHint: 'The customer chooses a password by signing up on vidalune.com with this email address.', added: 'Customer added: {email}.',
        overviewCard: 'Account', created: 'Created', lastActive: 'Last active', activeDays: 'Active days (30)', devices: 'Signed-in devices', currentAccess: 'Current access', scheduledAccess: 'Scheduled from {date}', history: 'Access history', servers: 'Servers', noServers: 'No servers linked yet.', connected: 'connected', notConnected: 'not connected',
        grant: 'Grant access', change: 'Change access', extend: 'Extend', extend30: '+30 days', extend365: '+1 year', revoke: 'Revoke access', suspend: 'Suspend customer', unsuspend: 'Lift suspension', reason: 'Reason (optional)',
        revokeTitle: 'Revoke access?', revokeText: 'Are you sure you want to revoke access for {who}? Remote access stops at once: connections through the relay are closed. It stays in the history.',
        suspendTitle: 'Suspend this customer?', suspendText: '{who} is signed out everywhere, cannot sign in, and their servers can no longer be reached through Vidalune until you lift the suspension.',
        granted: 'Access granted.', changed: 'Access changed.', extended: 'Extended until {date}.', revoked: 'Access revoked.', suspended: 'Customer suspended.', unsuspended: 'Suspension lifted.', saved: 'Saved.',
        show: { active: 'Active', expiring: 'Expiring', scheduled: 'Scheduled', expired: 'Expired', all: 'All' }, allTypes: 'All types',
        addRelay: 'Add relay', editRelay: 'Edit relay', region: 'Region', url: 'Address (https)', capacityMbps: 'Capacity (Mbit/s)', quotaGb: 'Traffic per month (GB, empty: unlimited)', overMbps: 'Speed beyond it (Mbit/s)',
        enable: 'Enable', disable: 'Disable', remove: 'Remove', relayAdded: 'Relay added: {name}.', relayUpdated: 'Relay updated.', relayRemoved: 'Relay removed.',
        removeTitle: 'Remove relay?', removeText: 'Are you sure you want to remove {name}? Its {n} server(s) and customers go back to the main relay. Its measurements are deleted.',
        disableTitle: 'Disable relay?', disableText: 'The servers and customers on {name} go back to the main relay.',
        totalCapacity: 'Total capacity', currentUsage: 'Current usage', hostname: 'Address', monthly: 'Monthly allowance', unlimited: 'unlimited', thisMonth: 'this month {used} GB',
        bandwidth: 'Bandwidth (Mbit/s)', clientsOverTime: 'Connected clients', loadOverTime: 'Relay load (%)', trafficDay: 'Traffic per day (GB)', errorsDay: 'Errors per day',
        connectedClients: 'Connected clients', clientsHint: 'Viewers’ devices watching through this relay (only the kind of device; nothing else is kept).', noClients: 'No clients connected right now.',
        customersHere: 'Customers on this relay', customersHint: 'A customer on this relay brings all their servers along, also servers linked later.', addClient: 'Add customer', noCustomersHere: 'No customers on this relay yet.',
        serversHere: 'Servers on this relay', addServer: 'Add server', noServersHere: 'No servers on this relay yet.', takeOff: 'Off this relay', limitDefault: 'default ({n})', noLimit: 'none',
        customerEmail: 'Customer email address', chooseServer: 'Server', findCustomer: 'Find', moved: '{n} server(s) moved.', limitSaved: 'Limit saved.',
        range: 'Period', ranges: { '1h': '1 hour', '6h': '6 hours', '24h': '24 hours', '7d': '7 days', '30d': '30 days', '90d': '90 days', '365d': '1 year' },
        stats: { customers: 'Customers', active: 'Active in period', new: 'New in period', growth: 'Growth vs previous period', accessStats: 'Access', relayStats: 'Relays', total: 'Relays', online: 'Online', offline: 'Offline', avgLoad: 'Average load', since: 'Measured since {date}' },
        chartAccounts: 'Accounts (total)', chartNew: 'New accounts per day', chartActive: 'Active accounts per day', chartAccess: 'Accounts with access', chartHourly: 'Bandwidth per hour (Mbit/s)', chartClients: 'Clients per hour',
        table: 'As a table', day: 'Day', value: 'Value', ago: { now: 'just now', m: '{n} min ago', h: '{n} h ago', d: '{n} days ago' },
      };
  /** An action's name (its key has dots of its own). */
  const actionName = (a) => T.actions[a] ?? a;
  const t = (key, vars = {}) => String(key.split('.').reduce((o, k) => o?.[k], T) ?? key).replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
  const $ = (id) => document.getElementById(id);
  const view = $('view');
  const tip = $('tip');

  // ---- building blocks
  const el = (tag, attrs = {}, ...children) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else if (k === 'width') e.style.width = v;
      else if (v !== false && v !== null && v !== undefined) e.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat(Infinity)) if (c !== null && c !== undefined && c !== false) e.append(c);
    return e;
  };
  const svg = (tag, attrs = {}, ...children) => {
    const e = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined) e.setAttribute(k, v);
    for (const c of children.flat()) if (c) e.append(c);
    return e;
  };
  // Icons in one consistent line style (24×24, 2px stroke).
  const ICONS = {
    subtitles: ['M3 5h18v14H3z', 'M7 15h4', 'M13 15h4', 'M7 11h10'],
    overview: ['M3 3h7v9H3z', 'M14 3h7v5h-7z', 'M14 12h7v9h-7z', 'M3 16h7v5H3z'],
    customers: ['M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2', 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 'M22 21v-2a4 4 0 0 0-3-3.87', 'M16 3.13a4 4 0 0 1 0 7.75'],
    access: ['M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z', 'M16.5 7.5h.01'],
    relays: ['M4.9 16.1C1 12.2 1 5.8 4.9 1.9', 'M7.8 4.7a6.14 6.14 0 0 0-.8 7.5', 'M12 9a1 1 0 1 0 0 2 1 1 0 0 0 0-2z', 'M16.2 4.8c2 2 2.26 5.11.8 7.47', 'M19.1 1.9a9.96 9.96 0 0 1 0 14.1', 'M9.5 18h5', 'M8 22l4-11 4 11'],
    statistics: ['M3 3v16a2 2 0 0 0 2 2h16', 'M7 16l4-4 4 4 6-6'],
    account: ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z', 'M12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M7 20.66V19a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v1.66'],
    signOut: ['M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4', 'M16 17l5-5-5-5', 'M21 12H9'],
    menu: ['M4 6h16', 'M4 12h16', 'M4 18h16'],
    close: ['M18 6 6 18', 'M6 6l12 12'],
    plus: ['M12 5v14', 'M5 12h14'],
    back: ['M19 12H5', 'M12 19l-7-7 7-7'],
  };
  const icon = (name) => svg('svg', { viewBox: '0 0 24 24', class: 'icon', 'aria-hidden': 'true' }, ICONS[name].map((d) => svg('path', { d })));

  async function api(method, url, body) {
    const res = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || t('failed')), { status: res.status });
    return data;
  }

  const locale = nl ? 'nl-NL' : 'en-GB';
  const num = (n) => Number(n).toLocaleString(locale);
  const pct = (n) => `${Number(n).toLocaleString(locale, { maximumFractionDigits: 1 })} %`;
  const date = (ms) => new Date(ms).toLocaleDateString(locale, { dateStyle: 'medium' });
  const dateTime = (ms) => new Date(ms).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' });
  const time = (ms) => new Date(ms).toLocaleTimeString(locale, { timeStyle: 'short' });
  const speed = (mbps) => (mbps === null || mbps === undefined ? t('na') : mbps >= 1000 ? `${(mbps / 1000).toLocaleString(locale, { maximumFractionDigits: 2 })} Gbit/s` : `${Number(mbps).toLocaleString(locale, { maximumFractionDigits: 1 })} Mbit/s`);
  const size = (b) => (b >= 1e9 ? `${(b / 1e9).toLocaleString(locale, { maximumFractionDigits: 1 })} GB` : b >= 1e6 ? `${Math.round(b / 1e6)} MB` : `${Math.round(b / 1e3)} kB`);
  const ago = (ms) => {
    const s = (Date.now() - ms) / 1000;
    return s < 60 ? t('ago.now') : s < 3600 ? t('ago.m', { n: Math.round(s / 60) }) : s < 86400 ? t('ago.h', { n: Math.round(s / 3600) }) : t('ago.d', { n: Math.round(s / 86400) });
  };
  /** A date field (yyyy-mm-dd, local) to the start or the end of that day. */
  const fromField = (v, end = false) => {
    if (!v) return null;
    const [y, m, d] = v.split('-').map(Number);
    return end ? new Date(y, m - 1, d, 23, 59, 59).getTime() : new Date(y, m - 1, d).getTime();
  };
  const toField = (ms) => {
    if (!ms) return '';
    const d = new Date(ms);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const who = (c) => c.name || c.email;

  // ---- feedback: toasts, dialogs, states
  let toastTimer;
  function toast(text, error = false) {
    const box = $('toast');
    box.textContent = text;
    box.className = `cc-toast${error ? ' error' : ''}`;
    box.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (box.hidden = true), 4000);
  }

  /**
   * A dialog with a form: the fields, and what to do on confirm (errors show in the dialog). For a
   * destructive action, `danger` makes the button say so.
   */
  function dialog({ title, text, fields = [], confirm, danger = false, onConfirm }) {
    const d = $('dialog');
    const error = el('p', { class: 'error', role: 'alert' });
    const submit = el('button', { type: 'submit', class: danger ? 'danger-solid' : '' }, confirm);
    const form = el('form', {
      method: 'dialog',
      onsubmit: async (e) => {
        e.preventDefault();
        submit.disabled = true;
        error.textContent = '';
        try {
          const values = Object.fromEntries(new FormData(form));
          const done = await onConfirm(values);
          d.close();
          if (done) toast(done);
          await go();
        } catch (err) {
          error.textContent = err.message;
        } finally {
          submit.disabled = false;
        }
      },
    },
      el('h2', {}, title),
      text ? el('p', {}, text) : null,
      fields,
      error,
      el('div', { class: 'cc-dialog-actions' }, el('button', { type: 'button', class: 'ghost', onclick: () => d.close() }, t('cancel')), submit),
    );
    d.replaceChildren(form);
    d.showModal();
    form.querySelector('input, select, textarea')?.focus();
  }
  const field = (label, input, hint) => el('label', { class: 'cc-field' }, el('span', {}, label), input, hint ? el('span', { class: 'small' }, hint) : null);
  const select = (name, options, value) => el('select', { name }, options.map(([v, l]) => el('option', { value: v, selected: String(v) === String(value ?? '') }, l)));

  const skeleton = (n = 4) => el('div', { class: 'cc-grid' }, Array.from({ length: n }, () => el('div', { class: 'cc-card cc-skeleton' })));
  const empty = (text) => el('p', { class: 'cc-empty' }, text);
  const errorState = (err) =>
    el('div', { class: 'cc-card cc-error' }, el('p', {}, err.status === 401 ? t('signIn') : err.status === 403 ? t('only') : `${t('loadFailed')} ${err.message}`), err.status === 401 || err.status === 403 ? el('a', { href: '/servers', class: 'button' }, t('toAccount')) : el('button', { onclick: () => void go() }, t('retry')));

  // ---- layout pieces
  const header = (title, sub, ...actions) => el('div', { class: 'cc-head' }, el('div', {}, el('h1', {}, title), sub ? el('p', { class: 'cc-sub' }, sub) : null), actions.length ? el('div', { class: 'cc-head-actions' }, actions) : null);
  const section = (title, ...children) => el('section', { class: 'cc-section' }, title ? el('h2', {}, title) : null, children);
  const kpi = (label, value, sub, href) => {
    const body = [el('span', { class: 'cc-kpi-label' }, label), el('strong', { class: 'cc-kpi-value' }, value), sub ? el('span', { class: 'cc-kpi-sub' }, sub) : null];
    return href ? el('a', { class: 'cc-card cc-kpi link', href }, body) : el('div', { class: 'cc-card cc-kpi' }, body);
  };
  const kpis = (...items) => el('div', { class: 'cc-kpis' }, items);
  const bar = (value, max = 100) => {
    const p = max ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
    return el('div', { class: `cc-bar${p >= 90 ? ' hot' : p >= 70 ? ' warm' : ''}`, role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': Math.round(p) }, el('span', { width: `${p}%` }));
  };
  const pill = (status, label) => el('span', { class: `cc-pill ${status}` }, label ?? t(`status.${status}`));
  const typeBadge = (type) => el('span', { class: `cc-type ${type}` }, t(`types.${type}`));
  /** A table that scrolls sideways on narrow screens; rows may open something. */
  const table = (cols, rows, onRow) =>
    el('div', { class: 'cc-table-wrap' },
      el('table', { class: 'cc-table' },
        el('thead', {}, el('tr', {}, cols.map((c) => el('th', { scope: 'col' }, c)))),
        el('tbody', {}, rows.map((r) => el('tr', onRow ? { class: 'clickable', tabindex: 0, onclick: (e) => !e.target.closest('button, a, input, select') && onRow(r.item), onkeydown: (e) => e.key === 'Enter' && e.target === e.currentTarget && onRow(r.item) } : {}, r.cells.map((c) => el('td', {}, c))))),
      ),
    );
  const tabs = (options, value, onChange, label) =>
    el('div', { class: 'cc-tabs', role: 'group', 'aria-label': label }, options.map(([v, l]) => el('button', { type: 'button', class: v === value ? 'on' : '', 'aria-pressed': v === value ? 'true' : 'false', onclick: () => onChange(v) }, l)));

  // ---- charts: one series each, hover and keyboard tooltips, and a table view
  function chart(title, points, { format = num, kind = 'bars', label = (p) => date(p.t) } = {}) {
    if (!points.length) return el('figure', { class: 'cc-card chart-card' }, el('figcaption', {}, title), empty(t('noHistory')));
    const W = 420, H = 170, P = { l: 44, r: 8, t: 12, b: 24 };
    const values = points.map((p) => p.v ?? 0);
    const max = Math.max(1, ...values);
    const step = (W - P.l - P.r) / Math.max(1, points.length);
    const y = (v) => H - P.b - (v / max) * (H - P.t - P.b);
    const g = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', 'aria-label': title });
    for (const f of [0, 0.5, 1]) {
      const v = max * f;
      g.append(svg('line', { x1: P.l, x2: W - P.r, y1: y(v), y2: y(v), class: 'grid' }), svg('text', { x: P.l - 6, y: y(v) + 4, class: 'axis', 'text-anchor': 'end' }, format(Math.round(v * 10) / 10)));
    }
    g.append(svg('text', { x: P.l, y: H - 6, class: 'axis' }, label(points[0])));
    g.append(svg('text', { x: W - P.r, y: H - 6, class: 'axis', 'text-anchor': 'end' }, label(points.at(-1))));
    const say = (p, x) => {
      tip.textContent = `${label(p)}: ${p.v === null || p.v === undefined ? t('na') : format(p.v)}`;
      tip.hidden = false;
      const box = g.getBoundingClientRect();
      tip.style.left = `${Math.min(window.innerWidth - 200, Math.max(8, box.left + (x / W) * box.width - 60))}px`;
      tip.style.top = `${window.scrollY + box.top + 2}px`;
    };
    const hide = () => (tip.hidden = true);
    if (kind === 'line') g.append(svg('polyline', { points: values.map((v, i) => `${P.l + step * i + step / 2},${y(v)}`).join(' '), class: 'line' }));
    points.forEach((p, i) => {
      const v = values[i];
      const x = P.l + step * i;
      if (kind === 'bars' && v > 0) {
        const w = Math.max(1, step - 2);
        const h = Math.max(1, H - P.b - y(v));
        g.append(svg('rect', { x: x + 1, y: H - P.b - h, width: w, height: h, rx: Math.min(4, w / 2), class: 'bar' }));
      }
      const hit = svg('rect', { x, y: P.t, width: step, height: H - P.t - P.b, class: 'hit', tabindex: i === points.length - 1 ? 0 : -1 });
      hit.addEventListener('mouseenter', () => say(p, x + step / 2));
      hit.addEventListener('focus', () => say(p, x + step / 2));
      hit.addEventListener('mouseleave', hide);
      hit.addEventListener('blur', hide);
      hit.addEventListener('keydown', (e) => {
        const next = e.key === 'ArrowLeft' ? hit.previousElementSibling : e.key === 'ArrowRight' ? hit.nextElementSibling : null;
        if (next?.classList.contains('hit')) next.focus();
      });
      g.append(hit);
    });
    const tbl = el('details', {}, el('summary', { class: 'small' }, t('table')),
      el('table', { class: 'data' }, el('thead', {}, el('tr', {}, el('th', {}, t('day')), el('th', {}, t('value')))),
        el('tbody', {}, points.map((p) => el('tr', {}, el('td', {}, label(p)), el('td', {}, p.v === null || p.v === undefined ? t('na') : format(p.v)))))));
    return el('figure', { class: 'cc-card chart-card' }, el('figcaption', {}, title), g, tbl);
  }
  const days = (list, fn) => list.map((d) => ({ t: Date.parse(d.day), v: fn(d) }));

  // ---- navigation (the sidebar is the only navigation)
  const NAV = [
    ['general', [['overview', 'overview'], ['customers', 'customers'], ['access', 'access']]],
    ['infrastructure', [['relays', 'relays'], ['subtitles', 'subtitles'], ['statistics', 'statistics']]],
  ];
  const route = () => {
    const [path, query = ''] = location.hash.replace(/^#\/?/, '').split('?');
    const [page, arg] = path.split('/');
    return { page: ['overview', 'customers', 'access', 'relays', 'subtitles', 'statistics', 'activity'].includes(page) ? page : 'overview', arg: arg ? decodeURIComponent(arg) : null, params: new URLSearchParams(query) };
  };
  function renderNav() {
    const { page } = route();
    $('nav').replaceChildren(
      ...NAV.map(([group, items]) =>
        el('div', { class: 'cc-nav-group' },
          el('span', { class: 'cc-nav-title' }, t(`nav.${group}`)),
          items.map(([key, ic]) => el('a', { href: `#/${key}`, class: 'cc-nav-item', 'aria-current': key === page ? 'page' : null, onclick: closeNav }, icon(ic), el('span', {}, t(`nav.${key}`)))),
        ),
      ),
    );
    $('account').replaceChildren(
      el('a', { href: '/servers', class: 'cc-nav-item' }, icon('account'), el('span', {}, t('nav.account'))),
      el('button', { type: 'button', class: 'cc-nav-item', onclick: async () => { await api('POST', '/api/logout').catch(() => null); location.href = '/servers'; } }, icon('signOut'), el('span', {}, t('nav.signOut'))),
    );
  }
  function openNav() {
    document.body.classList.add('nav-open');
    $('scrim').hidden = false;
    $('open-nav').setAttribute('aria-expanded', 'true');
    $('close-nav').focus();
  }
  function closeNav() {
    document.body.classList.remove('nav-open');
    $('scrim').hidden = true;
    $('open-nav').setAttribute('aria-expanded', 'false');
  }
  $('open-nav').append(icon('menu'));
  $('close-nav').append(icon('close'));
  $('open-nav').addEventListener('click', openNav);
  $('close-nav').addEventListener('click', closeNav);
  $('scrim').addEventListener('click', closeNav);
  document.addEventListener('keydown', (e) => e.key === 'Escape' && document.body.classList.contains('nav-open') && closeNav());
  const crumbs = (...parts) => $('crumbs').replaceChildren(...parts.flatMap((p, i) => [i ? el('span', { class: 'sep', 'aria-hidden': 'true' }, '/') : null, typeof p === 'string' ? el('span', {}, p) : p]).filter(Boolean));

  // ---- overview
  const eventRows = (events) =>
    table([t('when'), t('action'), t('target'), t('actor')], events.map((e) => ({
      cells: [el('span', { title: dateTime(e.at) }, dateTime(e.at)), actionName(e.action), e.target, e.actor === 'system' ? el('span', { class: 'muted' }, t('system')) : e.actor],
    })));

  const relayRow = (r) =>
    el('a', { class: 'cc-relay-row', href: `#/relays/${r.id}` },
      el('div', { class: 'cc-relay-name' }, el('strong', {}, r.name), el('span', { class: 'small' }, [r.region, r.main ? t('mainRelay') : null].filter(Boolean).join(' · '))),
      pill(r.status),
      r.status === 'offline'
        ? el('span', { class: 'small cc-relay-wide' }, r.lastSeenAt ? t('lastSeen', { when: ago(r.lastSeenAt) }) : t('neverChecked'))
        : [
            el('span', { class: 'cc-relay-cap' }, speed(r.mbpsNow), el('span', { class: 'small' }, ` / ${speed(r.capacityMbps)}`), bar(r.usage)),
            el('span', { class: 'small' }, `${num(r.clients)} clients`),
            el('span', { class: 'small' }, `${t('uptime')} ${r.uptime30 === null ? t('na') : pct(r.uptime30)}`),
          ],
    );

  async function overview() {
    crumbs(t('nav.overview'));
    show(header(t('nav.overview'), t('controlCenter')), skeleton(8));
    const d = await api('GET', '/api/ceo/dashboard');
    const c = d.customers;
    const a = d.access;
    const r = d.relays;
    show(
      header(t('nav.overview'), t('controlCenter')),
      section(t('customers'),
        kpis(
          kpi(t('totalCustomers'), num(c.total), c.suspended ? t('suspendedN', { n: c.suspended }) : null, '#/customers'),
          kpi(t('activeCustomers'), num(c.active), c.total ? t('ofCustomers', { pct: pct((c.active / c.total) * 100) }) : null, '#/customers?status=active'),
          kpi(t('new7'), num(c.new7), t('last7'), '#/customers?sort=created'),
          kpi(t('new30'), num(c.new30), t('last30'), '#/customers?sort=created'),
          kpi(t('growth'), c.growth30 === null ? t('na') : `${c.growth30 > 0 ? '+' : ''}${pct(c.growth30)}`, t('growthSub')),
        ),
      ),
      section(t('access'),
        kpis(
          kpi(t('withAccess'), num(a.total), null, '#/access'),
          ...Object.keys(T.types).map((k) => kpi(t(`types.${k}`), num(a.byType[k]), null, `#/access?type=${k}`)),
          kpi(t('expiringSoon'), num(a.expiringIn14Days), t('within14'), '#/access?show=expiring'),
          kpi(t('expired'), num(a.expired), null, '#/access?show=expired'),
        ),
        el('p', { class: 'cc-note' }, t('payments')),
      ),
      section(t('infra'),
        kpis(
          kpi(t('activeRelays'), num(r.nodes), null, '#/relays'),
          kpi(t('onlineRelays'), num(r.online), t('ofRelays', { n: num(r.nodes) }), '#/relays'),
          kpi(t('clients'), num(r.clients), t('clientsSub')),
          kpi(t('connectedServers'), num(d.servers.connected), `${num(d.servers.total)} ${t('servers').toLowerCase()}`),
          kpi(t('capacity'), speed(r.capacityMbps)),
          kpi(t('current'), speed(r.mbpsNow), `${t('available')} ${speed(r.availableMbps)}`),
          el('div', { class: 'cc-card cc-kpi' }, el('span', { class: 'cc-kpi-label' }, t('load')), el('strong', { class: 'cc-kpi-value' }, pct(r.usage)), bar(r.usage)),
        ),
        r.nearQuota.map((q) => el('p', { class: 'cc-warning', role: 'alert' }, t('nearQuota', { name: q.name, used: num(q.usedGb), quota: num(q.monthlyGb), mbps: q.overQuotaMbps ?? '?' }))),
      ),
      section(t('health'), el('div', { class: 'cc-card cc-list' }, r.list.map(relayRow))),
      section(t('recent'),
        d.activity.length ? el('div', { class: 'cc-card flush' }, eventRows(d.activity)) : el('div', { class: 'cc-card' }, empty(t('noData'))),
        el('p', {}, el('a', { href: '#/activity' }, t('viewAll'))),
      ),
    );
  }

  async function activity() {
    crumbs(el('a', { href: '#/overview' }, t('nav.overview')), t('nav.activity'));
    show(header(t('nav.activity')), skeleton(2));
    const d = await api('GET', '/api/ceo/activity?limit=200');
    show(header(t('nav.activity')), d.events.length ? el('div', { class: 'cc-card flush' }, eventRows(d.events)) : el('div', { class: 'cc-card' }, empty(t('noData'))));
  }

  // ---- customers
  async function relayOptions() {
    const d = await api('GET', '/api/ceo/relays');
    return d.relays.filter((r) => r.active).map((r) => [r.main ? '' : r.id, r.main ? t('relayDefault') : `${r.name}${r.region ? ` (${r.region})` : ''}`]);
  }
  const accessFields = (withNone, g = {}) => [
    field(t('accessType'), select('type', [...(withNone ? [['', t('noAccess')]] : []), ...Object.keys(T.types).map((k) => [k, t(`types.${k}`)])], g.type ?? (withNone ? '' : 'customer'))),
    field(t('plan'), select('plan', Object.keys(T.plans).map((k) => [k, t(`plans.${k}`)]), g.plan ?? 'remote')),
    el('div', { class: 'cc-row' },
      field(t('accessStart'), el('input', { type: 'date', name: 'startsAt', value: toField(g.startsAt ?? Date.now()) })),
      field(t('accessEnd'), el('input', { type: 'date', name: 'endsAt', value: toField(g.endsAt) })),
    ),
  ];
  /** The start date: today means now (not midnight, which has passed). */
  const startOf = (v) => {
    const ms = fromField(v);
    return ms === null || toField(ms) === toField(Date.now()) ? undefined : ms;
  };

  async function addCustomer() {
    const relays = await relayOptions();
    dialog({
      title: t('addCustomer'),
      text: t('addHint'),
      fields: [
        field(t('name'), el('input', { name: 'name', maxlength: 100, autocomplete: 'off' })),
        field(t('email'), el('input', { name: 'email', type: 'email', required: true, autocomplete: 'off' })),
        ...accessFields(true),
        field(t('relay'), select('relayId', relays, '')),
        field(t('notes'), el('textarea', { name: 'note', maxlength: 300, rows: 2 })),
      ],
      confirm: t('addCustomer'),
      onConfirm: async (v) => {
        const c = await api('POST', '/api/ceo/customers', {
          email: v.email,
          name: v.name || null,
          note: v.note || null,
          relayId: v.relayId ? Number(v.relayId) : null,
          access: v.type ? { type: v.type, plan: v.plan, startsAt: startOf(v.startsAt), endsAt: fromField(v.endsAt, true) } : null,
        });
        location.hash = `#/customers/${c.id}`;
        return t('added', { email: c.email });
      },
    });
  }

  let customerQuery = { q: '', filter: 'all', sort: 'created', dir: '', page: 1 };
  async function customers(arg, params) {
    if (arg) return customer(Number(arg));
    crumbs(t('nav.customers'));
    if (params.has('status') || params.has('sort') || params.has('type')) {
      customerQuery = { ...customerQuery, filter: params.get('status') || params.get('type') || 'all', sort: params.get('sort') || customerQuery.sort, page: 1 };
      history.replaceState(null, '', '#/customers');
    }
    const top = header(t('nav.customers'), null, el('button', { onclick: () => void addCustomer().catch((e) => toast(e.message, true)) }, icon('plus'), t('addCustomer')));
    show(top, skeleton(1));
    const f = customerQuery.filter;
    const qs = new URLSearchParams({ q: customerQuery.q, sort: customerQuery.sort, page: String(customerQuery.page) });
    if (customerQuery.dir) qs.set('dir', customerQuery.dir);
    if (['customer', 'beta', 'test', 'free', 'none'].includes(f)) qs.set('type', f);
    else if (f !== 'all') qs.set('status', f);
    const d = await api('GET', `/api/ceo/customers?${qs}`);
    const pages = Math.max(1, Math.ceil(d.total / d.pageSize));
    const set = (patch) => {
      customerQuery = { ...customerQuery, page: 1, ...patch };
      void go();
    };
    const toolbar = el('div', { class: 'cc-toolbar' },
      el('form', { class: 'cc-search', role: 'search', onsubmit: (e) => { e.preventDefault(); set({ q: new FormData(e.target).get('q') }); } },
        el('input', { name: 'q', type: 'search', placeholder: t('search'), 'aria-label': t('search'), value: customerQuery.q })),
      el('label', { class: 'cc-inline' }, el('span', {}, t('sort')),
        el('select', { onchange: (e) => set({ sort: e.target.value, dir: '' }) }, Object.keys(T.sorts).map((k) => el('option', { value: k, selected: k === customerQuery.sort }, t(`sorts.${k}`))))),
      el('select', { 'aria-label': t('sort'), onchange: (e) => set({ dir: e.target.value }) },
        [['', '—'], ['asc', t('asc')], ['desc', t('desc')]].map(([v, l]) => el('option', { value: v, selected: v === customerQuery.dir }, l))),
    );
    const filterTabs = tabs(
      [['all', t('filters.all')], ['active', t('filters.active')], ['inactive', t('filters.inactive')], ['expiring', t('filters.expiring')], ['none', t('filters.none')], ...Object.keys(T.types).map((k) => [k, t(`types.${k}`)]), ['suspended', t('filters.suspended')], ['invited', t('filters.invited')]],
      f,
      (v) => set({ filter: v }),
      t('nav.customers'),
    );
    const rows = d.customers.map((c) => ({
      item: c,
      cells: [
        el('div', { class: 'cc-who' }, el('strong', {}, who(c)), c.name ? el('span', { class: 'small' }, c.email) : null),
        c.access ? typeBadge(c.access.type) : el('span', { class: 'muted' }, t('noAccess')),
        el('span', { class: 'cc-stack' }, pill(c.status), c.invited ? el('span', { class: 'small' }, t('invited')) : null),
        date(c.createdAt),
        c.lastActive ? date(Date.parse(c.lastActive)) : el('span', { class: 'muted' }, t('never')),
        c.access ? (c.access.endsAt ? date(c.access.endsAt) : el('span', { class: 'muted' }, t('noEnd'))) : '—',
        c.relay.name,
        el('a', { href: `#/customers/${c.id}` }, t('open')),
      ],
    }));
    show(
      top,
      toolbar,
      filterTabs,
      d.customers.length
        ? el('div', { class: 'cc-card flush' }, table([t('col.customer'), t('col.access'), t('col.status'), t('col.created'), t('col.lastActive'), t('col.expires'), t('col.relay'), ''], rows, (c) => (location.hash = `#/customers/${c.id}`)))
        : el('div', { class: 'cc-card' }, empty(t('none'))),
      pages > 1
        ? el('div', { class: 'cc-pager' },
            el('button', { class: 'ghost', disabled: customerQuery.page <= 1, onclick: () => set({ page: customerQuery.page - 1 }) }, '‹'),
            el('span', { class: 'small' }, t('page', { page: d.page, pages })),
            el('button', { class: 'ghost', disabled: customerQuery.page >= pages, onclick: () => set({ page: customerQuery.page + 1 }) }, '›'))
        : null,
    );
  }

  function grantDialog(c) {
    dialog({
      title: t('grant'),
      text: who(c),
      fields: [...accessFields(false), field(t('note'), el('input', { name: 'note', maxlength: 300 }))],
      confirm: t('grant'),
      onConfirm: async (v) => {
        await api('POST', '/api/ceo/access', { accountId: c.id ?? c.accountId, type: v.type, plan: v.plan, startsAt: startOf(v.startsAt), until: fromField(v.endsAt, true), note: v.note || null });
        return t('granted');
      },
    });
  }
  function changeDialog(g, owner) {
    dialog({
      title: t('change'),
      text: owner,
      fields: [
        field(t('accessType'), select('type', Object.keys(T.types).map((k) => [k, t(`types.${k}`)]), g.type)),
        field(t('plan'), select('plan', Object.keys(T.plans).map((k) => [k, t(`plans.${k}`)]), g.plan)),
        field(t('accessEnd'), el('input', { type: 'date', name: 'endsAt', value: toField(g.endsAt) })),
        field(t('note'), el('input', { name: 'note', maxlength: 300, value: g.note ?? '' })),
      ],
      confirm: t('save'),
      onConfirm: async (v) => {
        const until = fromField(v.endsAt, true);
        await api('PUT', `/api/ceo/access/${g.id}`, { type: v.type, plan: v.plan, note: v.note || null, ...(until !== g.endsAt && toField(until) !== toField(g.endsAt) ? { until } : {}) });
        return t('changed');
      },
    });
  }
  function extendDialog(g, owner) {
    dialog({
      title: t('extend'),
      text: `${owner} · ${g.endsAt ? t('extended', { date: date(g.endsAt) }).replace(/\.$/, '') : t('noEnd')}`,
      fields: [field(t('extend'), select('days', [['30', t('extend30')], ['90', '+90'], ['365', t('extend365')]], '30'))],
      confirm: t('extend'),
      onConfirm: async (v) => {
        const r = await api('PUT', `/api/ceo/access/${g.id}`, { addDays: Number(v.days) });
        return t('extended', { date: date(r.endsAt) });
      },
    });
  }
  function revokeDialog(g, owner) {
    dialog({ title: t('revokeTitle'), text: t('revokeText', { who: owner }), confirm: t('revoke'), danger: true, onConfirm: async () => { await api('DELETE', `/api/ceo/access/${g.id}`); return t('revoked'); } });
  }
  const grantActions = (g, owner) =>
    g.status === 'revoked' || g.status === 'expired'
      ? null
      : el('div', { class: 'cc-actions' },
          el('button', { class: 'ghost small-button', onclick: () => changeDialog(g, owner) }, t('change')),
          el('button', { class: 'ghost small-button', onclick: () => extendDialog(g, owner) }, t('extend')),
          el('button', { class: 'ghost small-button danger', onclick: () => revokeDialog(g, owner) }, t('revoke')));

  async function customer(id) {
    crumbs(el('a', { href: '#/customers' }, t('nav.customers')), '…');
    show(skeleton(4));
    const [c, relays] = await Promise.all([api('GET', `/api/ceo/customers/${id}`), relayOptions()]);
    crumbs(el('a', { href: '#/customers' }, t('nav.customers')), who(c));
    const current = c.grants.find((g) => g.id === c.access?.grantId);
    const line = (label, value) => el('div', { class: 'cc-line' }, el('span', {}, label), el('strong', {}, value));
    const suspendButton =
      c.status === 'suspended'
        ? el('button', { class: 'ghost', onclick: () => dialog({ title: t('unsuspend'), text: who(c), confirm: t('unsuspend'), onConfirm: async () => { await api('POST', `/api/ceo/customers/${c.id}/unsuspend`, {}); return t('unsuspended'); } }) }, t('unsuspend'))
        : el('button', { class: 'ghost danger', onclick: () => dialog({ title: t('suspendTitle'), text: t('suspendText', { who: who(c) }), fields: [field(t('reason'), el('input', { name: 'reason', maxlength: 300 }))], confirm: t('suspend'), danger: true, onConfirm: async (v) => { await api('POST', `/api/ceo/customers/${c.id}/suspend`, { reason: v.reason || null }); return t('suspended'); } }) }, t('suspend'));
    const details = el('form', {
      class: 'cc-card cc-form',
      onsubmit: async (e) => {
        e.preventDefault();
        const v = Object.fromEntries(new FormData(e.target));
        try {
          await api('PUT', `/api/ceo/customers/${c.id}`, { name: v.name || null, note: v.note || null, relayId: v.relayId ? Number(v.relayId) : null });
          toast(t('saved'));
          await go();
        } catch (err) {
          toast(err.message, true);
        }
      },
    },
      el('h2', {}, t('overviewCard')),
      field(t('name'), el('input', { name: 'name', maxlength: 100, value: c.name ?? '' })),
      field(t('relay'), select('relayId', relays, c.relay.id && relays.some(([v]) => String(v) === String(c.relay.id)) ? c.relay.id : '')),
      field(t('notes'), el('textarea', { name: 'note', maxlength: 300, rows: 3 }, c.note ?? '')),
      el('button', { type: 'submit' }, t('save')),
    );
    show(
      el('p', {}, el('a', { href: '#/customers', class: 'cc-back' }, icon('back'), t('back'))),
      header(who(c), c.name ? c.email : null, c.status === 'suspended' ? null : el('button', { onclick: () => grantDialog(c) }, t('grant')), suspendButton),
      el('div', { class: 'cc-pills' }, pill(c.status), c.invited ? pill('scheduled', t('invited')) : null, c.access ? typeBadge(c.access.type) : null),
      c.status === 'suspended' ? el('p', { class: 'cc-warning' }, `${t('status.suspended')} · ${dateTime(c.suspendedAt)} · ${c.suspendedBy}`) : null,
      el('div', { class: 'cc-columns' },
        el('div', { class: 'cc-card' },
          line(t('col.email'), c.email),
          line(t('created'), date(c.createdAt)),
          line(t('lastActive'), c.lastActive ? date(Date.parse(c.lastActive)) : t('never')),
          line(t('activeDays'), num(c.activeDays30)),
          line(t('devices'), num(c.devices)),
          line(t('relay'), c.relay.name),
        ),
        el('div', { class: 'cc-card' },
          el('h2', {}, t('currentAccess')),
          current
            ? [
                line(t('col.type'), typeBadge(current.type)),
                line(t('col.plan'), t(`plans.${current.plan}`)),
                line(t('col.started'), date(current.startsAt)),
                line(t('col.expires'), current.endsAt ? date(current.endsAt) : t('noEnd')),
                line(t('col.status'), pill(current.status)),
                grantActions(current, who(c)),
              ]
            : el('p', { class: 'muted' }, c.plan ? t(`plans.${c.plan.plan}`) : t('noAccess')),
          c.scheduled ? el('p', { class: 'small' }, `${t(`types.${c.scheduled.type}`)} · ${t('scheduledAccess', { date: date(c.scheduled.startsAt) })}`) : null,
        ),
        details,
      ),
      section(t('servers'),
        c.servers.length
          ? el('div', { class: 'cc-card flush' }, table([t('col.server'), t('col.status'), t('clients'), t('col.lastActive')], c.servers.map((s) => ({
              cells: [s.name, s.connected ? pill('online', t('connected')) : pill('disabled', t('notConnected')), num(s.clients), dateTime(s.lastSeenAt)],
            }))))
          : el('div', { class: 'cc-card' }, empty(t('noServers'))),
      ),
      section(t('history'),
        c.grants.length
          ? el('div', { class: 'cc-card flush' }, table([t('col.type'), t('col.plan'), t('col.started'), t('col.expires'), t('col.status'), t('note'), ''], c.grants.map((g) => ({
              cells: [typeBadge(g.type), t(`plans.${g.plan}`), date(g.startsAt), g.endsAt ? date(g.endsAt) : t('noEnd'), pill(g.status), g.note ?? '', grantActions(g, who(c))],
            }))))
          : el('div', { class: 'cc-card' }, empty(t('noAccess'))),
      ),
      section(t('recent'), c.activity.length ? el('div', { class: 'cc-card flush' }, eventRows(c.activity)) : el('div', { class: 'cc-card' }, empty(t('noData')))),
    );
  }

  // ---- access
  let accessShow = 'active';
  let accessType = 'all';
  async function access(_arg, params) {
    crumbs(t('nav.access'));
    if (params.has('show') || params.has('type')) {
      accessShow = params.get('show') || 'active';
      accessType = params.get('type') || 'all';
      history.replaceState(null, '', '#/access');
    }
    const grantByEmail = () =>
      dialog({
        title: t('grant'),
        fields: [field(t('email'), el('input', { name: 'email', type: 'email', required: true, autocomplete: 'off' })), ...accessFields(false), field(t('note'), el('input', { name: 'note', maxlength: 300 }))],
        confirm: t('grant'),
        onConfirm: async (v) => {
          await api('POST', '/api/ceo/access', { email: v.email, type: v.type, plan: v.plan, startsAt: startOf(v.startsAt), until: fromField(v.endsAt, true), note: v.note || null });
          return t('granted');
        },
      });
    const top = header(t('nav.access'), null, el('button', { onclick: grantByEmail }, icon('plus'), t('grant')));
    show(top, skeleton(8));
    const d = await api('GET', `/api/ceo/access?show=${accessShow}&type=${accessType}`);
    const s = d.summary;
    show(
      top,
      kpis(
        kpi(t('withAccess'), num(s.total)),
        ...Object.keys(T.types).map((k) => kpi(t(`types.${k}`), num(s.byType[k]))),
        kpi(t('expiringSoon'), num(s.expiringIn7Days), t('within7')),
        kpi(t('expiringSoon'), num(s.expiringIn14Days), t('within14')),
        kpi(t('expired'), num(s.expired)),
      ),
      el('p', { class: 'cc-note' }, t('payments')),
      el('div', { class: 'cc-toolbar' },
        tabs(Object.keys(T.show).map((k) => [k, t(`show.${k}`)]), accessShow, (v) => { accessShow = v; void go(); }, t('nav.access')),
        el('select', { 'aria-label': t('col.type'), onchange: (e) => { accessType = e.target.value; void go(); } },
          [['all', t('allTypes')], ...Object.keys(T.types).map((k) => [k, t(`types.${k}`)])].map(([v, l]) => el('option', { value: v, selected: v === accessType }, l)))),
      d.grants.length
        ? el('div', { class: 'cc-card flush' }, table([t('col.customer'), t('col.type'), t('col.plan'), t('col.started'), t('col.expires'), t('col.status'), ''], d.grants.map((g) => ({
            item: g,
            cells: [
              el('div', { class: 'cc-who' }, el('strong', {}, g.name || g.email), g.name ? el('span', { class: 'small' }, g.email) : null),
              typeBadge(g.type), t(`plans.${g.plan}`), date(g.startsAt), g.endsAt ? date(g.endsAt) : t('noEnd'), pill(g.status), grantActions(g, g.name || g.email),
            ],
          })), (g) => (location.hash = `#/customers/${g.accountId}`)))
        : el('div', { class: 'cc-card' }, empty(t('none'))),
    );
  }

  // ---- relays
  const relayFields = (r = {}) => [
    el('div', { class: 'cc-row' }, field(t('name'), el('input', { name: 'name', required: true, maxlength: 60, value: r.name ?? '' })), field(t('region'), el('input', { name: 'region', maxlength: 60, value: r.region ?? '' }))),
    r.main ? null : field(t('url'), el('input', { name: 'url', type: 'url', required: true, placeholder: 'https://', value: r.url ?? '' })),
    el('div', { class: 'cc-row' },
      field(t('capacityMbps'), el('input', { name: 'capacity', type: 'number', min: 1, required: true, value: r.capacityMbps ?? '' })),
      field(t('quotaGb'), el('input', { name: 'quota', type: 'number', min: 1, value: r.quota?.monthlyGb ?? '' })),
      field(t('overMbps'), el('input', { name: 'over', type: 'number', min: 1, value: r.quota?.overQuotaMbps ?? '' })),
    ),
    field(t('note'), el('input', { name: 'note', maxlength: 300, value: r.note ?? '' })),
  ];
  const relayBody = (v, main) => {
    const n = (k) => (v[k] ? Number(v[k]) : null);
    return { name: v.name, region: v.region || null, ...(main ? {} : { url: v.url }), capacityMbps: n('capacity'), monthlyQuotaGb: n('quota'), overQuotaMbps: n('over'), note: v.note || null };
  };

  async function relays(arg) {
    if (arg) return relay(Number(arg));
    crumbs(t('nav.relays'));
    const add = () => dialog({ title: t('addRelay'), fields: relayFields(), confirm: t('addRelay'), onConfirm: async (v) => t('relayAdded', { name: (await api('POST', '/api/ceo/relays', relayBody(v, false))).name }) });
    const top = header(t('nav.relays'), null, el('button', { onclick: add }, icon('plus'), t('addRelay')));
    show(top, skeleton(3));
    const d = await api('GET', '/api/ceo/relays');
    const tot = d.totals;
    show(
      top,
      el('div', { class: 'cc-card cc-capacity' },
        el('div', { class: 'cc-capacity-figures' },
          el('div', {}, el('span', { class: 'cc-kpi-label' }, t('totalCapacity')), el('strong', { class: 'cc-kpi-value' }, speed(tot.capacityMbps))),
          el('div', {}, el('span', { class: 'cc-kpi-label' }, t('currentUsage')), el('strong', { class: 'cc-kpi-value' }, speed(tot.mbpsNow))),
          el('div', {}, el('span', { class: 'cc-kpi-label' }, t('available')), el('strong', { class: 'cc-kpi-value' }, speed(tot.availableMbps))),
          el('div', {}, el('span', { class: 'cc-kpi-label' }, t('load')), el('strong', { class: 'cc-kpi-value' }, pct(tot.usage))),
        ),
        bar(tot.usage),
      ),
      el('div', { class: 'cc-relays' }, d.relays.map((r) =>
        el('a', { class: `cc-card cc-relay${r.active ? '' : ' off'}`, href: `#/relays/${r.id}` },
          el('div', { class: 'cc-relay-head' }, el('div', {}, el('strong', {}, r.name), el('span', { class: 'small' }, [r.region, r.main ? t('mainRelay') : r.url ? new URL(r.url).host : null].filter(Boolean).join(' · '))), pill(r.status)),
          el('div', { class: 'cc-relay-usage' }, el('span', {}, speed(r.mbpsNow)), el('span', { class: 'small' }, `${pct(r.usage)} · ${t('available')} ${speed(r.availableMbps)}`)),
          bar(r.usage),
          el('dl', { class: 'cc-facts' },
            el('div', {}, el('dt', {}, t('capacity')), el('dd', {}, speed(r.capacityMbps))),
            el('div', {}, el('dt', {}, t('clients')), el('dd', {}, num(r.clients))),
            el('div', {}, el('dt', {}, t('connectedServers')), el('dd', {}, `${num(r.connected)} / ${num(r.servers)}`)),
            el('div', {}, el('dt', {}, t('uptime')), el('dd', {}, r.uptime30 === null ? t('na') : pct(r.uptime30))),
            el('div', {}, el('dt', {}, t('lastHeartbeat')), el('dd', {}, r.lastCheckAt ? ago(r.lastCheckAt) : t('neverChecked'))),
          ),
        ))),
    );
  }

  let relayRange = '24h';
  async function relay(id) {
    crumbs(el('a', { href: '#/relays' }, t('nav.relays')), '…');
    show(skeleton(6));
    const [r, h] = await Promise.all([api('GET', `/api/ceo/relays/${id}`), api('GET', `/api/ceo/relays/${id}/history?range=${relayRange}`)]);
    crumbs(el('a', { href: '#/relays' }, t('nav.relays')), r.name);
    const edit = () => dialog({ title: t('editRelay'), fields: relayFields(r), confirm: t('save'), onConfirm: async (v) => { await api('PUT', `/api/ceo/relays/${id}`, relayBody(v, r.main)); return t('relayUpdated'); } });
    const toggle = () =>
      r.active
        ? dialog({ title: t('disableTitle'), text: t('disableText', { name: r.name }), confirm: t('disable'), danger: true, onConfirm: async () => { await api('PUT', `/api/ceo/relays/${id}`, { active: false }); return t('relayUpdated'); } })
        : dialog({ title: t('enable'), text: r.name, confirm: t('enable'), onConfirm: async () => { await api('PUT', `/api/ceo/relays/${id}`, { active: true }); return t('relayUpdated'); } });
    const remove = () =>
      dialog({ title: t('removeTitle'), text: t('removeText', { name: r.name, n: r.servers }), confirm: t('remove'), danger: true, onConfirm: async () => { await api('DELETE', `/api/ceo/relays/${id}`); location.hash = '#/relays'; return t('relayRemoved'); } });
    const findCustomer = async (email) => {
      const list = await api('GET', `/api/ceo/customers?q=${encodeURIComponent(email)}`);
      const c = list.customers.find((x) => x.email === String(email).toLowerCase().trim());
      if (!c) throw new Error(t('none'));
      return c;
    };
    const addClient = () =>
      dialog({
        title: t('addClient'),
        text: t('customersHint'),
        fields: [field(t('customerEmail'), el('input', { name: 'email', type: 'email', required: true, autocomplete: 'off' }))],
        confirm: t('addClient'),
        onConfirm: async (v) => t('moved', { n: (await api('POST', `/api/ceo/relays/${id}/assign`, { accountId: (await findCustomer(v.email)).id })).moved }),
      });
    const addServer = () => {
      const serverSelect = el('select', { name: 'serverId', required: true, disabled: true }, el('option', { value: '' }, '—'));
      const emailInput = el('input', { name: 'email', type: 'email', required: true, autocomplete: 'off' });
      const find = el('button', {
        type: 'button', class: 'ghost',
        onclick: async () => {
          try {
            const c = await findCustomer(emailInput.value);
            serverSelect.replaceChildren(...c.servers.map((s) => el('option', { value: s.id }, s.name)));
            serverSelect.disabled = c.servers.length === 0;
            if (!c.servers.length) toast(t('noServers'), true);
          } catch (err) {
            toast(err.message, true);
          }
        },
      }, t('findCustomer'));
      dialog({
        title: t('addServer'),
        fields: [el('div', { class: 'cc-row end' }, field(t('customerEmail'), emailInput), find), field(t('chooseServer'), serverSelect)],
        confirm: t('addServer'),
        onConfirm: async (v) => {
          if (!v.serverId) throw new Error(t('none'));
          return t('moved', { n: (await api('POST', `/api/ceo/relays/${id}/assign`, { serverId: v.serverId })).moved });
        },
      });
    };
    const limitCell = (s) =>
      el('form', {
        class: 'cc-limit',
        onsubmit: async (e) => {
          e.preventDefault();
          const v = new FormData(e.target).get('limit');
          try {
            await api('PUT', `/api/ceo/servers/${encodeURIComponent(s.id)}/relay-limit`, { limitMbps: v ? Number(v) : null });
            toast(t('limitSaved'));
          } catch (err) {
            toast(err.message, true);
          }
        },
      },
        el('input', { name: 'limit', type: 'number', min: 1, max: 10000, value: s.limitMbps ?? '', placeholder: t('limitDefault', { n: r.serverDefaultMbps ? `${r.serverDefaultMbps} Mbit/s` : t('noLimit') }), 'aria-label': `${t('col.limit')} ${s.name}` }),
        el('button', { type: 'submit', class: 'ghost small-button' }, t('save')));
    const setRange = (v) => {
      relayRange = v;
      void go();
    };
    const fmtAt = (p) => (relayRange === '7d' || relayRange === '30d' ? dateTime(p.t) : time(p.t));
    const hPoints = (fn) => h.points.map((p) => ({ t: p.at, v: fn(p) }));
    show(
      el('p', {}, el('a', { href: '#/relays', class: 'cc-back' }, icon('back'), t('back'))),
      header(r.name, [r.region, r.main ? t('mainRelay') : null].filter(Boolean).join(' · ') || null,
        el('button', { class: 'ghost', onclick: edit }, t('editRelay')),
        r.main ? null : el('button', { class: 'ghost', onclick: toggle }, r.active ? t('disable') : t('enable')),
        r.main ? null : el('button', { class: 'ghost danger', onclick: remove }, t('remove'))),
      el('div', { class: 'cc-pills' }, pill(r.status), r.url ? el('span', { class: 'small' }, `${t('hostname')}: ${new URL(r.url).host}`) : null),
      kpis(
        kpi(t('capacity'), speed(r.capacityMbps)),
        el('div', { class: 'cc-card cc-kpi' }, el('span', { class: 'cc-kpi-label' }, t('current')), el('strong', { class: 'cc-kpi-value' }, speed(r.mbpsNow)), el('span', { class: 'cc-kpi-sub' }, `${pct(r.usage)} · ${t('available')} ${speed(r.availableMbps)}`), bar(r.usage)),
        kpi(t('peak'), speed(r.peakMbps30), t('ranges.30d')),
        kpi(t('clients'), num(r.clients), t('clientsSub')),
        kpi(t('connectedServers'), `${num(r.connected)} / ${num(r.servers)}`),
        kpi(t('uptime'), r.uptime30 === null ? t('na') : pct(r.uptime30), t('ranges.30d')),
        kpi(t('lastHeartbeat'), r.lastCheckAt ? ago(r.lastCheckAt) : t('neverChecked'), r.status === 'offline' && r.lastSeenAt ? t('lastSeen', { when: ago(r.lastSeenAt) }) : null),
        kpi(t('monthly'), r.quota.monthlyGb ? `${num(r.quota.monthlyGb)} GB` : t('unlimited'), t('thisMonth', { used: num(r.quota.usedGb) })),
      ),
      section(null,
        el('div', { class: 'cc-toolbar' }, tabs(['1h', '6h', '24h', '7d', '30d'].map((k) => [k, t(`ranges.${k}`)]), relayRange, setRange, t('range')),
          h.available ? el('span', { class: 'small' }, `${t('peak')} ${speed(h.peakMbps)} · ${t('load')} ${h.avgLoad === null ? t('na') : pct(h.avgLoad)} · ${t('uptime')} ${h.uptime === null ? t('na') : pct(h.uptime)}`) : null),
        h.available
          ? el('div', { class: 'charts' },
              chart(t('bandwidth'), hPoints((p) => p.mbps), { kind: 'line', label: fmtAt, format: (v) => Number(v).toLocaleString(locale, { maximumFractionDigits: 1 }) }),
              chart(t('clientsOverTime'), hPoints((p) => p.clients), { kind: 'line', label: fmtAt }),
              chart(t('loadOverTime'), hPoints((p) => p.load), { kind: 'line', label: fmtAt, format: (v) => Number(v).toLocaleString(locale, { maximumFractionDigits: 1 }) }))
          : el('div', { class: 'cc-card' }, empty(t('noHistory'))),
        el('div', { class: 'charts' },
          chart(t('trafficDay'), days(r.days, (d) => d.out / 1e9), { format: (v) => Number(v).toLocaleString(locale, { maximumFractionDigits: 1 }) }),
          chart(t('errorsDay'), days(r.days, (d) => d.errors))),
      ),
      section(t('connectedClients'),
        el('p', { class: 'small' }, t('clientsHint')),
        r.clientList.length
          ? el('div', { class: 'cc-card flush' }, table([t('col.customer'), t('col.server'), t('col.device'), t('col.since'), t('col.usage'), t('col.lastActive')], r.clientList.map((c) => ({
              cells: [c.customer ?? '—', c.server ?? '—', c.device, time(c.since), size(c.bytes), ago(c.lastSeen)],
            }))))
          : el('div', { class: 'cc-card' }, empty(t('noClients'))),
      ),
      section(t('customersHere'),
        el('div', { class: 'cc-toolbar' }, el('p', { class: 'small' }, t('customersHint')), r.active ? el('button', { class: 'ghost', onclick: addClient }, icon('plus'), t('addClient')) : null),
        r.customerList.length
          ? el('div', { class: 'cc-card flush' }, table([t('col.customer'), t('col.access'), t('col.status'), t('servers'), ''], r.customerList.map((c) => ({
              item: c,
              cells: [
                el('div', { class: 'cc-who' }, el('strong', {}, who(c)), c.name ? el('span', { class: 'small' }, c.email) : null),
                c.access ? typeBadge(c.access.type) : el('span', { class: 'muted' }, t('noAccess')),
                pill(c.status),
                num(c.servers),
                r.main ? null : el('button', { class: 'ghost small-button', onclick: async () => { await api('DELETE', `/api/ceo/relays/${id}/customers/${c.id}`); toast(t('saved')); await go(); } }, t('takeOff')),
              ],
            })), (c) => (location.hash = `#/customers/${c.id}`)))
          : el('div', { class: 'cc-card' }, empty(t('noCustomersHere'))),
      ),
      section(t('serversHere'),
        el('div', { class: 'cc-toolbar' }, el('span', {}), r.active ? el('button', { class: 'ghost', onclick: addServer }, icon('plus'), t('addServer')) : null),
        r.serverList.length
          ? el('div', { class: 'cc-card flush' }, table([t('col.server'), t('col.owner'), t('col.status'), t('col.since'), t('col.lastActive'), t('col.now'), t('clients'), t('col.limit'), ''], r.serverList.map((s) => ({
              cells: [
                s.name, s.ownerName || s.owner || '—',
                s.connected ? pill('online', t('connected')) : pill('disabled', t('notConnected')),
                s.connectedSince ? dateTime(s.connectedSince) : '—',
                ago(s.lastSeenAt),
                speed(s.mbpsNow),
                num(s.clients),
                limitCell(s),
                r.main ? null : el('button', { class: 'ghost small-button', onclick: async () => { await api('DELETE', `/api/ceo/relays/${id}/servers/${encodeURIComponent(s.id)}`); toast(t('saved')); await go(); } }, t('takeOff')),
              ],
            }))))
          : el('div', { class: 'cc-card' }, empty(t('noServersHere'))),
      ),
    );
  }

  // ---- statistics
  let statRange = '30d';
  async function statistics() {
    crumbs(t('nav.statistics'));
    const top = [header(t('nav.statistics')), tabs(['24h', '7d', '30d', '90d', '365d'].map((k) => [k, t(`ranges.${k}`)]), statRange, (v) => { statRange = v; void go(); }, t('range'))];
    show(top, skeleton(8));
    const d = await api('GET', `/api/ceo/statistics?range=${statRange}`);
    const s = d.summary;
    const rs = s.relays;
    const oneDecimal = (v) => Number(v).toLocaleString(locale, { maximumFractionDigits: 1 });
    show(
      top,
      section(t('stats.customers'),
        kpis(
          kpi(t('totalCustomers'), num(s.customers.total)),
          kpi(t('stats.active'), num(s.customers.active)),
          kpi(t('stats.new'), num(s.customers.new)),
          kpi(t('stats.growth'), s.customers.growth === null ? t('na') : `${s.customers.growth > 0 ? '+' : ''}${pct(s.customers.growth)}`),
        ),
      ),
      section(t('stats.accessStats'), kpis(...Object.keys(T.types).map((k) => kpi(t(`types.${k}`), num(s.access.byType[k]))), kpi(t('expired'), num(s.access.expired)))),
      section(t('stats.relayStats'),
        kpis(
          kpi(t('stats.total'), num(rs.total)),
          kpi(t('stats.online'), num(rs.online)),
          kpi(t('stats.offline'), num(rs.offline)),
          kpi(t('capacity'), speed(rs.capacityMbps)),
          kpi(t('current'), speed(rs.mbpsNow)),
          kpi(t('peak'), speed(rs.peakMbps)),
          kpi(t('clients'), num(rs.clientsNow)),
          kpi(t('connectedServers'), num(rs.serversNow)),
          kpi(t('stats.avgLoad'), rs.avgLoad === null ? t('na') : pct(rs.avgLoad)),
          kpi(t('uptime'), rs.uptime === null ? t('na') : pct(rs.uptime)),
        ),
        el('p', { class: 'small' }, rs.historySince ? t('stats.since', { date: dateTime(rs.historySince) }) : t('noHistory')),
      ),
      d.hours
        ? el('div', { class: 'charts' },
            chart(t('chartHourly'), d.hours.map((p) => ({ t: p.at, v: p.mbps })), { kind: 'line', label: (p) => time(p.t), format: oneDecimal }),
            chart(t('chartClients'), d.hours.map((p) => ({ t: p.at, v: p.clients })), { kind: 'line', label: (p) => time(p.t) }))
        : null,
      el('div', { class: 'charts' },
        chart(t('chartAccounts'), days(d.days, (x) => x.accounts), { kind: 'line' }),
        chart(t('chartAccess'), days(d.days, (x) => x.withAccess), { kind: 'line' }),
        chart(t('chartNew'), days(d.days, (x) => x.newAccounts)),
        chart(t('chartActive'), days(d.days, (x) => x.activeAccounts)),
        chart(t('trafficDay'), days(d.days, (x) => x.relayOut / 1e9), { format: oneDecimal }),
        chart(t('errorsDay'), days(d.days, (x) => x.relayErrors)),
      ),
    );
  }

  // ---- subtitles: the OpenSubtitles key servers use through vidalune.com (write-only)
  async function subtitles() {
    crumbs(t('nav.subtitles'));
    show(header(t('nav.subtitles')), skeleton(2));
    const d = await api('GET', '/api/ceo/subtitles');
    const status = d.configured ? (d.username ? t('subs.onAccount', { hint: d.hint, name: d.username }) : t('subs.on', { hint: d.hint })) : t('subs.off');
    const error = el('p', { class: 'error', role: 'alert' });
    const submit = el('button', { type: 'submit' }, t('subs.save'));
    const form = el('form', {
      class: 'cc-card',
      onsubmit: async (e) => {
        e.preventDefault();
        const v = Object.fromEntries(new FormData(form));
        const body = {};
        if (v.apiKey.trim()) body.apiKey = v.apiKey.trim();
        if (v.username.trim() !== (d.username ?? '')) body.username = v.username.trim();
        if (v.password) body.password = v.password;
        submit.disabled = true;
        error.textContent = '';
        try {
          await api('PUT', '/api/ceo/subtitles', body);
          toast(t('subs.saved'));
          await go();
        } catch (err) {
          error.textContent = err.message;
        } finally {
          submit.disabled = false;
        }
      },
    },
      el('p', {}, t('subs.intro')),
      el('p', {}, el('strong', {}, `${t('subs.status')}: `), el('span', { class: d.configured ? 'ok' : '' }, status)),
      field(t('subs.apiKey'), el('input', { name: 'apiKey', type: 'password', autocomplete: 'off', spellcheck: 'false', maxlength: 200, placeholder: d.configured ? t('subs.newKey') : '', required: !d.configured })),
      el('div', { class: 'cc-row' },
        field(t('subs.username'), el('input', { name: 'username', autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false', maxlength: 100, value: d.username ?? '' })),
        field(t('subs.password'), el('input', { name: 'password', type: 'password', autocomplete: 'new-password', maxlength: 200, placeholder: d.hasPassword ? t('subs.passwordKept') : '' })),
      ),
      el('p', { class: 'small' }, t('subs.accountHint')),
      error,
      el('div', { class: 'cc-dialog-actions' },
        d.configured ? el('button', { type: 'button', class: 'ghost', onclick: () => dialog({ title: t('subs.turnOff'), text: t('subs.turnOffText'), confirm: t('subs.turnOff'), danger: true, onConfirm: async () => { await api('DELETE', '/api/ceo/subtitles'); return t('subs.turnedOff'); } }) }, t('subs.turnOff')) : null,
        submit,
      ),
    );
    show(header(t('nav.subtitles')), section(null, form), section(null, kpis(kpi(t('subs.files'), num(d.files)), kpi(t('subs.served'), num(d.served))), el('p', { class: 'small' }, t('subs.perServer'))));
  }

  // ---- routing
  const show = (...nodes) => view.replaceChildren(...nodes.flat(Infinity).filter((n) => n !== null && n !== undefined && n !== false));
  let loadedMe = false;
  async function go() {
    renderNav();
    tip.hidden = true;
    const { page, arg, params } = route();
    document.title = `${t(`nav.${page}`)} · Vidalune Control Center`;
    try {
      if (!loadedMe) {
        const me = await api('GET', '/api/account');
        if (!me.ceo) throw Object.assign(new Error(t('only')), { status: 403 });
        $('who').textContent = me.email;
        loadedMe = true;
      }
      await { overview, customers, access, relays, subtitles, statistics, activity }[page](arg, params);
      view.focus({ preventScroll: true });
    } catch (err) {
      if (err.status === 401 || err.status === 403) {
        document.body.classList.add('cc-locked');
        crumbs();
      }
      show(errorState(err));
    }
  }
  window.addEventListener('hashchange', () => {
    window.scrollTo(0, 0);
    void go();
  });
  view.tabIndex = -1;
  void go();
})();
