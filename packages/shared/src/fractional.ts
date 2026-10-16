/**
 * Fractional indexing (after David Greenspan's algorithm): keys are base-62 strings that sort
 * lexicographically; a key strictly between any two keys always exists, so reordering one
 * queue item never rewrites the others.
 */
export const FRACTIONAL_DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const ZERO = FRACTIONAL_DIGITS[0]!;

function midpoint(a: string, b: string | null): string {
  if (b !== null && a >= b) throw new Error(`fractional: ${a} >= ${b}`);
  if (a.endsWith(ZERO) || (b !== null && b.endsWith(ZERO))) throw new Error('fractional: trailing zero');
  if (b !== null) {
    let n = 0;
    while ((a[n] ?? ZERO) === b[n]) n++;
    if (n > 0) return b.slice(0, n) + midpoint(a.slice(n), b.slice(n));
  }
  const digitA = a ? FRACTIONAL_DIGITS.indexOf(a[0]!) : 0;
  const digitB = b !== null ? FRACTIONAL_DIGITS.indexOf(b[0]!) : FRACTIONAL_DIGITS.length;
  if (digitB - digitA > 1) {
    return FRACTIONAL_DIGITS[Math.round(0.5 * (digitA + digitB))]!;
  }
  if (b !== null && b.length > 1) return b.slice(0, 1);
  return FRACTIONAL_DIGITS[digitA]! + midpoint(a.slice(1), null);
}

export function isValidKey(key: string): boolean {
  return key.length > 0 && !key.endsWith(ZERO) && [...key].every((c) => FRACTIONAL_DIGITS.includes(c));
}

/** Key strictly between a and b (null = open end). */
export function keyBetween(a: string | null, b: string | null): string {
  if (a !== null && !isValidKey(a)) throw new Error(`fractional: invalid key ${a}`);
  if (b !== null && !isValidKey(b)) throw new Error(`fractional: invalid key ${b}`);
  return midpoint(a ?? '', b);
}
