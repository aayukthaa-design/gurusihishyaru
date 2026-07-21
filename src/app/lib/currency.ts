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

// jsPDF's core fonts (Times/Helvetica/Courier) don't include the ₹ glyph (U+20B9) —
// it renders as a broken/superscript character in exported PDFs. Use this instead of
// formatIndianCurrency() for any value written directly into a jsPDF document/table;
// keep formatIndianCurrency() for on-screen UI, which renders ₹ fine.
export function formatIndianCurrencyForPdf(value: number | string | null | undefined): string {
  return formatIndianCurrency(value).replace('₹', 'Rs. ');
}
