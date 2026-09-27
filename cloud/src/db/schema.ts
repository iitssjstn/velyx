import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/** A Vidalune account: one person, any number of servers. */
export const accounts = sqliteTable('accounts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  createdAt: integer('created_at').notNull(),
  /** "remote": the servers this account owns may be reached through Vidalune (relay, app.vidalune.com). */
  plan: text('plan', { enum: ['free', 'remote'] }).notNull().default('free'),
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
