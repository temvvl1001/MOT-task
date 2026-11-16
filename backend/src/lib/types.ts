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
  // Worker энэ notification-ийг хэдэн удаа авсан.
  attempts: number;
  createdAt: string;
  updatedAt: string;
  // Epoch секунд. Энэ мөчөөс хойш DynamoDB-ийн TTL мөрийг устгана.
  expiresAt?: number;
}

export interface NotificationPage {
  items: Notification[];
  nextToken?: string;
}
