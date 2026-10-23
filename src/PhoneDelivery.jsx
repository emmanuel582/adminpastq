import React from 'react';
import { phoneDelivery } from './notification-delivery.js';

export default function PhoneDelivery({ rows }) { const counts = phoneDelivery(rows); return <><strong>{counts.accepted} accepted by phone provider</strong><small className="cell-subtitle">{counts.pending} queued / checking · {counts.failed} failed{counts.cancelled ? ` · ${counts.cancelled} cancelled` : ''}</small></>; }
