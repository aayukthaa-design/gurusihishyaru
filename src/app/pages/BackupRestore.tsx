import { Header } from '../components/Header';
import { HardDrive, Download, Upload, Clock, CheckCircle2 } from 'lucide-react';

const BACKUP_HISTORY = [
  { id: 1, name: 'backup_2026_06_18.zip', size: '45.2 MB', date: 'Jun 18, 2026 02:00 AM', status: 'success' },
  { id: 2, name: 'backup_2026_06_17.zip', size: '44.8 MB', date: 'Jun 17, 2026 02:00 AM', status: 'success' },
  { id: 3, name: 'backup_2026_06_16.zip', size: '44.1 MB', date: 'Jun 16, 2026 02:00 AM', status: 'success' },
];

export function BackupRestore() {
  return (
    <div className="flex-1">
      <Header title="Backup & Restore" />
      <div className="p-6 space-y-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="rounded-xl border border-border bg-card p-6">
            <div className="flex items-center gap-3 mb-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                <Download className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h3 className="font-semibold text-foreground">Create Backup</h3>
                <p className="text-xs text-muted-foreground">Export all system data</p>
              </div>
            </div>
            <p className="mb-4 text-sm text-muted-foreground">
              Creates a full backup of the database, uploaded files, and configuration.
            </p>
            <button className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-all hover:opacity-90">
              <HardDrive className="h-4 w-4" />
              Start Backup
            </button>
          </div>

          <div className="rounded-xl border border-border bg-card p-6">
            <div className="flex items-center gap-3 mb-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent/10">
                <Upload className="h-5 w-5 text-accent" />
              </div>
              <div>
                <h3 className="font-semibold text-foreground">Restore Backup</h3>
                <p className="text-xs text-muted-foreground">Import from backup file</p>
              </div>
            </div>
            <p className="mb-4 text-sm text-muted-foreground">
              Upload a backup file to restore the system to a previous state.
            </p>
            <button className="flex items-center gap-2 rounded-lg border border-border bg-secondary px-4 py-2.5 text-sm font-medium transition-colors hover:bg-muted">
              <Upload className="h-4 w-4" />
              Upload Backup File
            </button>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-6">
          <div className="flex items-center gap-2 mb-4">
            <Clock className="h-5 w-5 text-muted-foreground" />
            <h3 className="font-semibold text-foreground">Backup History</h3>
          </div>
          <div className="space-y-3">
            {BACKUP_HISTORY.map((b) => (
              <div key={b.id} className="flex items-center justify-between rounded-lg border border-border bg-secondary px-4 py-3">
                <div className="flex items-center gap-3">
                  <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                  <div>
                    <p className="text-sm font-medium text-foreground">{b.name}</p>
                    <p className="text-xs text-muted-foreground">{b.date} · {b.size}</p>
                  </div>
                </div>
                <button className="text-xs text-primary transition-colors hover:underline">Download</button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
