import React from 'react';
import NotificationsScreen from '../member/NotificationsScreen';

// Broadcast creation remains on Announce; this is the Admin's personal inbox.
export default function AdminNotificationsScreen() {
  return <NotificationsScreen audience="ADMIN" />;
}
