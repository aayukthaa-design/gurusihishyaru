// Shared by AccountantPortal.tsx and Dashboard.tsx (Admin/Super Admin view)
// so both ever compute Income/Expense-by-category from the exact same logic
// against the exact same /api/ledger source — no separate calculation system.
export interface LedgerSummaryEntry {
  type: 'Income' | 'Expense' | string;
  category: string;
  amount: number;
}

export interface IncomeExpenseSummary {
  incomeCategories: Record<string, number>;
  expenseCategories: Record<string, number>;
  totalInc: number;
  totalExp: number;
  net: number;
}

export function computeIncomeExpenseSummary(ledger: LedgerSummaryEntry[]): IncomeExpenseSummary {
  const incomeCategories: Record<string, number> = {};
  const expenseCategories: Record<string, number> = {};
  let totalInc = 0;
  let totalExp = 0;

  ledger.forEach((t) => {
    if (t.type === 'Income') {
      incomeCategories[t.category] = (incomeCategories[t.category] || 0) + t.amount;
      totalInc += t.amount;
    } else {
      expenseCategories[t.category] = (expenseCategories[t.category] || 0) + t.amount;
      totalExp += t.amount;
    }
  });

  return { incomeCategories, expenseCategories, totalInc, totalExp, net: totalInc - totalExp };
}

/** Inclusive YYYY-MM-DD range filter; an empty bound is open-ended. Shared by every income/expense view and export. */
export function filterLedgerByDateRange<T extends { date: string }>(ledger: T[], start?: string, end?: string): T[] {
  if (!start && !end) return ledger;
  return ledger.filter((t) => {
    const day = t.date.slice(0, 10);
    return (!start || day >= start) && (!end || day <= end);
  });
}
