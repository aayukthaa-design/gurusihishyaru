import { Header } from '../components/Header';
import { StatsCard } from '../components/StatsCard';
import { DataTable } from '../components/DataTable';
import { Users, DollarSign, TrendingUp, Bell } from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

const chartData = [
  { name: 'Jan', value: 400 },
  { name: 'Feb', value: 300 },
  { name: 'Mar', value: 600 },
  { name: 'Apr', value: 800 },
];

interface SampleData {
  id: number;
  name: string;
  status: 'Active' | 'Inactive';
  value: number;
}

const tableData: SampleData[] = [
  { id: 1, name: 'Item 1', status: 'Active', value: 100 },
  { id: 2, name: 'Item 2', status: 'Inactive', value: 200 },
  { id: 3, name: 'Item 3', status: 'Active', value: 300 },
];

export function ThemeShowcase() {
  const columns = [
    { header: 'Name', accessor: 'name' as const },
    {
      header: 'Status',
      accessor: (item: SampleData) => (
        <span
          className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${
            item.status === 'Active'
              ? 'bg-chart-3/10 text-chart-3'
              : 'bg-destructive/10 text-destructive'
          }`}
        >
          {item.status}
        </span>
      ),
    },
    { header: 'Value', accessor: 'value' as const },
  ];

  return (
    <div className="flex-1">
      <Header title="Theme Showcase - Light & Dark Mode" />
      
      <div className="p-6 space-y-6">
        {/* Color Palette */}
        <div className="rounded-xl border border-border bg-card p-6">
          <h3 className="mb-4 text-lg font-semibold text-card-foreground">
            Color Palette
          </h3>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-6">
            <div className="space-y-2">
              <div className="h-16 rounded-lg bg-background border-2 border-border" />
              <p className="text-xs text-muted-foreground">Background</p>
            </div>
            <div className="space-y-2">
              <div className="h-16 rounded-lg bg-card border-2 border-border" />
              <p className="text-xs text-muted-foreground">Card</p>
            </div>
            <div className="space-y-2">
              <div className="h-16 rounded-lg bg-primary" />
              <p className="text-xs text-muted-foreground">Primary</p>
            </div>
            <div className="space-y-2">
              <div className="h-16 rounded-lg bg-accent" />
              <p className="text-xs text-muted-foreground">Accent</p>
            </div>
            <div className="space-y-2">
              <div className="h-16 rounded-lg bg-secondary border-2 border-border" />
              <p className="text-xs text-muted-foreground">Secondary</p>
            </div>
            <div className="space-y-2">
              <div className="h-16 rounded-lg bg-muted border-2 border-border" />
              <p className="text-xs text-muted-foreground">Muted</p>
            </div>
          </div>
        </div>

        {/* Stats Cards */}
        <div>
          <h3 className="mb-4 text-lg font-semibold text-foreground">Stats Cards</h3>
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
            <StatsCard
              title="Total Users"
              value="1,234"
              change="+12% increase"
              changeType="positive"
              icon={Users}
              iconColor="bg-primary"
            />
            <StatsCard
              title="Revenue"
              value="$45.2K"
              change="+8.5% growth"
              changeType="positive"
              icon={DollarSign}
              iconColor="bg-chart-3"
            />
            <StatsCard
              title="Performance"
              value="94.8%"
              change="+2.1% improvement"
              changeType="positive"
              icon={TrendingUp}
              iconColor="bg-accent"
            />
            <StatsCard
              title="Notifications"
              value="24"
              change="3 unread"
              icon={Bell}
              iconColor="bg-chart-4"
            />
          </div>
        </div>

        {/* Forms & Inputs */}
        <div className="rounded-xl border border-border bg-card p-6">
          <h3 className="mb-4 text-lg font-semibold text-card-foreground">
            Form Elements
          </h3>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="mb-2 block text-sm">Text Input</label>
              <input
                type="text"
                placeholder="Enter text..."
                className="w-full rounded-lg border border-input bg-input-background px-4 py-2 transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </div>
            <div>
              <label className="mb-2 block text-sm">Select Dropdown</label>
              <select className="w-full rounded-lg border border-input bg-input-background px-4 py-2 transition-colors">
                <option>Option 1</option>
                <option>Option 2</option>
                <option>Option 3</option>
              </select>
            </div>
          </div>
          <div className="mt-4 flex gap-3">
            <button className="rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground transition-all hover:opacity-90">
              Primary Button
            </button>
            <button className="rounded-lg border border-border bg-card px-4 py-2 text-sm transition-colors hover:bg-secondary">
              Secondary Button
            </button>
            <button className="rounded-lg bg-accent px-4 py-2 text-sm text-accent-foreground transition-all hover:opacity-90">
              Accent Button
            </button>
          </div>
        </div>

        {/* Charts */}
        <div className="rounded-xl border border-border bg-card p-6">
          <h3 className="mb-4 text-lg font-semibold text-card-foreground">
            Chart Example
          </h3>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="name" stroke="var(--muted-foreground)" />
              <YAxis stroke="var(--muted-foreground)" />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'var(--card)',
                  border: '1px solid var(--border)',
                  borderRadius: '0.5rem',
                  color: 'var(--card-foreground)',
                }}
              />
              <Bar dataKey="value" fill="var(--primary)" radius={[8, 8, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Data Table */}
        <div>
          <h3 className="mb-4 text-lg font-semibold text-foreground">
            Data Table Example
          </h3>
          <DataTable columns={columns} data={tableData} />
        </div>

        {/* Cards & Notifications */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="rounded-xl border border-border bg-card p-6">
            <h3 className="mb-4 text-lg font-semibold text-card-foreground">
              Card Component
            </h3>
            <p className="text-sm text-muted-foreground">
              This is a card component demonstrating the background, borders, and
              text colors in the current theme.
            </p>
            <div className="mt-4 rounded-lg border border-border bg-secondary p-4">
              <p className="text-sm text-card-foreground">
                Nested secondary background
              </p>
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card p-6">
            <h3 className="mb-4 text-lg font-semibold text-card-foreground">
              Status Badges
            </h3>
            <div className="flex flex-wrap gap-2">
              <span className="rounded-full bg-chart-3/10 px-3 py-1 text-xs font-medium text-chart-3">
                Success
              </span>
              <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
                Info
              </span>
              <span className="rounded-full bg-chart-4/10 px-3 py-1 text-xs font-medium text-chart-4">
                Warning
              </span>
              <span className="rounded-full bg-destructive/10 px-3 py-1 text-xs font-medium text-destructive">
                Error
              </span>
              <span className="rounded-full bg-accent/10 px-3 py-1 text-xs font-medium text-accent">
                Accent
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
