export function fixMoneyPrecision(amount: number): number {
  const cents = Math.round(amount * 100);
  return cents / 100;
}

export function addMoney(a: number, b: number): number {
  const centsA = Math.round(a * 100);
  const centsB = Math.round(b * 100);
  return (centsA + centsB) / 100;
}

export function subtractMoney(a: number, b: number): number {
  const centsA = Math.round(a * 100);
  const centsB = Math.round(b * 100);
  const result = (centsA - centsB) / 100;
  return Math.abs(result) < 0.01 ? 0 : result;
}

export function multiplyMoney(amount: number, multiplier: number): number {
  const cents = Math.round(amount * 100);
  const result = Math.round(cents * multiplier);
  return result / 100;
}

export function isMoneyEqual(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.01;
}

export function isValidMoney(amount: number): boolean {
  return amount >= 0.01;
}
