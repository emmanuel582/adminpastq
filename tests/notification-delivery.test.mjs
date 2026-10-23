import test from 'node:test';
import assert from 'node:assert/strict';
import { phoneDelivery } from '../src/notification-delivery.js';
test('phone delivery distinguishes queued tickets from provider receipts and failures', () => {
 assert.deepEqual(phoneDelivery([{status:'delivered',count:2},{status:'receipt',count:3},{status:'pending',count:4},{status:'sending',count:1},{status:'failed',count:5},{status:'cancelled',count:1}]),{accepted:2,pending:8,failed:5,cancelled:1});
 assert.deepEqual(phoneDelivery(undefined),{accepted:0,pending:0,failed:0,cancelled:0});
 assert.deepEqual(phoneDelivery([{status:'delivered',count:-1},{status:'delivered',count:'bad'}]),{accepted:0,pending:0,failed:0,cancelled:0});
});
