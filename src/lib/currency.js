const CURRENCIES = ['PHP', 'USD', 'EUR', 'GBP', 'AUD', 'CAD', 'SGD']

export function formatMoney(amount, currency = 'PHP') {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount || 0)
  } catch {
    return `${currency} ${Number(amount || 0).toFixed(2)}`
  }
}

export { CURRENCIES }
