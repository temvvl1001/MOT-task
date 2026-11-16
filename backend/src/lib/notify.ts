import { broadcastNotification } from './broadcast';
import { Notification } from './types';

// A failed push must never undo or repeat the work that was already saved, so errors are
// logged and swallowed. Clients that missed a push catch up when they reconnect and refetch.
export const notify = async (notification: Notification) => {
  try {
    await broadcastNotification(notification);
  } catch (err) {
    console.error(`Broadcast failed for ${notification.id}`, err);
  }
};
