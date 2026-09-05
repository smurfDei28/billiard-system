import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  ActivityIndicator, Alert, Modal, TextInput,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { api } from '../../context/AuthContext';
import { COLORS } from '../../constants';

const CATEGORY_ICONS: Record<string, string> = {
  ALL: '🛍️', RICE_MEAL: '🍚', DRINKS: '🥤', ALCOHOLIC_BEVERAGES: '🍺',
  COFFEE: '☕', BILLIARD_EQUIPMENT: '🎱', SNACKS: '🍟',
};

const CATEGORY_LABELS: Record<string, string> = {
  ALL: 'All', RICE_MEAL: 'Rice Meals', DRINKS: 'Drinks',
  ALCOHOLIC_BEVERAGES: 'Alcohol', COFFEE: 'Coffee',
  BILLIARD_EQUIPMENT: 'Equipment', SNACKS: 'Snacks',
};

export default function POSScreen({ navigation }: any) {
  const [products, setProducts] = useState<any[]>([]);
  const [cart, setCart] = useState<Record<string, number>>({});
  const [category, setCategory] = useState('ALL');
  const [loading, setLoading] = useState(true);
  const [checkoutModal, setCheckoutModal] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState('CASH');
  const [amountTendered, setAmountTendered] = useState('');
  const [memberEmail, setMemberEmail] = useState('');
  const [foundMember, setFoundMember] = useState<any>(null);
  const [memberResults, setMemberResults] = useState<any[]>([]);
  const [placing, setPlacing] = useState(false);
  const [receipt, setReceipt] = useState<any>(null);
  const [historyVisible, setHistoryVisible] = useState(false);
  const [orders, setOrders] = useState<any[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [voidReason, setVoidReason] = useState('');
  const [voiding, setVoiding] = useState(false);

  // Typeahead member search (username/displayName, name, email, phone)
  useEffect(() => {
    if (!checkoutModal) return;
    const q = memberEmail.trim();
    if (!q) {
      setMemberResults([]);
      return;
    }

    const handle = setTimeout(async () => {
      try {
        const res = await api.get(`/api/users/search?q=${encodeURIComponent(q)}&role=MEMBER`);
        setMemberResults(Array.isArray(res.data) ? res.data : []);
      } catch {
        // ignore typeahead errors
      }
    }, 250);

    return () => clearTimeout(handle);
  }, [memberEmail, checkoutModal]);

  const fetchProducts = useCallback(async () => {
    try {
      const res = await api.get('/api/products');
      setProducts(res.data);
    } catch { Alert.alert('Error', 'Failed to load products'); }
    finally { setLoading(false); }
  }, []);

  useFocusEffect(useCallback(() => {
    fetchProducts();
  }, [fetchProducts]));

  const fetchOrders = async () => {
    setHistoryLoading(true);
    try { const res = await api.get('/api/orders'); setOrders(res.data?.orders || []); }
    catch { Alert.alert('Error', 'Failed to load sales history'); }
    finally { setHistoryLoading(false); }
  };

  const voidReceipt = async () => {
    if (!receipt?.id || !voidReason.trim() || voiding) return;
    setVoiding(true);
    try {
      const result = await api.patch(`/api/orders/${receipt.id}/void`, { reason: voidReason.trim() });
      setReceipt({ ...receipt, ...result.data.order });
      setVoidReason('');
      fetchProducts();
    } catch (err: any) { Alert.alert('Void failed', err.response?.data?.error || 'Could not void this sale.'); }
    finally { setVoiding(false); }
  };

  const addToCart = (id: string) => setCart(c => {
    const product = products.find((item) => item.id === id);
    const available = Number(product?.stock || 0);
    const current = c[id] || 0;
    if (!product || available <= 0) {
      Alert.alert('Out of stock', 'This product is out of stock.');
      return c;
    }
    if (current >= available) {
      Alert.alert('Stock limit reached', `Only ${available} available.`);
      return c;
    }
    return { ...c, [id]: current + 1 };
  });
  const removeFromCart = (id: string) => setCart(c => {
    const next = { ...c };
    if (next[id] <= 1) delete next[id]; else next[id]--;
    return next;
  });
  const clearCart = () => { setCart({}); setFoundMember(null); setMemberEmail(''); setMemberResults([]); };

  const cartItems = Object.entries(cart).map(([id, qty]) => ({
    product: products.find(p => p.id === id)!, qty,
  })).filter(i => i.product);

  const cartTotal = cartItems.reduce((s, i) => s + i.product.price * i.qty, 0);
  const cartCount = Object.values(cart).reduce((s, v) => s + v, 0);

  const searchMember = async () => {
    if (!memberEmail.trim()) return;
    try {
      setFoundMember(null);
      const res = await api.get(`/api/users/search?q=${encodeURIComponent(memberEmail.trim())}&role=MEMBER`);
      const results = Array.isArray(res.data) ? res.data : [];
      setMemberResults(results);
      if (results.length === 1) {
        setFoundMember(results[0]);
        setMemberResults([]);
      } else if (results.length === 0) {
        Alert.alert('Not Found', 'No member found for that search.');
      }
    } catch { Alert.alert('Error', 'Search failed'); }
  };

  const placeOrder = async () => {
    if (cartItems.length === 0) return;
    setPlacing(true);
    try {
      const result = await api.post('/api/orders', {
        items: cartItems.map(i => ({ productId: i.product.id, quantity: i.qty })),
        userId: foundMember?.id || null,
        paymentMethod: paymentMethod === 'CREDITS' ? 'LOYALTY_CREDIT' : paymentMethod,
        paidWithCredits: paymentMethod === 'CREDITS',
        amountTendered: paymentMethod === 'CASH' ? Number(amountTendered) : undefined,
      });
      Alert.alert('✅ Order Placed!', `Total: ₱${cartTotal.toFixed(2)}`);
      clearCart();
      setCheckoutModal(false);
      setAmountTendered('');
      setReceipt(result.data);
      fetchProducts();
    } catch (err: any) {
      Alert.alert('Error', err.response?.data?.error || 'Order failed');
    } finally { setPlacing(false); }
  };

  const filteredProducts = products.filter(p => category === 'ALL' || p.category === category);
  const categories = ['ALL', ...new Set(products.map(p => p.category))];

  if (loading) return <View style={s.center}><ActivityIndicator size="large" color={COLORS.primary} /></View>;

  return (
    <View style={s.container}>
      <View style={s.header}>
        <Text style={s.title}>🛒 Point of Sale</Text>
        <View style={s.headerActions}>
          <TouchableOpacity accessibilityLabel="Inventory" style={s.inventoryBtn} onPress={() => navigation.navigate('Inventory')}>
            <Ionicons name="cube-outline" size={17} color={COLORS.primary} />
            <Text style={s.inventoryBtnTxt}>Inventory</Text>
          </TouchableOpacity>
          <TouchableOpacity accessibilityLabel="Top Up Credits" style={s.creditTopupBtn} onPress={() => navigation.navigate('Credits')}>
            <Ionicons name="wallet-outline" size={17} color={COLORS.primary} />
            <Text style={s.inventoryBtnTxt}>Top Up</Text>
          </TouchableOpacity>
          <TouchableOpacity accessibilityLabel="Member Orders" style={s.headerIconBtn} onPress={() => navigation.navigate('MemberOrders')}><Ionicons name="clipboard-outline" size={19} color={COLORS.primary} /></TouchableOpacity>
          <TouchableOpacity accessibilityLabel="Sales History" style={s.headerIconBtn} onPress={() => { setHistoryVisible(true); fetchOrders(); }}><Ionicons name="receipt-outline" size={19} color={COLORS.textPrimary} /></TouchableOpacity>
        </View>
        {cartCount > 0 && (
          <TouchableOpacity style={s.cartBtn} onPress={() => setCheckoutModal(true)}>
            <Ionicons name="cart" size={20} color="#000" />
            <Text style={s.cartBtnTxt}>{cartCount} · ₱{cartTotal.toFixed(0)}</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Category Filter */}
      <ScrollView keyboardShouldPersistTaps="handled" horizontal showsHorizontalScrollIndicator={false} style={s.catScroll} contentContainerStyle={s.catList}>
        {categories.map(cat => (
          <TouchableOpacity key={cat} style={[s.catBtn, category === cat && s.catBtnActive]} onPress={() => setCategory(cat)}>
            <Text style={s.catIcon}>{CATEGORY_ICONS[cat] || '📦'}</Text>
            <Text style={[s.catTxt, category === cat && s.catTxtActive]}>{CATEGORY_LABELS[cat] || cat}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Products Grid */}
      <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled" contentContainerStyle={s.productGrid}>
        {filteredProducts.map((product: any) => {
          const inCart = cart[product.id] || 0;
          const isLowStock = product.stock <= product.lowStockAt;
          const isOutOfStock = product.stock === 0;
          return (
            <View key={product.id} style={[s.productCard, isOutOfStock && s.productCardOut]}>
              <Text style={s.productEmoji}>{CATEGORY_ICONS[product.category] || '📦'}</Text>
              <Text style={s.productName}>{product.name}</Text>
              <Text style={s.productPrice}>₱{product.price.toFixed(2)}</Text>
              <Text style={[s.productStock, isLowStock && s.productStockLow]}>
                {isOutOfStock ? 'Out of stock' : `${product.stock} left${isLowStock ? ' ⚠️' : ''}`}
              </Text>
              {!isOutOfStock && (
                <View style={s.productActions}>
                  {inCart > 0 ? (
                    <View style={s.qtyRow}>
                      <TouchableOpacity style={s.qtyBtn} onPress={() => removeFromCart(product.id)}>
                        <Ionicons name="remove" size={16} color={COLORS.textPrimary} />
                      </TouchableOpacity>
                      <Text style={s.qtyTxt}>{inCart}</Text>
                      <TouchableOpacity disabled={inCart >= product.stock} style={[s.qtyBtn, inCart >= product.stock && s.qtyBtnDisabled]} onPress={() => addToCart(product.id)}>
                        <Ionicons name="add" size={16} color={COLORS.textPrimary} />
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <TouchableOpacity style={s.addBtn} onPress={() => addToCart(product.id)}>
                      <Ionicons name="add" size={18} color="#000" />
                    </TouchableOpacity>
                  )}
                </View>
              )}
            </View>
          );
        })}
      </ScrollView>

      {/* Checkout Modal */}
      <Modal visible={checkoutModal} animationType="slide" onRequestClose={() => setCheckoutModal(false)}>
        <View style={s.modal}>
          <View style={s.modalHeader}>
            <TouchableOpacity onPress={() => setCheckoutModal(false)}>
              <Ionicons name="arrow-back" size={24} color={COLORS.textPrimary} />
            </TouchableOpacity>
            <Text style={s.modalTitle}>Checkout</Text>
            <TouchableOpacity onPress={clearCart}><Text style={s.clearTxt}>Clear</Text></TouchableOpacity>
          </View>

          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={s.modalContent}>
            {/* Cart Items */}
            <Text style={s.sectionTitle}>Order Items</Text>
            {cartItems.map(({ product, qty }) => (
              <View key={product.id} style={s.cartItem}>
                <Text style={s.cartItemEmoji}>{CATEGORY_ICONS[product.category]}</Text>
                <View style={s.cartItemInfo}>
                  <Text style={s.cartItemName}>{product.name}</Text>
                  <Text style={s.cartItemPrice}>₱{product.price.toFixed(2)} × {qty}</Text>
                </View>
                <Text style={s.cartItemTotal}>₱{(product.price * qty).toFixed(2)}</Text>
                <View style={s.qtyRow}>
                  <TouchableOpacity style={s.qtyBtn} onPress={() => removeFromCart(product.id)}>
                    <Ionicons name="remove" size={14} color={COLORS.textPrimary} />
                  </TouchableOpacity>
                  <Text style={s.qtyTxt}>{qty}</Text>
                  <TouchableOpacity disabled={qty >= product.stock} style={[s.qtyBtn, qty >= product.stock && s.qtyBtnDisabled]} onPress={() => addToCart(product.id)}>
                    <Ionicons name="add" size={14} color={COLORS.textPrimary} />
                  </TouchableOpacity>
                </View>
              </View>
            ))}

            <View style={s.totalRow}>
              <Text style={s.totalLabel}>Total</Text>
              <Text style={s.totalValue}>₱{cartTotal.toFixed(2)}</Text>
            </View>

            {/* Member Search */}
            <Text style={s.sectionTitle}>Member (optional)</Text>
            <View style={s.searchRow}>
              <TextInput
                style={s.searchInput}
                placeholder="Username, name, email, or phone..."
                placeholderTextColor={COLORS.textMuted}
                value={memberEmail}
                onChangeText={(t) => { setMemberEmail(t); setFoundMember(null); }}
              />
              <TouchableOpacity style={s.searchBtn} onPress={searchMember}>
                <Ionicons name="search" size={18} color={COLORS.textPrimary} />
              </TouchableOpacity>
            </View>

            {!foundMember && memberResults.length > 0 && (
              <View style={s.searchResults}>
                {memberResults.slice(0, 6).map((m: any) => (
                  <TouchableOpacity
                    key={m.id}
                    style={s.searchResultRow}
                    onPress={() => { setFoundMember(m); setMemberEmail(m.gamifiedProfile?.displayName || m.email); setMemberResults([]); }}
                  >
                    <Ionicons name="person-circle" size={22} color={COLORS.textMuted} />
                    <View style={{ flex: 1 }}>
                      <Text style={s.searchResultName}>
                        {m.gamifiedProfile?.displayName || `${m.firstName} ${m.lastName}`}
                      </Text>
                      <Text style={s.searchResultMeta} numberOfLines={1}>
                        {m.email}{m.phone ? ` · ${m.phone}` : ''}
                      </Text>
                    </View>
                    <Text style={s.searchResultCredits}>{(m.membership?.creditBalance || 0).toFixed(0)}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
            {foundMember && (
              <View style={s.memberFound}>
                <Ionicons name="person-circle" size={28} color={COLORS.primary} />
                <View>
                  <Text style={s.memberName}>{foundMember.firstName} {foundMember.lastName}</Text>
                  <Text style={s.memberCredits}>💳 {foundMember.membership?.creditBalance?.toFixed(0) || 0} credits</Text>
                </View>
              </View>
            )}

            {/* Payment Method */}
            <Text style={s.sectionTitle}>Payment Method</Text>
            <View style={s.paymentMethods}>
              {[
                { key: 'CASH', label: 'Cash', icon: '💵' },
                { key: 'GCASH', label: 'GCash', icon: '📱' },
                { key: 'MAYA', label: 'Maya', icon: '💚' },
                { key: 'CREDITS', label: 'Credits', icon: '💳' },
              ].map(m => (
                <TouchableOpacity key={m.key} style={[s.payMethod, paymentMethod === m.key && s.payMethodActive]} onPress={() => setPaymentMethod(m.key)}>
                  <Text style={s.payMethodIcon}>{m.icon}</Text>
                  <Text style={[s.payMethodTxt, paymentMethod === m.key && s.payMethodTxtActive]}>{m.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {paymentMethod === 'CASH' && (
              <View style={s.tenderBox}>
                <Text style={s.tenderLabel}>Amount Tendered</Text>
                <TextInput style={s.tenderInput} value={amountTendered} onChangeText={setAmountTendered} keyboardType="decimal-pad" placeholder={`At least ₱${cartTotal.toFixed(2)}`} placeholderTextColor={COLORS.textMuted} />
                <Text style={s.changeText}>Change: ₱{Math.max(0, Number(amountTendered || 0) - cartTotal).toFixed(2)}</Text>
              </View>
            )}

            {paymentMethod === 'CREDITS' && !foundMember && (
              <Text style={s.creditsWarning}>⚠️ Search for a member to pay with credits</Text>
            )}

            <TouchableOpacity
              style={[s.placeOrderBtn, (placing || (paymentMethod === 'CREDITS' && !foundMember) || (paymentMethod === 'CASH' && Number(amountTendered) < cartTotal)) && s.placeOrderBtnDis]}
              onPress={placeOrder}
              disabled={placing || (paymentMethod === 'CREDITS' && !foundMember) || (paymentMethod === 'CASH' && Number(amountTendered) < cartTotal)}
            >
              {placing ? <ActivityIndicator color="#000" /> : (
                <Text style={s.placeOrderTxt}>Place Order — ₱{cartTotal.toFixed(2)}</Text>
              )}
            </TouchableOpacity>
          </ScrollView>
        </View>
      </Modal>

      <Modal visible={!!receipt} animationType="slide" onRequestClose={() => setReceipt(null)}>
        <ScrollView style={s.modal} contentContainerStyle={s.modalContent}>
          <View style={s.modalHeader}><Text style={s.modalTitle}>Receipt</Text><TouchableOpacity onPress={() => setReceipt(null)}><Ionicons name="close" size={24} color={COLORS.textPrimary} /></TouchableOpacity></View>
          {receipt && <>
            <Text style={s.receiptBrand}>Saturday Nights Billiard</Text>
            <Text style={s.receiptMeta}>{receipt.receiptNumber} • {new Date(receipt.createdAt).toLocaleString('en-PH')}</Text>
            <Text style={s.receiptMeta}>{receipt.user ? `${receipt.user.firstName} ${receipt.user.lastName}` : 'Walk-In'} • {receipt.paymentMethod === 'LOYALTY_CREDIT' ? 'Credits' : receipt.paymentMethod}</Text>
            {receipt.items?.map((item: any) => <View key={item.id} style={s.receiptLine}><Text style={{ flex: 1, color: COLORS.textPrimary }}>{item.product?.name} × {item.quantity}</Text><Text style={{ color: COLORS.textSecondary }}>₱{(item.price * item.quantity).toFixed(2)}</Text></View>)}
            <View style={s.receiptTotal}><Text style={s.totalLabel}>Total</Text><Text style={s.totalValue}>₱{Number(receipt.total).toFixed(2)}</Text></View>
            {receipt.amountTendered != null && <><Text style={s.receiptMeta}>Tendered: ₱{Number(receipt.amountTendered).toFixed(2)}</Text><Text style={s.receiptMeta}>Change: ₱{Number(receipt.changeDue || 0).toFixed(2)}</Text></>}
            {receipt.status !== 'VOIDED' && <View style={s.voidBox}><Text style={s.tenderLabel}>Void this sale</Text><TextInput style={s.tenderInput} value={voidReason} onChangeText={setVoidReason} placeholder="Required reason" placeholderTextColor={COLORS.textMuted} /><TouchableOpacity disabled={!voidReason.trim() || voiding} style={[s.voidBtn, (!voidReason.trim() || voiding) && s.placeOrderBtnDis]} onPress={voidReceipt}>{voiding ? <ActivityIndicator color={COLORS.error} /> : <Text style={s.voidTxt}>Void and restore stock</Text>}</TouchableOpacity></View>}
            {receipt.status === 'VOIDED' && <Text style={s.voidedText}>VOIDED: {receipt.voidReason}</Text>}
            <TouchableOpacity style={s.placeOrderBtn} onPress={() => setReceipt(null)}><Text style={s.placeOrderTxt}>Done</Text></TouchableOpacity>
          </>}
        </ScrollView>
      </Modal>

      <Modal visible={historyVisible} animationType="slide" onRequestClose={() => setHistoryVisible(false)}>
        <View style={s.modal}>
          <View style={s.modalHeader}><TouchableOpacity onPress={() => setHistoryVisible(false)}><Ionicons name="arrow-back" size={24} color={COLORS.textPrimary} /></TouchableOpacity><Text style={s.modalTitle}>Sales History</Text><TouchableOpacity onPress={fetchOrders}><Ionicons name="refresh" size={22} color={COLORS.primary} /></TouchableOpacity></View>
          <ScrollView contentContainerStyle={s.modalContent}>{historyLoading ? <ActivityIndicator color={COLORS.primary} /> : orders.length === 0 ? <Text style={s.creditsWarning}>No sales yet.</Text> : orders.map((order) => <TouchableOpacity key={order.id} style={s.historyRow} onPress={() => { setReceipt(order); setHistoryVisible(false); }}><View style={{ flex: 1 }}><Text style={s.historyReceipt}>{order.receiptNumber || order.id.slice(0, 8)}</Text><Text style={s.receiptMeta}>{new Date(order.createdAt).toLocaleString('en-PH')} • {order.user ? `${order.user.firstName} ${order.user.lastName}` : order.walkinName || 'Walk-In'}</Text><Text style={[s.historyStatus, order.status === 'VOIDED' && { color: COLORS.error }]}>{order.status} • {order.paymentMethod === 'LOYALTY_CREDIT' ? 'Credits' : order.paymentMethod}</Text></View><Text style={s.historyTotal}>₱{Number(order.total).toFixed(2)}</Text></TouchableOpacity>)}</ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.background },
  header: { paddingTop: 60, paddingHorizontal: 20, paddingBottom: 14, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', rowGap: 10, backgroundColor: COLORS.surface, borderBottomWidth: 1, borderBottomColor: COLORS.surfaceBorder },
  title: { flexShrink: 1, fontSize: 22, fontWeight: '800', color: COLORS.textPrimary },
  headerActions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', alignItems: 'center', gap: 7, flexShrink: 1 },
  inventoryBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, height: 38, paddingHorizontal: 9, borderRadius: 10, justifyContent: 'center', backgroundColor: COLORS.surfaceLight, borderWidth: 1, borderColor: COLORS.primary + '70' },
  inventoryBtnTxt: { color: COLORS.primary, fontSize: 12, fontWeight: '700' },
  creditTopupBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, height: 38, paddingHorizontal: 9, borderRadius: 10, justifyContent: 'center', backgroundColor: COLORS.primary + '12', borderWidth: 1, borderColor: COLORS.primary + '70' },
  headerIconBtn: { width: 38, height: 38, borderRadius: 10, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.surfaceLight, borderWidth: 1, borderColor: COLORS.surfaceBorder },
  cartBtn: { marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: COLORS.primary, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8 },
  cartBtnTxt: { color: '#000', fontWeight: '800', fontSize: 13 },
  catScroll: { maxHeight: 60, backgroundColor: COLORS.surface, borderBottomWidth: 1, borderBottomColor: COLORS.surfaceBorder },
  catList: { paddingHorizontal: 14, paddingVertical: 8, gap: 8, flexDirection: 'row', alignItems: 'center' },
  catBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, borderWidth: 1, borderColor: COLORS.surfaceBorder, backgroundColor: COLORS.surfaceLight, flexDirection: 'row', alignItems: 'center', gap: 4 },
  catBtnActive: { backgroundColor: COLORS.primary + '20', borderColor: COLORS.primary },
  catIcon: { fontSize: 14 },
  catTxt: { fontSize: 12, color: COLORS.textMuted, fontWeight: '600' },
  catTxtActive: { color: COLORS.primary },
  productGrid: { flexDirection: 'row', flexWrap: 'wrap', padding: 12, gap: 10 },
  productCard: { width: '47%', backgroundColor: COLORS.surface, borderRadius: 14, padding: 14, gap: 6, borderWidth: 1, borderColor: COLORS.surfaceBorder },
  productCardOut: { opacity: 0.5 },
  productEmoji: { fontSize: 28 },
  productName: { fontSize: 13, fontWeight: '700', color: COLORS.textPrimary },
  productPrice: { fontSize: 16, fontWeight: '800', color: COLORS.primary },
  productStock: { fontSize: 11, color: COLORS.textMuted },
  productStockLow: { color: COLORS.warning },
  productActions: { marginTop: 4 },
  addBtn: { backgroundColor: COLORS.primary, borderRadius: 8, padding: 8, alignItems: 'center' },
  qtyRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  qtyBtn: { backgroundColor: COLORS.surfaceLight, borderRadius: 6, width: 28, height: 28, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: COLORS.surfaceBorder },
  qtyBtnDisabled: { opacity: 0.35 },
  qtyTxt: { fontSize: 16, fontWeight: '800', color: COLORS.textPrimary, minWidth: 20, textAlign: 'center' },
  modal: { flex: 1, backgroundColor: COLORS.background },
  modalHeader: { paddingTop: 60, paddingHorizontal: 20, paddingBottom: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: COLORS.surface, borderBottomWidth: 1, borderBottomColor: COLORS.surfaceBorder },
  modalTitle: { fontSize: 18, fontWeight: '800', color: COLORS.textPrimary },
  clearTxt: { color: COLORS.error, fontWeight: '600' },
  modalContent: { padding: 16, gap: 12 },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: COLORS.textPrimary, marginTop: 4 },
  cartItem: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: COLORS.surface, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: COLORS.surfaceBorder },
  cartItemEmoji: { fontSize: 22 },
  cartItemInfo: { flex: 1 },
  cartItemName: { fontSize: 14, fontWeight: '600', color: COLORS.textPrimary },
  cartItemPrice: { fontSize: 12, color: COLORS.textMuted },
  cartItemTotal: { fontSize: 14, fontWeight: '700', color: COLORS.primary },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: COLORS.surfaceLight, borderRadius: 12, padding: 16 },
  totalLabel: { fontSize: 16, fontWeight: '700', color: COLORS.textPrimary },
  totalValue: { fontSize: 24, fontWeight: '900', color: COLORS.primary },
  searchRow: { flexDirection: 'row', gap: 10 },
  searchInput: { flex: 1, backgroundColor: COLORS.surface, borderRadius: 10, paddingHorizontal: 14, color: COLORS.textPrimary, height: 46, borderWidth: 1, borderColor: COLORS.surfaceBorder },
  searchBtn: { backgroundColor: COLORS.surface, borderRadius: 10, width: 46, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: COLORS.surfaceBorder },
  searchResults: { backgroundColor: COLORS.surface, borderRadius: 12, borderWidth: 1, borderColor: COLORS.surfaceBorder, overflow: 'hidden' },
  searchResultRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderBottomWidth: 1, borderBottomColor: COLORS.surfaceBorder },
  searchResultName: { fontSize: 13, fontWeight: '700', color: COLORS.textPrimary },
  searchResultMeta: { fontSize: 11, color: COLORS.textMuted },
  searchResultCredits: { fontSize: 12, fontWeight: '800', color: COLORS.primary, minWidth: 40, textAlign: 'right' },
  memberFound: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: COLORS.surfaceLight, borderRadius: 12, padding: 12 },
  memberName: { fontSize: 15, fontWeight: '700', color: COLORS.textPrimary },
  memberCredits: { fontSize: 12, color: COLORS.textSecondary },
  paymentMethods: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  payMethod: { flex: 1, minWidth: '22%', alignItems: 'center', gap: 4, backgroundColor: COLORS.surface, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: COLORS.surfaceBorder },
  payMethodActive: { borderColor: COLORS.primary, backgroundColor: COLORS.primary + '15' },
  payMethodIcon: { fontSize: 20 },
  payMethodTxt: { fontSize: 11, color: COLORS.textMuted, fontWeight: '600' },
  payMethodTxtActive: { color: COLORS.primary },
  creditsWarning: { fontSize: 13, color: COLORS.warning, textAlign: 'center' },
  tenderBox: { gap: 6, padding: 12, backgroundColor: COLORS.surfaceLight, borderRadius: 12, borderWidth: 1, borderColor: COLORS.surfaceBorder },
  tenderLabel: { fontSize: 13, fontWeight: '700', color: COLORS.textSecondary },
  tenderInput: { height: 46, borderRadius: 9, borderWidth: 1, borderColor: COLORS.surfaceBorder, paddingHorizontal: 12, color: COLORS.textPrimary, backgroundColor: COLORS.surface },
  changeText: { color: COLORS.success, fontWeight: '800', textAlign: 'right' },
  receiptBrand: { color: COLORS.primary, fontSize: 20, fontWeight: '900', textAlign: 'center' },
  receiptMeta: { color: COLORS.textMuted, fontSize: 12, textAlign: 'center' },
  receiptLine: { flexDirection: 'row', gap: 12, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: COLORS.surfaceBorder },
  receiptTotal: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 14 },
  historyRow: { flexDirection: 'row', gap: 10, padding: 13, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.surfaceBorder, borderRadius: 12 },
  historyReceipt: { color: COLORS.textPrimary, fontWeight: '800' },
  historyStatus: { color: COLORS.success, fontSize: 11, fontWeight: '700', marginTop: 3 },
  historyTotal: { color: COLORS.primary, fontWeight: '900', alignSelf: 'center' },
  voidBox: { gap: 7, marginTop: 8, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: COLORS.error + '70', backgroundColor: COLORS.error + '10' },
  voidBtn: { height: 44, borderRadius: 10, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: COLORS.error },
  voidTxt: { color: COLORS.error, fontWeight: '800' },
  voidedText: { color: COLORS.error, fontWeight: '800', textAlign: 'center' },
  placeOrderBtn: { backgroundColor: COLORS.primary, borderRadius: 14, height: 54, justifyContent: 'center', alignItems: 'center', marginTop: 8 },
  placeOrderBtnDis: { opacity: 0.5 },
  placeOrderTxt: { color: '#000', fontWeight: '800', fontSize: 16 },
});
