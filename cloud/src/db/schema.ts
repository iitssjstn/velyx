import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/** A Vidalune account: one person, any number of servers. */
export const accounts = sqliteTable('accounts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  createdAt: integer('created_at').notNull(),
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
  expiresAt: integer('expires_at').notNull(),
});
