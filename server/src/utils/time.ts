export function getUtc8Timestamp(): number {
  return Math.floor((Date.now() + 8 * 60 * 60 * 1000) / 1000);
}
