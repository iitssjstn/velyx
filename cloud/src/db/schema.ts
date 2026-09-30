import { blob, index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

/** A Vidalune account: one person, any number of servers. */
export const accounts = sqliteTable('accounts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  createdAt: integer('created_at').notNull(),
  /**
   * "remote": everyone on the servers this account owns may watch away from home (relay,
   * app.vidalune.com). "viewer": only this account may, on any server it uses.
   */
  plan: text('plan', { enum: ['free', 'remote', 'viewer'] }).notNull().default('free'),
  /** When the plan ends (null: no end date). */
  planUntil: integer('plan_until'),
  /** A note by whoever set the plan (e.g. how it was paid). */
  planNote: text('plan_note'),
  planChangedAt: integer('plan_changed_at'),
});

/** Signed-in browsers and apps. Only a hash of the token is stored. */
export const accountSessions = sqliteTable(
  'account_sessions',
  {
    tokenHash: text('token_hash').primaryKey(),
    accountId: integer('account_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
    createdAt: integer('created_at').notNull(),
    expiresAt: integer('expires_at').notNull(),
  },
  (t) => [index('account_sessions_account').on(t.accountId)],
);

/**
 * A Vidalune server that asked to be linked. It proves who it is with a secret it got when it
 * registered (only the hash is stored). What it reports: its name, version and public address.
 */
export const servers = sqliteTable(
  'servers',
  {
    id: text('id').primaryKey(),
    secretHash: text('secret_hash').notNull(),
    accountId: integer('account_id').references(() => accounts.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    version: text('version').notNull(),
    url: text('url'),
    /** Its relay address: https://<relaySlug>.vidalune.com (assigned once, kept when turned off). */
    relaySlug: text('relay_slug').unique(),
    /** Reachable through the relay (the server's administrator turned it on). */
    relayEnabled: integer('relay_enabled', { mode: 'boolean' }).notNull().default(false),
    /** What this server may send through the relay, in Mbit/s (null: the service's default). */
    relayLimitMbps: integer('relay_limit_mbps'),
    /** The relay this server is assigned to (null: the main relay, vidalune.com itself). */
    relayNodeId: integer('relay_node_id').references(() => relayNodes.id, { onDelete: 'set null' }),
    createdAt: integer('created_at').notNull(),
    lastSeenAt: integer('last_seen_at').notNull(),
  },
  (t) => [index('servers_account').on(t.accountId)],
);

/** Short-lived codes that link a server to the account of whoever enters them. */
export const linkCodes = sqliteTable('link_codes', {
  codeHash: text('code_hash').primaryKey(),
  serverId: text('server_id')
    .notNull()
    .unique()
    .references(() => servers.id, { onDelete: 'cascade' }),
  /** The server user (administrator) who asked for the code: they become a member when it is used. */
  userRef: text('user_ref'),
  expiresAt: integer('expires_at').notNull(),
});

/**
 * Which Vidalune account belongs to which user on a server (the server's own user id). Made when
 * that user enters a code their server showed them; the server's owner is added when linking.
 */
export const memberships = sqliteTable(
  'memberships',
  {
    serverId: text('server_id')
      .notNull()
      .references(() => servers.id, { onDelete: 'cascade' }),
    userRef: text('user_ref').notNull(),
    accountId: integer('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.serverId, t.userRef] }), index('memberships_account').on(t.accountId)],
);

/** Codes a server user enters to connect their Vidalune account (hashed, ten minutes). */
export const memberCodes = sqliteTable('member_codes', {
  codeHash: text('code_hash').primaryKey(),
  serverId: text('server_id')
    .notNull()
    .references(() => servers.id, { onDelete: 'cascade' }),
  userRef: text('user_ref').notNull(),
  expiresAt: integer('expires_at').notNull(),
});

/** One-time tickets: "this account opens this server" (hashed, one minute, used once). */
export const tickets = sqliteTable('tickets', {
  ticketHash: text('ticket_hash').primaryKey(),
  serverId: text('server_id')
    .notNull()
    .references(() => servers.id, { onDelete: 'cascade' }),
  accountId: integer('account_id')
    .notNull()
    .references(() => accounts.id, { onDelete: 'cascade' }),
  expiresAt: integer('expires_at').notNull(),
});

/**
 * Invitations a server's administrator made (hashed, seven days, used once). Whoever accepts one
 * gets the server in their list; the server makes a user for them the first time they open it.
 */
export const invites = sqliteTable(
  'invites',
  {
    tokenHash: text('token_hash').primaryKey(),
    serverId: text('server_id')
      .notNull()
      .references(() => servers.id, { onDelete: 'cascade' }),
    /** The server's own name for the invitation. */
    ref: text('ref').notNull(),
    createdAt: integer('created_at').notNull(),
    expiresAt: integer('expires_at').notNull(),
  },
  (t) => [uniqueIndex('invites_server_ref').on(t.serverId, t.ref)],
);

/** What passed through the relay, per server and day (UTC): only amounts, never content. */
export const relayTraffic = sqliteTable(
  'relay_traffic',
  {
    serverId: text('server_id')
      .notNull()
      .references(() => servers.id, { onDelete: 'cascade' }),
    /** YYYY-MM-DD */
    day: text('day').notNull(),
    /** Bytes sent to visitors (the server's answers). */
    bytesOut: integer('bytes_out').notNull().default(0),
    /** Bytes visitors sent (requests, uploads). */
    bytesIn: integer('bytes_in').notNull().default(0),
    requests: integer('requests').notNull().default(0),
    /** Visitors who got an error instead of reaching the server (off, offline, busy, too large, cut off). */
    errors: integer('errors').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.serverId, t.day] }), index('relay_traffic_day').on(t.day)],
);

/**
 * Shared intro/recap/credits detection (servers that turned it on): where each server found a
 * part in an episode, by TMDB show id, season and episode number, with the episode's length.
 * Only timings — no files, users or what anyone watches. Removed with the server.
 */
export const detectionReports = sqliteTable(
  'detection_reports',
  {
    serverId: text('server_id')
      .notNull()
      .references(() => servers.id, { onDelete: 'cascade' }),
    tmdbShow: integer('tmdb_show').notNull(),
    season: integer('season').notNull(),
    episode: integer('episode').notNull(),
    kind: text('kind', { enum: ['recap', 'intro', 'credits'] }).notNull(),
    /** The episode's length in seconds (different cuts of an episode are kept apart). */
    duration: real('duration').notNull(),
    start: real('start').notNull(),
    end: real('end').notNull(),
    source: text('source', { enum: ['audio', 'chapters', 'video', 'manual'] }).notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.serverId, t.tmdbShow, t.season, t.episode, t.kind] }), index('detection_reports_season').on(t.tmdbShow, t.season)],
);

