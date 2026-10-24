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

export function pushConnection(push) {
  if (!push) return 'Checking push connection';
  const channels=[];
  if(push.phoneDevices)channels.push(`${push.phoneDevices} phone${push.phoneDevices===1?'':'s'}`);
  if(push.browserDevices)channels.push(`${push.browserDevices} browser${push.browserDevices===1?'':'s'}`);
  return channels.length?channels.join(' · '):push.reason==='browser_disabled'?'Browser notifications switched off':'No push device connected';
}
export function campaignDelivery(item) {
  if(item.message?.push===false)return 'Inbox only';
  const phone=phoneDelivery(item.nativePush);
  if(phone.pending)return 'Sending phone push';
  if(item.status==='queued'||item.status==='sending')return 'Sending';
  if(item.interrupted)return 'Some results unknown';
  if(phone.failed||item.push_failed)return phone.accepted+Number(item.push_sent||0)>0?'Some pushes failed':'Push failed';
  if(phone.accepted+Number(item.push_sent||0)>0)return 'Push accepted';
  return 'Inbox sent · no push accepted';
}
