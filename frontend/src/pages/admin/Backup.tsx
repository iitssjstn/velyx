import { Download } from 'lucide-react';

export function BackupPage() {
  return (
    <div className="space-y-6">
      <section className="panel p-5 sm:p-6">
        <h2 className="font-display text-lg font-semibold">Database backup</h2>
        <p className="mt-1 text-sm text-muted">
          Downloads a consistent snapshot of the Velyx database: users, libraries, metadata, watch progress and favorites. Your media files are not included.
        </p>
        <a href="/api/admin/backup" download className="mt-5 inline-flex h-10 items-center gap-2 rounded-lg bg-accent px-4 font-semibold text-accent-ink hover:bg-accent-strong">
          <Download className="size-4" /> Download backup
        </a>
      </section>
      <section className="panel p-5 text-sm sm:p-6">
        <h2 className="font-display text-lg font-semibold">Full backup and restore</h2>
        <p className="mt-2 text-muted">Everything Velyx stores lives in the data volume (./data by default). Create a complete archive, including artwork cache and avatars, from the server:</p>
        <pre className="mt-3 overflow-x-auto rounded-lg bg-bg/70 p-3 text-xs">docker compose exec velyx velyx backup</pre>
        <p className="mt-3 text-muted">The archive is written to data/backups/. To restore: stop Velyx, replace the contents of the data folder with the backup (or put a downloaded database file at data/velyx.db), then start Velyx again.</p>
        <p className="mt-3 text-muted">Velyx also saves an automatic copy of the database before every database upgrade.</p>
      </section>
    </div>
  );
}
