import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, RefreshControl, ActivityIndicator, Modal, useWindowDimensions, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../../context/AuthContext';
import { COLORS } from '../../constants';
import { useSocket } from '../../context/SocketContext';
import { useNavigation } from '@react-navigation/native';

const NOTIF_ICONS: Record<string, { icon: string; color: string }> = {
  LOW_CREDIT:          { icon: 'warning-outline', color: COLORS.warning },
  TIME_ENDING:         { icon: 'time-outline', color: COLORS.warning },
  EXTENSION_AVAILABLE: { icon: 'add-circle-outline', color: COLORS.success },
  EXTENSION_BLOCKED:   { icon: 'close-circle-outline', color: COLORS.error },
  TOURNAMENT_INVITE:   { icon: 'trophy-outline', color: COLORS.gold },
  TOURNAMENT_MATCH:    { icon: 'game-controller-outline', color: COLORS.primary },
  TOURNAMENT_APPROVED: { icon: 'checkmark-circle-outline', color: COLORS.success },
  TOURNAMENT_CANCELLED:{ icon: 'close-circle-outline', color: COLORS.error },
  TOURNAMENT_PAYMENT:  { icon: 'card-outline', color: COLORS.info },
  LOYALTY_EARNED:      { icon: 'gift-outline', color: COLORS.success },
  BIRTHDAY_REWARD:     { icon: 'heart-outline', color: COLORS.rankElite },
  QUEUE_UPDATE:        { icon: 'time-outline', color: COLORS.info },
  EVENT_ANNOUNCEMENT:  { icon: 'megaphone-outline', color: COLORS.primary },
  RESERVATION_APPROVED:{ icon: 'calendar-outline', color: COLORS.success },
  RESERVATION_DECLINED:{ icon: 'calendar-clear-outline', color: COLORS.error },
  RESERVATION_SUBMITTED:{ icon: 'calendar-outline', color: COLORS.info },
  RESERVATION_CANCELLED:{ icon: 'calendar-clear-outline', color: COLORS.warning },
  RESERVATION_REMINDER:{ icon: 'alarm-outline', color: COLORS.gold },
  TOPUP_SUCCESS:       { icon: 'wallet-outline', color: COLORS.success },
  TOPUP_SUBMITTED:     { icon: 'hourglass-outline', color: COLORS.warning },
  TOPUP_APPROVED:      { icon: 'wallet-outline', color: COLORS.success },
  TOPUP_REJECTED:      { icon: 'close-circle-outline', color: COLORS.error },
  PAYMENT_INFO_REQUIRED:{ icon: 'help-circle-outline', color: COLORS.warning },
  PAYMENT_RECEIVED:    { icon: 'cash-outline', color: COLORS.success },
  SYSTEM:              { icon: 'information-circle-outline', color: COLORS.textMuted },
};

type InboxAudience = 'MEMBER' | 'STAFF' | 'ADMIN';

