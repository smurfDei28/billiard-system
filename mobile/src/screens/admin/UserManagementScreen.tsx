import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  RefreshControl, ActivityIndicator, Alert, TextInput, Modal,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../../context/AuthContext';
import { COLORS, RANK_CONFIG, MEMBERSHIP_PLANS } from '../../constants';

// ── Field component defined OUTSIDE to prevent keyboard bug ──────────────────
const Field = ({ label, value, onChange, placeholder, keyboardType, secureTextEntry, autoCapitalize }: any) => (
  <View style={s.fieldGroup}>
    <Text style={s.fieldLabel}>{label}</Text>
    <TextInput
      style={s.fieldInput}
      value={value}
      onChangeText={onChange}
      placeholder={placeholder}
      placeholderTextColor={COLORS.textMuted}
      keyboardType={keyboardType || 'default'}
      secureTextEntry={secureTextEntry || false}
      autoCapitalize={autoCapitalize ?? 'none'}
    />
  </View>
);

export default function UserManagementScreen() {
  const [users, setUsers] = useState<any[]>([]);
  const [filtered, setFiltered] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<'ALL' | 'MEMBER' | 'STAFF' | 'ADMIN'>('ALL');
  const [selectedUser, setSelectedUser] = useState<any>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [createStaffModal, setCreateStaffModal] = useState(false);
  const [staffForm, setStaffForm] = useState({ firstName: '', lastName: '', email: '', phone: '', password: '', confirmPassword: '' });
  const [staffLoading, setStaffLoading] = useState(false);

  const fetchUsers = useCallback(async () => {
    try {
      const res = await api.get('/api/users');
      setUsers(res.data);
      setFiltered(res.data);
    } catch { }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => { fetchUsers(); }, []);

  useEffect(() => {
    let result = users;
    if (roleFilter !== 'ALL') result = result.filter(u => u.role === roleFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(u =>
        u.email?.toLowerCase().includes(q) ||
        `${u.firstName} ${u.lastName}`.toLowerCase().includes(q)
      );
    }
    setFiltered(result);
  }, [search, roleFilter, users]);

  const createStaff = async () => {
    const { firstName, lastName, email, phone, password, confirmPassword } = staffForm;
    if (!firstName.trim() || !lastName.trim() || !email.trim() || !phone.trim() || !password)
      return Alert.alert('Missing Fields', 'Please fill in all required fields.');
    if (password !== confirmPassword)
      return Alert.alert('Password Mismatch', 'Passwords do not match.');
    if (password.length < 8)
      return Alert.alert('Weak Password', 'Password must be at least 8 characters.');
    if (!/[A-Z]/.test(password))
      return Alert.alert('Weak Password', 'Password must contain at least one uppercase letter.');
    if (!/[0-9]/.test(password))
      return Alert.alert('Weak Password', 'Password must contain at least one number.');
    if (!/^(\+63|0)[0-9]{10}$/.test(phone))
      return Alert.alert('Invalid Phone', 'Enter a valid Philippine phone number (e.g. 09171234567).');

    setStaffLoading(true);
    try {
      await api.post('/api/auth/create-staff', {
        firstName: firstName.trim(), lastName: lastName.trim(),
        email: email.trim().toLowerCase(), phone: phone.trim(), password,
      });
      Alert.alert('✅ Staff Created', `${firstName} ${lastName} has been registered as Staff.`);
      setCreateStaffModal(false);
      setStaffForm({ firstName: '', lastName: '', email: '', phone: '', password: '', confirmPassword: '' });
      fetchUsers();
    } catch (err: any) {
      Alert.alert('Error', err.response?.data?.error || 'Failed to create staff account.');
    } finally { setStaffLoading(false); }
  };

  const grantLoyalty = async (userId: string, credits: number, description: string) => {
    setActionLoading(true);
    try {
      await api.post('/api/loyalty/grant', { userId, creditsAwarded: credits, description, trigger: 'MANUAL_GRANT' });
      fetchUsers();
      Alert.alert('✅ Granted', `${credits} credits added`);
    } catch (err: any) {
      Alert.alert('Error', err.response?.data?.error || 'Failed');
    } finally { setActionLoading(false); }
  };

  const ROLE_COLORS: Record<string, string> = { MEMBER: COLORS.info, STAFF: COLORS.gold, ADMIN: COLORS.rankElite };

  if (loading) return <View style={s.center}><ActivityIndicator size="large" color={COLORS.primary} /></View>;

  return (
    <View style={s.container}>
      <View style={s.header}>
        <View>
          <Text style={s.title}>👥 Users ({filtered.length})</Text>
          <Text style={s.subtitle}>{users.filter(u => u.role === 'MEMBER').length} members · {users.filter(u => u.role === 'STAFF').length} staff</Text>
        </View>
        <TouchableOpacity style={s.createStaffBtn} onPress={() => setCreateStaffModal(true)}>
          <Ionicons name="person-add-outline" size={16} color="#000" />
          <Text style={s.createStaffTxt}>Add Staff</Text>
        </TouchableOpacity>
      </View>

      <View style={s.searchBar}>
        <View style={s.searchInput}>
          <Ionicons name="search-outline" size={16} color={COLORS.textMuted} />
          <TextInput style={s.searchTxt} placeholder="Search name or email..." placeholderTextColor={COLORS.textMuted} value={search} onChangeText={setSearch} />
          {search ? <TouchableOpacity onPress={() => setSearch('')}><Ionicons name="close-circle" size={16} color={COLORS.textMuted} /></TouchableOpacity> : null}
        </View>
      </View>

      <View style={s.roleFilters}>
        {(['ALL', 'MEMBER', 'STAFF', 'ADMIN'] as const).map(r => (
          <TouchableOpacity key={r} style={[s.roleFilter, roleFilter === r && s.roleFilterActive]} onPress={() => setRoleFilter(r)}>
            <Text style={[s.roleFilterTxt, roleFilter === r && s.roleFilterTxtActive]}>{r}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView contentContainerStyle={s.list} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchUsers(); }} tintColor={COLORS.primary} />}>
        {filtered.map((user: any) => {
          const gp = user.gamifiedProfile;
          const rankCfg = RANK_CONFIG[gp?.rank as keyof typeof RANK_CONFIG] || RANK_CONFIG.Rookie;
          return (
            <TouchableOpacity key={user.id} style={s.userCard} onPress={() => setSelectedUser(user)} activeOpacity={0.8}>
              <View style={[s.avatar, { backgroundColor: rankCfg.color + '20' }]}><Text style={s.avatarTxt}>{rankCfg.icon}</Text></View>
              <View style={s.userInfo}>
                <Text style={s.userName}>{user.firstName} {user.lastName}</Text>
                <Text style={s.userEmail}>{user.email}</Text>
                <View style={s.userMeta}>
                  <View style={[s.roleBadge, { backgroundColor: (ROLE_COLORS[user.role] || COLORS.textMuted) + '20' }]}>
                    <Text style={[s.roleTxt, { color: ROLE_COLORS[user.role] || COLORS.textMuted }]}>{user.role}</Text>
                  </View>
                  {gp && <Text style={s.metaRank}>{gp.rank} · {gp.totalWins}W</Text>}
                  {user.membership && <Text style={s.metaCredits}>💳 {user.membership.creditBalance?.toFixed(0)} cr</Text>}
                </View>
              </View>
              <Ionicons name="chevron-forward" size={16} color={COLORS.textMuted} />
            </TouchableOpacity>
          );
        })}
        {filtered.length === 0 && <View style={s.empty}><Text style={s.emptyTxt}>No users found</Text></View>}
      </ScrollView>

      {/* ── Create Staff Modal ── */}
      <Modal visible={createStaffModal} animationType="slide">
        <View style={s.modal}>
          <View style={s.modalHeader}>
            <TouchableOpacity onPress={() => setCreateStaffModal(false)}><Ionicons name="close" size={24} color={COLORS.textPrimary} /></TouchableOpacity>
            <Text style={s.modalTitle}>Register Staff Account</Text>
            <View style={{ width: 24 }} />
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={s.modalContent}>
            <View style={s.infoBox}>
              <Ionicons name="information-circle-outline" size={16} color={COLORS.info} />
              <Text style={s.infoTxt}>Staff accounts are created directly by Admin. Staff can manage tables, POS, inventory, credits, queue, and reservations.</Text>
            </View>
            <View style={s.nameRow}>
              <View style={{ flex: 1 }}><Field label="First Name *" value={staffForm.firstName} onChange={(v: string) => setStaffForm(f => ({ ...f, firstName: v }))} placeholder="Juan" autoCapitalize="words" /></View>
              <View style={{ flex: 1 }}><Field label="Last Name *" value={staffForm.lastName} onChange={(v: string) => setStaffForm(f => ({ ...f, lastName: v }))} placeholder="Dela Cruz" autoCapitalize="words" /></View>
            </View>
            <Field label="Email Address *" value={staffForm.email} onChange={(v: string) => setStaffForm(f => ({ ...f, email: v }))} placeholder="staff@saturdaynights.ph" keyboardType="email-address" />
            <Field label="Phone Number *" value={staffForm.phone} onChange={(v: string) => setStaffForm(f => ({ ...f, phone: v }))} placeholder="09171234567" keyboardType="phone-pad" />
            <Field label="Password *" value={staffForm.password} onChange={(v: string) => setStaffForm(f => ({ ...f, password: v }))} placeholder="Min 8 chars, 1 uppercase, 1 number" secureTextEntry />
            <Field label="Confirm Password *" value={staffForm.confirmPassword} onChange={(v: string) => setStaffForm(f => ({ ...f, confirmPassword: v }))} placeholder="Re-enter password" secureTextEntry />
            <View style={s.passwordHint}><Text style={s.passwordHintTxt}>Requirements: at least 8 characters, 1 uppercase letter, 1 number.</Text></View>
            <TouchableOpacity style={[s.submitBtn, staffLoading && s.submitBtnDis]} onPress={createStaff} disabled={staffLoading}>
              {staffLoading ? <ActivityIndicator color="#000" /> : <><Ionicons name="person-add-outline" size={18} color="#000" /><Text style={s.submitTxt}>Create Staff Account</Text></>}
            </TouchableOpacity>
          </ScrollView>
        </View>
      </Modal>

      {/* ── User Detail Modal ── */}
      <Modal visible={!!selectedUser} animationType="slide">
        <View style={s.modal}>
          <View style={s.modalHeader}>
            <TouchableOpacity onPress={() => setSelectedUser(null)}><Ionicons name="arrow-back" size={24} color={COLORS.textPrimary} /></TouchableOpacity>
            <Text style={s.modalTitle}>User Details</Text>
            <View style={{ width: 24 }} />
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={s.modalContent}>
            {selectedUser && (() => {
              const gp = selectedUser.gamifiedProfile;
              const rankCfg = RANK_CONFIG[gp?.rank as keyof typeof RANK_CONFIG] || RANK_CONFIG.Rookie;
              const planCfg = MEMBERSHIP_PLANS[selectedUser.membership?.plan as keyof typeof MEMBERSHIP_PLANS];
              return (
                <>
                  <View style={[s.profileCard, { borderColor: rankCfg.color + '60' }]}>
                    <View style={[s.bigAvatar, { backgroundColor: rankCfg.color + '20', borderColor: rankCfg.color }]}><Text style={s.bigAvatarTxt}>{rankCfg.icon}</Text></View>
                    <Text style={s.profileName}>{selectedUser.firstName} {selectedUser.lastName}</Text>
                    <Text style={s.profileEmail}>{selectedUser.email}</Text>
                    {selectedUser.phone && <Text style={s.profilePhone}>{selectedUser.phone}</Text>}
                    <Text style={s.profileJoined}>Joined {new Date(selectedUser.createdAt).toLocaleDateString('en-PH')}</Text>
                    <View style={s.profileBadges}>
                      <View style={[s.badge, { backgroundColor: (ROLE_COLORS[selectedUser.role]) + '20' }]}><Text style={[s.badgeTxt, { color: ROLE_COLORS[selectedUser.role] }]}>{selectedUser.role}</Text></View>
                      {gp && <View style={[s.badge, { backgroundColor: rankCfg.color + '20' }]}><Text style={[s.badgeTxt, { color: rankCfg.color }]}>{gp.rank} Lv.{gp.level}</Text></View>}
                      {planCfg && <View style={[s.badge, { backgroundColor: planCfg.color + '20' }]}><Text style={[s.badgeTxt, { color: planCfg.color }]}>{planCfg.icon} {planCfg.label}</Text></View>}
                    </View>
                  </View>

                  <View style={s.statsRow}>
                    {[
                      { label: 'Credits', val: (selectedUser.membership?.creditBalance || 0).toFixed(0), color: COLORS.primary },
                      { label: 'Hours', val: (selectedUser.membership?.totalHoursPlayed || 0).toFixed(1), color: COLORS.info },
                      { label: 'Wins', val: gp?.totalWins || 0, color: COLORS.gold },
                      { label: 'Games', val: gp?.totalGames || 0, color: COLORS.success },
                    ].map(stat => (
                      <View key={stat.label} style={s.statCard}>
                        <Text style={[s.statVal, { color: stat.color }]}>{stat.val}</Text>
                        <Text style={s.statLbl}>{stat.label}</Text>
                      </View>
                    ))}
                  </View>

                  <View style={s.section}>
                    <Text style={s.sectionTitle}>Account Role</Text>
                    <View style={s.roleInfoBox}>
                      <View style={[s.badge, { backgroundColor: (ROLE_COLORS[selectedUser.role] || COLORS.textMuted) + '20' }]}>
                        <Text style={[s.badgeTxt, { color: ROLE_COLORS[selectedUser.role] || COLORS.textMuted, fontSize: 14 }]}>{selectedUser.role}</Text>
                      </View>
                      <Text style={s.roleInfoNote}>
                        {selectedUser.role === 'STAFF' ? 'Staff accounts are created by Admin via "Add Staff".'
                          : selectedUser.role === 'ADMIN' ? 'Admin accounts cannot be modified here.'
                          : 'Members self-register. Use "Add Staff" to create a staff account.'}
                      </Text>
                    </View>
                  </View>

                  {selectedUser.role === 'MEMBER' && (
                    <View style={s.section}>
                      <Text style={s.sectionTitle}>Grant Loyalty Credits</Text>
                      <View style={s.actionBtns}>
                        {[{ label: '+ 60 Credits (1 hr)', credits: 60, desc: 'Manual loyalty grant' }, { label: '+ 120 Credits (2 hrs)', credits: 120, desc: 'Manual loyalty grant' }, { label: '+ 300 Credits (5 hrs)', credits: 300, desc: 'Manual loyalty grant' }].map(action => (
                          <TouchableOpacity key={action.credits} style={s.actionBtn} onPress={() => grantLoyalty(selectedUser.id, action.credits, action.desc)} disabled={actionLoading}>
                            {actionLoading ? <ActivityIndicator size="small" color={COLORS.primary} /> : <Text style={s.actionBtnTxt}>{action.label}</Text>}
                          </TouchableOpacity>
                        ))}
                      </View>
                    </View>
                  )}

                  {selectedUser.role === 'MEMBER' && (
                    <View style={s.section}>
                      <Text style={s.sectionTitle}>Membership Plan</Text>
                      <View style={s.planRow}>
                        {Object.entries(MEMBERSHIP_PLANS).map(([key, plan]) => (
                          <TouchableOpacity key={key} style={[s.planBtn, selectedUser.membership?.plan === key && { borderColor: plan.color, backgroundColor: plan.color + '15' }]}
                            onPress={async () => { try { await api.patch('/api/membership/plan', { userId: selectedUser.id, plan: key }); fetchUsers(); Alert.alert('✅ Plan Updated'); } catch { Alert.alert('Error', 'Failed to update plan'); } }}>
                            <Text style={s.planBtnIcon}>{plan.icon}</Text>
                            <Text style={[s.planBtnTxt, { color: selectedUser.membership?.plan === key ? plan.color : COLORS.textMuted }]}>{plan.label}</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    </View>
                  )}
                </>
              );
            })()}
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.background },
  header: { paddingTop: 60, paddingHorizontal: 20, paddingBottom: 14, backgroundColor: COLORS.surface, borderBottomWidth: 1, borderBottomColor: COLORS.surfaceBorder, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { fontSize: 22, fontWeight: '800', color: COLORS.textPrimary },
  subtitle: { fontSize: 13, color: COLORS.textSecondary },
  createStaffBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: COLORS.gold, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8 },
  createStaffTxt: { color: '#000', fontWeight: '700', fontSize: 13 },
  searchBar: { padding: 12, backgroundColor: COLORS.surface, borderBottomWidth: 1, borderBottomColor: COLORS.surfaceBorder },
  searchInput: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: COLORS.surfaceLight, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: COLORS.surfaceBorder },
  searchTxt: { flex: 1, color: COLORS.textPrimary, fontSize: 14 },
  roleFilters: { flexDirection: 'row', paddingHorizontal: 12, paddingVertical: 8, gap: 8, backgroundColor: COLORS.surface, borderBottomWidth: 1, borderBottomColor: COLORS.surfaceBorder },
  roleFilter: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, backgroundColor: COLORS.surfaceLight, borderWidth: 1, borderColor: COLORS.surfaceBorder },
  roleFilterActive: { backgroundColor: COLORS.primary + '20', borderColor: COLORS.primary },
  roleFilterTxt: { fontSize: 12, fontWeight: '600', color: COLORS.textMuted },
  roleFilterTxtActive: { color: COLORS.primary },
  list: { padding: 12, gap: 8 },
  userCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: COLORS.surface, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: COLORS.surfaceBorder },
  avatar: { width: 44, height: 44, borderRadius: 22, justifyContent: 'center', alignItems: 'center' },
  avatarTxt: { fontSize: 20 },
  userInfo: { flex: 1, gap: 3 },
  userName: { fontSize: 15, fontWeight: '700', color: COLORS.textPrimary },
  userEmail: { fontSize: 12, color: COLORS.textMuted },
  userMeta: { flexDirection: 'row', gap: 8, alignItems: 'center', flexWrap: 'wrap' },
  roleBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  roleTxt: { fontSize: 10, fontWeight: '700' },
  metaRank: { fontSize: 11, color: COLORS.textSecondary },
  metaCredits: { fontSize: 11, color: COLORS.primary },
  empty: { padding: 40, alignItems: 'center' },
  emptyTxt: { color: COLORS.textMuted },
  modal: { flex: 1, backgroundColor: COLORS.background },
  modalHeader: { paddingTop: 60, paddingHorizontal: 20, paddingBottom: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: COLORS.surface, borderBottomWidth: 1, borderBottomColor: COLORS.surfaceBorder },
  modalTitle: { fontSize: 18, fontWeight: '800', color: COLORS.textPrimary },
  modalContent: { padding: 16, gap: 14 },
  infoBox: { flexDirection: 'row', gap: 8, backgroundColor: COLORS.info + '15', borderRadius: 10, padding: 12, borderWidth: 1, borderColor: COLORS.info + '40', alignItems: 'flex-start' },
  infoTxt: { flex: 1, fontSize: 12, color: COLORS.textSecondary, lineHeight: 18 },
  nameRow: { flexDirection: 'row', gap: 10 },
  fieldGroup: { gap: 6 },
  fieldLabel: { fontSize: 13, fontWeight: '600', color: COLORS.textSecondary },
  fieldInput: { backgroundColor: COLORS.surface, borderRadius: 10, paddingHorizontal: 14, height: 46, color: COLORS.textPrimary, borderWidth: 1, borderColor: COLORS.surfaceBorder, fontSize: 15 },
  passwordHint: { backgroundColor: COLORS.surfaceLight, borderRadius: 8, padding: 10 },
  passwordHintTxt: { fontSize: 11, color: COLORS.textMuted, lineHeight: 16 },
  submitBtn: { backgroundColor: COLORS.gold, borderRadius: 14, height: 52, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8, marginTop: 4 },
  submitBtnDis: { opacity: 0.5 },
  submitTxt: { color: '#000', fontWeight: '800', fontSize: 16 },
  profileCard: { backgroundColor: COLORS.surface, borderRadius: 20, padding: 20, alignItems: 'center', gap: 8, borderWidth: 1 },
  bigAvatar: { width: 72, height: 72, borderRadius: 36, justifyContent: 'center', alignItems: 'center', borderWidth: 2 },
  bigAvatarTxt: { fontSize: 32 },
  profileName: { fontSize: 20, fontWeight: '800', color: COLORS.textPrimary },
  profileEmail: { fontSize: 13, color: COLORS.textSecondary },
  profilePhone: { fontSize: 13, color: COLORS.textMuted },
  profileJoined: { fontSize: 11, color: COLORS.textMuted },
  profileBadges: { flexDirection: 'row', gap: 6, flexWrap: 'wrap', justifyContent: 'center' },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  badgeTxt: { fontSize: 11, fontWeight: '700' },
  statsRow: { flexDirection: 'row', gap: 8 },
  statCard: { flex: 1, backgroundColor: COLORS.surface, borderRadius: 12, padding: 14, alignItems: 'center', gap: 4, borderWidth: 1, borderColor: COLORS.surfaceBorder },
  statVal: { fontSize: 20, fontWeight: '900' },
  statLbl: { fontSize: 10, color: COLORS.textMuted },
  section: { gap: 10 },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: COLORS.textPrimary },
  roleInfoBox: { backgroundColor: COLORS.surface, borderRadius: 12, padding: 14, gap: 10, borderWidth: 1, borderColor: COLORS.surfaceBorder },
  roleInfoNote: { fontSize: 12, color: COLORS.textSecondary, lineHeight: 18 },
  actionBtns: { gap: 8 },
  actionBtn: { backgroundColor: COLORS.surface, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: COLORS.primary + '40', alignItems: 'center' },
  actionBtnTxt: { fontSize: 14, fontWeight: '700', color: COLORS.primary },
  planRow: { flexDirection: 'row', gap: 8 },
  planBtn: { flex: 1, backgroundColor: COLORS.surface, borderRadius: 10, padding: 12, alignItems: 'center', gap: 4, borderWidth: 1, borderColor: COLORS.surfaceBorder },
  planBtnIcon: { fontSize: 18 },
  planBtnTxt: { fontSize: 10, fontWeight: '700' },
});
