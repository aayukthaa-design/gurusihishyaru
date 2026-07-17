import { useEffect, useMemo, useState } from 'react';
import { Header } from '../components/Header';
import { StatsCard } from '../components/StatsCard';
import { DataTable } from '../components/DataTable';
import { useAuth } from '../auth/AuthContext';
import { getBranches } from '../lib/branchService';
import { formatIndianCurrency } from '../lib/currency';
import { apiFetch } from '../lib/apiClient';
import { Package, AlertTriangle, TrendingDown, Box, Search, Plus, Trash2, Loader2 } from 'lucide-react';

interface InventoryItem {
  id: number;
  branchId?: string;
  itemName: string;
  category: string;
  itemCode: string;
  quantity: number;
  availableQuantity: number;
  minStock: number;
  unit: string;
  purchaseCost: number;
  supplier: string;
  status: string;
}

const UNIT_OPTIONS = ['pcs', 'sets', 'boxes', 'kg', 'litres', 'reams'];

function stockStatus(item: InventoryItem): 'In Stock' | 'Low Stock' | 'Out of Stock' {
  if (item.availableQuantity <= 0) return 'Out of Stock';
  if (item.availableQuantity <= item.minStock) return 'Low Stock';
  return 'In Stock';
}

const EMPTY_FORM = { itemName: '', category: '', quantity: '', minStock: '0', unit: UNIT_OPTIONS[0], purchaseCost: '', supplier: '' };

