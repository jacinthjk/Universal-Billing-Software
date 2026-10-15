// Converts an amount to words for invoices, e.g. 1850 INR -> "One Thousand Eight Hundred and Fifty Rupees only".
// INR uses the Indian system (lakh, crore); other currencies use the international system.
const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

const CURRENCY_WORDS = {
  INR: ['Rupees', 'Paise'], USD: ['Dollars', 'Cents'], EUR: ['Euros', 'Cents'], GBP: ['Pounds', 'Pence'],
  AED: ['Dirhams', 'Fils'], SGD: ['Dollars', 'Cents'], AUD: ['Dollars', 'Cents'],
};

function belowHundred(n) {
  if (n < 20) return ONES[n];
  return `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ''}`;
}

function belowThousand(n) {
  const h = Math.floor(n / 100);
  const r = n % 100;
  if (!h) return belowHundred(r);
  return `${ONES[h]} Hundred${r ? ` and ${belowHundred(r)}` : ''}`;
}

function integerWords(n, indian) {
  if (n === 0) return 'Zero';
  const scales = indian
    ? [[10000000, 'Crore'], [100000, 'Lakh'], [1000, 'Thousand']]
    : [[1e9, 'Billion'], [1e6, 'Million'], [1000, 'Thousand']];
  const parts = [];
  let rest = n;
  for (const [value, name] of scales) {
    if (rest >= value) {
      const count = Math.floor(rest / value);
      // Crores can exceed 99, so recurse for the count.
      parts.push(`${count >= 1000 ? integerWords(count, indian) : belowThousand(count)} ${name}`);
      rest %= value;
    }
  }
  if (rest) parts.push(rest < 100 && parts.length ? `and ${belowHundred(rest)}` : belowThousand(rest));
  return parts.join(' ');
}

function amountInWords(amount, currency = 'INR') {
  const [major, minor] = CURRENCY_WORDS[currency] || [currency, 'Cents'];
  const value = Math.round(Math.abs(Number(amount) || 0) * 100);
  const whole = Math.floor(value / 100);
  const fraction = value % 100;
  const indian = currency === 'INR';
  let words = `${integerWords(whole, indian)} ${major}`;
  if (fraction) words += ` and ${belowHundred(fraction)} ${minor}`;
  return `${words} only`;
}

module.exports = { amountInWords };
