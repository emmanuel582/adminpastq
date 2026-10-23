export function phoneDelivery(rows = []) {
  const result = { accepted: 0, pending: 0, failed: 0, cancelled: 0 };
  for (const row of rows || []) {
    const count = Number(row.count);
    if (!Number.isSafeInteger(count) || count < 0) continue;
    if (row.status === 'delivered') result.accepted += count;
    else if (['pending', 'sending', 'receipt'].includes(row.status)) result.pending += count;
    else if (row.status === 'failed') result.failed += count;
    else if (row.status === 'cancelled') result.cancelled += count;
  }
  return result;
}
