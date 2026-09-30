import { loadConfig } from './config.js';
import { openDatabase } from './db/client.js';
import { buildCloudApp } from './app.js';

const config = loadConfig();
const db = openDatabase(config.dbPath);
const app = await buildCloudApp(config, db);
app.prune();
setInterval(() => app.prune(), 60 * 60 * 1000).unref();
void app.ceoMonitor();
setInterval(() => void app.ceoMonitor(), 5 * 60 * 1000).unref();
await app.listen({ port: config.port, host: config.host });
console.log(`Vidalune account service on http://${config.host}:${config.port} (${config.publicUrl})`);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void app.close().then(() => {
      db.$client.close();
      process.exit(0);
    });
  });
}
