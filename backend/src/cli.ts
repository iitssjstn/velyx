/**
 * Maintenance commands, run inside the container:
 *   docker compose exec velyx velyx backup
 *   docker compose exec velyx velyx reset-password <username> <new-password>
 *   docker compose exec velyx velyx scan
 */
import { eq } from 'drizzle-orm';
import { loadConfig } from './config.js';
import { openDatabase } from './db/client.js';
import { users } from './db/schema.js';
import { hashPassword, validatePassword } from './auth/password.js';
import { SessionService } from './auth/sessions.js';
import { createFullBackup } from './services/backup.js';
import { createContext } from './app.js';
import { setLogLevel } from './logger.js';

async function run(): Promise<number> {
  const [cmd, ...args] = process.argv.slice(2);
  const config = loadConfig();
  if (cmd !== 'scan') setLogLevel('warn');
  const db = openDatabase(config.dbPath, { backupDir: config.backupDir });

  switch (cmd) {
    case 'backup': {
      const file = createFullBackup(db, config.dataDir, config.backupDir);
      console.log(`Backup written to ${file}`);
      return 0;
    }
    case 'reset-password': {
      const [username, password] = args;
      if (!username || !password) {
        console.error('Usage: velyx reset-password <username> <new-password>');
        return 2;
      }
      const err = validatePassword(password);
      if (err) {
        console.error(err);
        return 2;
      }
      const user = db.select().from(users).where(eq(users.username, username)).get();
      if (!user) {
        console.error(`User "${username}" not found`);
        return 1;
      }
      db.update(users).set({ passwordHash: await hashPassword(password), disabled: false, updatedAt: Date.now() }).where(eq(users.id, user.id)).run();
      new SessionService(db, config.sessionTtlDays).destroyAllForUser(user.id);
      console.log(`Password for "${username}" updated and account enabled`);
      return 0;
    }
    case 'scan': {
      const ctx = createContext(config, db);
      ctx.scans.enqueueAll(args.includes('--refresh-metadata'));
      await ctx.scans.whenIdle();
      return 0;
    }
    default:
      console.log('Velyx maintenance commands:\n  backup\n  reset-password <username> <new-password>\n  scan [--refresh-metadata]');
      return cmd ? 2 : 0;
  }
}

run().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  },
);
