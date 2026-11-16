export type NotificationStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
export type Channel = 'EMAIL' | 'SMS' | 'PUSH';

export interface Notification {
  id: string;
  recipient: string;
  channel: Channel;
  message: string;
  status: NotificationStatus;
  result?: string;
  attempts: number;
  createdAt: string;
  updatedAt: string;
}

export interface NotificationPage {
  items: Notification[];
  nextToken?: string;
}

export interface CreateNotificationInput {
  recipient: string;
  channel: Channel;
  message: string;
}
