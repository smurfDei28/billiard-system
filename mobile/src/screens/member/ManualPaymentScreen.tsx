import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Image,
  ActivityIndicator,
  Alert,
  Modal,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system";
import * as MediaLibrary from "expo-media-library";
import { Ionicons } from "@expo/vector-icons";
import { api, getAccessToken, useAuth } from "../../context/AuthContext";
import { API_URL, COLORS } from "../../constants";
import GCashSandboxSheet, { SandboxScenario } from "../../components/GCashSandboxSheet";

const label = (value: string) =>
  value === "CREDIT_TOPUP"
    ? "Add credits"
    : value === "ORDER"
      ? "Shop order"
      : "Tournament entry";
const imageUrl = (url?: string) =>
  url?.startsWith("http") ? url : `${API_URL}${url || ""}`;
const methodLabel = (value?: string) =>
  value === "GCASH" ? "GCash" : value === "MAYA" ? "Maya" : value === "ACQUIREMOCK_GCASH_SANDBOX" ? "GCash Sandbox / Mock" : value || "Payment";
const sandboxStatusLabel = (value?: string) =>
  value === "paid" ? "Successful" : value === "failed" ? "Failed" : value === "pending" ? "Pending" : value === "cancelled" ? "Cancelled" : "Unknown";
const isSandboxOrderAttempt = (payment: any) => payment?.method === "GCASH" && (
  String(payment?.referenceNo || "").startsWith("ACQUIREMOCK-")
  || /gcash_mock_[0-9a-f-]{36}/i.test(`${payment?.referenceNo || ""} ${payment?.notes || ""}`)
);
const normalizeSandboxStatus = (value?: string) => {
  const status = String(value || "").toLowerCase();
  return ["paid", "failed", "pending", "cancelled"].includes(status) ? status : null;
};
const sandboxStatusFromAttempt = (payment: any) => {
  const notes = typeof payment?.notes === "string" ? payment.notes : JSON.stringify(payment?.notes || "");
  const status = notes.match(/(?:status=|"status"\s*:\s*")(paid|failed|pending|cancelled)/i)?.[1];
  return normalizeSandboxStatus(status) || (payment?.status === "PENDING" ? "pending" : payment?.status === "APPROVED" ? "paid" : payment?.status === "REJECTED" ? "failed" : null);
};
const money = (value: number | string | undefined) =>
  `₱${Number(value || 0).toFixed(2)}`;

export default function ManualPaymentScreen({ route }: any) {
  const { refreshUser } = useAuth();
  const [methods, setMethods] = useState<any[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  const [entries] = useState<any[]>([]);
  const [entryId, setEntryId] = useState("");
  const [orders, setOrders] = useState<any[]>([]);
  const requestedOrderId = route?.params?.orderId || "";
  const requestedPurpose = route?.params?.purpose === "CREDIT_TOPUP" ? "CREDIT_TOPUP" : requestedOrderId ? "ORDER" : "CREDIT_TOPUP";
  const [orderId, setOrderId] = useState(requestedOrderId);
  const [purpose, setPurpose] = useState(requestedPurpose);
  const [method, setMethod] = useState<any>(null);
  const [topUpAmount, setTopUpAmount] = useState("");
  const [referenceNo, setReferenceNo] = useState("");
  const [notes, setNotes] = useState("");
  const [receipt, setReceipt] = useState<any>(null);
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [qrViewerMethod, setQrViewerMethod] = useState<any>(null);
  const [savingQr, setSavingQr] = useState(false);
  const [qrLoading, setQrLoading] = useState(false);
  const [sandboxEnabled, setSandboxEnabled] = useState(false);
  const [sandboxPayment, setSandboxPayment] = useState<any>(null);
  const [sandboxScenario, setSandboxScenario] = useState<SandboxScenario>("success");
  const [sandboxBusy, setSandboxBusy] = useState(false);
  const [sandboxRestoreError, setSandboxRestoreError] = useState("");
  const [sandboxCheckoutOpen, setSandboxCheckoutOpen] = useState(false);
  const [showAllPendingShopPayments, setShowAllPendingShopPayments] = useState(false);
  const isCash = method?.method === "CASH";
  const isSandbox = method?.method === "ACQUIREMOCK_GCASH_SANDBOX";
  const isOrderPayment = purpose === "ORDER";
  const isCreditTopUp = purpose === "CREDIT_TOPUP";
  const sandboxPaymentOrderId = sandboxPayment?.order?.id || sandboxPayment?.payment?.orderId;
  const hasRestoredSandboxOrderPayment = isOrderPayment
    && sandboxPaymentOrderId === orderId
    && normalizeSandboxStatus(sandboxPayment?.sandbox?.status) === "pending";
  const selectedOrder = orders.find((order: any) => order.id === orderId);
  const pendingShopPayments = orders.filter(
    (order: any) =>
      order.source === "MEMBER_SHOP" &&
      order.paymentStatus === "PENDING" &&
      ["GCASH", "MAYA"].includes(order.paymentMethod),
  );
  const visiblePendingShopPayments = showAllPendingShopPayments
    ? pendingShopPayments
    : pendingShopPayments.slice(0, 3);
  const amount = isOrderPayment
    ? selectedOrder
      ? String(selectedOrder.total)
      : ""
    : topUpAmount;

  const load = useCallback(async () => {
    try {
      const [methodsRes, historyRes, entriesRes, ordersRes, sandboxConfigRes] = await Promise.all(
        [
          api.get("/api/payments/methods"),
          api.get("/api/payments/mine"),
          api.get("/api/payments/tournament-entries"),
          api.get("/api/member-orders/mine"),
          api.get("/api/payments/sandbox/gcash/config").catch(() => ({ data: { enabled: false } })),
        ],
      );
      setMethods(methodsRes.data || []);
      setSandboxEnabled(Boolean(sandboxConfigRes.data?.enabled));
      const availableMethods = (methodsRes.data || []).filter(
        (item: any) =>
          requestedPurpose !== "CREDIT_TOPUP" && item.method !== "CASH",
      );
      setMethod(
        (current: any) =>
          availableMethods.find(
            (item: any) => item.method === current?.method,
          ) ||
          availableMethods[0] ||
          null,
      );
      setHistory(historyRes.data || []);
      setOrders(
        (ordersRes.data || []).filter(
          (order: any) =>
            order.paymentStatus === "PENDING" &&
            ["GCASH", "MAYA", "CASH"].includes(order.paymentMethod),
        ),
      );
      if (requestedOrderId) {
        const order = (ordersRes.data || []).find(
          (item: any) => item.id === requestedOrderId,
        );
        if (order) {
          setPurpose("ORDER");
          setOrderId(order.id);
          setMethod(
            (current: any) =>
              order.paymentMethod === "GCASH" && sandboxConfigRes.data?.enabled
                ? { method: "ACQUIREMOCK_GCASH_SANDBOX", businessName: "GCash Sandbox / Mock" }
                : (methodsRes.data || []).find(
                (item: any) => item.method === order.paymentMethod,
              ) || current,
          );
          const sandboxAttempts = order.manualPayments?.filter(isSandboxOrderAttempt) || [];
          const latestSandboxAttempt = sandboxAttempts.find((payment: any) => payment.status === "PENDING") || sandboxAttempts[0];
          if (latestSandboxAttempt) {
            setSandboxRestoreError("");
            setSandboxPayment({
              payment: { ...latestSandboxAttempt, amount: order.total, orderId: order.id },
              sandbox: { status: sandboxStatusFromAttempt(latestSandboxAttempt), reference: latestSandboxAttempt.referenceNo, mockReference: latestSandboxAttempt.referenceNo },
              order,
            });
            setSandboxCheckoutOpen(true);
            try {
              const { data } = await api.get(`/api/payments/sandbox/gcash/order/payment/${encodeURIComponent(latestSandboxAttempt.id)}`);
              await applySandboxResult(data);
            } catch (err: any) {
              setSandboxRestoreError(err.response?.data?.error || "Could not retrieve this sandbox payment's provider status.");
              if (__DEV__) console.warn("[Sandbox order] Could not restore provider status", { paymentId: latestSandboxAttempt.id });
            }
          } else {
            setSandboxPayment(null);
          }
        }
      }
    } catch (err: any) {
      Alert.alert(
        "Payment unavailable",
        err.response?.data?.error ||
          "Please check your connection and try again.",
      );
    } finally {
      setLoading(false);
    }
  }, [requestedPurpose, requestedOrderId]);
  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (isCreditTopUp && sandboxEnabled) {
      setMethod({ method: "ACQUIREMOCK_GCASH_SANDBOX", businessName: "GCash Sandbox / Mock" });
    }
  }, [isCreditTopUp, sandboxEnabled]);

  useEffect(() => {
    setPurpose(requestedPurpose);
    setOrderId(requestedPurpose === "ORDER" ? requestedOrderId : "");
    setTopUpAmount("");
    setReferenceNo("");
    setReceipt(null);
  }, [requestedPurpose, requestedOrderId]);

  const pickReceipt = async (camera = false) => {
    const permission = camera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted)
      return Alert.alert(
        "Permission needed",
        camera
          ? "Camera access was denied. Enable it in your device settings to take a receipt photo."
          : "Photo library access was denied. Enable it in your device settings to choose a receipt.",
      );
    const result = camera
      ? await ImagePicker.launchCameraAsync({
          mediaTypes: ImagePicker.MediaTypeOptions.Images,
          quality: 0.8,
        })
      : await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ImagePicker.MediaTypeOptions.Images,
          quality: 0.8,
        });
    if (!result.canceled && result.assets?.[0]) setReceipt(result.assets[0]);
  };

  const applySandboxResult = async (data: any) => {
    if (!data?.payment || !data?.sandbox) throw new Error("The sandbox returned an invalid payment response.");
    const status = normalizeSandboxStatus(data.sandbox.status);
    setSandboxPayment({ ...data, sandbox: { ...data.sandbox, status: status || data.sandbox.status } });
    setSandboxRestoreError("");
    setHistory((previous) => [data.payment, ...previous.filter((payment) => payment.id !== data.payment.id)]);
    if (isOrderPayment && data.order) {
      setOrders((previous) => {
        if (status === "paid" || data.order.paymentStatus !== "PENDING") {
          return previous.filter((order) => order.id !== data.order.id);
        }
        return previous.map((order) => order.id === data.order.id ? {
          ...order,
          ...data.order,
          manualPayments: [data.payment, ...(order.manualPayments || []).filter((payment: any) => payment.id !== data.payment.id)],
        } : order);
      });
    }
    if (isCreditTopUp && status === "paid") await refreshUser();
  };

  const selectPendingShopOrder = (order: any) => {
    // Never carry a completed/failed attempt from one order into another.
    // A stale result made the next order look restored and hid its Proceed button.
    if (order.id !== sandboxPaymentOrderId) {
      setSandboxPayment(null);
      setSandboxRestoreError("");
      setSandboxScenario("success");
      setSandboxCheckoutOpen(false);
    }
    setPurpose("ORDER");
    setOrderId(order.id);
    setTopUpAmount("");
    setMethod(
      order.paymentMethod === "GCASH" && sandboxEnabled
        ? { method: "ACQUIREMOCK_GCASH_SANDBOX", businessName: "GCash Sandbox / Mock" }
        : methods.find((item: any) => item.method === order.paymentMethod) || method,
    );
  };

  const submitSandbox = async () => {
    if (sandboxBusy) return;
    setSandboxBusy(true);
    try {
      if (isOrderPayment) {
        if (!orderId || !selectedOrder) return Alert.alert("Order unavailable", "Return to My Orders and try again.");
        const { data } = await api.post(`/api/payments/sandbox/gcash/order/${encodeURIComponent(orderId)}`, { scenario: sandboxScenario });
        await applySandboxResult(data);
        return;
      }
      if (!Number.isInteger(Number(topUpAmount)) || Number(topUpAmount) <= 0) return Alert.alert("Invalid credits", "Enter a whole number of credits greater than zero.");
      const { data } = await api.post("/api/payments/sandbox/gcash", { amount: Number(topUpAmount), scenario: sandboxScenario });
      await applySandboxResult(data);
    } catch (err: any) {
      Alert.alert("Sandbox payment failed", err.response?.data?.error || "Could not reach the development sandbox.");
    } finally {
      setSandboxBusy(false);
    }
  };

  const refreshSandbox = async () => {
    if (!sandboxPayment?.payment?.id || sandboxBusy) return Alert.alert("No sandbox payment", "Create a sandbox payment before refreshing its status.");
    setSandboxBusy(true);
    try {
      const endpoint = isOrderPayment
        ? `/api/payments/sandbox/gcash/order/payment/${encodeURIComponent(sandboxPayment.payment.id)}`
        : `/api/payments/sandbox/gcash/${encodeURIComponent(sandboxPayment.payment.id)}`;
      const { data } = await api.get(endpoint);
      await applySandboxResult(data);
    } catch (err: any) {
      Alert.alert("Could not refresh status", err.response?.data?.error || "Could not reach the development sandbox.");
    } finally {
      setSandboxBusy(false);
    }
  };

  const cancelSandbox = async () => {
    if (!sandboxPayment?.payment?.id || sandboxBusy) return;
    setSandboxBusy(true);
    try {
      const endpoint = isOrderPayment
        ? `/api/payments/sandbox/gcash/order/payment/${encodeURIComponent(sandboxPayment.payment.id)}/cancel`
        : `/api/payments/sandbox/gcash/${encodeURIComponent(sandboxPayment.payment.id)}/cancel`;
      const { data } = await api.post(endpoint);
      await applySandboxResult(data);
    } catch (err: any) {
      Alert.alert("Could not cancel sandbox payment", err.response?.data?.error || "Could not reach the development sandbox.");
    } finally {
      setSandboxBusy(false);
    }
  };

  const completeSandbox = async () => {
    if (!sandboxPayment?.payment?.id || sandboxBusy) return;
    setSandboxBusy(true);
    try {
      const endpoint = isOrderPayment
        ? `/api/payments/sandbox/gcash/order/payment/${encodeURIComponent(sandboxPayment.payment.id)}/complete`
        : `/api/payments/sandbox/gcash/${encodeURIComponent(sandboxPayment.payment.id)}/complete`;
      const { data } = await api.post(endpoint);
      await applySandboxResult(data);
    } catch (err: any) {
      Alert.alert("Could not complete sandbox payment", err.response?.data?.error || "Could not reach the development sandbox.");
    } finally {
      setSandboxBusy(false);
    }
  };

  const startNewSandboxTransaction = () => {
    setSandboxPayment(null);
    setSandboxRestoreError("");
  };

  const closeSandboxCheckout = () => {
    const status = normalizeSandboxStatus(sandboxPayment?.sandbox?.status);
    setSandboxCheckoutOpen(false);
    // A finished top-up is a receipt, not the next checkout. Clearing it here
    // ensures a new amount always creates a new provider transaction. Pending
    // attempts stay restorable so the member can refresh or cancel them.
    if ((isCreditTopUp || isOrderPayment) && status && status !== "pending") {
      setSandboxPayment(null);
      setSandboxRestoreError("");
      setSandboxScenario("success");
    }
  };

  const submit = async () => {
    if (submitting) return;
    if (!method)
      return Alert.alert(
        "No payment method",
        "No payment method is currently available.",
      );
    if (!amount || Number(amount) <= 0)
      return Alert.alert("Missing amount", "Enter a valid amount to pay.");
    if (isSandbox) {
      setSandboxCheckoutOpen(true);
      return;
    }
    if (isCreditTopUp && (!Number.isInteger(Number(topUpAmount)) || Number(topUpAmount) <= 0))
      return Alert.alert("Invalid credits", "Enter a whole number of credits greater than zero.");
    if (isCreditTopUp)
      return Alert.alert("GCash Sandbox unavailable", "Enable the development sandbox to buy credits in this environment.");
    if (purpose === "ORDER" && !orderId)
      return Alert.alert(
        "Select an order",
        "Choose the shop order you are paying for.",
      );
    if (isOrderPayment && !selectedOrder)
      return Alert.alert(
        "Order unavailable",
        "This order could not be loaded. Return to My Orders and try again.",
      );
    if (!isCash && (!referenceNo.trim() || !receipt))
      return Alert.alert(
        "Missing details",
        "Enter the reference number and attach a receipt image.",
      );
    setSubmitting(true);
    try {
      const form = new FormData();
      form.append("purpose", purpose);
      form.append("method", method.method);
      const submittedAmount = isOrderPayment
        ? String(selectedOrder.total)
        : topUpAmount;
      form.append("amount", submittedAmount);
      form.append("referenceNo", referenceNo.trim());
      form.append("notes", notes.trim());
      if (purpose === "ORDER") form.append("orderId", orderId);
      if (receipt)
        form.append("receipt", {
          uri: receipt.uri,
          name: receipt.fileName || `receipt-${Date.now()}.jpg`,
          type: receipt.mimeType || "image/jpeg",
        } as any);
      const endpoint = "/api/payments/submit";
      if (__DEV__) {
        console.log("[Manual Payment] submitting", {
          endpoint,
          purpose,
          hasOrderId: Boolean(orderId),
          method: method.method,
          amount: submittedAmount,
          hasProof: Boolean(receipt),
          proofUriScheme: receipt?.uri?.split(":", 1)[0] || null,
        });
      }

      // Axios multipart can fail inside React Native before Express receives a
      // request. Use the project's working native-fetch multipart pattern and
      // let the platform generate the multipart boundary.
      const token = await getAccessToken();
      const response = await fetch(`${API_URL}${endpoint}`, {
        method: "POST",
        headers: {
          Accept: "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: form,
      });
      const rawResponse = await response.text();
      let data: any = null;
      try {
        data = rawResponse ? JSON.parse(rawResponse) : null;
      } catch {
        data = null;
      }
      if (__DEV__) {
        console.log("[Manual Payment] response", {
          status: response.status,
          message: data?.error || data?.message || null,
        });
      }
      if (!response.ok) {
        const error: any = new Error(
          data?.error || `Payment submission failed (${response.status}).`,
        );
        error.status = response.status;
        error.data = data;
        throw error;
      }
      Alert.alert(
        "Submitted",
        data?.message ||
          (isOrderPayment
            ? "Payment submitted for verification. Your order will update after staff approval."
            : "Payment submitted for verification."),
      );
      if (!isOrderPayment) setTopUpAmount("");
      setReferenceNo("");
      setNotes("");
      setReceipt(null);
      load();
    } catch (err: any) {
      const serverMessage = err?.data?.error || err?.response?.data?.error;
      if (__DEV__) {
        console.log("[Manual Payment] submission failed", {
          status: err?.status || err?.response?.status || null,
          message: serverMessage || err?.message || null,
        });
      }
      Alert.alert(
        "Could not submit payment",
        serverMessage ||
          (err?.status
            ? err.message
            : "Please check your connection and try again."),
      );
    } finally {
      setSubmitting(false);
    }
  };

  const saveQrImage = async () => {
    const url = imageUrl(qrViewerMethod?.qrCodeUrl);
    if (!/^https:\/\//i.test(url))
      return Alert.alert(
        "Could not save QR image",
        "This QR image is not available through a secure download link. Please try again later.",
      );
    if (savingQr) return;
    setSavingQr(true);
    let temporaryUri: string | null = null;
    try {
      const extension = (
        new URL(url).pathname.match(/\.([a-z0-9]+)$/i)?.[1] || "jpg"
      ).toLowerCase();
      const safeExtension = ["jpg", "jpeg", "png", "webp"].includes(extension)
        ? extension
        : "jpg";
      const filename = `SaturdayNights-${methodLabel(qrViewerMethod.method)}-QR.${safeExtension}`;
      const download = await FileSystem.downloadAsync(
        url,
        `${FileSystem.cacheDirectory}${filename}`,
      );
      temporaryUri = download.uri;
      let permission = await MediaLibrary.getPermissionsAsync();
      if (!permission.granted)
        permission = await MediaLibrary.requestPermissionsAsync();
      if (!permission.granted)
        return Alert.alert(
          "Photo access required",
          "Photo access is required to save the QR image.",
        );
      await MediaLibrary.saveToLibraryAsync(download.uri);
      Alert.alert("QR image saved", "QR image saved to your photos.");
    } catch {
      Alert.alert(
        "Could not save QR image",
        "Could not save the QR image. Please try again.",
      );
    } finally {
      if (temporaryUri)
        FileSystem.deleteAsync(temporaryUri, { idempotent: true }).catch(
          () => {},
        );
      setSavingQr(false);
    }
  };

  if (loading)
    return (
      <View style={s.center}>
        <ActivityIndicator color={COLORS.primary} size="large" />
      </View>
    );
  const viewerUrl = imageUrl(qrViewerMethod?.qrCodeUrl);

  return (
    <>
      <ScrollView style={s.container} contentContainerStyle={s.content}>
        <View style={s.header}>
          <Text style={s.title}>{isOrderPayment ? "Order Payment" : "Buy Credits"}</Text>
          <Text style={s.subtitle}>
            {isOrderPayment ? "Review historical manual order payments." : "1 Credit = PHP 1. Complete your top-up through the automated GCash sandbox."}
          </Text>
        </View>
        {pendingShopPayments.length > 0 && (
          <View style={s.card}>
            <Text style={s.sectionTitle}>Pending Shop Payments</Text>
            {visiblePendingShopPayments.map((order: any) => {
                const proofPending = order.manualPayments?.some(
                  (payment: any) => payment.status === "PENDING",
                );
                return (
                  <View key={order.id} style={s.entry}>
                    <Text style={s.historyTitle}>
                      {order.receiptNumber || `Order ${order.id.slice(0, 8)}`}
                    </Text>
                    <Text style={s.muted}>
                      PHP {Number(order.total).toFixed(2)} •{" "}
                      {methodLabel(order.paymentMethod)} •{" "}
                      {new Date(order.createdAt).toLocaleString("en-PH")}
                    </Text>
                    {proofPending ? (
                      <Text style={s.warning}>
                        Payment verification pending
                      </Text>
                    ) : (
                      <TouchableOpacity
                        style={{
                          alignSelf: "flex-start",
                          backgroundColor: COLORS.primary,
                          paddingHorizontal: 12,
                          paddingVertical: 8,
                          borderRadius: 8,
                          marginTop: 5,
                        }}
                        onPress={() => selectPendingShopOrder(order)}
                      >
                        <Text
                          style={{
                            color: "#00150f",
                            fontWeight: "800",
                            fontSize: 12,
                          }}
                        >
                          Complete Payment
                        </Text>
                      </TouchableOpacity>
                    )}
                  </View>
                );
              })}
            {pendingShopPayments.length > 3 && (
              <TouchableOpacity
                accessibilityRole="button"
                style={s.seeMoreBtn}
                onPress={() => setShowAllPendingShopPayments((current) => !current)}
              >
                <Text style={s.seeMoreTxt}>
                  {showAllPendingShopPayments
                    ? "See Less"
                    : `See More (${pendingShopPayments.length - 3})`}
                </Text>
                <Ionicons
                  name={showAllPendingShopPayments ? "chevron-up" : "chevron-down"}
                  size={16}
                  color={COLORS.primary}
                />
              </TouchableOpacity>
            )}
          </View>
        )}
        <View style={s.card}>
          <Text style={s.sectionTitle}>
            {isOrderPayment ? "Shop order payment" : "Buy credits"}
          </Text>
          <Text style={s.muted}>
            {isOrderPayment
              ? `Order total: PHP ${Number(selectedOrder?.total || 0).toFixed(2)}`
              : "Top up your credits with GCash Sandbox / Mock."}
          </Text>
          {purpose === "TOURNAMENT_ENTRY" &&
            (entries.length ? (
              entries.map((entry) => (
                <TouchableOpacity
                  key={entry.id}
                  onPress={() => {
                    setEntryId(entry.id);
                    setTopUpAmount(String(entry.tournament.entryFee));
                  }}
                  style={[s.entry, entryId === entry.id && s.choiceActive]}
                >
                  <Text style={s.historyTitle}>{entry.tournament.name}</Text>
                  <Text style={s.muted}>
                    PHP {Number(entry.tournament.entryFee).toFixed(2)} • select
                    to set exact amount
                  </Text>
                </TouchableOpacity>
              ))
            ) : (
              <Text style={s.warning}>
                No pending tournament registrations to pay.
              </Text>
            ))}
        </View>
        {isOrderPayment && selectedOrder && (
          <View style={s.card}>
            <Text style={s.sectionTitle}>Your Order</Text>
            <Text style={s.orderReference}>
              {selectedOrder.receiptNumber ||
                `Order ${selectedOrder.id.slice(0, 8)}`}
            </Text>
            {selectedOrder.items?.map((item: any) => (
              <View key={item.id} style={s.orderLine}>
                <View style={s.orderItemCopy}>
                  <Text style={s.historyTitle}>
                    {item.product?.name || "Item"}
                  </Text>
                  <Text style={s.muted}>
                    {item.quantity} × {money(item.price)}
                  </Text>
                </View>
                <Text style={s.orderLineTotal}>
                  {money(Number(item.price) * Number(item.quantity))}
                </Text>
              </View>
            ))}
            <View style={s.orderTotalRow}>
              <Text style={s.orderTotalLabel}>Total</Text>
              <Text style={s.orderTotal}>{money(selectedOrder.total)}</Text>
            </View>
          </View>
        )}
        <View style={s.card}>
          <Text style={s.sectionTitle}>{isSandbox ? "Payment method" : "2. Choose a payment method"}</Text>
          <View style={s.row}>
            {methods
              .filter((item) => {
                if (isOrderPayment) {
                  return item.method === selectedOrder?.paymentMethod && !(sandboxEnabled && selectedOrder?.paymentMethod === "GCASH");
                }
                return !isCreditTopUp && item.method !== "CASH";
              })
              .map((item) => (
                <TouchableOpacity
                  key={item.method}
                  onPress={() => setMethod(item)}
                  style={[
                    s.choice,
                    method?.method === item.method && s.choiceActive,
                  ]}
                >
                  <Text
                    style={[
                      s.choiceText,
                      method?.method === item.method && s.choiceTextActive,
                    ]}
                  >
                    {methodLabel(item.method)}
                  </Text>
                </TouchableOpacity>
              ))}
            {(isCreditTopUp || (isOrderPayment && selectedOrder?.paymentMethod === "GCASH")) && sandboxEnabled && (
              <TouchableOpacity
                onPress={() => setMethod({ method: "ACQUIREMOCK_GCASH_SANDBOX", businessName: "GCash Sandbox / Mock" })}
                style={[s.choice, method?.method === "ACQUIREMOCK_GCASH_SANDBOX" && s.choiceActive]}
              >
                <Text style={[s.choiceText, method?.method === "ACQUIREMOCK_GCASH_SANDBOX" && s.choiceTextActive]}>GCash Sandbox / Mock</Text>
              </TouchableOpacity>
            )}
          </View>
          {method && (
            <View style={s.details}>
              {isSandbox ? (
                <View style={s.sandboxNotice}>
                  <Text style={s.sandboxTitle}>GCash Sandbox / Mock</Text>
                  <Text style={s.instructions}>Development testing only. No real GCash transaction will occur.</Text>
                </View>
              ) : isCash ? (
                <>
                  <Ionicons
                    name="cash-outline"
                    size={34}
                    color={COLORS.primary}
                  />
                  <Text style={s.business}>Pay at the counter</Text>
                  <Text style={s.instructions}>
                    No QR code or receipt is required for cash. Submit this
                    request, then pay staff; it stays pending until verified.
                  </Text>
                </>
              ) : (
                <>
                  <Text style={s.business}>{method.businessName}</Text>
                  <Text style={s.detail}>
                    {method.accountName}
                    {method.accountNumber ? ` • ${method.accountNumber}` : ""}
                  </Text>
                  {method.qrCodeUrl ? (
                    <>
                      <TouchableOpacity
                        accessibilityRole="button"
                        accessibilityLabel="Enlarge payment QR code"
                        onPress={() => {
                          setQrLoading(true);
                          setQrViewerMethod(method);
                        }}
                      >
                        <Image
                          source={{ uri: imageUrl(method.qrCodeUrl) }}
                          style={s.qr}
                          resizeMode="contain"
                        />
                      </TouchableOpacity>
                      <Text style={s.qrHint}>Tap QR to enlarge or save</Text>
                    </>
                  ) : (
                    <Text style={s.warning}>
                      This QR code is not configured yet. Choose Cash or contact
                      the hall.
                    </Text>
                  )}
                  <Text style={s.instructions}>
                    {method.instructions ||
                      "Open your wallet app, scan this QR, and pay the exact amount below."}
                  </Text>
                </>
              )}
            </View>
          )}
        </View>
        <View style={s.card}>
          <Text style={s.sectionTitle}>{isCreditTopUp ? "Credits to Buy" : isSandbox ? "Payment details" : `3. ${isCash ? "Cash payment details" : "Payment proof"}`}</Text>
          {isOrderPayment ? (
            <View style={s.amountToPay}>
              <Text style={s.amountToPayLabel}>Amount to Pay</Text>
              <Text style={s.amountToPayValue}>
                {money(selectedOrder?.total)}
              </Text>
            </View>
          ) : isCreditTopUp ? (
            <>
              <TextInput value={topUpAmount} onChangeText={(value) => setTopUpAmount(value.replace(/[^0-9]/g, ""))} keyboardType="number-pad" placeholder="Enter credits (for example, 500)" placeholderTextColor={COLORS.textMuted} style={s.input} />
              <View style={s.quickAmounts}>{[100, 200, 500, 1000].map((value) => <TouchableOpacity key={value} style={[s.quickAmount, topUpAmount === String(value) && s.quickAmountActive]} onPress={() => setTopUpAmount(String(value))}><Text style={[s.quickAmountText, topUpAmount === String(value) && s.quickAmountTextActive]}>PHP {value}</Text></TouchableOpacity>)}</View>
              <View style={s.amountToPay}><Text style={s.amountToPayLabel}>You will receive</Text><Text style={s.creditReceive}>{Number(topUpAmount || 0).toLocaleString()} Credits</Text><Text style={s.amountToPayLabel}>Amount to Pay</Text><Text style={s.amountToPayValue}>{money(topUpAmount)}</Text></View>
            </>
          ) : (
            <TextInput value={topUpAmount} onChangeText={setTopUpAmount} keyboardType="decimal-pad" placeholder="Exact amount paid (PHP)" placeholderTextColor={COLORS.textMuted} style={s.input} />
          )}
          {isSandbox ? (
            <Text style={s.sandboxLabel}>Payment result is confirmed automatically by the payment service.</Text>
          ) : !isCash && (
            <>
              <TextInput
                value={referenceNo}
                onChangeText={setReferenceNo}
                placeholder="Transaction reference number"
                placeholderTextColor={COLORS.textMuted}
                style={s.input}
              />
              <View style={s.uploadRow}>
                <TouchableOpacity
                  disabled={submitting}
                  onPress={() => pickReceipt(true)}
                  style={s.upload}
                >
                  <Ionicons
                    name="camera-outline"
                    color={COLORS.primary}
                    size={20}
                  />
                  <Text style={s.uploadText}>Take Photo</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  disabled={submitting}
                  onPress={() => pickReceipt(false)}
                  style={s.upload}
                >
                  <Ionicons
                    name="images-outline"
                    color={COLORS.primary}
                    size={20}
                  />
                  <Text style={s.uploadText}>Choose from Gallery</Text>
                </TouchableOpacity>
              </View>
              {receipt && (
                <>
                  <Image
                    source={{ uri: receipt.uri }}
                    style={s.preview}
                    resizeMode="contain"
                  />
                  <TouchableOpacity
                    disabled={submitting}
                    onPress={() => setReceipt(null)}
                  >
                    <Text style={s.remove}>Remove selected image</Text>
                  </TouchableOpacity>
                </>
              )}
            </>
          )}
          <TextInput
            value={notes}
            onChangeText={setNotes}
            placeholder="Notes (optional)"
            placeholderTextColor={COLORS.textMuted}
            style={s.input}
          />
          {!hasRestoredSandboxOrderPayment && <TouchableOpacity
            disabled={submitting || sandboxBusy}
            onPress={submit}
            style={[s.submit, (submitting || sandboxBusy) && { opacity: 0.6 }]}
          >
            {submitting || sandboxBusy ? (
              <ActivityIndicator color="#00150f" />
            ) : (
              <Text style={s.submitText}>
                {isSandbox ? "Proceed to Payment" : isCash ? "Submit cash request" : "Submit for verification"}
              </Text>
            )}
          </TouchableOpacity>}
        </View>
        <View style={s.card}>
          <Text style={s.sectionTitle}>Payment status</Text>
          {history.length === 0 ? (
            <Text style={s.muted}>No payment submissions yet.</Text>
          ) : (
            history.slice(0, 6).map((payment) => (
              <View key={payment.id} style={s.history}>
                <View style={s.historyHeader}>
                  <Text style={s.historyTitle} numberOfLines={2}>
                    {label(payment.purpose)} • PHP{" "}
                    {Number(payment.amount).toFixed(2)}
                  </Text>
                  <Text
                    numberOfLines={1}
                    style={[
                      s.status,
                      {
                        color:
                          payment.status === "APPROVED"
                            ? COLORS.success
                            : payment.status === "REJECTED"
                              ? COLORS.error
                              : COLORS.warning,
                      },
                    ]}
                  >
                    {payment.status}
                  </Text>
                </View>
                <Text style={s.paymentReference} numberOfLines={1} ellipsizeMode="middle">
                  {payment.method} • {payment.referenceNo}
                </Text>
                {payment.reviewerRemarks && (
                  <Text style={s.remarks}>{payment.reviewerRemarks}</Text>
                )}
              </View>
            ))
          )}
        </View>
      </ScrollView>
      <GCashSandboxSheet
        visible={sandboxCheckoutOpen}
        amount={Number(sandboxPayment?.payment?.amount || amount || 0)}
        description={isOrderPayment ? "Saturday Nights Shop Order" : "Saturday Nights Credit Top-up"}
        result={sandboxPayment}
        error={sandboxRestoreError}
        busy={sandboxBusy}
        scenario={sandboxScenario}
        onScenarioChange={setSandboxScenario}
        onConfirm={submitSandbox}
        onRefresh={refreshSandbox}
        onCancel={cancelSandbox}
        onComplete={completeSandbox}
        onRetry={startNewSandboxTransaction}
        onClose={closeSandboxCheckout}
      />
      <Modal
        visible={!!qrViewerMethod}
        transparent
        animationType="fade"
        onRequestClose={() => setQrViewerMethod(null)}
      >
        <View style={s.viewerOverlay}>
          <View style={s.viewerCard}>
            <Text style={s.viewerTitle}>
              {methodLabel(qrViewerMethod?.method)} QR
            </Text>
            <Text style={s.viewerDetail}>{qrViewerMethod?.businessName}</Text>
            {qrLoading && (
              <ActivityIndicator
                color={COLORS.primary}
                size="large"
                style={s.viewerLoading}
              />
            )}
            {!!qrViewerMethod?.qrCodeUrl && (
              <Image
                source={{ uri: viewerUrl }}
                style={s.viewerImage}
                resizeMode="contain"
                onLoadEnd={() => setQrLoading(false)}
                onError={() => {
                  setQrLoading(false);
                  Alert.alert(
                    "QR image unavailable",
                    "Could not load this QR image. Please try again later.",
                  );
                }}
              />
            )}
            <Text style={s.viewerAccount}>
              {qrViewerMethod?.accountName}
              {qrViewerMethod?.accountNumber
                ? ` • ${qrViewerMethod.accountNumber}`
                : ""}
            </Text>
            <View style={s.viewerActions}>
              <TouchableOpacity
                disabled={savingQr}
                style={[s.saveQrBtn, savingQr && s.disabled]}
                onPress={saveQrImage}
              >
                {savingQr ? (
                  <ActivityIndicator color="#00150f" />
                ) : (
                  <>
                    <Ionicons
                      name="download-outline"
                      size={18}
                      color="#00150f"
                    />
                    <Text style={s.saveQrTxt}>Save Image</Text>
                  </>
                )}
              </TouchableOpacity>
              <TouchableOpacity
                style={s.closeQrBtn}
                onPress={() => setQrViewerMethod(null)}
              >
                <Text style={s.closeQrTxt}>Close</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  content: { padding: 16, gap: 14, paddingBottom: 30 },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: COLORS.background,
  },
  header: { paddingTop: 50, paddingHorizontal: 4, paddingBottom: 4 },
  title: { fontSize: 26, fontWeight: "800", color: COLORS.textPrimary },
  subtitle: { marginTop: 5, color: COLORS.textSecondary, lineHeight: 19 },
  card: {
    backgroundColor: COLORS.surface,
    borderColor: COLORS.surfaceBorder,
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
    gap: 11,
  },
  sectionTitle: { color: COLORS.textPrimary, fontSize: 15, fontWeight: "800" },
  row: { flexDirection: "row", gap: 8 },
  choice: {
    flex: 1,
    alignItems: "center",
    padding: 11,
    borderRadius: 10,
    backgroundColor: COLORS.surfaceLight,
    borderWidth: 1,
    borderColor: COLORS.surfaceBorder,
  },
  choiceActive: {
    borderColor: COLORS.primary,
    backgroundColor: COLORS.primary + "18",
  },
  choiceText: { fontSize: 12, fontWeight: "700", color: COLORS.textMuted },
  choiceTextActive: { color: COLORS.primary },
  entry: {
    padding: 11,
    borderRadius: 10,
    backgroundColor: COLORS.surfaceLight,
    borderWidth: 1,
    borderColor: COLORS.surfaceBorder,
  },
  details: { alignItems: "center", gap: 5, paddingTop: 4 },
  business: { color: COLORS.textPrimary, fontWeight: "800", fontSize: 16 },
  detail: { color: COLORS.textSecondary },
  qr: {
    width: 190,
    height: 190,
    borderRadius: 12,
    marginVertical: 7,
    backgroundColor: "#fff",
  },
  qrHint: { fontSize: 11, color: COLORS.textMuted, marginTop: -3 },
  instructions: {
    textAlign: "center",
    color: COLORS.textSecondary,
    lineHeight: 19,
  },
  warning: { color: COLORS.warning, textAlign: "center" },
  input: {
    height: 47,
    borderRadius: 10,
    borderColor: COLORS.surfaceBorder,
    borderWidth: 1,
    backgroundColor: COLORS.surfaceLight,
    paddingHorizontal: 13,
    color: COLORS.textPrimary,
  },
  readonlyInput: { color: COLORS.textSecondary, opacity: 0.8 },
  uploadRow: { flexDirection: "row", gap: 8 },
  upload: {
    flex: 1,
    height: 48,
    borderWidth: 1,
    borderColor: COLORS.primary,
    borderStyle: "dashed",
    borderRadius: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  uploadText: { color: COLORS.primary, fontWeight: "700", fontSize: 12 },
  preview: {
    width: "100%",
    height: 180,
    borderRadius: 10,
    backgroundColor: COLORS.surfaceLight,
  },
  remove: { color: COLORS.error, textAlign: "center", fontWeight: "700" },
  submit: {
    height: 52,
    justifyContent: "center",
    alignItems: "center",
    borderRadius: 12,
    backgroundColor: COLORS.primary,
  },
  submitText: { fontWeight: "800", fontSize: 15, color: "#00150f" },
  history: {
    paddingVertical: 10,
    borderTopWidth: 1,
    borderColor: COLORS.surfaceBorder,
    gap: 4,
  },
  historyHeader: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  historyTitle: { flex: 1, minWidth: 0, fontWeight: "700", color: COLORS.textPrimary },
  paymentReference: { color: COLORS.textMuted, fontSize: 11 },
  status: { flexShrink: 0, maxWidth: "32%", fontSize: 9, fontWeight: "800", textAlign: "right" },
  seeMoreBtn: { minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderRadius: 10, borderWidth: 1, borderColor: COLORS.primary + "55", backgroundColor: COLORS.surfaceLight, marginTop: 4 },
  seeMoreTxt: { color: COLORS.primary, fontSize: 13, fontWeight: "800" },
  muted: { color: COLORS.textMuted, fontSize: 12, marginTop: 3 },
  orderReference: { color: COLORS.textSecondary, fontSize: 12 },
  orderLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 9,
    borderTopWidth: 1,
    borderColor: COLORS.surfaceBorder,
  },
  orderItemCopy: { flex: 1, minWidth: 0 },
  orderLineTotal: { color: COLORS.textPrimary, fontWeight: "800" },
  orderTotalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderTopWidth: 1,
    borderColor: COLORS.primary + "66",
    paddingTop: 11,
  },
  orderTotalLabel: {
    color: COLORS.textPrimary,
    fontWeight: "800",
    fontSize: 16,
  },
  orderTotal: { color: COLORS.primary, fontWeight: "900", fontSize: 18 },
  amountToPay: {
    borderRadius: 10,
    borderColor: COLORS.primary + "66",
    borderWidth: 1,
    backgroundColor: COLORS.primary + "12",
    paddingHorizontal: 13,
    paddingVertical: 11,
  },
  amountToPayLabel: { color: COLORS.textSecondary, fontSize: 12 },
  amountToPayValue: {
    color: COLORS.primary,
    fontWeight: "900",
    fontSize: 20,
    marginTop: 2,
  },
  creditReceive: { color: COLORS.primary, fontSize: 18, fontWeight: "800" },
  quickAmounts: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  quickAmount: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 9, borderWidth: 1, borderColor: COLORS.surfaceBorder, backgroundColor: COLORS.surfaceLight },
  quickAmountActive: { borderColor: COLORS.primary, backgroundColor: COLORS.primary + "18" },
  quickAmountText: { color: COLORS.textSecondary, fontSize: 12, fontWeight: "700" },
  quickAmountTextActive: { color: COLORS.primary },
  remarks: { color: COLORS.error, fontSize: 12, marginTop: 4 },
  viewerOverlay: {
    flex: 1,
    backgroundColor: "#000000CC",
    justifyContent: "center",
    padding: 20,
  },
  viewerCard: {
    maxHeight: "90%",
    backgroundColor: COLORS.surface,
    borderRadius: 18,
    padding: 18,
    gap: 10,
    borderWidth: 1,
    borderColor: COLORS.surfaceBorder,
  },
  viewerTitle: {
    fontSize: 20,
    fontWeight: "800",
    color: COLORS.textPrimary,
    textAlign: "center",
  },
  viewerDetail: {
    fontSize: 13,
    color: COLORS.textSecondary,
    textAlign: "center",
  },
  viewerLoading: {
    position: "absolute",
    alignSelf: "center",
    top: "45%",
    zIndex: 1,
  },
  viewerImage: {
    width: "100%",
    height: 330,
    backgroundColor: "#fff",
    borderRadius: 12,
  },
  viewerAccount: {
    fontSize: 13,
    color: COLORS.textSecondary,
    textAlign: "center",
  },
  viewerActions: { flexDirection: "row", gap: 10 },
  saveQrBtn: {
    flex: 1,
    height: 48,
    borderRadius: 12,
    backgroundColor: COLORS.primary,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
  },
  saveQrTxt: { color: "#00150f", fontWeight: "800" },
  closeQrBtn: {
    width: 92,
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.surfaceBorder,
    justifyContent: "center",
    alignItems: "center",
  },
  closeQrTxt: { color: COLORS.textSecondary, fontWeight: "700" },
  disabled: { opacity: 0.6 },
  sandboxNotice: { alignItems: "center", gap: 6, paddingVertical: 4 },
  sandboxTitle: { color: COLORS.primary, fontSize: 16, fontWeight: "800", textAlign: "center" },
  sandboxLabel: { color: COLORS.textSecondary, fontSize: 12, fontWeight: "700" },
  sandboxControls: { gap: 8 },
  sandboxResult: { borderColor: COLORS.primary + "88" },
  sandboxStatus: { color: COLORS.primary, fontSize: 16, fontWeight: "900", textAlign: "center" },
  sandboxError: { color: COLORS.error, fontSize: 12, textAlign: "center" },
  refreshButton: { height: 46, borderRadius: 10, justifyContent: "center", alignItems: "center", backgroundColor: COLORS.primary },
  refreshText: { color: "#00150f", fontWeight: "800" },
  cancelButton: { height: 46, borderRadius: 10, justifyContent: "center", alignItems: "center", borderColor: COLORS.error, borderWidth: 1 },
  cancelText: { color: COLORS.error, fontWeight: "800" },
});
