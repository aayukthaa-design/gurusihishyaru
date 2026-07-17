import { useEffect, useState } from 'react';
import { Header } from '../components/Header';
import { HardDrive, Download, Upload, Clock, CheckCircle2, Loader2, AlertTriangle } from 'lucide-react';
import {
  BackupRecord,
  fetchBackupHistory,
  createBackup,
  downloadBackup,
  restoreBackup,
  formatBackupSize,
} from '../lib/backupService';

const CONFIRM_PHRASE = 'RESTORE';

export function BackupRestore() {
  const [history, setHistory] = useState<BackupRecord[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [pendingRestoreFile, setPendingRestoreFile] = useState<File | null>(null);
  const [confirmText, setConfirmText] = useState('');
  const [isRestoring, setIsRestoring] = useState(false);

  function loadHistory() {
    setIsLoadingHistory(true);
    fetchBackupHistory()
      .then(setHistory)
      .catch((err) => setError(err.message))
      .finally(() => setIsLoadingHistory(false));
  }

  useEffect(() => {
    loadHistory();
  }, []);

  async function handleCreateBackup() {
    setError(null);
    setSuccess(null);
    setIsCreating(true);
    try {
      await createBackup();
      setSuccess('Backup created successfully.');
      loadHistory();
    } catch (err: any) {
      setError(err.message || 'Backup creation failed.');
    } finally {
      setIsCreating(false);
    }
  }

  async function handleDownload(record: BackupRecord) {
    setError(null);
    try {
      await downloadBackup(record);
    } catch (err: any) {
      setError(err.message || 'Download failed.');
    }
  }

  function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) {
      setPendingRestoreFile(file);
      setConfirmText('');
      setError(null);
      setSuccess(null);
    }
  }

  async function handleConfirmRestore() {
    if (!pendingRestoreFile) return;
    setError(null);
    setSuccess(null);
    setIsRestoring(true);
    try {
      const result = await restoreBackup(pendingRestoreFile);
      setSuccess(result.message || 'Restore complete.');
      setPendingRestoreFile(null);
      setConfirmText('');
      loadHistory();
    } catch (err: any) {
      setError(err.message || 'Restore failed.');
    } finally {
      setIsRestoring(false);
    }
  }

  return (
    <div className="flex-1">
      <Header title="Backup & Restore" />
      <div className="p-6 space-y-6">
        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-400">
            {error}
          </div>
        )}
        {success && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-400">
            {success}
          </div>
        )}

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
              Creates a full backup of the database, uploaded files, and study materials.
            </p>
            <button
              onClick={handleCreateBackup}
              disabled={isCreating}
              className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-all hover:opacity-90 disabled:opacity-50"
            >
              {isCreating ? <Loader2 className="h-4 w-4 animate-spin" /> : <HardDrive className="h-4 w-4" />}
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
              Upload a backup file to restore the system to a previous state. A safety snapshot of the current data is always taken first.
            </p>
            <input
              type="file"
              accept=".zip"
              id="restore-file-input"
              onChange={handleFileSelected}
              className="hidden"
            />
            <label
              htmlFor="restore-file-input"
              className="inline-flex items-center gap-2 rounded-lg border border-border bg-secondary px-4 py-2.5 text-sm font-medium transition-colors hover:bg-muted cursor-pointer"
            >
              <Upload className="h-4 w-4" />
              Upload Backup File
            </label>
          </div>
        </div>

        {pendingRestoreFile && (
          <div className="rounded-xl border border-red-300 bg-red-50 p-6 dark:border-red-900 dark:bg-red-950/30">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 shrink-0 text-red-600 dark:text-red-400 mt-0.5" />
              <div className="flex-1">
                <h3 className="font-semibold text-red-800 dark:text-red-300">This will overwrite all current data</h3>
                <p className="mt-1 text-sm text-red-700 dark:text-red-400">
                  You're about to restore from <strong>{pendingRestoreFile.name}</strong>. Every student, fee, homework, and
                  material record currently in the system will be replaced with what's in this backup. A snapshot of the
                  current state is saved automatically first, but this action cannot be undone from the UI.
                </p>
                <p className="mt-3 text-sm font-medium text-red-800 dark:text-red-300">
                  Type <span className="font-mono">{CONFIRM_PHRASE}</span> to confirm:
                </p>
                <div className="mt-2 flex items-center gap-3">
                  <input
                    type="text"
                    value={confirmText}
                    onChange={(e) => setConfirmText(e.target.value)}
                    className="rounded-lg border border-red-300 bg-white px-3 py-2 text-sm focus:outline-none focus:border-red-500 dark:bg-background"
                    placeholder={CONFIRM_PHRASE}
                  />
                  <button
                    onClick={handleConfirmRestore}
                    disabled={confirmText !== CONFIRM_PHRASE || isRestoring}
                    className="flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-700 disabled:opacity-50"
                  >
                    {isRestoring ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                    Confirm Restore
                  </button>
                  <button
                    onClick={() => { setPendingRestoreFile(null); setConfirmText(''); }}
                    disabled={isRestoring}
                    className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-secondary disabled:opacity-50"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="rounded-xl border border-border bg-card p-6">
          <div className="flex items-center gap-2 mb-4">
            <Clock className="h-5 w-5 text-muted-foreground" />
            <h3 className="font-semibold text-foreground">Backup History</h3>
          </div>
          {isLoadingHistory ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading…
            </div>
          ) : history.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">No backups yet — create one above.</p>
          ) : (
            <div className="space-y-3">
              {history.map((b) => (
                <div key={b.id} className="flex items-center justify-between rounded-lg border border-border bg-secondary px-4 py-3">
                  <div className="flex items-center gap-3">
                    <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        {b.filename}
                        {b.type === 'pre_restore_auto' && (
                          <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-950/40 dark:text-amber-400">
                            Auto (pre-restore)
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(b.createdAt).toLocaleString('en-IN')} · {formatBackupSize(b.sizeBytes)} · by {b.createdBy}
                      </p>
                    </div>
                  </div>
                  <button onClick={() => handleDownload(b)} className="text-xs text-primary transition-colors hover:underline">
                    Download
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
