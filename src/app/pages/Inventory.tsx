import { useState } from 'react';
import { Header } from '../components/Header';
import { StatsCard } from '../components/StatsCard';
import { DataTable } from '../components/DataTable';
import { useAuth } from '../auth/AuthContext';
import { getBranches } from '../lib/branchService';
import { formatIndianCurrency } from '../lib/currency';
import { Package, AlertTriangle, TrendingDown, Box, Search } from 'lucide-react';

interface InventoryItem {
  id: number;
  branchId?: string;
  itemName: string;
  category: string;
  quantity: number;
  minStock: number;
  price: number;
  status: 'In Stock' | 'Low Stock' | 'Out of Stock';
}

// No demo inventory items - start empty and wait for real data import
const inventorySeed: InventoryItem[] = [];

export function Inventory() {
  const { user } = useAuth();
  const branches = getBranches();
  const [search, setSearch] = useState('');
  const [branchFilter, setBranchFilter] = useState(user?.role === 'super_admin' ? '' : user?.branchId ?? '');
  const inventory = inventorySeed.filter((item) => {
    const matchesSearch = `${item.itemName} ${item.category}`.toLowerCase().includes(search.toLowerCase());
    const matchesBranch = user?.role === 'super_admin'
      ? (!branchFilter || item.branchId === branchFilter)
      : (!user?.branchId || item.branchId === user.branchId);
    return matchesSearch && matchesBranch;
  });
  const lowStockItems = inventory.filter((item) => item.status === 'Low Stock' || item.status === 'Out of Stock').length;
  const outOfStockItems = inventory.filter((item) => item.status === 'Out of Stock').length;
  const totalInventoryValue = inventory.reduce((sum, item) => sum + item.quantity * item.price, 0);

  const columns = [
    { header: 'Item Name', accessor: 'itemName' as const },
    { header: 'Category', accessor: 'category' as const },
    { header: 'Quantity', accessor: 'quantity' as const },
    { header: 'Min Stock', accessor: 'minStock' as const },
    {
      header: 'Price',
      accessor: (item: InventoryItem) => formatIndianCurrency(item.price),
    },
    {
      header: 'Status',
      accessor: (item: InventoryItem) => (
        <span
          className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${
            item.status === 'In Stock'
              ? 'bg-chart-3/10 text-chart-3'
              : item.status === 'Low Stock'
              ? 'bg-chart-4/10 text-chart-4'
              : 'bg-destructive/10 text-destructive'
          }`}
        >
          {item.status}
        </span>
      ),
    },
  ];

  return (
    <div className="flex-1">
      <Header title="Inventory Management" />
      
      <div className="p-6 space-y-6">
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
        </div>

        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
          <StatsCard title="Total Items" value={inventory.length.toString()} icon={Package} iconColor="bg-primary" />
          <StatsCard title="Low Stock Items" value={lowStockItems.toString()} change="Need reorder" changeType="negative" icon={AlertTriangle} iconColor="bg-chart-4" />
          <StatsCard title="Out of Stock" value={outOfStockItems.toString()} change="Urgent attention" changeType="negative" icon={TrendingDown} iconColor="bg-destructive" />
          <StatsCard title="Total Value" value={formatIndianCurrency(totalInventoryValue)} icon={Box} iconColor="bg-chart-3" />
        </div>

        <DataTable columns={columns} data={inventory} />
      </div>
    </div>
  );
}
