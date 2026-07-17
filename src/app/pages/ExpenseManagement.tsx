import { useEffect, useMemo, useState } from 'react';
import { Header } from '../components/Header';
import { StatsCard } from '../components/StatsCard';
import { DataTable } from '../components/DataTable';
import { useAuth } from '../auth/AuthContext';
import { getBranches } from '../lib/branchService';
import { formatIndianCurrency } from '../lib/currency';
import { apiFetch } from '../lib/apiClient';
import { Receipt, TrendingDown, DollarSign, CreditCard, Search, Plus, Loader2 } from 'lucide-react';

interface LedgerExpense {
  id: number;
  voucherNumber: string;
  branchId?: string;
  category: string;
  description: string;
  amount: number;
  date: string;
  paymentMode: string;
  referenceNumber: string;
}

const EXPENSE_CATEGORIES = ['Salaries', 'Utilities', 'Supplies', 'Rent', 'Maintenance', 'Marketing', 'Other'];
const PAYMENT_MODES = ['Cash', 'UPI', 'Card', 'Bank Transfer', 'Cheque'];

const EMPTY_FORM = { category: EXPENSE_CATEGORIES[0], description: '', amount: '', date: new Date().toISOString().slice(0, 10), paymentMode: PAYMENT_MODES[0], referenceNumber: '' };

