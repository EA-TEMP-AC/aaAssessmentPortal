import { useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import type { AttendanceRecordState, RosterCandidate } from "../domain/batch";
import type { AttendanceRecordInput } from "../queue/types";

type Props = {
  batchId: string;
  batchType?: string;
  batchStatus?: string;
  roster: RosterCandidate[];
  initialAttendance: Record<string, AttendanceRecordState>;
  onSave: (records: AttendanceRecordInput[]) => Promise<void>;
  saving: boolean;
  banner: string | null;
};

export function AttendanceScreen({
  batchId,
  batchType,
  batchStatus,
  roster,
  initialAttendance,
  onSave,
  saving,
  banner,
}: Props) {
  const [attendance, setAttendance] = useState<Record<string, AttendanceRecordState>>(
    { ...initialAttendance },
  );
  const [notice, setNotice] = useState<string | null>(null);

  const activeCandidates = roster.filter((c) => c.active);
  const inactiveCandidates = roster.filter((c) => !c.active);

  const presentCount = activeCandidates.filter((c) => attendance[c.id]?.present === true).length;
  const absentCount = activeCandidates.filter((c) => attendance[c.id]?.present === false).length;
  const unmarkedCount = activeCandidates.length - presentCount - absentCount;

  function togglePresent(candidateId: string, present: boolean) {
    setAttendance((prev) => {
      const current = prev[candidateId];
      if (current?.present === present) {
        // Toggle off if tapped again
        const copy = { ...prev };
        delete copy[candidateId];
        return copy;
      }
      return {
        ...prev,
        [candidateId]: {
          candidateId,
          present,
          idVerified: current?.idVerified ?? false,
          note: current?.note,
        },
      };
    });
  }

  function toggleIdVerified(candidateId: string) {
    setAttendance((prev) => {
      const current = prev[candidateId];
      return {
        ...prev,
        [candidateId]: {
          candidateId,
          present: current?.present ?? true,
          idVerified: !(current?.idVerified ?? false),
          note: current?.note,
        },
      };
    });
  }

  function setNote(candidateId: string, note: string) {
    setAttendance((prev) => {
      const current = prev[candidateId];
      return {
        ...prev,
        [candidateId]: {
          candidateId,
          present: current?.present ?? false,
          idVerified: current?.idVerified,
          note: note.trim() || undefined,
        },
      };
    });
  }

  async function handleSave() {
    setNotice(null);
    const records: AttendanceRecordInput[] = [];
    for (const [candidateId, state] of Object.entries(attendance)) {
      if (state && typeof state.present === "boolean") {
        records.push({
          candidateId,
          present: state.present,
          idVerified: state.idVerified,
          note: state.note,
        });
      }
    }
    if (records.length === 0) {
      setNotice("Mark attendance for at least one candidate before saving.");
      return;
    }
    await onSave(records);
    setNotice("Attendance saved offline and queued for sync.");
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Candidate Attendance</Text>
        <Text style={styles.subtitle}>
          Batch {batchId.slice(-6)} • {batchType ?? "STT"} • Status: {batchStatus ?? "in_progress"}
        </Text>
      </View>

      <View style={styles.summaryCard}>
        <View style={styles.summaryItem}>
          <Text style={styles.summaryValue}>{activeCandidates.length}</Text>
          <Text style={styles.summaryLabel}>Total</Text>
        </View>
        <View style={styles.summaryItem}>
          <Text style={[styles.summaryValue, styles.presentColor]}>{presentCount}</Text>
          <Text style={styles.summaryLabel}>Present</Text>
        </View>
        <View style={styles.summaryItem}>
          <Text style={[styles.summaryValue, styles.absentColor]}>{absentCount}</Text>
          <Text style={styles.summaryLabel}>Absent</Text>
        </View>
        <View style={styles.summaryItem}>
          <Text style={[styles.summaryValue, styles.unmarkedColor]}>{unmarkedCount}</Text>
          <Text style={styles.summaryLabel}>Unmarked</Text>
        </View>
      </View>

      {banner ? <Text style={styles.banner}>{banner}</Text> : null}
      {notice ? <Text style={styles.notice}>{notice}</Text> : null}

      <Text style={styles.sectionTitle}>Active Roster ({activeCandidates.length})</Text>

      {activeCandidates.map((candidate) => {
        const state = attendance[candidate.id];
        const isPresent = state?.present === true;
        const isAbsent = state?.present === false;
        const isIdVerified = state?.idVerified === true;

        return (
          <View key={candidate.id} style={styles.candidateCard}>
            <View style={styles.candidateHeader}>
              <View>
                <Text style={styles.candidateName}>{candidate.name}</Text>
                <Text style={styles.candidateRef}>
                  Ref: {candidate.externalRef ?? candidate.id.slice(-6)}
                </Text>
              </View>
              <Pressable
                style={[styles.idBadge, isIdVerified ? styles.idBadgeVerified : styles.idBadgeUnverified]}
                onPress={() => toggleIdVerified(candidate.id)}
                accessibilityRole="button"
                accessibilityLabel={`Verify ID for ${candidate.name}`}
              >
                <Text style={[styles.idBadgeText, isIdVerified ? styles.idVerifiedText : styles.idUnverifiedText]}>
                  {isIdVerified ? "✓ ID Verified" : "Check ID"}
                </Text>
              </Pressable>
            </View>

            <View style={styles.buttonRow}>
              <Pressable
                style={[styles.attButton, isPresent && styles.presentActive]}
                onPress={() => togglePresent(candidate.id, true)}
                accessibilityRole="button"
                accessibilityLabel={`Mark ${candidate.name} present`}
              >
                <Text style={[styles.buttonLabel, isPresent && styles.whiteText]}>Present</Text>
              </Pressable>
              <Pressable
                style={[styles.attButton, isAbsent && styles.absentActive]}
                onPress={() => togglePresent(candidate.id, false)}
                accessibilityRole="button"
                accessibilityLabel={`Mark ${candidate.name} absent`}
              >
                <Text style={[styles.buttonLabel, isAbsent && styles.whiteText]}>Absent</Text>
              </Pressable>
            </View>

            <TextInput
              style={styles.noteInput}
              placeholder="Note (optional)"
              placeholderTextColor="#888"
              value={state?.note ?? ""}
              onChangeText={(text) => setNote(candidate.id, text)}
            />
          </View>
        );
      })}

      {inactiveCandidates.length > 0 ? (
        <>
          <Text style={styles.sectionTitle}>Inactive Roster ({inactiveCandidates.length})</Text>
          {inactiveCandidates.map((c) => (
            <View key={c.id} style={[styles.candidateCard, styles.inactiveCard]}>
              <Text style={styles.inactiveName}>{c.name} (Deactivated)</Text>
              <Text style={styles.candidateRef}>No attendance needed</Text>
            </View>
          ))}
        </>
      ) : null}

      <Pressable
        style={[styles.saveButton, saving && styles.disabledButton]}
        onPress={() => void handleSave()}
        disabled={saving}
        accessibilityRole="button"
        accessibilityLabel="Save Attendance"
      >
        <Text style={styles.saveButtonText}>{saving ? "Saving…" : "Save Attendance (Offline Queue)"}</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 16,
    paddingTop: 48,
    paddingBottom: 40,
    backgroundColor: "#f7f7f5",
  },
  header: {
    marginBottom: 16,
  },
  title: {
    fontSize: 22,
    fontWeight: "700",
    color: "#1a1a1a",
  },
  subtitle: {
    fontSize: 13,
    color: "#666",
    marginTop: 2,
  },
  summaryCard: {
    flexDirection: "row",
    justifyContent: "space-around",
    backgroundColor: "#fff",
    borderRadius: 10,
    paddingVertical: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "#e8e8e8",
  },
  summaryItem: {
    alignItems: "center",
  },
  summaryValue: {
    fontSize: 18,
    fontWeight: "700",
  },
  summaryLabel: {
    fontSize: 11,
    color: "#666",
    marginTop: 2,
  },
  presentColor: { color: "#2e7d32" },
  absentColor: { color: "#c62828" },
  unmarkedColor: { color: "#e65100" },
  sectionTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: "#444",
    marginBottom: 8,
    marginTop: 8,
  },
  candidateCard: {
    backgroundColor: "#fff",
    borderRadius: 8,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "#e0e0e0",
  },
  inactiveCard: {
    opacity: 0.6,
    backgroundColor: "#f0f0f0",
  },
  candidateHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  candidateName: {
    fontSize: 16,
    fontWeight: "600",
    color: "#111",
  },
  candidateRef: {
    fontSize: 12,
    color: "#777",
    marginTop: 1,
  },
  inactiveName: {
    fontSize: 14,
    fontWeight: "500",
    color: "#555",
  },
  idBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    borderWidth: 1,
  },
  idBadgeVerified: {
    backgroundColor: "#e8f5e9",
    borderColor: "#2e7d32",
  },
  idBadgeUnverified: {
    backgroundColor: "#fafafa",
    borderColor: "#ccc",
  },
  idBadgeText: {
    fontSize: 11,
    fontWeight: "600",
  },
  idVerifiedText: {
    color: "#2e7d32",
  },
  idUnverifiedText: {
    color: "#666",
  },
  buttonRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 8,
  },
  attButton: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#ccc",
    alignItems: "center",
    backgroundColor: "#fafafa",
  },
  presentActive: {
    backgroundColor: "#2e7d32",
    borderColor: "#2e7d32",
  },
  absentActive: {
    backgroundColor: "#c62828",
    borderColor: "#c62828",
  },
  buttonLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: "#333",
  },
  whiteText: {
    color: "#fff",
  },
  noteInput: {
    borderWidth: 1,
    borderColor: "#e0e0e0",
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    fontSize: 12,
    color: "#333",
    backgroundColor: "#fafafa",
  },
  saveButton: {
    backgroundColor: "#1a73e8",
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: "center",
    marginTop: 16,
  },
  disabledButton: {
    opacity: 0.6,
  },
  saveButtonText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "600",
  },
  notice: {
    backgroundColor: "#e8f5e9",
    color: "#2e7d32",
    padding: 10,
    borderRadius: 6,
    marginBottom: 12,
    fontSize: 13,
  },
  banner: {
    backgroundColor: "#fff3e0",
    color: "#e65100",
    padding: 10,
    borderRadius: 6,
    marginBottom: 12,
    fontSize: 13,
  },
});
