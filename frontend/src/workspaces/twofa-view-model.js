// Presentation rules retained from the existing tool; JSX owns rendering.

function validPercent(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100;
}

function formatPercent(value) {
  return `${Number(value.toFixed(2))}%`;
}

function formatResetDuration(seconds) {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) return null;
  const totalSeconds = Math.floor(seconds);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (days) return `${days} ngày${hours ? ` ${hours} giờ` : ''}`;
  if (hours) return `${hours} giờ${minutes ? ` ${minutes} phút` : ''}`;
  if (minutes) return `${minutes} phút`;
  return 'dưới 1 phút';
}

function creditLabel(credits) {
  if (!credits || typeof credits !== 'object') return null;
  if (credits.unlimited === true) return 'Credit không giới hạn';
  if (credits.has_credits !== true) return null;
  const balance = ['string', 'number'].includes(typeof credits.balance)
    ? String(credits.balance).trim().slice(0, 64)
    : '';
  return balance ? `Credit ${balance}` : 'Có credit';
}

function buildUsageView(usage) {
  if (!usage || typeof usage !== 'object' || !validPercent(usage.used_percent)) return null;
  const used = Number(usage.used_percent.toFixed(2));
  const remaining = validPercent(usage.remaining_percent)
    ? Number(usage.remaining_percent.toFixed(2))
    : Number((100 - used).toFixed(2));
  const limited = usage.limit_reached === true || usage.allowed === false;
  const resetDuration = formatResetDuration(usage.reset_after_seconds);
  const resetCount = usage.reset_credits?.available_count;

  return {
    used,
    usedLabel: formatPercent(used),
    remainingLabel: `${formatPercent(remaining)} còn lại`,
    statusLabel: limited
      ? 'Đã chạm giới hạn'
      : resetDuration
        ? `Reset sau ${resetDuration}`
        : 'Chưa có giờ reset',
    creditLabel: creditLabel(usage.credits),
    resetCreditLabel: Number.isInteger(resetCount) && resetCount >= 0
      ? `${resetCount} lượt reset`
      : null,
    tone: limited ? 'limited' : used >= 80 ? 'warning' : 'healthy',
  };
}

function isBelowUsageThreshold(usage, threshold = 50) {
  if (!usage || typeof usage !== 'object' || !validPercent(usage.used_percent)) return false;
  if (typeof threshold !== 'number' || !Number.isFinite(threshold)) return false;
  return usage.used_percent < threshold;
}

function isUsageFullyUsed(usage) {
  return Boolean(
    usage
    && typeof usage === 'object'
    && validPercent(usage.used_percent)
    && usage.used_percent === 100
  );
}

function isFreeWithoutUsage(job) {
  const plan = String(job?.plan || '').toLowerCase();
  return Boolean(
    job
    && job.usage_enabled !== false
    && ['free', 'plus'].includes(plan)
    && job.status === 'success'
    && job.account_state === 'live'
    && (!job.usage || typeof job.usage !== 'object' || !validPercent(job.usage.used_percent))
  );
}

function buildFilteredExportMeta(view, count) {
  const definitions = {
    all: ['Tất cả', 'twofa-all.txt'],
    running: ['Đang chạy', 'twofa-running.txt'],
    success: ['Thành công', 'twofa-success-tab.txt'],
    'usage-low': ['Usage < 50%', 'twofa-usage-under-50.txt'],
    'usage-full': ['Usage = 100%', 'twofa-usage-100.txt'],
    'free-no-usage': ['Free + Plus · Chưa có Usage', 'twofa-free-plus-no-usage.txt'],
    error: ['Lỗi', 'twofa-errors.txt'],
  };
  const definition = definitions[view];
  if (!definition || !Number.isInteger(count) || count < 0) return null;
  return {
    view,
    count,
    label: `Xuất ${definition[0]} (${count})`,
    fileName: definition[1],
  };
}
export { buildUsageView, formatResetDuration, isBelowUsageThreshold, isUsageFullyUsed, isFreeWithoutUsage, buildFilteredExportMeta };


const TYPE_LABELS = {
  card: 'Thẻ',
  paypal: 'PayPal',
  apple_pay: 'Apple Pay',
  google_pay: 'Google Pay',
  link: 'Link',
};

function safeLabel(value, maxLength = 32) {
  if (typeof value !== 'string') return null;
  const label = value.trim().toLowerCase();
  if (!label || label.length > maxLength || !/^[a-z0-9][a-z0-9 _-]*$/.test(label)) return null;
  return label;
}

function safeLast4(value) {
  if (!['string', 'number'].includes(typeof value)) return null;
  const last4 = String(value).trim();
  return /^\d{4}$/.test(last4) ? last4 : null;
}

function safeInteger(value, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) return null;
  return value;
}

function buildMethodView(method) {
  if (!method || typeof method !== 'object') return null;
  const type = safeLabel(method.type);
  const brand = safeLabel(method.brand, 24);
  const last4 = safeLast4(method.last4);
  const month = safeInteger(method.exp_month, 1, 12);
  const year = safeInteger(method.exp_year, 2000, 9999);
  if (!type && !brand && !last4) return null;
  const numberLabel = last4 ? `•••• ${last4}` : null;
  const expiryLabel = month && year ? `${String(month).padStart(2, '0')}/${String(year).slice(-2)}` : null;
  return {
    typeLabel: TYPE_LABELS[type] || (type ? type.replaceAll('_', ' ').toUpperCase() : 'Thanh toán'),
    brandLabel: brand ? brand.replaceAll('_', ' ').toUpperCase() : null,
    numberLabel,
    expiryLabel,
    detailLabel: [numberLabel, expiryLabel ? `HSD ${expiryLabel}` : null].filter(Boolean).join(' · ') || null,
    isDefault: method.is_default === true,
  };
}

function paymentDateLabel(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) return null;
  return `Thanh toán ${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`;
}

function buildPaymentView(paymentMethods, billingDate) {
  if (!Array.isArray(paymentMethods)) return null;
  const normalized = paymentMethods.map(buildMethodView).filter(Boolean).slice(0, 8);
  if (!normalized.length) return { empty: true, methods: [], extraCount: 0 };
  return {
    empty: false,
    methods: normalized.slice(0, 2),
    extraCount: Math.max(0, normalized.length - 2),
    paymentDateLabel: paymentDateLabel(billingDate),
  };
}
export { buildPaymentView };
