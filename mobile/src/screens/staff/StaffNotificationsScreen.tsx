import React from 'react';
import NotificationsScreen from '../member/NotificationsScreen';

// Reuse the authenticated-user inbox. The API scopes every request to the
// caller, while this wrapper only adapts related-item navigation for Staff.
export default function StaffNotificationsScreen() {
  return <NotificationsScreen audience="STAFF" />;
}
