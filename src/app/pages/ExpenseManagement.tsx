import { useState } from 'react';
import { Header } from '../components/Header';
import { StatsCard } from '../components/StatsCard';
import { DataTable } from '../components/DataTable';
import { useAuth } from '../auth/AuthContext';
import { getBranches } from '../lib/branchService';
import { formatIndianCurrency } from '../lib/currency';
import { Receipt, TrendingDown, DollarSign, CreditCard, Search } from 'lucide-react';

interface Expense {
  id: number;
  branchId?: string;
  category: string;
  description: string;
  amount: number;
  date: string;
  status: 'Paid' | 'Pending';
}

// Start with no demo expenses; ready for real data import
const expensesSeed: Expense[] = [];

export function ExpenseManagement() {
  const { user } = useAuth();
  const branches = getBranches();
  const [search, setSearch] = useState('');
  const [branchFilter, setBranchFilter] = useState(user?.role === 'super_admin' ? '' : user?.branchId ?? '');
  const expenses = expensesSeed.filter((expense) => {
    const matchesSearch = `${expense.category} ${expense.description}`.toLowerCase().includes(search.toLowerCase());
    const matchesBranch = user?.role === 'super_admin'
      ? (!branchFilter || expense.branchId === branchFilter)
      : (!user?.branchId || expense.branchId === user.branchId);
    return matchesSearch && matchesBranch;
  });
  const totalExpenses = expenses.reduce((sum, expense) => sum + expense.amount, 0);
  const pendingExpenses = expenses.filter((expense) => expense.status === 'Pending').reduce((sum, expense) => sum + expense.amount, 0);

  const columns = [
    { header: 'Category', accessor: 'category' as const },
    { header: 'Description', accessor: 'description' as const },
    {
      header: 'Amount',
      accessor: (expense: Expense) => formatIndianCurrency(expense.amount),
    },
    { header: 'Date', accessor: 'date' as const },
    {
      header: 'Status',
      accessor: (expense: Expense) => (
        <span className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${
          expense.status === 'Paid' ? 'bg-chart-3/10 text-chart-3' : 'bg-chart-4/10 text-chart-4'
        }`}>
          {expense.status}
        </span>
      ),
    },
  ];

  return (
    <div className="flex-1">
      <Header title="Expense Management" />
      
      <div className="p-6 space-y-6">
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
        </div>

        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
          <StatsCard title="Total Expenses" value={formatIndianCurrency(totalExpenses)} icon={Receipt} iconColor="bg-destructive" />
          <StatsCard title="This Month" value={formatIndianCurrency(Math.round(totalExpenses / 2))} change="Branch scoped" changeType="positive" icon={DollarSign} iconColor="bg-chart-4" />
          <StatsCard title="Pending Payments" value={formatIndianCurrency(pendingExpenses)} icon={CreditCard} iconColor="bg-primary" />
          <StatsCard title="Avg Monthly" value={formatIndianCurrency(Math.round(totalExpenses / expenses.length || 0))} icon={TrendingDown} iconColor="bg-accent" />
        </div>

        <DataTable columns={columns} data={expenses} />
      </div>
    </div>
  );
}
