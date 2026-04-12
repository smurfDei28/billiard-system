// InventoryScreen.tsx
import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, ActivityIndicator, Alert, Modal, TextInput, RefreshControl } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../../context/AuthContext';
import { COLORS } from '../../constants';

const CATEGORIES = ['RICE_MEAL','DRINKS','ALCOHOLIC_BEVERAGES','COFFEE','BILLIARD_EQUIPMENT','SNACKS'];
const CAT_LABELS: Record<string,string> = { RICE_MEAL:'Rice Meal', DRINKS:'Drinks', ALCOHOLIC_BEVERAGES:'Alcohol', COFFEE:'Coffee', BILLIARD_EQUIPMENT:'Equipment', SNACKS:'Snacks' };
const CAT_ICONS: Record<string,string> = { RICE_MEAL:'🍚', DRINKS:'🥤', ALCOHOLIC_BEVERAGES:'🍺', COFFEE:'☕', BILLIARD_EQUIPMENT:'🎱', SNACKS:'🍟' };

export default function InventoryScreen() {
  const [data, setData] = useState<any>({ products: [], lowStock: [] });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [modal, setModal] = useState<any>(null); // { product, type: 'add'|'minus'|'new' }
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('RESTOCK');
  const [newForm, setNewForm] = useState({ name:'', category:'DRINKS', price:'', stock:'', lowStockAt:'5' });
  const [saving, setSaving] = useState(false);

  const fetchData = useCallback(async () => {
    try { const r = await api.get('/api/products/inventory'); setData(r.data); }
    catch {} finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => { fetchData(); }, []);

  const updateStock = async () => {
    if (!amount || isNaN(Number(amount))) return Alert.alert('Error', 'Enter a valid number');
    setSaving(true);
    try {
      const change = modal.type === 'add' ? parseInt(amount) : -parseInt(amount);
      await api.patch(`/api/products/${modal.product.id}/stock`, { change, reason });
      fetchData(); setModal(null); setAmount('');
    } catch (err: any) { Alert.alert('Error', err.response?.data?.error || 'Failed'); }
    finally { setSaving(false); }
  };

  const createProduct = async () => {
    if (!newForm.name || !newForm.price) return Alert.alert('Error', 'Name and price required');
    setSaving(true);
    try {
      await api.post('/api/products', { ...newForm, price: parseFloat(newForm.price), stock: parseInt(newForm.stock||'0'), lowStockAt: parseInt(newForm.lowStockAt||'5') });
      fetchData(); setModal(null);
    } catch (err: any) { Alert.alert('Error', err.response?.data?.error || 'Failed'); }
    finally { setSaving(false); }
  };

  if (loading) return <View style={s.center}><ActivityIndicator size="large" color={COLORS.primary} /></View>;

  return (
    <View style={s.container}>
      <View style={s.header}>
        <View>
          <Text style={s.title}>📦 Inventory</Text>
          {data.lowStockCount > 0 && <Text style={s.lowStockAlert}>⚠️ {data.lowStockCount} items low on stock</Text>}
        </View>
        <TouchableOpacity style={s.addBtn} onPress={() => setModal({ type: 'new' })}>
          <Ionicons name="add" size={20} color="#000" />
          <Text style={s.addBtnTxt}>Add Product</Text>
        </TouchableOpacity>
      </View>

      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={s.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchData(); }} tintColor={COLORS.primary} />}>
        {data.lowStock?.length > 0 && (
          <>
            <Text style={s.sectionTitle}>⚠️ Low Stock Alerts</Text>
            {data.lowStock.map((p: any) => (
              <View key={p.id} style={[s.productRow, s.productRowLow]}>
                <Text style={s.productEmoji}>{CAT_ICONS[p.category]||'📦'}</Text>
                <View style={s.productInfo}><Text style={s.productName}>{p.name}</Text><Text style={s.productCat}>{CAT_LABELS[p.category]||p.category}</Text></View>
                <Text style={[s.productStock, s.stockLow]}>{p.stock} left</Text>
                <TouchableOpacity style={s.stockAddBtn} onPress={() => { setModal({ product: p, type: 'add' }); setAmount(''); }}>
                  <Ionicons name="add" size={16} color={COLORS.primary} />
                </TouchableOpacity>
              </View>
            ))}
          </>
        )}

        {CATEGORIES.map(cat => {
          const items = data.products?.filter((p: any) => p.category === cat);
          if (!items?.length) return null;
          return (
            <View key={cat}>
              <Text style={s.sectionTitle}>{CAT_ICONS[cat]} {CAT_LABELS[cat]}</Text>
              {items.map((p: any) => (
                <View key={p.id} style={s.productRow}>
                  <Text style={s.productEmoji}>{CAT_ICONS[p.category]}</Text>
                  <View style={s.productInfo}>
                    <Text style={s.productName}>{p.name}</Text>
                    <Text style={s.productPrice}>₱{p.price.toFixed(2)}</Text>
                  </View>
                  <Text style={[s.productStock, p.stock <= p.lowStockAt && s.stockLow]}>{p.stock}</Text>
                  <View style={s.stockBtns}>
                    <TouchableOpacity style={s.stockBtn} onPress={() => { setModal({ product: p, type: 'minus' }); setAmount(''); }}>
                      <Ionicons name="remove" size={14} color={COLORS.error} />
                    </TouchableOpacity>
                    <TouchableOpacity style={s.stockBtn} onPress={() => { setModal({ product: p, type: 'add' }); setAmount(''); }}>
                      <Ionicons name="add" size={14} color={COLORS.success} />
                    </TouchableOpacity>
                  </View>
                </View>
              ))}
            </View>
          );
        })}
      </ScrollView>

      {/* Stock Modal */}
      <Modal visible={!!modal && modal.type !== 'new'} transparent animationType="slide">
        <View style={s.overlay}>
          <View style={s.modalBox}>
            <Text style={s.modalTitle}>{modal?.type === 'add' ? '➕ Add Stock' : '➖ Remove Stock'}</Text>
            <Text style={s.modalSub}>{modal?.product?.name}</Text>
            <Text style={s.modalSub2}>Current stock: {modal?.product?.stock}</Text>
            <TextInput style={s.input} placeholder="Quantity" placeholderTextColor={COLORS.textMuted} value={amount} onChangeText={setAmount} keyboardType="numeric" />
            <Text style={s.label}>Reason</Text>
            <View style={s.reasonRow}>
              {(modal?.type === 'add' ? ['RESTOCK','ADJUSTMENT'] : ['SALE','DAMAGE','ADJUSTMENT']).map(r => (
                <TouchableOpacity key={r} style={[s.reasonBtn, reason === r && s.reasonBtnActive]} onPress={() => setReason(r)}>
                  <Text style={[s.reasonTxt, reason === r && s.reasonTxtActive]}>{r}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={s.modalBtns}>
              <TouchableOpacity style={s.cancelBtn} onPress={() => setModal(null)}><Text style={s.cancelTxt}>Cancel</Text></TouchableOpacity>
              <TouchableOpacity style={s.confirmBtn} onPress={updateStock} disabled={saving}>
                {saving ? <ActivityIndicator color="#000" size="small" /> : <Text style={s.confirmTxt}>Confirm</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* New Product Modal */}
      <Modal visible={!!modal && modal.type === 'new'} animationType="slide">
        <View style={s.newModal}>
          <View style={s.newModalHeader}>
            <TouchableOpacity onPress={() => setModal(null)}><Ionicons name="close" size={24} color={COLORS.textPrimary} /></TouchableOpacity>
            <Text style={s.modalTitle}>Add New Product</Text>
            <View style={{ width: 24 }} />
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={s.newModalContent}>
            {[['Name','name','default'],['Price (₱)','price','decimal-pad'],['Initial Stock','stock','numeric'],['Low Stock Alert At','lowStockAt','numeric']].map(([label,field,kb]) => (
              <View key={field} style={s.fieldGroup}>
                <Text style={s.label}>{label}</Text>
                <TextInput style={s.input} placeholder={label} placeholderTextColor={COLORS.textMuted} value={newForm[field as keyof typeof newForm]} onChangeText={v => setNewForm(f => ({ ...f, [field]: v }))} keyboardType={kb as any} />
              </View>
            ))}
            <Text style={s.label}>Category</Text>
            <View style={s.catGrid}>
              {CATEGORIES.map(c => (
                <TouchableOpacity key={c} style={[s.catBtn, newForm.category === c && s.catBtnActive]} onPress={() => setNewForm(f => ({ ...f, category: c }))}>
                  <Text style={s.catBtnIcon}>{CAT_ICONS[c]}</Text>
                  <Text style={[s.catBtnTxt, newForm.category === c && s.catBtnTxtActive]}>{CAT_LABELS[c]}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TouchableOpacity style={s.confirmBtn} onPress={createProduct} disabled={saving}>
              {saving ? <ActivityIndicator color="#000" /> : <Text style={s.confirmTxt}>Add Product</Text>}
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
  lowStockAlert: { fontSize: 12, color: COLORS.warning, marginTop: 2 },
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: COLORS.primary, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  addBtnTxt: { color: '#000', fontWeight: '700', fontSize: 13 },
  content: { padding: 16, gap: 10 },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: COLORS.textSecondary, marginTop: 8 },
  productRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: COLORS.surface, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: COLORS.surfaceBorder },
  productRowLow: { borderColor: COLORS.warning + '50' },
  productEmoji: { fontSize: 22 },
  productInfo: { flex: 1 },
  productName: { fontSize: 14, fontWeight: '600', color: COLORS.textPrimary },
  productCat: { fontSize: 11, color: COLORS.textMuted },
  productPrice: { fontSize: 12, color: COLORS.primary },
  productStock: { fontSize: 16, fontWeight: '800', color: COLORS.textPrimary, minWidth: 36, textAlign: 'center' },
  stockLow: { color: COLORS.warning },
  stockBtns: { flexDirection: 'row', gap: 6 },
  stockBtn: { width: 30, height: 30, borderRadius: 8, backgroundColor: COLORS.surfaceLight, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: COLORS.surfaceBorder },
  stockAddBtn: { width: 30, height: 30, borderRadius: 8, backgroundColor: COLORS.primary + '20', justifyContent: 'center', alignItems: 'center' },
  overlay: { flex: 1, backgroundColor: '#000000AA', justifyContent: 'flex-end' },
  modalBox: { backgroundColor: COLORS.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, gap: 12 },
  modalTitle: { fontSize: 18, fontWeight: '800', color: COLORS.textPrimary },
  modalSub: { fontSize: 15, color: COLORS.textSecondary },
  modalSub2: { fontSize: 13, color: COLORS.textMuted },
  input: { backgroundColor: COLORS.surfaceLight, borderRadius: 10, paddingHorizontal: 14, height: 46, color: COLORS.textPrimary, borderWidth: 1, borderColor: COLORS.surfaceBorder, fontSize: 15 },
  label: { fontSize: 13, fontWeight: '600', color: COLORS.textSecondary },
  reasonRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  reasonBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: COLORS.surfaceLight, borderWidth: 1, borderColor: COLORS.surfaceBorder },
  reasonBtnActive: { backgroundColor: COLORS.primary + '20', borderColor: COLORS.primary },
  reasonTxt: { fontSize: 12, color: COLORS.textMuted, fontWeight: '600' },
  reasonTxtActive: { color: COLORS.primary },
  modalBtns: { flexDirection: 'row', gap: 10 },
  cancelBtn: { flex: 1, backgroundColor: COLORS.surfaceLight, borderRadius: 12, padding: 14, alignItems: 'center' },
  cancelTxt: { color: COLORS.textPrimary, fontWeight: '700' },
  confirmBtn: { flex: 1, backgroundColor: COLORS.primary, borderRadius: 12, padding: 14, alignItems: 'center' },
  confirmTxt: { color: '#000', fontWeight: '700' },
  newModal: { flex: 1, backgroundColor: COLORS.background },
  newModalHeader: { paddingTop: 60, paddingHorizontal: 20, paddingBottom: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: COLORS.surface, borderBottomWidth: 1, borderBottomColor: COLORS.surfaceBorder },
  newModalContent: { padding: 16, gap: 12 },
  fieldGroup: { gap: 6 },
  catGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  catBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: COLORS.surfaceBorder, backgroundColor: COLORS.surface, flexDirection: 'row', alignItems: 'center', gap: 4 },
  catBtnActive: { borderColor: COLORS.primary, backgroundColor: COLORS.primary + '15' },
  catBtnIcon: { fontSize: 14 },
  catBtnTxt: { fontSize: 12, color: COLORS.textMuted, fontWeight: '600' },
  catBtnTxtActive: { color: COLORS.primary },
});
