import React from "react";
import {
  ActivityIndicator,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

type Props = {
  visible: boolean;
  amount: number;
  description?: string;
  result?: any;
  error?: string;
  busy?: boolean;
  scenario?: SandboxScenario;
  onScenarioChange?: (scenario: SandboxScenario) => void;
  onConfirm: () => void;
  onRefresh?: () => void;
  onCancel?: () => void;
  onComplete?: () => void;
  onRetry?: () => void;
  onClose: () => void;
};

export type SandboxScenario = "success" | "failed" | "pending" | "cancelled";

const scenarios: Array<{ value: SandboxScenario; label: string }> = [
  { value: "success", label: "Success" },
  { value: "failed", label: "Failed" },
  { value: "pending", label: "Pending" },
  { value: "cancelled", label: "Cancelled" },
];

const BLUE = "#0878F9";
const statusCopy: Record<string, { title: string; detail: string; icon: any; color: string }> = {
  paid: { title: "Payment successful", detail: "Your test payment was confirmed and recorded.", icon: "checkmark-circle", color: "#16A06A" },
  pending: { title: "Payment pending", detail: "This test payment stays pending until you complete or cancel it.", icon: "time", color: "#E39A16" },
  failed: { title: "Payment failed", detail: "No funds were transferred. You may safely try again.", icon: "close-circle", color: "#D94A4A" },
  cancelled: { title: "Payment cancelled", detail: "This test payment was not completed.", icon: "ban", color: "#6E7785" },
};

export default function GCashSandboxSheet({
  visible,
  amount,
  description = "Saturday Nights Billiard",
  result,
  error,
  busy = false,
  scenario = "success",
  onScenarioChange,
  onConfirm,
  onRefresh,
  onCancel,
  onComplete,
  onRetry,
  onClose,
}: Props) {
  const status = String(result?.sandbox?.status || "").toLowerCase();
  const completed = Boolean(result);
  const copy = statusCopy[status] || statusCopy.pending;
  const reference = result?.sandbox?.mockReference || result?.sandbox?.reference;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={() => !busy && onClose()}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={styles.blueHeader}>
            <View style={styles.brandRow}>
              <View style={styles.walletMark}><Text style={styles.walletMarkText}>G</Text></View>
              <View style={styles.brandCopy}>
                <Text style={styles.brand}>GCash Sandbox</Text>
                <Text style={styles.demoBadge}>DEMO PAYMENT • NO REAL MONEY</Text>
              </View>
              <Ionicons name="shield-checkmark" color="#FFFFFF" size={24} />
            </View>
          </View>

          {!completed ? (
            <ScrollView contentContainerStyle={styles.body} bounces={false}>
              <Text style={styles.caption}>PAYING</Text>
              <Text style={styles.merchant}>{description}</Text>
              <View style={styles.amountBox}>
                <Text style={styles.amountLabel}>Amount due</Text>
                <Text style={styles.amount}>₱{Number(amount || 0).toFixed(2)}</Text>
              </View>
              <View style={styles.accountRow}>
                <View style={styles.phoneIcon}><Ionicons name="phone-portrait-outline" size={20} color={BLUE} /></View>
                <View style={styles.accountCopy}>
                  <Text style={styles.accountLabel}>Test wallet</Text>
                  <Text style={styles.accountNumber}>09•• ••• ••••</Text>
                </View>
                <Text style={styles.testBalance}>Sandbox balance</Text>
              </View>
              <Text style={styles.notice}>This screen simulates an e-wallet checkout. It will never request a real mobile number, MPIN, OTP, or account credential.</Text>
              <View style={styles.scenarioBox}>
                <Text style={styles.scenarioTitle}>TEST RESULT</Text>
                <Text style={styles.scenarioHint}>Choose the result returned by this new sandbox payment.</Text>
                <View style={styles.scenarioRow}>
                  {scenarios.map((item) => (
                    <TouchableOpacity
                      key={item.value}
                      disabled={busy}
                      onPress={() => onScenarioChange?.(item.value)}
                      style={[styles.scenarioButton, scenario === item.value && styles.scenarioButtonActive]}
                    >
                      <Text style={[styles.scenarioText, scenario === item.value && styles.scenarioTextActive]}>{item.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
              <TouchableOpacity disabled={busy || amount <= 0} onPress={onConfirm} style={[styles.payButton, (busy || amount <= 0) && styles.disabled]}>
                {busy ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.payText}>Pay ₱{Number(amount || 0).toFixed(2)}</Text>}
              </TouchableOpacity>
              <TouchableOpacity disabled={busy} onPress={onClose} style={styles.secondaryButton}><Text style={styles.secondaryText}>Cancel</Text></TouchableOpacity>
            </ScrollView>
          ) : (
            <ScrollView contentContainerStyle={styles.body} bounces={false}>
              <Ionicons name={copy.icon} size={68} color={copy.color} style={styles.statusIcon} />
              <Text style={styles.resultTitle}>{copy.title}</Text>
              <Text style={styles.resultDetail}>{copy.detail}</Text>
              {!!error && <Text style={styles.errorText}>{error}</Text>}
              <View style={styles.receipt}>
                <View style={styles.receiptRow}><Text style={styles.receiptLabel}>Merchant</Text><Text style={styles.receiptValue}>{description}</Text></View>
                <View style={styles.receiptRow}><Text style={styles.receiptLabel}>Amount</Text><Text style={styles.receiptAmount}>₱{Number(amount || 0).toFixed(2)}</Text></View>
                {!!reference && <View style={styles.receiptRow}><Text style={styles.receiptLabel}>Reference</Text><Text numberOfLines={1} style={styles.reference}>{reference}</Text></View>}
                <View style={styles.receiptRow}><Text style={styles.receiptLabel}>Environment</Text><Text style={styles.sandboxValue}>SANDBOX</Text></View>
              </View>
              {(status === "failed" || status === "cancelled") && (
                <View style={styles.scenarioBox}>
                  <Text style={styles.scenarioTitle}>RETRY RESULT</Text>
                  <Text style={styles.scenarioHint}>Choose the result for the new attempt on this same order.</Text>
                  <View style={styles.scenarioRow}>
                    {scenarios.map((item) => (
                      <TouchableOpacity
                        key={item.value}
                        disabled={busy}
                        onPress={() => onScenarioChange?.(item.value)}
                        style={[styles.scenarioButton, scenario === item.value && styles.scenarioButtonActive]}
                      >
                        <Text style={[styles.scenarioText, scenario === item.value && styles.scenarioTextActive]}>{item.label}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              )}
              {status === "pending" && <TouchableOpacity disabled={busy} onPress={onComplete} style={[styles.payButton, busy && styles.disabled]}>{busy ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.payText}>Complete test payment</Text>}</TouchableOpacity>}
              {status === "pending" && <TouchableOpacity disabled={busy} onPress={onRefresh} style={styles.secondaryButton}><Text style={styles.secondaryText}>Check payment status</Text></TouchableOpacity>}
              {status === "pending" && <TouchableOpacity disabled={busy} onPress={onCancel} style={styles.secondaryButton}><Text style={styles.dangerText}>Cancel test payment</Text></TouchableOpacity>}
              {(status === "failed" || status === "cancelled") && <TouchableOpacity disabled={busy} onPress={onRetry} style={[styles.payButton, busy && styles.disabled]}><Text style={styles.payText}>Try again</Text></TouchableOpacity>}
              {status !== "pending" && <TouchableOpacity disabled={busy} onPress={onClose} style={styles.secondaryButton}><Text style={styles.secondaryText}>Done</Text></TouchableOpacity>}
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "#06111FCC", justifyContent: "flex-end" },
  sheet: { backgroundColor: "#FFFFFF", borderTopLeftRadius: 28, borderTopRightRadius: 28, overflow: "hidden", maxHeight: "94%" },
  blueHeader: { backgroundColor: BLUE, paddingTop: 20, paddingBottom: 18, paddingHorizontal: 20 },
  brandRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  walletMark: { width: 42, height: 42, borderRadius: 21, backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center" },
  walletMarkText: { color: BLUE, fontSize: 24, fontWeight: "900" },
  brandCopy: { flex: 1 },
  brand: { color: "#FFFFFF", fontSize: 20, fontWeight: "900" },
  demoBadge: { color: "#DCEBFF", fontSize: 9, fontWeight: "800", letterSpacing: 0.7, marginTop: 2 },
  body: { padding: 22, gap: 14 },
  caption: { color: "#7D8794", fontSize: 11, fontWeight: "800", letterSpacing: 1.2 },
  merchant: { color: "#172033", fontSize: 19, fontWeight: "800" },
  amountBox: { alignItems: "center", paddingVertical: 20, borderRadius: 16, backgroundColor: "#F1F7FF", borderWidth: 1, borderColor: "#D9E9FF" },
  amountLabel: { color: "#697688", fontSize: 12 },
  amount: { color: "#121C2F", fontSize: 34, fontWeight: "900", marginTop: 4 },
  accountRow: { flexDirection: "row", alignItems: "center", paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: "#E8EDF3" },
  phoneIcon: { width: 38, height: 38, borderRadius: 19, backgroundColor: "#EAF3FF", alignItems: "center", justifyContent: "center" },
  accountCopy: { flex: 1, marginLeft: 11 },
  accountLabel: { color: "#697688", fontSize: 11 },
  accountNumber: { color: "#172033", fontWeight: "800", marginTop: 2 },
  testBalance: { color: BLUE, fontSize: 10, fontWeight: "800" },
  notice: { color: "#697688", fontSize: 11, lineHeight: 16, textAlign: "center" },
  scenarioBox: { backgroundColor: "#F7F9FC", borderRadius: 14, borderWidth: 1, borderColor: "#E6EBF2", padding: 12, gap: 7 },
  scenarioTitle: { color: "#697688", fontSize: 10, fontWeight: "900", letterSpacing: 1 },
  scenarioHint: { color: "#697688", fontSize: 11 },
  scenarioRow: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  scenarioButton: { minWidth: "47%", flexGrow: 1, borderRadius: 9, borderWidth: 1, borderColor: "#CED7E3", paddingVertical: 9, paddingHorizontal: 10, alignItems: "center" },
  scenarioButtonActive: { backgroundColor: "#EAF3FF", borderColor: BLUE },
  scenarioText: { color: "#697688", fontSize: 11, fontWeight: "800" },
  scenarioTextActive: { color: BLUE },
  payButton: { minHeight: 52, borderRadius: 13, backgroundColor: BLUE, alignItems: "center", justifyContent: "center", paddingHorizontal: 14 },
  payText: { color: "#FFFFFF", fontSize: 15, fontWeight: "900" },
  secondaryButton: { minHeight: 44, alignItems: "center", justifyContent: "center" },
  secondaryText: { color: "#4F5C6D", fontWeight: "800" },
  dangerText: { color: "#D94A4A", fontWeight: "800" },
  disabled: { opacity: 0.55 },
  statusIcon: { alignSelf: "center", marginTop: 4 },
  resultTitle: { color: "#172033", fontSize: 24, fontWeight: "900", textAlign: "center" },
  resultDetail: { color: "#697688", lineHeight: 19, textAlign: "center" },
  receipt: { backgroundColor: "#F7F9FC", borderRadius: 15, padding: 14, gap: 12, borderWidth: 1, borderColor: "#E6EBF2" },
  receiptRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  receiptLabel: { color: "#7D8794", fontSize: 12 },
  receiptValue: { color: "#172033", fontSize: 12, fontWeight: "700", flexShrink: 1, textAlign: "right" },
  receiptAmount: { color: "#172033", fontSize: 17, fontWeight: "900" },
  reference: { color: "#3E4B5E", fontSize: 10, flex: 1, textAlign: "right" },
  sandboxValue: { color: "#E39A16", fontSize: 11, fontWeight: "900" },
  errorText: { color: "#D94A4A", backgroundColor: "#FFF0F0", borderRadius: 10, padding: 10, fontSize: 12, textAlign: "center" },
});
