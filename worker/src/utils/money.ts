/**
 * 金额计算工具函数
 * 解决JavaScript浮点数精度问题
 */

/**
 * 修正金额精度,确保金额为2位小数
 * @param {number} amount - 金额
 * @returns {number} 修正后的金额
 */
export function fixMoneyPrecision(amount) {
  // 将金额转换为分(整数),然后再转回元,避免浮点数精度问题
  const cents = Math.round(amount * 100);
  return cents / 100;
}

/**
 * 金额加法
 * @param {number} a - 金额1
 * @param {number} b - 金额2
 * @returns {number} 相加后的金额
 */
export function addMoney(a, b) {
  const centsA = Math.round(a * 100);
  const centsB = Math.round(b * 100);
  return (centsA + centsB) / 100;
}

/**
 * 金额减法
 * @param {number} a - 金额1
 * @param {number} b - 金额2
 * @returns {number} 相减后的金额
 */
export function subtractMoney(a, b) {
  const centsA = Math.round(a * 100);
  const centsB = Math.round(b * 100);
  const result = (centsA - centsB) / 100;
  // 如果结果小于0.01,则设为0,避免出现极小的浮点数
  return Math.abs(result) < 0.01 ? 0 : result;
}

/**
 * 金额乘法
 * @param {number} amount - 金额
 * @param {number} multiplier - 乘数
 * @returns {number} 相乘后的金额
 */
export function multiplyMoney(amount, multiplier) {
  const cents = Math.round(amount * 100);
  const result = Math.round(cents * multiplier);
  return result / 100;
}

/**
 * 比较两个金额是否相等(考虑精度)
 * @param {number} a - 金额1
 * @param {number} b - 金额2
 * @returns {boolean} 是否相等
 */
export function isMoneyEqual(a, b) {
  return Math.abs(a - b) < 0.01;
}

/**
 * 检查金额是否有效(大于等于0.01)
 * @param {number} amount - 金额
 * @returns {boolean} 是否有效
 */
export function isValidMoney(amount) {
  return amount >= 0.01;
}
