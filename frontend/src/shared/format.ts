/** 所有金额统一按澳元显示两位小数，缺失值按零展示。 */
export const money = (value: unknown): string => `A$${Number(value ?? 0).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** 将十进制文本精确解析为指定小数位的整数，非法精度不做静默舍入。 */
function decimalToScaledInteger(value: string, places: number): bigint | null {
  const normalized = value.trim();
  const match = normalized.match(/^(\d*)(?:\.(\d*))?$/);
  if (!match || (!match[1] && !match[2]) || (match[2]?.length ?? 0) > places) return null;
  const whole = match[1] || '0';
  const fraction = (match[2] || '').padEnd(places, '0');
  return BigInt(whole) * 10n ** BigInt(places) + BigInt(fraction || '0');
}

/** 将非负金额比例按 HALF_UP 舍入到整数；非法分母时返回零。 */
function roundPositiveRatioHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n || numerator < 0n) return 0n;
  // 对正数按 HALF_UP 舍入到整数分，避免浮点误差影响税额边界。
  return (numerator * 2n + denominator) / (denominator * 2n);
}

export interface OrderLineAmounts {
  grossLineCents: number;
  unitExGstCents: number;
  subtotalExGstCents: number;
  gstCents: number;
}

/** 用整数分计算含税订单行，单价只用于展示，不能再参与数量乘算。 */
export function calculateOrderLineAmounts(
  rrpInclGst: string,
  quantity: number,
  gstRatePercent: string,
): OrderLineAmounts {
  const rrpCents = decimalToScaledInteger(rrpInclGst, 2);
  const rateBasisPoints = decimalToScaledInteger(gstRatePercent, 2);
  if (rrpCents === null || rateBasisPoints === null || quantity <= 0 || !Number.isInteger(quantity)) {
    return { grossLineCents: 0, unitExGstCents: 0, subtotalExGstCents: 0, gstCents: 0 };
  }

  // 税率以百分数的百分之一存储：10.00% = 1000，分母 10000 + 1000 即 1.10。
  const denominator = 10_000n + rateBasisPoints;
  const grossLineCents = rrpCents * BigInt(quantity);
  const gstCents = roundPositiveRatioHalfUp(grossLineCents * rateBasisPoints, denominator);
  const subtotalExGstCents = grossLineCents - gstCents;
  const unitExGstCents = roundPositiveRatioHalfUp(rrpCents * 10_000n, denominator);
  return {
    grossLineCents: Number(grossLineCents),
    unitExGstCents: Number(unitExGstCents),
    subtotalExGstCents: Number(subtotalExGstCents),
    gstCents: Number(gstCents),
  };
}

/** 按未税订单行汇总同税率金额，再在税率组级别计算 GST。 */
export function calculateOrderGstCents(lines: Array<{ subtotalExGstCents: number; gstRatePercent: string }>): number {
  const basesByRate = new Map<bigint, bigint>();
  for (const line of lines) {
    const rateBasisPoints = decimalToScaledInteger(line.gstRatePercent, 2);
    if (rateBasisPoints === null || !Number.isSafeInteger(line.subtotalExGstCents) || line.subtotalExGstCents < 0) continue;
    const rate = BigInt(rateBasisPoints);
    basesByRate.set(rate, (basesByRate.get(rate) ?? 0n) + BigInt(line.subtotalExGstCents));
  }

  return Number([...basesByRate.entries()].reduce(
    (total, [rateBasisPoints, netCents]) => total + roundPositiveRatioHalfUp(netCents * rateBasisPoints, 10_000n),
    0n,
  ));
}

/** 校验订单行税率是否在 0% 到 100% 之间且最多保留两位小数。 */
export function isValidOrderLineGstRate(value: string): boolean {
  const rate = decimalToScaledInteger(value, 2);
  return rate !== null && rate <= 10_000n;
}

/** 校验含税标价为正数且最多精确到分。 */
export function isValidMoneyAmount(value: string): boolean {
  const amount = decimalToScaledInteger(value, 2);
  return amount !== null && amount > 0n;
}

/** 按澳洲日期格式显示订单日期，固定时区以免受运行设备时区影响。 */
export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const parsed = new Date(`${value.slice(0, 10)}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? value : new Intl.DateTimeFormat('en-AU', { dateStyle: 'medium', timeZone: 'Australia/Melbourne' }).format(parsed);
}

/** 将追踪时间格式化为澳洲本地时间；无效值原样返回供排查。 */
export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : new Intl.DateTimeFormat('en-AU', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Australia/Melbourne' }).format(parsed);
}
