import { Notification } from './types';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Simulated delivery: a recipient containing "fail" is always rejected.
// In production this would dispatch per channel (SES / SNS / FCM).
export const deliver = async (n: Notification): Promise<string> => {
  await sleep(1000 + Math.random() * 2000);
  if (n.recipient.toLowerCase().includes('fail')) {
    throw new Error(`Delivery to ${n.recipient} was rejected`);
  }
  return `Delivered via ${n.channel} to ${n.recipient}`;
};