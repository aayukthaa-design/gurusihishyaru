import { LucideIcon } from 'lucide-react';

interface StatsCardProps {
  title: string;
  value: string | number;
  change?: string;
  changeType?: 'positive' | 'negative';
  icon: LucideIcon;
  iconColor?: string;
}

export function StatsCard({
  title,
  value,
  change,
  changeType,
  icon: Icon,
  iconColor = 'bg-primary',
}: StatsCardProps) {
  return (
    <div className="rounded-xl border border-border bg-card p-6 transition-all duration-200 hover:shadow-lg">
      <div className="flex items-center justify-between">
        <div className="flex-1">
          <p className="text-sm text-muted-foreground">{title}</p>
          <h3 className="mt-2 text-3xl font-semibold text-card-foreground">
            {value}
          </h3>
          {change && (
            <p
              className={`mt-2 text-sm ${
                changeType === 'positive'
                  ? 'text-chart-3'
                  : changeType === 'negative'
                  ? 'text-destructive'
                  : 'text-muted-foreground'
              }`}
            >
              {change}
            </p>
          )}
        </div>
        <div
          className={`flex h-12 w-12 items-center justify-center rounded-lg ${iconColor}`}
        >
          <Icon className="h-6 w-6 text-primary-foreground" />
        </div>
      </div>
    </div>
  );
}
