export function formatIndianCurrency(value: number | string | null | undefined): string {
  const numericValue = typeof value === 'number'
    ? value
    : Number(String(value ?? '').replace(/[^0-9.-]/g, ''));

  if (!Number.isFinite(numericValue)) {
    return '₹0';
  }

  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
  }).format(numericValue);
}