/**
 * Audio fingerprints of a season's intro or credits (a few seconds of 32-bit hashes per ~0.1 s,
 * not audio): another server matches them against its own episodes.
 */
export const detectionPrints = sqliteTable(
  'detection_prints',
  {
    serverId: text('server_id')
      .notNull()
      .references(() => servers.id, { onDelete: 'cascade' }),
    tmdbShow: integer('tmdb_show').notNull(),
    season: integer('season').notNull(),
    kind: text('kind', { enum: ['intro', 'credits'] }).notNull(),
    slot: integer('slot').notNull(),
    words: blob('words', { mode: 'buffer' }).notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.serverId, t.tmdbShow, t.season, t.kind, t.slot] }), index('detection_prints_season').on(t.tmdbShow, t.season)],
);

/**
 * Relays: the main one is vidalune.com itself (id 1). Others can be registered with their capacity
 * and servers assigned to them, so customers can be spread out as more relays are added.
 */
export const relayNodes = sqliteTable('relay_nodes', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  region: text('region'),
  /** Where it is reached (null for the main relay: this service). */
  url: text('url'),
  /** What it can send in total, in Mbit/s. */
  capacityMbps: integer('capacity_mbps').notNull(),
  note: text('note'),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at').notNull(),
});

/**
 * Access given to an account: remote access (for everyone on its servers) or a viewer plan, why
 * (a paying customer, a beta or test account, or free), from when until when, and by whom. The
 * account's current plan follows its active grant. Ready for billing: a price and a reference to a
 * payment can be kept per grant (empty while access is given by hand).
 */
export const accessGrants = sqliteTable(
  'access_grants',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    accountId: integer('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    type: text('type', { enum: ['customer', 'beta', 'test', 'free'] }).notNull(),
    plan: text('plan', { enum: ['remote', 'viewer'] }).notNull(),
    startsAt: integer('starts_at').notNull(),
    /** Null: no end. */
    endsAt: integer('ends_at'),
    note: text('note'),
    grantedBy: text('granted_by').notNull(),
    createdAt: integer('created_at').notNull(),
    revokedAt: integer('revoked_at'),
    revokedBy: text('revoked_by'),
    /** Where it came from: by hand now; a payment later. */
    source: text('source', { enum: ['manual', 'billing'] }).notNull().default('manual'),
    priceCents: integer('price_cents'),
    currency: text('currency'),
    billingRef: text('billing_ref'),
  },
  (t) => [index('access_grants_account').on(t.accountId), index('access_grants_ends').on(t.endsAt)],
);

/** On which days an account used Vidalune (signed in on the website or in the app): for "active" over time. */
export const accountActivity = sqliteTable(
  'account_activity',
  {
    accountId: integer('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    /** YYYY-MM-DD (UTC) */
    day: text('day').notNull(),
  },
  (t) => [primaryKey({ columns: [t.accountId, t.day] }), index('account_activity_day').on(t.day)],
);