export function ExpenseManagement() {
  const { user } = useAuth();
  const branches = getBranches();
  const canManage = user?.role === 'accountant' || user?.role === 'admin' || user?.role === 'super_admin';

  const [expenses, setExpenses] = useState<LedgerExpense[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [branchFilter, setBranchFilter] = useState(user?.role === 'super_admin' ? '' : user?.branchId ?? '');
  const [showAddForm, setShowAddForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [isSaving, setIsSaving] = useState(false);

  function loadExpenses() {
    setIsLoading(true);
    setError(null);
    const params = new URLSearchParams({ type: 'Expense' });
    if (branchFilter) params.set('branchId', branchFilter);
    apiFetch(`/api/ledger?${params.toString()}`)
      .then((res) => res.json())
      .then((data) => setExpenses(Array.isArray(data) ? data : []))
      .catch((err) => { console.error(err); setError('Failed to load expenses.'); })
      .finally(() => setIsLoading(false));
  }

  useEffect(() => {
    loadExpenses();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchFilter]);

  const filtered = useMemo(() => expenses.filter((expense) =>
    `${expense.category} ${expense.description}`.toLowerCase().includes(search.toLowerCase())
  ), [expenses, search]);

  const totalExpenses = filtered.reduce((sum, expense) => sum + expense.amount, 0);
  const thisMonthTotal = filtered
    .filter((e) => e.date.slice(0, 7) === new Date().toISOString().slice(0, 7))
    .reduce((sum, e) => sum + e.amount, 0);
  const avgMonthly = filtered.length > 0 ? Math.round(totalExpenses / filtered.length) : 0;

  async function handleAddExpense(e: React.FormEvent) {
    e.preventDefault();
    if (!form.category || !form.description || !form.amount) {
      setError('Category, description and amount are required.');
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      const res = await apiFetch('/api/ledger', {
        method: 'POST',
        body: {
          date: form.date,
          type: 'Expense',
          category: form.category,
          description: form.description,
          amount: Number(form.amount),
          paymentMode: form.paymentMode,
          referenceNumber: form.referenceNumber,
          enteredBy: user?.name || 'Accountant',
        },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to add expense');
      }
      setForm(EMPTY_FORM);
      setShowAddForm(false);
      loadExpenses();
    } catch (err: any) {
      setError(err.message || 'Failed to add expense.');
    } finally {
      setIsSaving(false);
    }
  }

  const columns = [
    { header: 'Voucher', accessor: 'voucherNumber' as const },
    { header: 'Category', accessor: 'category' as const },
    { header: 'Description', accessor: 'description' as const },
    { header: 'Amount', accessor: (expense: LedgerExpense) => formatIndianCurrency(expense.amount) },
    { header: 'Date', accessor: 'date' as const },
    { header: 'Payment Mode', accessor: 'paymentMode' as const },
  ];

  return (
    <div className="flex-1">
      <Header title="Expense Management" />

      <div className="p-6 space-y-6">
        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-400">
            {error}
          </div>
        )}

        <div className="flex flex-wrap gap-3">
          <div className="relative min-w-[220px] flex-1">
            <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input type="search" placeholder="Search expenses" value={search} onChange={(event) => setSearch(event.target.value)} className="w-full rounded-xl border border-input bg-input-background py-2.5 pl-10 pr-4 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20" />
          </div>
          {user?.role === 'super_admin' && (
            <select value={branchFilter} onChange={(event) => setBranchFilter(event.target.value)} className="rounded-xl border border-input bg-input-background px-3 py-2.5 text-sm focus:border-primary focus:outline-none">
              <option value="">All Branches</option>
              {branches.filter((branch) => branch.status === 'Active').map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
            </select>
          )}
          {canManage && (
            <button onClick={() => setShowAddForm((v) => !v)} className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90">
              <Plus className="h-4 w-4" /> Add Expense
            </button>
          )}
        </div>

        {showAddForm && canManage && (
          <form onSubmit={handleAddExpense} className="rounded-2xl border border-border bg-card p-6 shadow-sm grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="font-medium text-foreground">Category</span>
              <select value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                className="rounded-xl border border-input bg-input-background px-3 py-2 text-sm focus:outline-none focus:border-primary">
                {EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1.5 text-sm sm:col-span-2">
              <span className="font-medium text-foreground">Description</span>
              <input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                className="rounded-xl border border-input bg-input-background px-3 py-2 text-sm focus:outline-none focus:border-primary" />
            </label>
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="font-medium text-foreground">Amount (₹)</span>
              <input type="number" min={0} value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                className="rounded-xl border border-input bg-input-background px-3 py-2 text-sm focus:outline-none focus:border-primary" />
            </label>
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="font-medium text-foreground">Date</span>
              <input type="date" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
                className="rounded-xl border border-input bg-input-background px-3 py-2 text-sm focus:outline-none focus:border-primary" />
            </label>
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="font-medium text-foreground">Payment Mode</span>
              <select value={form.paymentMode} onChange={(e) => setForm((f) => ({ ...f, paymentMode: e.target.value }))}
                className="rounded-xl border border-input bg-input-background px-3 py-2 text-sm focus:outline-none focus:border-primary">
                {PAYMENT_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="font-medium text-foreground">Reference No. (optional)</span>
              <input value={form.referenceNumber} onChange={(e) => setForm((f) => ({ ...f, referenceNumber: e.target.value }))}
                className="rounded-xl border border-input bg-input-background px-3 py-2 text-sm focus:outline-none focus:border-primary" />
            </label>
            <div className="flex items-end">
              <button type="submit" disabled={isSaving} className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50">
                {isSaving && <Loader2 className="h-4 w-4 animate-spin" />}
                Save Expense
              </button>
            </div>
          </form>
        )}

        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
          <StatsCard title="Total Expenses" value={formatIndianCurrency(totalExpenses)} icon={Receipt} iconColor="bg-destructive" />
          <StatsCard title="This Month" value={formatIndianCurrency(thisMonthTotal)} icon={DollarSign} iconColor="bg-chart-4" />
          <StatsCard title="Transactions" value={filtered.length.toString()} icon={CreditCard} iconColor="bg-primary" />
          <StatsCard title="Avg per Entry" value={formatIndianCurrency(avgMonthly)} icon={TrendingDown} iconColor="bg-accent" />
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading expenses…
          </div>
        ) : (
          <DataTable columns={columns} data={filtered} />
        )}
      </div>
    </div>
  );
}
