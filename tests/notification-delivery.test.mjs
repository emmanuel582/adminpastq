import test from 'node:test';
import assert from 'node:assert/strict';
import { phoneDelivery, pushConnection, campaignDelivery } from '../src/notification-delivery.js';
test('phone delivery distinguishes queued tickets from provider receipts and failures', () => {
 assert.deepEqual(phoneDelivery([{status:'delivered',count:2},{status:'receipt',count:3},{status:'pending',count:4},{status:'sending',count:1},{status:'failed',count:5},{status:'cancelled',count:1}]),{accepted:2,pending:8,failed:5,cancelled:1});
 assert.deepEqual(phoneDelivery(undefined),{accepted:0,pending:0,failed:0,cancelled:0});
 assert.deepEqual(phoneDelivery([{status:'delivered',count:-1},{status:'delivered',count:'bad'}]),{accepted:0,pending:0,failed:0,cancelled:0});
});
test('an inbox-completed campaign with phone tickets still shows as sending',()=>{
 assert.equal(campaignDelivery({status:'completed',message:{push:true},nativePush:[{status:'receipt',count:2}]}),'Sending phone push');
 assert.equal(campaignDelivery({status:'completed',message:{push:true},nativePush:[{status:'delivered',count:1}]}),'Push accepted');
 assert.equal(campaignDelivery({status:'completed',message:{push:true},nativePush:[{status:'failed',count:1}],push_sent:1}),'Some pushes failed');
 assert.equal(campaignDelivery({status:'completed',message:{push:false}}),'Inbox only');
 assert.equal(campaignDelivery({status:'completed',message:{push:true}}),'Inbox sent · no push accepted');
});
test('connection labels identify phones, browsers, and disabled push without device credentials',()=>{
 assert.equal(pushConnection({phoneDevices:1,browserDevices:2}),'1 phone · 2 browsers');
 assert.equal(pushConnection({phoneDevices:0,browserDevices:0,reason:'browser_disabled'}),'Browser notifications switched off');
 assert.equal(pushConnection({phoneDevices:0,browserDevices:0}),'No push device connected');
});
