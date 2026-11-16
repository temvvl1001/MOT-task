export type NotificationStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
export type Channel = 'EMAIL' | 'SMS' | 'PUSH';

export interface Notification {
  id: string;
  userId: string;
  recipient: string;
  channel: Channel;
  message: string;
  status: NotificationStatus;
  result?: string;
  // How many times the worker has picked this notification up.
  attempts: number;
  createdAt: string;
  updatedAt: string;
  // Epoch seconds. DynamoDB's TTL removes the item after this moment.
  expiresAt?: number;
}

export interface NotificationPage {
  items: Notification[];
  nextToken?: string;
}
