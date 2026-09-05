import React, { useEffect, useState } from 'react';
import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../constants';

type DialogButton = { text?: string; onPress?: () => void; style?: 'default' | 'cancel' | 'destructive' };
type Dialog = { title?: string; message?: string; buttons?: DialogButton[] };

let present: ((dialog: Dialog) => void) | null = null;

// Compatibility bridge for existing Alert.alert call sites. It deliberately
// keeps Alert's title/message/button callback contract so business flows do
// not change while feedback uses the established dark modal styling.
export const showDialog = (title?: string, message?: string, buttons?: DialogButton[]) => {
  present?.({ title, message, buttons });
};

export default function AppDialogHost() {
  const [dialog, setDialog] = useState<Dialog | null>(null);

  useEffect(() => {
    present = setDialog;
    return () => { present = null; };
  }, []);

  if (!dialog) return null;
  const buttons = dialog.buttons?.length ? dialog.buttons : [{ text: 'OK' }];
  const destructive = buttons.find((button) => button.style === 'destructive');
  const icon = destructive ? 'warning-outline' : dialog.title?.toLowerCase().includes('error') || dialog.title?.toLowerCase().includes('failed') ? 'alert-circle-outline' : 'information-circle-outline';
  const iconColor = destructive ? COLORS.error : icon === 'alert-circle-outline' ? COLORS.error : COLORS.primary;
  const dismiss = () => {
    const cancel = buttons.find((button) => button.style === 'cancel');
    setDialog(null);
    cancel?.onPress?.();
  };
  const choose = (button: DialogButton) => {
    setDialog(null);
    button.onPress?.();
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={dismiss}>
      <View style={s.overlay}>
        <View style={s.modalCard}>
          <Ionicons name={icon as any} size={30} color={iconColor} />
          {!!dialog.title && <Text style={s.modalTitle}>{dialog.title}</Text>}
          {!!dialog.message && <Text style={s.modalMsg}>{dialog.message}</Text>}
          <View style={s.modalBtns}>
            {buttons.map((button, index) => {
              const isDestructive = button.style === 'destructive';
              const isCancel = button.style === 'cancel';
              return (
                <TouchableOpacity key={`${button.text || 'OK'}-${index}`} style={[s.button, isCancel ? s.cancelBtn : isDestructive ? s.destructiveBtn : s.confirmBtn]} onPress={() => choose(button)}>
                  <Text style={[s.buttonTxt, isCancel ? s.cancelTxt : s.confirmTxt]}>{button.text || 'OK'}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: '#000000AA', justifyContent: 'center', alignItems: 'center', padding: 32 },
  modalCard: { backgroundColor: COLORS.surface, borderRadius: 20, padding: 24, gap: 12, width: '100%', borderWidth: 1, borderColor: COLORS.surfaceBorder },
  modalTitle: { fontSize: 18, fontWeight: '800', color: COLORS.textPrimary },
  modalMsg: { fontSize: 14, color: COLORS.textSecondary, lineHeight: 20 },
  modalBtns: { flexDirection: 'row', gap: 10, marginTop: 8 },
  button: { flex: 1, borderRadius: 12, padding: 14, alignItems: 'center' },
  cancelBtn: { backgroundColor: COLORS.surfaceLight },
  confirmBtn: { backgroundColor: COLORS.primary },
  destructiveBtn: { backgroundColor: COLORS.error },
  buttonTxt: { fontWeight: '700' },
  cancelTxt: { color: COLORS.textPrimary },
  confirmTxt: { color: '#000' },
});