export function Inventory() {
  const { user } = useAuth();
  const branches = getBranches();
  const canManage = user?.role === 'accountant' || user?.role === 'admin' || user?.role === 'super_admin';

  const [items, setItems] = useState<InventoryItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [branchFilter, setBranchFilter] = useState(user?.role === 'super_admin' ? '' : user?.branchId ?? '');
  const [showAddForm, setShowAddForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [isSaving, setIsSaving] = useState(false);

  function loadInventory() {
    setIsLoading(true);
    setError(null);
    const params = new URLSearchParams();
    if (branchFilter) params.set('branchId', branchFilter);
    apiFetch(`/api/inventory?${params.toString()}`)
      .then((res) => res.json())
      .then((data) => setItems(Array.isArray(data) ? data : []))
      .catch((err) => { console.error(err); setError('Failed to load inventory.'); })
      .finally(() => setIsLoading(false));
  }

  useEffect(() => {
    loadInventory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchFilter]);

  const filtered = useMemo(() => items.filter((item) =>
    `${item.itemName} ${item.category}`.toLowerCase().includes(search.toLowerCase())
  ), [items, search]);

  const lowStockItems = filtered.filter((item) => stockStatus(item) === 'Low Stock').length;
  const outOfStockItems = filtered.filter((item) => stockStatus(item) === 'Out of Stock').length;
  const totalInventoryValue = filtered.reduce((sum, item) => sum + item.quantity * item.purchaseCost, 0);

  async function handleAddItem(e: React.FormEvent) {
    e.preventDefault();
    if (!form.itemName || !form.category || !form.quantity || !form.purchaseCost) {
      setError('Item name, category, quantity and purchase cost are required.');
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      const res = await apiFetch('/api/inventory', {
        method: 'POST',
        body: {
          itemName: form.itemName,
          category: form.category,
          quantity: Number(form.quantity),
          minStock: Number(form.minStock || 0),
          unit: form.unit,
          purchaseCost: Number(form.purchaseCost),
          supplier: form.supplier,
        },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to add item');
      }
      setForm(EMPTY_FORM);
      setShowAddForm(false);
      loadInventory();
    } catch (err: any) {
      setError(err.message || 'Failed to add item.');
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete(id: number) {
    if (!window.confirm('Deactivate this inventory item?')) return;
    try {
      const res = await apiFetch(`/api/inventory/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to deactivate item');
      loadInventory();
    } catch (err: any) {
      setError(err.message || 'Failed to deactivate item.');
    }
  }

  const columns = [
    { header: 'Item Name', accessor: 'itemName' as const },
    { header: 'Category', accessor: 'category' as const },
    { header: 'Available', accessor: 'availableQuantity' as const },
    { header: 'Min Stock', accessor: 'minStock' as const },
    { header: 'Unit Cost', accessor: (item: InventoryItem) => formatIndianCurrency(item.purchaseCost) },
    {
      header: 'Status',
      accessor: (item: InventoryItem) => {
        const status = stockStatus(item);
        return (
          <span
            className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${
              status === 'In Stock'
                ? 'bg-chart-3/10 text-chart-3'
                : status === 'Low Stock'
                ? 'bg-chart-4/10 text-chart-4'
                : 'bg-destructive/10 text-destructive'
            }`}
          >
            {status}
          </span>
        );
      },
    },
    ...(canManage ? [{
      header: '',
      accessor: (item: InventoryItem) => (
        <button onClick={() => handleDelete(item.id)} className="rounded-lg p-1.5 hover:bg-secondary text-red-500" title="Deactivate">
          <Trash2 className="h-4 w-4" />
        </button>
      ),
    }] : []),
  ];

  return (
    <div className="flex-1">
      <Header title="Inventory Management" />

      <div className="p-6 space-y-6">
        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-400">
            {error}
          </div>
        )}

        <div className="flex flex-wrap gap-3">
          <div className="relative min-w-[220px] flex-1">
            <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input type="search" placeholder="Search inventory" value={search} onChange={(event) => setSearch(event.target.value)} className="w-full rounded-xl border border-input bg-input-background py-2.5 pl-10 pr-4 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20" />
          </div>
          {user?.role === 'super_admin' && (
            <select value={branchFilter} onChange={(event) => setBranchFilter(event.target.value)} className="rounded-xl border border-input bg-input-background px-3 py-2.5 text-sm focus:border-primary focus:outline-none">
              <option value="">All Branches</option>
              {branches.filter((branch) => branch.status === 'Active').map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
            </select>
          )}
          {canManage && (
            <button onClick={() => setShowAddForm((v) => !v)} className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90">
              <Plus className="h-4 w-4" /> Add Item
            </button>
          )}
        </div>

        {showAddForm && canManage && (
          <form onSubmit={handleAddItem} className="rounded-2xl border border-border bg-card p-6 shadow-sm grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="font-medium text-foreground">Item Name</span>
              <input value={form.itemName} onChange={(e) => setForm((f) => ({ ...f, itemName: e.target.value }))}
                className="rounded-xl border border-input bg-input-background px-3 py-2 text-sm focus:outline-none focus:border-primary" />
            </label>
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="font-medium text-foreground">Category</span>
              <input value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                className="rounded-xl border border-input bg-input-background px-3 py-2 text-sm focus:outline-none focus:border-primary" />
            </label>
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="font-medium text-foreground">Quantity</span>
              <input type="number" min={0} value={form.quantity} onChange={(e) => setForm((f) => ({ ...f, quantity: e.target.value }))}
                className="rounded-xl border border-input bg-input-background px-3 py-2 text-sm focus:outline-none focus:border-primary" />
            </label>
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="font-medium text-foreground">Min Stock</span>
              <input type="number" min={0} value={form.minStock} onChange={(e) => setForm((f) => ({ ...f, minStock: e.target.value }))}
                className="rounded-xl border border-input bg-input-background px-3 py-2 text-sm focus:outline-none focus:border-primary" />
            </label>
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="font-medium text-foreground">Unit</span>
              <select value={form.unit} onChange={(e) => setForm((f) => ({ ...f, unit: e.target.value }))}
                className="rounded-xl border border-input bg-input-background px-3 py-2 text-sm focus:outline-none focus:border-primary">
                {UNIT_OPTIONS.map((u) => <option key={u} value={u}>{u}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="font-medium text-foreground">Purchase Cost (₹/unit)</span>
              <input type="number" min={0} value={form.purchaseCost} onChange={(e) => setForm((f) => ({ ...f, purchaseCost: e.target.value }))}
                className="rounded-xl border border-input bg-input-background px-3 py-2 text-sm focus:outline-none focus:border-primary" />
            </label>
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="font-medium text-foreground">Supplier (optional)</span>
              <input value={form.supplier} onChange={(e) => setForm((f) => ({ ...f, supplier: e.target.value }))}
                className="rounded-xl border border-input bg-input-background px-3 py-2 text-sm focus:outline-none focus:border-primary" />
            </label>
            <div className="flex items-end">
              <button type="submit" disabled={isSaving} className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50">
                {isSaving && <Loader2 className="h-4 w-4 animate-spin" />}
                Save Item
              </button>
            </div>
          </form>
        )}

        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
          <StatsCard title="Total Items" value={filtered.length.toString()} icon={Package} iconColor="bg-primary" />
          <StatsCard title="Low Stock Items" value={lowStockItems.toString()} change="Need reorder" changeType="negative" icon={AlertTriangle} iconColor="bg-chart-4" />
          <StatsCard title="Out of Stock" value={outOfStockItems.toString()} change="Urgent attention" changeType="negative" icon={TrendingDown} iconColor="bg-destructive" />
          <StatsCard title="Total Value" value={formatIndianCurrency(totalInventoryValue)} icon={Box} iconColor="bg-chart-3" />
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading inventory…
          </div>
        ) : (
          <DataTable columns={columns} data={filtered} />
        )}
      </div>
    </div>
  );
}