export default function NotificationsScreen({ audience = 'MEMBER' }: { audience?: InboxAudience }) {
  const navigation = useNavigation<any>();
  const { width: screenWidth } = useWindowDimensions();
  const isNarrowHeader = screenWidth < 400;
  const { socket } = useSocket();
  const [notifications, setNotifications] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selected, setSelected] = useState<any>(null);
  const [category, setCategory] = useState('All');

  const fetchNotifs = useCallback(async () => {
    try {
      const res = await api.get('/api/notifications');
      setNotifications(res.data);
    } catch { }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => {
    fetchNotifs();
    socket?.on('notification:broadcast', fetchNotifs);
    return () => { socket?.off('notification:broadcast', fetchNotifs); };
  }, [socket, fetchNotifs]);

  const markRead = async (id: string) => {
    try {
      await api.patch(`/api/notifications/${id}/read`);
      setNotifications(prev => prev.map(n => n.id === id ? { ...n, isRead: true } : n));
    } catch { }
  };

  const markAllRead = async () => {
    try {
      await api.patch('/api/notifications/read-all');
      setNotifications(prev => prev.map(n => ({ ...n, isRead: true })));
    } catch { }
  };

  const unreadCount = notifications.filter(n => !n.isRead).length;

  const openNotification = async (notification: any) => {
    setSelected(notification);
    if (!notification.isRead) {
      await markRead(notification.id);
    }
  };

  const notificationCategory = (type: string) => {
    if (type?.startsWith('TOPUP') || type === 'PAYMENT_RECEIVED' || type === 'PAYMENT_INFO_REQUIRED') return 'Payments';
    if (type?.startsWith('RESERVATION')) return 'Reservations';
    if (type?.startsWith('TOURNAMENT')) return 'Tournaments';
    if (['LOW_CREDIT', 'LOYALTY_EARNED', 'BIRTHDAY_REWARD'].includes(type)) return 'Account';
    return 'System';
  };
  const visibleNotifications = category === 'All' ? notifications : notifications.filter((item) => notificationCategory(item.type) === category);
  const notificationData = (notification: any) => {
    if (!notification?.data) return {};
    if (typeof notification.data === 'object') return notification.data;
    try { return JSON.parse(notification.data); } catch { return {}; }
  };

  const notificationStatusLabel = (notification: any) => {
    const data = notificationData(notification);
    if (notification?.type === 'PAYMENT_RECEIVED' && data.sandbox === 'ACQUIREMOCK' && data.paymentStatus === 'PENDING') {
      return 'PAYMENT PENDING';
    }
    return notification?.type?.replace(/_/g, ' ');
  };

  const topupState = (notification: any) => {
    const data = notificationData(notification);
    const isTopup = notification?.type?.startsWith('TOPUP') || data.purpose === 'CREDIT_TOPUP';
    if (!isTopup) return null;
    if (['TOPUP_APPROVED', 'TOPUP_SUCCESS'].includes(notification.type) || ['APPROVED', 'PAID'].includes(data.status)) return 'COMPLETED';
    if (['TOPUP_REJECTED', 'PAYMENT_INFO_REQUIRED'].includes(notification.type) || ['REJECTED', 'NEEDS_INFORMATION'].includes(data.status)) return 'ACTION_REQUIRED';
    return 'PENDING';
  };

  const goToRelated = async () => {
    const notification = selected;
    if (!notification) return;
    const data = notificationData(notification);
    const isOrderRelated = Boolean(data.orderId) || data.purpose === 'ORDER';
    const relatedTopupState = topupState(notification);

    if (audience === 'MEMBER' && relatedTopupState === 'COMPLETED') {
      setSelected(null);
      navigation.navigate('Profile', { initialTab: 'history' });
      return;
    }

    if (audience === 'MEMBER' && isOrderRelated) {
      setSelected(null);
      try {
        const response = await api.get('/api/member-orders/mine');
        const orders = Array.isArray(response.data) ? response.data : [];
        const order = data.orderId
          ? orders.find((item: any) => item.id === data.orderId)
          : orders.find((item: any) => item.manualPayments?.some((payment: any) => payment.id === data.paymentId));
        if (!order) {
          Alert.alert('Order unavailable', 'This related order is no longer available.');
          return;
        }

        const linkedPayment = data.paymentId
          ? order.manualPayments?.find((payment: any) => payment.id === data.paymentId)
          : null;
        const paymentActionNeeded = order.paymentStatus !== 'PAID'
          && ['GCASH', 'MAYA'].includes(order.paymentMethod)
          && (!linkedPayment || ['NEEDS_INFORMATION', 'REJECTED'].includes(linkedPayment.status));
        if (paymentActionNeeded) {
          navigation.navigate('Payments', { orderId: order.id });
        } else {
          navigation.navigate('OrderDetail', { order });
        }
        return;
      } catch {
        Alert.alert('Order unavailable', 'We could not load this related order. Please try again.');
        return;
      }
    }

    const route = notification.actionRoute || notificationCategory(notification.type);
    const target = audience === 'STAFF' && route === 'Tournaments'
      ? 'Matches'
      : route;
    // Admin has no reservation-management tab. Keep the existing detail view
    // rather than navigating to a screen that is unavailable for that role.
    if (!(audience === 'ADMIN' && target === 'Reservations') && (target === 'Payments' || target === 'Reservations' || target === 'Tournaments' || target === 'Matches')) navigation.navigate(target);
    setSelected(null);
  };

  if (loading) return <View style={s.center}><ActivityIndicator size="large" color={COLORS.primary} /></View>;

  return (
    <SafeAreaView style={s.container} edges={['top']}>
      <View style={[s.header, isNarrowHeader && s.headerNarrow]}>
        <View style={s.headerTitleRow}>
          <Ionicons name="notifications-outline" size={24} color={COLORS.textPrimary} />
          <Text style={s.title}>Notifications</Text>
        </View>
        {unreadCount > 0 && (
          <View style={isNarrowHeader ? s.headerActionRow : undefined}>
            <TouchableOpacity style={s.markAllBtn} onPress={markAllRead}>
              <Text style={s.markAll}>Mark all read</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      <ScrollView contentContainerStyle={s.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchNotifs(); }} tintColor={COLORS.primary} />}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.categories}>
          {['All', 'Payments', 'Reservations', 'Tournaments', 'Account', 'System'].map((item) => <TouchableOpacity key={item} onPress={() => setCategory(item)} style={[s.category, category === item && s.categoryActive]}><Text style={[s.categoryText, category === item && s.categoryTextActive]}>{item}</Text></TouchableOpacity>)}
        </ScrollView>
        {visibleNotifications.length === 0 ? (
          <View style={s.empty}>
            <Ionicons name="notifications-off-outline" size={48} color={COLORS.textMuted} />
            <Text style={s.emptyTxt}>No notifications yet</Text>
          </View>
        ) : visibleNotifications.map((n: any) => {
          const cfg = NOTIF_ICONS[n.type] || NOTIF_ICONS.SYSTEM;
          return (
            <TouchableOpacity key={n.id} style={[s.card, !n.isRead && s.cardUnread]} onPress={() => openNotification(n)} activeOpacity={0.8}>
              <View style={[s.iconBox, { backgroundColor: cfg.color + '20' }]}>
                <Ionicons name={cfg.icon as any} size={20} color={cfg.color} />
              </View>
              <View style={s.cardInfo}>
                <Text style={[s.cardTitle, !n.isRead && s.cardTitleUnread]}>{n.title}</Text>
                <Text style={s.cardMsg}>{n.message}</Text>
                <Text style={s.cardTime}>{new Date(n.sentAt).toLocaleString('en-PH')}</Text>
              </View>
              {!n.isRead && <View style={s.unreadDot} />}
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      <Modal visible={!!selected} transparent animationType="fade" onRequestClose={() => setSelected(null)}>
        <View style={s.overlay}>
          <View style={s.dialog}>
            <View style={s.dialogTop}>
              <Text style={s.dialogTitle}>{selected?.title}</Text>
              <TouchableOpacity onPress={() => setSelected(null)}>
                <Ionicons name="close" size={22} color={COLORS.textMuted} />
              </TouchableOpacity>
            </View>
            <Text style={s.dialogType}>{notificationStatusLabel(selected)}</Text>
            <ScrollView style={s.dialogBodyWrap}>
              <Text style={s.dialogBody}>{selected?.message}</Text>
            </ScrollView>
            <Text style={s.dialogTime}>{selected?.sentAt ? new Date(selected.sentAt).toLocaleString('en-PH') : ''}</Text>
            {(audience !== 'MEMBER' || topupState(selected) !== 'PENDING') && (selected?.actionRoute || ['Payments', 'Reservations', 'Tournaments'].includes(selected ? notificationCategory(selected.type) : '')) && !(audience === 'ADMIN' && (selected?.actionRoute || notificationCategory(selected?.type)) === 'Reservations') && <TouchableOpacity style={s.relatedBtn} onPress={goToRelated}><Text style={s.relatedBtnTxt}>View related item</Text></TouchableOpacity>}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.background },
  header: { paddingTop: 16, paddingHorizontal: 20, paddingBottom: 16, flexDirection: 'row', alignItems: 'center', gap: 16, backgroundColor: COLORS.surface, borderBottomWidth: 1, borderBottomColor: COLORS.surfaceBorder },
  headerNarrow: { flexDirection: 'column', alignItems: 'stretch', gap: 10 },
  headerTitleRow: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerActionRow: { alignItems: 'flex-end' },
  title: { fontSize: 22, fontWeight: '800', color: COLORS.textPrimary },
  markAllBtn: { paddingHorizontal: 10, paddingVertical: 7, borderRadius: 9, borderWidth: 1, borderColor: COLORS.primary + '55', backgroundColor: COLORS.primary + '12' },
  markAll: { fontSize: 12, color: COLORS.primary, fontWeight: '700' },
  content: { padding: 16, gap: 8 },
  categories: { gap: 8, paddingBottom: 4 },
  category: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.surfaceBorder },
  categoryActive: { backgroundColor: COLORS.primary + '18', borderColor: COLORS.primary },
  categoryText: { color: COLORS.textMuted, fontSize: 12, fontWeight: '700' },
  categoryTextActive: { color: COLORS.primary },
  card: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, backgroundColor: COLORS.surface, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: COLORS.surfaceBorder },
  cardUnread: { borderColor: COLORS.primary + '50', backgroundColor: COLORS.primary + '08' },
  iconBox: { width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center' },
  cardInfo: { flex: 1, gap: 3 },
  cardTitle: { fontSize: 14, fontWeight: '600', color: COLORS.textSecondary },
  cardTitleUnread: { color: COLORS.textPrimary, fontWeight: '700' },
  cardMsg: { fontSize: 13, color: COLORS.textSecondary },
  cardTime: { fontSize: 11, color: COLORS.textMuted },
  unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: COLORS.primary, marginTop: 6 },
  empty: { padding: 60, alignItems: 'center', gap: 12 },
  emptyTxt: { color: COLORS.textMuted, fontSize: 15 },
  overlay: { flex: 1, backgroundColor: '#00000088', justifyContent: 'center', padding: 20 },
  dialog: { backgroundColor: COLORS.surface, borderRadius: 18, padding: 18, gap: 10, maxHeight: '75%' },
  dialogTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  dialogTitle: { flex: 1, fontSize: 17, fontWeight: '800', color: COLORS.textPrimary },
  dialogType: { fontSize: 11, color: COLORS.primary, fontWeight: '700', textTransform: 'uppercase' },
  dialogBodyWrap: { maxHeight: 260 },
  dialogBody: { fontSize: 14, color: COLORS.textSecondary, lineHeight: 22 },
  dialogTime: { fontSize: 11, color: COLORS.textMuted },
  relatedBtn: { height: 45, borderRadius: 10, backgroundColor: COLORS.primary, justifyContent: 'center', alignItems: 'center' },
  relatedBtnTxt: { color: '#00150f', fontWeight: '800' },
});
