// AnnouncementsScreen.tsx
import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, TextInput, Alert, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../../context/AuthContext';
import { COLORS } from '../../constants';

const TEMPLATES = [
  { icon: '🎱', label: 'Tournament Announce', title: 'Tournament This Weekend!', message: 'Join us this Saturday for our billiard tournament. Registration open until Friday. Entry fee: ₱50. Prizes await!' },
  { icon: '🎉', label: 'Promo', title: 'Special Promo Today!', message: 'Double credits on all top-ups today only! Visit our cashier to avail.' },
  { icon: '⚠️', label: 'Maintenance', title: 'Scheduled Maintenance', message: 'We will be performing table maintenance this Sunday morning 8AM–10AM. Sorry for the inconvenience.' },
  { icon: '🎂', label: 'Birthday Greeting', title: 'Happy Birthday from Saturday Nights!', message: 'We appreciate your loyalty. Come visit us and claim your birthday reward!' },
  { icon: '🌙', label: 'Closing Soon', title: 'Closing in 30 Minutes', message: 'Saturday Nights Billiard will be closing in 30 minutes. Please settle your tables. Thank you!' },
];

const NOTIF_TYPES = [
  { key: 'EVENT_ANNOUNCEMENT', label: 'Announcement', color: COLORS.primary },
  { key: 'SYSTEM', label: 'System', color: COLORS.info },
  { key: 'TOURNAMENT_INVITE', label: 'Tournament', color: COLORS.gold },
];

