// InventoryScreen.tsx
import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, ActivityIndicator, Alert, Modal, TextInput, RefreshControl, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { api, getAccessToken } from '../../context/AuthContext';
import { API_URL, COLORS } from '../../constants';

const CATEGORIES = ['RICE_MEAL','DRINKS','ALCOHOLIC_BEVERAGES','COFFEE','BILLIARD_EQUIPMENT','SNACKS'];
const CAT_LABELS: Record<string,string> = { RICE_MEAL:'Rice Meal', DRINKS:'Drinks', ALCOHOLIC_BEVERAGES:'Alcohol', COFFEE:'Coffee', BILLIARD_EQUIPMENT:'Equipment', SNACKS:'Snacks' };
const CAT_ICONS: Record<string,string> = { RICE_MEAL:'🍚', DRINKS:'🥤', ALCOHOLIC_BEVERAGES:'🍺', COFFEE:'☕', BILLIARD_EQUIPMENT:'🎱', SNACKS:'🍟' };
const storedImageSource = (url?: string) => url ? { uri: /^https?:\/\//i.test(url) ? url : `${API_URL}${url}` } : null;

export default function InventoryScreen() {
  const [data, setData] = useState<any>({ products: [], lowStock: [] });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [modal, setModal] = useState<any>(null); // { product, type: 'add'|'minus'|'new' }
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('RESTOCK');
  const [newForm, setNewForm] = useState({ name:'', category:'DRINKS', price:'', costPrice:'', stock:'', lowStockAt:'5' });
  const [editingProduct, setEditingProduct] = useState<any>(null);
  const [editForm, setEditForm] = useState({ name:'', category:'DRINKS', price:'', costPrice:'', lowStockAt:'5' });
  const [statusProduct, setStatusProduct] = useState<any>(null);
  const [newImage, setNewImage] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [editImage, setEditImage] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [saving, setSaving] = useState(false);

  const fetchData = useCallback(async () => {
    try { const r = await api.get('/api/products/inventory'); setData(r.data); }
    catch {} finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => { fetchData(); }, []);

  const chooseProductImage = async (target: 'new' | 'edit', camera = false) => {
    const permission = camera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return Alert.alert('Permission needed', `Allow ${camera ? 'camera' : 'photo library'} access to choose a product photo.`);
    const result = camera
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.8, allowsEditing: true, aspect: [4, 3] })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.8, allowsEditing: true, aspect: [4, 3] });
    if (!result.canceled && result.assets?.[0]) (target === 'new' ? setNewImage : setEditImage)(result.assets[0]);
  };

  const uploadProductImage = async (productId: string, image: ImagePicker.ImagePickerAsset) => {
    const token = await getAccessToken();
    const form = new FormData();
    form.append('image', {
      uri: image.uri,
      name: image.fileName || `product-${Date.now()}.jpg`,
      type: image.mimeType || 'image/jpeg',
    } as any);
    const response = await fetch(`${API_URL}/api/products/${encodeURIComponent(productId)}/image`, {
      method: 'POST',
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: form,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'Could not upload the product image.');
    return payload;
  };

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
    if (!newImage) return Alert.alert('Product photo required', 'Choose a photo that shows this exact product before adding it.');
    setSaving(true);
    try {
      const created = await api.post('/api/products', { ...newForm, price: parseFloat(newForm.price), costPrice: parseFloat(newForm.costPrice || '0'), stock: parseInt(newForm.stock||'0'), lowStockAt: parseInt(newForm.lowStockAt||'5') });
      try {
        await uploadProductImage(created.data.id, newImage);
      } catch (imageError: any) {
        setModal(null); setNewImage(null); fetchData();
        return Alert.alert('Product created without photo', `${imageError.message}\n\nOpen this product with Edit / Photo to retry the upload. The product was not duplicated.`);
      }
      setNewImage(null); setNewForm({ name:'', category:'DRINKS', price:'', costPrice:'', stock:'', lowStockAt:'5' });
      fetchData(); setModal(null);
    } catch (err: any) { Alert.alert('Error', err.response?.data?.error || 'Failed'); }
    finally { setSaving(false); }
  };

  const openEditProduct = (product: any) => {
    setEditingProduct(product);
    setEditImage(null);
    setEditForm({ name: product.name, category: product.category, price: String(product.price), costPrice: String(product.costPrice || 0), lowStockAt: String(product.lowStockAt) });
  };

  const saveProduct = async () => {
    if (!editingProduct || !editForm.name.trim() || !editForm.price) return Alert.alert('Error', 'Name and selling price are required.');
    if (!editingProduct.imageUrl && !editImage) return Alert.alert('Product photo required', 'Choose a photo that shows this exact product.');
    setSaving(true);
    try {
      await api.patch(`/api/products/${editingProduct.id}`, {
        name: editForm.name.trim(), category: editForm.category, price: Number(editForm.price), costPrice: Number(editForm.costPrice || 0), lowStockAt: Number(editForm.lowStockAt),
      });
      if (editImage) await uploadProductImage(editingProduct.id, editImage);
      setEditImage(null);
      setEditingProduct(null);
      fetchData();
    } catch (err: any) { Alert.alert('Could not save product', err.response?.data?.error || 'Please check the product details.'); }
    finally { setSaving(false); }
  };

  const updateProductStatus = async () => {
    if (!statusProduct) return;
    setSaving(true);
    try {
      await api.patch(`/api/products/${statusProduct.id}/active`, { isActive: !statusProduct.isActive });
      setStatusProduct(null);
      fetchData();
    } catch (err: any) { Alert.alert('Could not update product', err.response?.data?.error || 'Please try again.'); }
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
        <TouchableOpacity accessibilityLabel="Add Product" style={s.addBtn} onPress={() => { setNewImage(null); setModal({ type: 'new' }); }}>
          <Ionicons name="add" size={20} color="#000" />
          <Text style={s.addBtnTxt}>Add Product</Text>
        </TouchableOpacity>
      </View>

      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={s.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchData(); }} tintColor={COLORS.primary} />}>
        <View style={s.summaryRow}>
          <Summary value={data.totalProducts || 0} label="Products" color={COLORS.info} />
          <Summary value={data.lowStockCount || 0} label="Low Stock" color={COLORS.warning} />
          <Summary value={data.outOfStockCount || 0} label="Out" color={COLORS.error} />
          <Summary value={`₱${Number(data.inventoryValue || 0).toFixed(0)}`} label="Cost Value" color={COLORS.success} />
        </View>
        {data.lowStock?.length > 0 && (
          <>
            <Text style={s.sectionTitle}>⚠️ Low Stock Alerts</Text>
            {data.lowStock.map((p: any) => (
              <View key={p.id} style={[s.productRow, s.productRowLow]}>
                {p.imageUrl ? <Image source={storedImageSource(p.imageUrl)!} style={s.productThumb} /> : <Text style={s.productEmoji}>{CAT_ICONS[p.category]||'📦'}</Text>}
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
                <React.Fragment key={p.id}>
                <View style={s.productRow}>
                  {p.imageUrl ? <Image source={storedImageSource(p.imageUrl)!} style={s.productThumb} /> : <View style={s.missingPhoto}><Ionicons name="image-outline" size={19} color={COLORS.textMuted} /></View>}
                  <View style={s.productInfo}>
                    <Text style={s.productName}>{p.name}</Text>
                    {!p.isActive && <Text style={s.inactiveBadge}>Inactive</Text>}
                    <Text style={s.productPrice}>Sell ₱{p.price.toFixed(2)} • Cost ₱{Number(p.costPrice || 0).toFixed(2)}</Text>
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
                {p.stockHistory?.[0] && <Text style={s.movementHint}>Latest movement: {p.stockHistory[0].change > 0 ? '+' : ''}{p.stockHistory[0].change} • {p.stockHistory[0].reason} • {new Date(p.stockHistory[0].createdAt).toLocaleDateString('en-PH')}</Text>}
                <View style={s.productActions}>
                  <TouchableOpacity accessibilityLabel="Edit Product and Photo" style={s.editBtn} onPress={() => openEditProduct(p)}><Ionicons name="pencil-outline" size={15} color={COLORS.primary} /><Text style={s.editBtnTxt}>Edit / Photo</Text></TouchableOpacity>
                  <TouchableOpacity accessibilityLabel={p.isActive ? 'Deactivate Product' : 'Reactivate Product'} style={[s.statusBtn, p.isActive ? s.deactivateBtn : s.reactivateBtn]} onPress={() => setStatusProduct(p)}><Text style={[s.statusBtnTxt, p.isActive ? s.deactivateBtnTxt : s.reactivateBtnTxt]}>{p.isActive ? 'Deactivate' : 'Reactivate'}</Text></TouchableOpacity>
                </View>
                </React.Fragment>
              ))}
            </View>
          );
        })}
      </ScrollView>

      {/* Stock Modal */}
      <Modal visible={!!modal && modal.type !== 'new'} transparent animationType="slide" onRequestClose={() => setModal(null)}>
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
      <Modal visible={!!modal && modal.type === 'new'} animationType="slide" onRequestClose={() => setModal(null)}>
        <View style={s.newModal}>
          <View style={s.newModalHeader}>
            <TouchableOpacity onPress={() => setModal(null)}><Ionicons name="close" size={24} color={COLORS.textPrimary} /></TouchableOpacity>
            <Text style={s.modalTitle}>Add New Product</Text>
            <View style={{ width: 24 }} />
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={s.newModalContent}>
            <ProductImagePicker
              source={newImage ? { uri: newImage.uri } : null}
              onGallery={() => chooseProductImage('new')}
              onCamera={() => chooseProductImage('new', true)}
            />
            {[['Name','name','default'],['Selling Price (₱)','price','decimal-pad'],['Cost Price (₱)','costPrice','decimal-pad'],['Initial Stock','stock','numeric'],['Low Stock Alert At','lowStockAt','numeric']].map(([label,field,kb]) => (
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

      <Modal visible={!!editingProduct} animationType="slide" onRequestClose={() => setEditingProduct(null)}>
        <View style={s.newModal}>
          <View style={s.newModalHeader}>
            <TouchableOpacity accessibilityLabel="Cancel Edit Product" onPress={() => setEditingProduct(null)}><Ionicons name="close" size={24} color={COLORS.textPrimary} /></TouchableOpacity>
            <Text style={s.modalTitle}>Edit Product</Text>
            <View style={{ width: 24 }} />
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={s.newModalContent}>
            <ProductImagePicker
              source={editImage ? { uri: editImage.uri } : storedImageSource(editingProduct?.imageUrl)}
              onGallery={() => chooseProductImage('edit')}
              onCamera={() => chooseProductImage('edit', true)}
            />
            {[['Product Name','name','default'],['Selling Price (PHP)','price','decimal-pad'],['Cost Price (PHP)','costPrice','decimal-pad'],['Low Stock Alert At','lowStockAt','numeric']].map(([label,field,kb]) => (
              <View key={field} style={s.fieldGroup}>
                <Text style={s.label}>{label}</Text>
                <TextInput style={s.input} placeholder={label} placeholderTextColor={COLORS.textMuted} value={editForm[field as keyof typeof editForm]} onChangeText={v => setEditForm(f => ({ ...f, [field]: v }))} keyboardType={kb as any} />
              </View>
            ))}
            <Text style={s.label}>Category</Text>
            <View style={s.catGrid}>
              {CATEGORIES.map(c => <TouchableOpacity key={c} style={[s.catBtn, editForm.category === c && s.catBtnActive]} onPress={() => setEditForm(f => ({ ...f, category: c }))}><Text style={s.catBtnIcon}>{CAT_ICONS[c]}</Text><Text style={[s.catBtnTxt, editForm.category === c && s.catBtnTxtActive]}>{CAT_LABELS[c]}</Text></TouchableOpacity>)}
            </View>
            <View style={s.readOnlyStock}><Text style={s.label}>Current Stock</Text><Text style={s.readOnlyStockValue}>{editingProduct?.stock ?? 0}</Text><Text style={s.readOnlyHint}>Use Restock or Adjustment to change stock.</Text></View>
            <View style={s.modalBtns}>
              <TouchableOpacity style={s.cancelBtn} onPress={() => setEditingProduct(null)}><Text style={s.cancelTxt}>Cancel</Text></TouchableOpacity>
              <TouchableOpacity style={s.confirmBtn} onPress={saveProduct} disabled={saving}>{saving ? <ActivityIndicator color="#000" /> : <Text style={s.confirmTxt}>Save Changes</Text>}</TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </Modal>

      <Modal visible={!!statusProduct} transparent animationType="fade" onRequestClose={() => setStatusProduct(null)}>
        <View style={s.overlay}>
          <View style={s.modalBox}>
            <Text style={s.modalTitle}>{statusProduct?.isActive ? 'Deactivate Product?' : 'Reactivate Product?'}</Text>
            <Text style={s.modalSub}>{statusProduct?.isActive ? `${statusProduct?.name} will no longer be available for new purchases. Existing orders and stock history will remain.` : `${statusProduct?.name} will become available for new purchases again.`}</Text>
            <View style={s.modalBtns}>
              <TouchableOpacity style={s.cancelBtn} onPress={() => setStatusProduct(null)}><Text style={s.cancelTxt}>Cancel</Text></TouchableOpacity>
              <TouchableOpacity style={[s.confirmBtn, statusProduct?.isActive && s.confirmDeactivateBtn]} onPress={updateProductStatus} disabled={saving}>{saving ? <ActivityIndicator color="#000" /> : <Text style={s.confirmTxt}>{statusProduct?.isActive ? 'Deactivate' : 'Reactivate'}</Text>}</TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const Summary = ({ value, label, color }: any) => (
  <View style={[s.summaryCard, { borderColor: color + '55' }]}>
    <Text style={[s.summaryValue, { color }]}>{value}</Text>
    <Text style={s.summaryLabel}>{label}</Text>
  </View>
);

const ProductImagePicker = ({ source, onGallery, onCamera }: any) => (
  <View style={s.imageEditor}>
    <Text style={s.label}>Product Photo</Text>
    <Text style={s.imageHint}>Use a clear photo of this exact item—not a category photo.</Text>
    {source ? <Image source={source} style={s.imagePreview} resizeMode="cover" /> : <View style={s.imagePlaceholder}><Ionicons name="image-outline" size={34} color={COLORS.textMuted} /><Text style={s.imagePlaceholderText}>No product photo</Text></View>}
    <View style={s.imageActions}>
      <TouchableOpacity style={s.imageButton} onPress={onGallery}><Ionicons name="images-outline" size={17} color={COLORS.primary} /><Text style={s.imageButtonText}>Gallery</Text></TouchableOpacity>
      <TouchableOpacity style={s.imageButton} onPress={onCamera}><Ionicons name="camera-outline" size={17} color={COLORS.primary} /><Text style={s.imageButtonText}>Camera</Text></TouchableOpacity>
    </View>
  </View>
);

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.background },
  header: { paddingTop: 60, paddingHorizontal: 20, paddingBottom: 14, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: COLORS.surface, borderBottomWidth: 1, borderBottomColor: COLORS.surfaceBorder },
  title: { fontSize: 22, fontWeight: '800', color: COLORS.textPrimary },
  lowStockAlert: { fontSize: 12, color: COLORS.warning, marginTop: 2 },
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: COLORS.primary, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  addBtnTxt: { color: '#000', fontWeight: '700', fontSize: 13 },
  productThumb: { width: 46, height: 46, borderRadius: 9, backgroundColor: COLORS.surfaceLight },
  missingPhoto: { width: 46, height: 46, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.surfaceLight, borderWidth: 1, borderColor: COLORS.surfaceBorder },
  imageEditor: { gap: 8, padding: 12, borderRadius: 12, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.surfaceBorder },
  imageHint: { color: COLORS.textMuted, fontSize: 12, lineHeight: 17 },
  imagePreview: { width: '100%', height: 180, borderRadius: 11, backgroundColor: COLORS.surfaceLight },
  imagePlaceholder: { height: 130, borderRadius: 11, alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: COLORS.surfaceLight, borderWidth: 1, borderStyle: 'dashed', borderColor: COLORS.textMuted },
  imagePlaceholderText: { color: COLORS.textMuted, fontSize: 12 },
  imageActions: { flexDirection: 'row', gap: 8 },
  imageButton: { flex: 1, minHeight: 42, borderRadius: 9, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: COLORS.primary + '14', borderWidth: 1, borderColor: COLORS.primary + '55' },
  imageButtonText: { color: COLORS.primary, fontWeight: '700', fontSize: 12 },
  content: { padding: 16, gap: 10 },
  summaryRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  summaryCard: { width: '47%', backgroundColor: COLORS.surface, borderRadius: 12, padding: 12, borderWidth: 1 },
  summaryValue: { fontSize: 18, fontWeight: '900' },
  summaryLabel: { fontSize: 10, color: COLORS.textMuted, marginTop: 2 },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: COLORS.textSecondary, marginTop: 8 },
  productRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: COLORS.surface, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: COLORS.surfaceBorder },
  productRowLow: { borderColor: COLORS.warning + '50' },
  productEmoji: { fontSize: 22 },
  productInfo: { flex: 1 },
  productName: { fontSize: 14, fontWeight: '600', color: COLORS.textPrimary },
  productCat: { fontSize: 11, color: COLORS.textMuted },
  productPrice: { fontSize: 12, color: COLORS.primary },
  inactiveBadge: { alignSelf: 'flex-start', marginTop: 4, borderRadius: 8, paddingHorizontal: 7, paddingVertical: 2, backgroundColor: COLORS.textMuted + '22', color: COLORS.textMuted, fontSize: 10, fontWeight: '800' },
  productStock: { fontSize: 16, fontWeight: '800', color: COLORS.textPrimary, minWidth: 36, textAlign: 'center' },
  stockLow: { color: COLORS.warning },
  movementHint: { color: COLORS.textMuted, fontSize: 10, marginTop: -5, marginLeft: 12 },
  productActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 6, marginBottom: 4 },
  editBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: COLORS.primary + '18', borderWidth: 1, borderColor: COLORS.primary + '55' },
  editBtnTxt: { color: COLORS.primary, fontSize: 12, fontWeight: '700' },
  statusBtn: { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1 },
  statusBtnTxt: { fontSize: 12, fontWeight: '700' },
  deactivateBtn: { backgroundColor: COLORS.error + '12', borderColor: COLORS.error + '70' },
  deactivateBtnTxt: { color: COLORS.error },
  reactivateBtn: { backgroundColor: COLORS.success + '12', borderColor: COLORS.success + '70' },
  reactivateBtnTxt: { color: COLORS.success },
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
  readOnlyStock: { gap: 5, padding: 12, borderRadius: 10, backgroundColor: COLORS.surfaceLight, borderWidth: 1, borderColor: COLORS.surfaceBorder },
  readOnlyStockValue: { color: COLORS.textPrimary, fontSize: 20, fontWeight: '800' },
  readOnlyHint: { color: COLORS.textMuted, fontSize: 12 },
  confirmDeactivateBtn: { backgroundColor: COLORS.error },
  fieldGroup: { gap: 6 },
  catGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  catBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: COLORS.surfaceBorder, backgroundColor: COLORS.surface, flexDirection: 'row', alignItems: 'center', gap: 4 },
  catBtnActive: { borderColor: COLORS.primary, backgroundColor: COLORS.primary + '15' },
  catBtnIcon: { fontSize: 14 },
  catBtnTxt: { fontSize: 12, color: COLORS.textMuted, fontWeight: '600' },
  catBtnTxtActive: { color: COLORS.primary },
});
