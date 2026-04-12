import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  ActivityIndicator, Alert, Modal, TextInput,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
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

export default function POSScreen() {
  const [products, setProducts] = useState<any[]>([]);
  const [cart, setCart] = useState<Record<string, number>>({});
  const [category, setCategory] = useState('ALL');
  const [loading, setLoading] = useState(true);
  const [checkoutModal, setCheckoutModal] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState('CASH');
  const [memberEmail, setMemberEmail] = useState('');
  const [foundMember, setFoundMember] = useState<any>(null);
  const [placing, setPlacing] = useState(false);

  useEffect(() => { fetchProducts(); }, []);

  const fetchProducts = async () => {
    try {
      const res = await api.get('/api/products');
      setProducts(res.data);
    } catch { Alert.alert('Error', 'Failed to load products'); }
    finally { setLoading(false); }
  };

  const addToCart = (id: string) => setCart(c => ({ ...c, [id]: (c[id] || 0) + 1 }));
  const removeFromCart = (id: string) => setCart(c => {
    const next = { ...c };
    if (next[id] <= 1) delete next[id]; else next[id]--;
    return next;
  });
  const clearCart = () => { setCart({}); setFoundMember(null); setMemberEmail(''); };

  const cartItems = Object.entries(cart).map(([id, qty]) => ({
    product: products.find(p => p.id === id)!, qty,
  })).filter(i => i.product);

  const cartTotal = cartItems.reduce((s, i) => s + i.product.price * i.qty, 0);
  const cartCount = Object.values(cart).reduce((s, v) => s + v, 0);

  const searchMember = async () => {
    if (!memberEmail.trim()) return;
    try {
      const res = await api.get('/api/users');
      const found = res.data.find((u: any) => u.email.toLowerCase().includes(memberEmail.toLowerCase()));
      if (found) setFoundMember(found);
      else Alert.alert('Not Found', 'No member with that email');
    } catch { Alert.alert('Error', 'Search failed'); }
  };

  const placeOrder = async () => {
    if (cartItems.length === 0) return;
    setPlacing(true);
    try {
      await api.post('/api/orders', {
        items: cartItems.map(i => ({ productId: i.product.id, quantity: i.qty })),
        userId: foundMember?.id || null,
        paymentMethod,
        paidWithCredits: paymentMethod === 'CREDITS',
      });
      Alert.alert('✅ Order Placed!', `Total: ₱${cartTotal.toFixed(2)}`);
      clearCart();
      setCheckoutModal(false);
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
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={s.productGrid}>
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
                      <TouchableOpacity style={s.qtyBtn} onPress={() => addToCart(product.id)}>
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
      <Modal visible={checkoutModal} animationType="slide">
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
                  <TouchableOpacity style={s.qtyBtn} onPress={() => addToCart(product.id)}>
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
              <TextInput style={s.searchInput} placeholder="Member email..." placeholderTextColor={COLORS.textMuted} value={memberEmail} onChangeText={setMemberEmail} />
              <TouchableOpacity style={s.searchBtn} onPress={searchMember}>
                <Ionicons name="search" size={18} color={COLORS.textPrimary} />
              </TouchableOpacity>
            </View>
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

            {paymentMethod === 'CREDITS' && !foundMember && (
              <Text style={s.creditsWarning}>⚠️ Search for a member to pay with credits</Text>
            )}

            <TouchableOpacity
              style={[s.placeOrderBtn, (placing || (paymentMethod === 'CREDITS' && !foundMember)) && s.placeOrderBtnDis]}
              onPress={placeOrder}
              disabled={placing || (paymentMethod === 'CREDITS' && !foundMember)}
            >
              {placing ? <ActivityIndicator color="#000" /> : (
                <Text style={s.placeOrderTxt}>Place Order — ₱{cartTotal.toFixed(2)}</Text>
              )}
            </TouchableOpacity>
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.background },
  header: { paddingTop: 60, paddingHorizontal: 20, paddingBottom: 14, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: COLORS.surface, borderBottomWidth: 1, borderBottomColor: COLORS.surfaceBorder },
  title: { fontSize: 22, fontWeight: '800', color: COLORS.textPrimary },
  cartBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: COLORS.primary, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8 },
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
  placeOrderBtn: { backgroundColor: COLORS.primary, borderRadius: 14, height: 54, justifyContent: 'center', alignItems: 'center', marginTop: 8 },
  placeOrderBtnDis: { opacity: 0.5 },
  placeOrderTxt: { color: '#000', fontWeight: '800', fontSize: 16 },
});
