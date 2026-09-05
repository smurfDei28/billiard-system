import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { api } from '../../context/AuthContext';
import { COLORS } from '../../constants';

const pretty = (value?: string) => String(value || '').replace(/_/g, ' ').replace(/\b\w/g, character => character.toUpperCase());

const isAcquireMockSandboxAttempt = (payment: any) => (
  payment?.method === 'GCASH'
  && (
    String(payment?.referenceNo || '').startsWith('ACQUIREMOCK-')
    || /gcash_mock_[0-9a-f-]{36}/i.test(`${payment?.referenceNo || ''} ${payment?.notes || ''}`)
  )
);

const sandboxStatusFromAttempt = (payment: any): string | null => {
  const notes = typeof payment?.notes === 'string' ? payment.notes : JSON.stringify(payment?.notes || '');
  const providerStatus = notes.match(/(?:status=|"status"\s*:\s*")(paid|failed|pending|cancelled)/i)?.[1]?.toUpperCase();
  if (providerStatus) return providerStatus;
  if (payment?.status === 'PENDING') return 'PENDING';
  if (payment?.status === 'APPROVED') return 'PAID';
  if (payment?.status === 'REJECTED') return 'FAILED';
  return null;
};

// The API returns attempts newest first. Prefer any active attempt, then the newest terminal attempt.
const currentSandboxAttempt = (order: any) => {
  const sandboxAttempts = (order.manualPayments || []).filter(isAcquireMockSandboxAttempt);
  return sandboxAttempts.find((payment: any) => payment.status === 'PENDING') || sandboxAttempts[0];
};

export default function MyOrdersScreen({ navigation }: any) {
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setOrders((await api.get('/api/member-orders/mine')).data || []);
    } catch {
      // The existing empty/error state is intentionally unchanged.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => navigation.addListener('focus', load), [navigation, load]);

  if (loading) {
    return <View style={s.center}><ActivityIndicator color={COLORS.primary} /></View>;
  }

  return (
    <View style={s.root}>
      <View style={s.header}>
        <Text style={s.title}>My Orders</Text>
        <TouchableOpacity onPress={load}><Text style={s.refresh}>Refresh</Text></TouchableOpacity>
      </View>
      <FlatList
        data={orders}
        contentContainerStyle={s.list}
        ListEmptyComponent={<Text style={s.empty}>No orders yet.</Text>}
        keyExtractor={order => order.id}
        renderItem={({ item: order }) => {
          const sandboxAttempt = currentSandboxAttempt(order);
          const providerStatus = sandboxStatusFromAttempt(sandboxAttempt);
          const isSandboxOrder = Boolean(sandboxAttempt);
          const isPendingSandboxOrder = order.paymentStatus === 'PENDING' && isSandboxOrder && Boolean(providerStatus);
          const paymentAction = order.paymentStatus === 'PENDING' && ['GCASH', 'MAYA'].includes(order.paymentMethod)
            ? isSandboxOrder && (providerStatus === 'FAILED' || providerStatus === 'CANCELLED')
              ? 'Retry Payment'
              : isSandboxOrder && providerStatus === 'PENDING'
                ? 'Resume Payment'
                : 'Complete Payment'
            : null;

          return (
            <TouchableOpacity style={s.card} onPress={() => navigation.navigate('OrderDetail', { order })}>
              <Text style={s.name}>{order.receiptNumber || `Order ${order.id.slice(0, 8)}`}</Text>
              <Text style={s.meta}>{new Date(order.createdAt).toLocaleString('en-PH')} · {order.items?.length || 0} item(s)</Text>
              <Text style={s.total}>₱{Number(order.total).toFixed(2)} · {pretty(order.paymentMethod)}</Text>
              <Text style={s.meta}>
                {isPendingSandboxOrder
                  ? `${order.paymentStatus} · PAYMENT ${providerStatus}`
                  : `${pretty(order.paymentStatus) === 'Pending' ? 'Pending Payment' : pretty(order.paymentStatus)} · ${pretty(order.fulfillmentStatus)}`}
              </Text>
              {paymentAction ? (
                <TouchableOpacity style={s.pay} onPress={() => navigation.navigate('Payments', { orderId: order.id })}>
                  <Text style={s.payTxt}>{paymentAction}</Text>
                </TouchableOpacity>
              ) : order.paymentStatus === 'PENDING' && order.paymentMethod === 'CASH' ? (
                <Text style={s.meta}>Waiting for staff to collect payment</Text>
              ) : null}
            </TouchableOpacity>
          );
        }}
      />
    </View>
  );
}

export function OrderDetailScreen({ route, navigation }: any) {
  const order = route.params.order;
  return (
    <View style={s.root}>
      <View style={s.header}>
        <Text style={s.title}>{order.receiptNumber || 'Order Details'}</Text>
        <TouchableOpacity onPress={() => navigation.goBack()}><Text style={s.refresh}>Back</Text></TouchableOpacity>
      </View>
      <FlatList
        data={order.items || []}
        keyExtractor={(item: any) => item.id}
        contentContainerStyle={s.list}
        ListHeaderComponent={<>
          <Text style={s.meta}>{new Date(order.createdAt).toLocaleString('en-PH')}</Text>
          <Text style={s.total}>{pretty(order.paymentMethod)} · {pretty(order.paymentStatus)} · {pretty(order.fulfillmentStatus)}</Text>
          {order.note ? <Text style={s.meta}>Note: {order.note.replace(/^\[shop:[^\]]+\]/, '')}</Text> : null}
        </>}
        renderItem={({ item }) => <View style={s.card}><Text style={s.name}>{item.product?.name || 'Item'} × {item.quantity}</Text><Text style={s.total}>₱{(item.price * item.quantity).toFixed(2)}</Text></View>}
        ListFooterComponent={<Text style={s.total}>Total: ₱{Number(order.total).toFixed(2)}</Text>}
      />
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.background },
  header: { paddingTop: 56, paddingHorizontal: 18, paddingBottom: 14, flexDirection: 'row', justifyContent: 'space-between' },
  title: { color: COLORS.textPrimary, fontSize: 23, fontWeight: '800' },
  refresh: { color: COLORS.primary, fontWeight: '800' },
  list: { padding: 16, gap: 10 },
  card: { backgroundColor: COLORS.surface, borderRadius: 14, padding: 14, gap: 6 },
  name: { color: COLORS.textPrimary, fontWeight: '800' },
  meta: { color: COLORS.textMuted, fontSize: 12 },
  total: { color: COLORS.primary, fontWeight: '800' },
  pay: { backgroundColor: COLORS.primary, padding: 10, borderRadius: 9, alignSelf: 'flex-start' },
  payTxt: { fontWeight: '800', color: '#00150f' },
  empty: { color: COLORS.textMuted, textAlign: 'center', marginTop: 40 },
});
