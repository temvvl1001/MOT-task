export type NotificationStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';

export interface Notification {
  id: string;
  recipient: string;
  channel: 'EMAIL' | 'SMS' | 'PUSH';
  message: string;
  status: NotificationStatus;
  result?: string;
  createdAt: string;
  updatedAt: string;
}