export default function AnnouncementsScreen() {
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [type, setType] = useState('EVENT_ANNOUNCEMENT');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<{ count: number; title: string } | null>(null);

  const applyTemplate = (t: typeof TEMPLATES[0]) => {
    setTitle(t.title);
    setMessage(t.message);
  };

  const sendAnnouncement = async () => {
    if (!title.trim() || !message.trim()) return Alert.alert('Error', 'Title and message are required');
    Alert.alert('Broadcast Announcement', `Send to all members?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Send', onPress: async () => {
          setSending(true);
          try {
            const res = await api.post('/api/notifications/broadcast', { title: title.trim(), message: message.trim(), type });
            setSent({ count: res.data.sent, title: title.trim() });
            setTitle(''); setMessage('');
          } catch (err: any) {
            Alert.alert('Error', err.response?.data?.error || 'Failed to send');
          } finally { setSending(false); }
        }
      }
    ]);
  };

  return (
    <KeyboardAvoidingView style={s.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={s.header}>
        <Text style={s.title}>📢 Announcements</Text>
        <Text style={s.subtitle}>Broadcast messages to all members</Text>
      </View>

      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={s.content} >
        {sent && (
          <View style={s.sentCard}>
            <Ionicons name="checkmark-circle" size={24} color={COLORS.success} />
            <View>
              <Text style={s.sentTitle}>Sent Successfully!</Text>
              <Text style={s.sentMsg}>"{sent.title}" sent to {sent.count} members</Text>
            </View>
            <TouchableOpacity onPress={() => setSent(null)}>
              <Ionicons name="close" size={20} color={COLORS.textMuted} />
            </TouchableOpacity>
          </View>
        )}

        {/* Templates */}
        <Text style={s.sectionTitle}>Quick Templates</Text>
        <ScrollView keyboardShouldPersistTaps="handled" horizontal showsHorizontalScrollIndicator={false}>
          <View style={s.templateRow}>
            {TEMPLATES.map(t => (
              <TouchableOpacity key={t.label} style={s.templateBtn} onPress={() => applyTemplate(t)}>
                <Text style={s.templateIcon}>{t.icon}</Text>
                <Text style={s.templateLabel}>{t.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </ScrollView>

        {/* Type */}
        <Text style={s.sectionTitle}>Notification Type</Text>
        <View style={s.typeRow}>
          {NOTIF_TYPES.map(nt => (
            <TouchableOpacity key={nt.key} style={[s.typeBtn, type === nt.key && { borderColor: nt.color, backgroundColor: nt.color + '15' }]} onPress={() => setType(nt.key)}>
              <Text style={[s.typeTxt, { color: type === nt.key ? nt.color : COLORS.textMuted }]}>{nt.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Compose */}
        <Text style={s.sectionTitle}>Compose</Text>
        <View style={s.composeCard}>
          <TextInput
            style={s.titleInput}
            placeholder="Notification title..."
            placeholderTextColor={COLORS.textMuted}
            value={title}
            onChangeText={setTitle}
            maxLength={100}
          />
          <Text style={s.charCount}>{title.length}/100</Text>
          <TextInput
            style={s.msgInput}
            placeholder="Your message to all members..."
            placeholderTextColor={COLORS.textMuted}
            value={message}
            onChangeText={setMessage}
            multiline
            maxLength={500}
            textAlignVertical="top"
          />
          <Text style={s.charCount}>{message.length}/500</Text>
        </View>

        {/* Preview */}
        {(title || message) && (
          <>
            <Text style={s.sectionTitle}>Preview</Text>
            <View style={s.previewCard}>
              <View style={s.previewHeader}>
                <Ionicons name="notifications" size={16} color={COLORS.primary} />
                <Text style={s.previewApp}>Saturday Nights Billiard</Text>
              </View>
              <Text style={s.previewTitle}>{title || 'Title...'}</Text>
              <Text style={s.previewMsg}>{message || 'Message...'}</Text>
            </View>
          </>
        )}

        <TouchableOpacity style={[s.sendBtn, (sending || !title || !message) && s.sendBtnDis]} onPress={sendAnnouncement} disabled={sending || !title.trim() || !message.trim()}>
          {sending ? <ActivityIndicator color="#000" /> : (
            <><Ionicons name="send" size={18} color="#000" /><Text style={s.sendTxt}>Broadcast to All Members</Text></>
          )}
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: { paddingTop: 60, paddingHorizontal: 20, paddingBottom: 14, backgroundColor: COLORS.surface, borderBottomWidth: 1, borderBottomColor: COLORS.surfaceBorder },
  title: { fontSize: 22, fontWeight: '800', color: COLORS.textPrimary },
  subtitle: { fontSize: 13, color: COLORS.textSecondary },
  content: { padding: 16, gap: 14 },
  sentCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: COLORS.success + '15', borderRadius: 14, padding: 14, borderWidth: 1, borderColor: COLORS.success },
  sentTitle: { fontSize: 14, fontWeight: '700', color: COLORS.success },
  sentMsg: { fontSize: 12, color: COLORS.textSecondary },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: COLORS.textPrimary },
  templateRow: { flexDirection: 'row', gap: 10, paddingBottom: 4 },
  templateBtn: { backgroundColor: COLORS.surface, borderRadius: 12, padding: 14, alignItems: 'center', gap: 6, width: 100, borderWidth: 1, borderColor: COLORS.surfaceBorder },
  templateIcon: { fontSize: 24 },
  templateLabel: { fontSize: 10, color: COLORS.textSecondary, textAlign: 'center', fontWeight: '600' },
  typeRow: { flexDirection: 'row', gap: 8 },
  typeBtn: { flex: 1, backgroundColor: COLORS.surface, borderRadius: 10, padding: 12, alignItems: 'center', borderWidth: 1, borderColor: COLORS.surfaceBorder },
  typeTxt: { fontSize: 12, fontWeight: '700' },
  composeCard: { backgroundColor: COLORS.surface, borderRadius: 16, padding: 16, gap: 8, borderWidth: 1, borderColor: COLORS.surfaceBorder },
  titleInput: { fontSize: 16, fontWeight: '700', color: COLORS.textPrimary, borderBottomWidth: 1, borderBottomColor: COLORS.surfaceBorder, paddingBottom: 8 },
  msgInput: { fontSize: 14, color: COLORS.textPrimary, height: 100, marginTop: 8 },
  charCount: { fontSize: 10, color: COLORS.textMuted, alignSelf: 'flex-end' },
  previewCard: { backgroundColor: COLORS.surfaceLight, borderRadius: 14, padding: 14, gap: 6, borderWidth: 1, borderColor: COLORS.surfaceBorder },
  previewHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  previewApp: { fontSize: 11, color: COLORS.textMuted, fontWeight: '600' },
  previewTitle: { fontSize: 14, fontWeight: '800', color: COLORS.textPrimary },
  previewMsg: { fontSize: 13, color: COLORS.textSecondary },
  sendBtn: { backgroundColor: COLORS.primary, borderRadius: 14, height: 54, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 4 },
  sendBtnDis: { opacity: 0.5 },
  sendTxt: { color: '#000', fontWeight: '800', fontSize: 15 },
});
