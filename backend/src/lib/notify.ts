import { broadcastNotification } from './broadcast';
import { Notification } from './types';

// Push амжилтгүй болох нь хадгалагдсан ажлыг буцаах, давтах ёсгүй тул алдааг
// лог хийгээд залгина. Push алдсан client дахин холбогдохдоо жагсаалтаа шинэчилж гүйцнэ.
export const notify = async (notification: Notification) => {
  try {
    await broadcastNotification(notification);
  } catch (err) {
    console.error(`Broadcast failed for ${notification.id}`, err);
  }
};
