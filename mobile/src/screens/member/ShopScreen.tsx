import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { api } from "../../context/AuthContext";
import { COLORS } from "../../constants";
import { formatCredits, normalizeCreditBalance } from "../../utils/credits";
import GCashSandboxSheet from "../../components/GCashSandboxSheet";

const pretty = (v: string) =>
  v.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
const key = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;
export default function ShopScreen({ navigation }: any) {
  const [products, setProducts] = useState<any[]>([]),
    [cart, setCart] = useState<Record<string, number>>({}),
    [q, setQ] = useState(""),
    [cat, setCat] = useState("ALL"),
    [busy, setBusy] = useState(false),
    [cartOpen, setCartOpen] = useState(false),
    [checkout, setCheckout] = useState(false),
    [method, setMethod] = useState("CASH"),
    [note, setNote] = useState(""),
    [wallet, setWallet] = useState(0),
    [attempt, setAttempt] = useState(key()),
    [sandboxEnabled, setSandboxEnabled] = useState(false),
    [sandboxOrderPayment, setSandboxOrderPayment] = useState<any>(null),
    [gcashCheckoutOpen, setGcashCheckoutOpen] = useState(false);
  const load = useCallback(async () => {
    try {
      const [p, me, sandbox] = await Promise.all([
        api.get("/api/products"),
        api.get("/api/auth/me"),
        api.get("/api/payments/sandbox/gcash/config").catch(() => ({ data: { enabled: false } })),
      ]);
      setProducts(p.data || []);
      setWallet(normalizeCreditBalance(me.data?.membership?.creditBalance));
      setSandboxEnabled(Boolean(sandbox.data?.enabled));
    } catch (error: any) {
      if (error.response?.status === 429) {
        Alert.alert("Too many requests", "Please wait a moment and try again.");
      } else {
        Alert.alert("Shop unavailable", "Please try again.");
      }
    }
  }, []);
  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', load);
    return unsubscribe;
  }, [navigation, load]);
  useEffect(() => {
    setCart((current) => Object.fromEntries(Object.entries(current).flatMap(([id, quantity]) => {
      const product = products.find((item) => item.id === id);
      const next = Math.min(Number(quantity), Math.max(0, Number(product?.stock || 0)));
      return next ? [[id, next]] : [];
    })));
  }, [products]);
  const items = useMemo(
    () =>
      Object.entries(cart)
        .map(([id, quantity]) => ({
          product: products.find((p) => p.id === id),
          quantity,
        }))
        .filter((x) => x.product),
    [cart, products],
  );
  const total = items.reduce((s, i) => s + i.product.price * i.quantity, 0);
  const count = items.reduce((s, i) => s + i.quantity, 0);
  const add = (id: string, n = 1) =>
    setCart((c) => {
      const product = products.find((item) => item.id === id);
      const available = Math.max(0, Number(product?.stock || 0));
      const next = Math.min(available, Math.max(0, (c[id] || 0) + n));
      if (n > 0 && (c[id] || 0) >= available) {
        Alert.alert(available ? 'Stock limit reached' : 'Out of stock', available ? `Only ${available} available.` : 'This product is out of stock.');
        return c;
      }
      const copy = { ...c };
      if (next) copy[id] = next;
      else delete copy[id];
      return copy;
    });
  const place = async (gcashConfirmed = false) => {
    if (!items.length || busy) return;
    if (method === "CREDITS" && wallet < total)
      return Alert.alert(
        "Insufficient credits",
        "Top up your credits before placing this order.",
      );
    if (method === "GCASH" && !gcashConfirmed) {
      setCheckout(false);
      setGcashCheckoutOpen(true);
      return;
    }
    setBusy(true);
    try {
      const r = await api.post("/api/member-orders", {
        items: items.map((i) => ({
          productId: i.product.id,
          quantity: i.quantity,
        })),
        paymentMethod: method,
        note,
        idempotencyKey: attempt,
      });
      const order = r.data.order || r.data;
      if (method === "GCASH") {
        const { data } = await api.post(`/api/payments/sandbox/gcash/order/${encodeURIComponent(order.id)}`);
        setSandboxOrderPayment(data);
      }
      setCart({});
      setNote("");
      setAttempt(key());
      setCheckout(false);
      setCartOpen(false);
      if (method !== "GCASH")
        Alert.alert(
          method === "CREDITS" ? "Order paid" : "Order received",
          method === "CREDITS"
            ? "Your order is accepted for preparation."
            : "Pay when staff collects your order.",
        );
      load();
    } catch (e: any) {
      const message = e.response?.data?.error || "Could not place order. Please try again.";
      if (e.response?.status === 409) load();
      Alert.alert("Could not place order", message);
    } finally {
      setBusy(false);
    }
  };
  const refreshSandboxOrder = async () => {
    if (!sandboxOrderPayment?.payment?.id || busy) return;
    setBusy(true);
    try {
      const { data } = await api.get(`/api/payments/sandbox/gcash/order/payment/${encodeURIComponent(sandboxOrderPayment.payment.id)}`);
      setSandboxOrderPayment(data);
      load();
    } catch (e: any) {
      Alert.alert("Could not refresh status", e.response?.data?.error || "Please check your connection and try again.");
    } finally { setBusy(false); }
  };
  const cancelSandboxOrder = async () => {
    if (!sandboxOrderPayment?.payment?.id || busy) return;
    setBusy(true);
    try {
      const { data } = await api.post(`/api/payments/sandbox/gcash/order/payment/${encodeURIComponent(sandboxOrderPayment.payment.id)}/cancel`);
      setSandboxOrderPayment(data);
      load();
    } catch (e: any) {
      Alert.alert("Could not cancel payment", e.response?.data?.error || "Please check your connection and try again.");
    } finally { setBusy(false); }
  };
  const retrySandboxOrder = async () => {
    if (!sandboxOrderPayment?.order?.id || busy) return;
    setBusy(true);
    try {
      const { data } = await api.post(`/api/payments/sandbox/gcash/order/${encodeURIComponent(sandboxOrderPayment.order.id)}`);
      setSandboxOrderPayment(data);
      load();
    } catch (e: any) {
      Alert.alert("Could not start payment", e.response?.data?.error || "Please check your connection and try again.");
    } finally { setBusy(false); }
  };
  const filtered = products.filter(
    (p) =>
      (cat === "ALL" || p.category === cat) &&
      p.name.toLowerCase().includes(q.toLowerCase()),
  );
  const cats = ["ALL", ...new Set(products.map((p) => p.category))];
  return (
    <View style={s.root}>
      <View style={s.header}>
        <View style={s.headerTitle}>
          <Text style={s.title}>Shop</Text>
          <Text style={s.sub}>Food, drinks & billiard items</Text>
        </View>
        <View style={s.headerActions}>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="My Orders"
            style={s.headerIcon}
            onPress={() => navigation.navigate("Orders")}
          >
            <Ionicons
              name="receipt-outline"
              size={24}
              color={COLORS.textPrimary}
            />
          </TouchableOpacity>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Cart"
            style={s.headerIcon}
            onPress={() => setCartOpen(true)}
          >
            <Ionicons name="cart-outline" size={27} color={COLORS.primary} />
            {count ? (
              <View style={s.badge}>
                <Text style={s.badgeTxt}>{count}</Text>
              </View>
            ) : null}
          </TouchableOpacity>
        </View>
      </View>
      <TouchableOpacity
        style={s.buyCredits}
        onPress={() =>
          navigation.navigate("Payments", {
            purpose: "CREDIT_TOPUP",
            orderId: undefined,
          })
        }
      >
        <Ionicons name="wallet-outline" size={24} color={COLORS.primary} />
        <View style={s.buyCreditsText}>
          <Text style={s.buyCreditsTitle}>Buy Credits</Text>
          <Text style={s.buyCreditsHint}>
            Top up your wallet with GCash Sandbox / Mock
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={20} color={COLORS.primary} />
      </TouchableOpacity>
      <View style={s.search}>
        <Ionicons name="search" size={18} color={COLORS.textMuted} />
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="Search products"
          placeholderTextColor={COLORS.textMuted}
          style={s.input}
        />
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={s.categoryScroller}
        contentContainerStyle={s.chips}
      >
        {cats.map((c) => (
          <TouchableOpacity
            key={c}
            onPress={() => setCat(c)}
            style={[s.chip, cat === c && s.active]}
          >
            <Text style={s.chipTxt}>{c === "ALL" ? "All" : pretty(c)}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
      <FlatList
        data={filtered}
        keyExtractor={(p) => p.id}
        contentContainerStyle={[s.list, filtered.length === 0 && s.emptyList]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        refreshing={busy}
        onRefresh={load}
        ListEmptyComponent={
          <Text style={s.empty}>
            {products.length ? "No products found." : "No products available."}
          </Text>
        }
        renderItem={({ item }) => {
          const out = item.stock <= 0;
          return (
            <View style={s.card}>
              <Text style={s.name}>{item.name}</Text>
              <Text style={s.meta}>{pretty(item.category)}</Text>
              <Text style={s.price}>₱{Number(item.price).toFixed(2)}</Text>
              <Text
                style={[
                  s.stock,
                  {
                    color: out
                      ? COLORS.error
                      : item.stock <= item.lowStockAt
                        ? COLORS.warning
                        : COLORS.success,
                  },
                ]}
              >
                {out
                  ? "Out of stock"
                  : item.stock <= item.lowStockAt
                    ? "Low stock"
                    : "Available"}
              </Text>
              <TouchableOpacity
                disabled={out}
                onPress={() => add(item.id)}
                style={[s.add, out && { opacity: 0.4 }]}
              >
                <Text style={s.addTxt}>Add</Text>
              </TouchableOpacity>
            </View>
          );
        }}
      />
      <Modal
        visible={cartOpen}
        animationType="slide"
        onRequestClose={() => setCartOpen(false)}
      >
        <View style={s.root}>
          <View style={s.header}>
            <Text style={s.title}>Your Cart</Text>
            <TouchableOpacity onPress={() => setCartOpen(false)}>
              <Ionicons name="close" size={28} color={COLORS.textPrimary} />
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={s.list}>
            {items.length ? (
              items.map((i) => (
                <View style={s.row} key={i.product.id}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.name}>{i.product.name}</Text>
                    <Text style={s.meta}>
                      ₱{Number(i.product.price).toFixed(2)} each
                    </Text>
                  </View>
                  <TouchableOpacity onPress={() => add(i.product.id, -1)}>
                    <Text style={s.qty}>−</Text>
                  </TouchableOpacity>
                  <Text style={s.quantity}>{i.quantity}</Text>
                  <TouchableOpacity disabled={i.quantity >= i.product.stock} onPress={() => add(i.product.id)}>
                    <Text style={s.qty}>+</Text>
                  </TouchableOpacity>
                  <Text style={s.line}>
                    ₱{(i.product.price * i.quantity).toFixed(2)}
                  </Text>
                </View>
              ))
            ) : (
              <Text style={s.empty}>Your cart is empty.</Text>
            )}
          </ScrollView>
          {items.length ? (
            <View style={s.footer}>
              <Text style={s.total}>Subtotal: ₱{total.toFixed(2)}</Text>
              <TouchableOpacity
                style={s.checkout}
                onPress={() => setCheckout(true)}
              >
                <Text style={s.addTxt}>Checkout</Text>
              </TouchableOpacity>
            </View>
          ) : null}
        </View>
      </Modal>
      <Modal visible={checkout} transparent animationType="fade" onRequestClose={() => !busy && setCheckout(false)}>
        <View style={s.overlay}>
          <View style={s.dialog}>
            <Text style={s.title}>Checkout</Text>
            <Text style={s.total}>₱{total.toFixed(2)}</Text>
            {["CASH", "CREDITS", ...(sandboxEnabled ? ["GCASH"] : [])].map((m) => (
              <TouchableOpacity
                key={m}
                onPress={() => setMethod(m)}
                style={[s.choice, method === m && s.active]}
              >
                <Text style={s.chipTxt}>
                  {m === "CREDITS"
                    ? `Credits (${formatCredits(wallet)} available)`
                    : m === "GCASH" ? "GCash Sandbox / Mock" : pretty(m)}
                </Text>
              </TouchableOpacity>
            ))}
            <TextInput
              value={note}
              onChangeText={setNote}
              maxLength={300}
              placeholder="Order note (optional)"
              placeholderTextColor={COLORS.textMuted}
              style={[s.input, s.note]}
            />
            <TouchableOpacity
              disabled={busy}
              onPress={() => place()}
              style={s.checkout}
            >
              <Text style={s.addTxt}>
                {busy ? "Processing..." : method === "GCASH" ? "Proceed to Payment" : "Place Order"}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setCheckout(false)}>
              <Text style={s.cancel}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
      <GCashSandboxSheet
        visible={gcashCheckoutOpen}
        amount={Number(sandboxOrderPayment?.order?.total || sandboxOrderPayment?.payment?.amount || total || 0)}
        description="Saturday Nights Shop Order"
        result={sandboxOrderPayment}
        busy={busy}
        onConfirm={() => place(true)}
        onRefresh={refreshSandboxOrder}
        onCancel={cancelSandboxOrder}
        onRetry={retrySandboxOrder}
        onClose={() => {
          const paid = sandboxOrderPayment?.sandbox?.status === "paid";
          setGcashCheckoutOpen(false);
          setSandboxOrderPayment(null);
          if (paid) navigation.navigate("Orders");
        }}
      />
    </View>
  );
}
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.background },
  header: {
    paddingTop: 56,
    paddingHorizontal: 18,
    paddingBottom: 14,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  headerTitle: { flex: 1, minWidth: 0, paddingRight: 10 },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexShrink: 0,
  },
  headerIcon: {
    minWidth: 34,
    minHeight: 34,
    alignItems: "center",
    justifyContent: "center",
  },
  buyCredits: {
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 13,
    borderRadius: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.primary + "55",
  },
  buyCreditsText: { flex: 1, minWidth: 0 },
  buyCreditsTitle: {
    color: COLORS.textPrimary,
    fontWeight: "800",
    fontSize: 15,
  },
  buyCreditsHint: { color: COLORS.textMuted, fontSize: 12, marginTop: 2 },
  title: { color: COLORS.textPrimary, fontSize: 23, fontWeight: "800" },
  sub: { color: COLORS.textMuted, fontSize: 12 },
  search: {
    marginHorizontal: 16,
    height: 46,
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    gap: 8,
  },
  input: { flex: 1, color: COLORS.textPrimary },
  categoryScroller: { flexGrow: 0, flexShrink: 0, height: 56 },
  chips: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 8,
    alignItems: "center",
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    minHeight: 36,
    justifyContent: "center",
    alignItems: "center",
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "transparent",
    backgroundColor: COLORS.surface,
  },
  active: {
    backgroundColor: COLORS.primary + "33",
    borderWidth: 1,
    borderColor: COLORS.primary,
  },
  chipTxt: {
    color: COLORS.textPrimary,
    fontWeight: "700",
    fontSize: 12,
    lineHeight: 17,
  },
  list: { padding: 16, gap: 10 },
  emptyList: { flexGrow: 1, justifyContent: "center" },
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: COLORS.surfaceBorder,
    gap: 5,
  },
  name: { color: COLORS.textPrimary, fontWeight: "800", fontSize: 15 },
  meta: { color: COLORS.textMuted, fontSize: 11 },
  price: { color: COLORS.primary, fontWeight: "800", fontSize: 16 },
  stock: { fontSize: 11, fontWeight: "700" },
  add: {
    backgroundColor: COLORS.primary,
    alignSelf: "flex-start",
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderRadius: 9,
  },
  addTxt: { color: "#00150f", fontWeight: "800" },
  badge: {
    position: "absolute",
    right: -8,
    top: -7,
    backgroundColor: COLORS.error,
    borderRadius: 10,
    minWidth: 18,
    alignItems: "center",
  },
  badgeTxt: { color: "#fff", fontSize: 10, fontWeight: "800" },
  empty: { color: COLORS.textMuted, textAlign: "center" },
  row: {
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    padding: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  qty: { fontSize: 24, color: COLORS.primary, paddingHorizontal: 5 },
  quantity: { color: COLORS.textPrimary, fontWeight: "800" },
  line: { color: COLORS.textPrimary, fontWeight: "800", marginLeft: 4 },
  footer: {
    padding: 16,
    borderTopColor: COLORS.surfaceBorder,
    borderTopWidth: 1,
    gap: 10,
  },
  total: { color: COLORS.textPrimary, fontSize: 18, fontWeight: "800" },
  checkout: {
    height: 48,
    borderRadius: 12,
    backgroundColor: COLORS.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  overlay: {
    flex: 1,
    backgroundColor: "#000a",
    justifyContent: "center",
    padding: 18,
  },
  dialog: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 18,
    gap: 10,
  },
  choice: {
    padding: 12,
    borderRadius: 10,
    backgroundColor: COLORS.surfaceLight,
  },
  note: {
    backgroundColor: COLORS.surfaceLight,
    borderRadius: 10,
    paddingHorizontal: 12,
    height: 46,
  },
  cancel: { color: COLORS.textMuted, textAlign: "center", padding: 8 },
  sandboxText: { color: COLORS.gold, fontSize: 12, fontWeight: "800" },
});
