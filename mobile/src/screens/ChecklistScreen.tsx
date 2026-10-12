import { useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  type AttendanceRecordState,
  type ChecklistItem,
  isAttendanceComplete,
  missingAttendanceCandidateIds,
  type RosterCandidate,
} from "../domain/batch";
import type { ChecklistItemInput } from "../queue/types";

type Props = {
  batchId: string;
  batchStatus?: string;
  roster: RosterCandidate[];
  attendance: Record<string, AttendanceRecordState>;
  initialChecklist: ChecklistItem[];
  onSaveChecklist: (items: ChecklistItemInput[], completeAssessment: boolean) => Promise<void>;
  saving: boolean;
  banner: string | null;
};

export function ChecklistScreen({
  batchId,
  batchStatus,
  roster,
  attendance,
  initialChecklist,
  onSaveChecklist,
  saving,
  banner,
}: Props) {
  const [items, setItems] = useState<ChecklistItem[]>([...initialChecklist]);
  const [newKey, setNewKey] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const activeCandidates = roster.filter((c) => c.active);
  const attendanceComplete = isAttendanceComplete(roster, attendance);
  const missingIds = missingAttendanceCandidateIds(roster, attendance);
  const missingCandidates = activeCandidates.filter((c) => missingIds.includes(c.id));

  const idVerifiedCount = activeCandidates.filter((c) => attendance[c.id]?.idVerified === true).length;
  const isAssessmentCompleted = batchStatus === "assessment_completed";

  function toggleAvailable(key: string) {
    setItems((prev) =>
      prev.map((item) => (item.key === key ? { ...item, available: !item.available } : item)),
    );
  }

  function setItemNote(key: string, note: string) {
    setItems((prev) =>
      prev.map((item) => (item.key === key ? { ...item, note: note.trim() || undefined } : item)),
    );
  }

  function addItem() {
    if (!newKey.trim()) return;
    const cleanKey = newKey.trim().toLowerCase().replace(/\s+/g, "-");
    if (items.some((i) => i.key === cleanKey)) {
      setErrorMessage(`Item with key "${cleanKey}" already exists`);
      return;
    }
    setItems((prev) => [
      ...prev,
      {
        key: cleanKey,
        label: newLabel.trim() || cleanKey,
        available: true,
      },
    ]);
    setNewKey("");
    setNewLabel("");
    setErrorMessage(null);
  }

  async function handleSave(completeAssessment: boolean) {
    setNotice(null);
    setErrorMessage(null);

    if (completeAssessment && !attendanceComplete) {
      setErrorMessage(
        `Cannot complete assessment: Attendance is missing for ${missingCandidates.length} candidate(s).`,
      );
      return;
    }

    const payload: ChecklistItemInput[] = items.map((i) => ({
      key: i.key,
      label: i.label,
      available: i.available,
      note: i.note,
    }));

    await onSaveChecklist(payload, completeAssessment);
    if (completeAssessment) {
      setNotice("Checklist submitted and assessment marked completed!");
    } else {
      setNotice("Checklist saved offline and queued for sync.");
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>ID Check & Checklist</Text>
        <Text style={styles.subtitle}>
          Batch {batchId.slice(-6)} • Status: {batchStatus ?? "in_progress"}
        </Text>
      </View>

      {/* ID Verification Overview Card */}
      <View style={styles.idCard}>
        <Text style={styles.cardTitle}>Candidate ID Check Summary</Text>
        <View style={styles.idRow}>
          <Text style={styles.idStat}>
            <Text style={styles.bold}>{idVerifiedCount}</Text> of{" "}
            <Text style={styles.bold}>{activeCandidates.length}</Text> IDs verified
          </Text>
          <Text style={[styles.statusBadge, attendanceComplete ? styles.badgeSuccess : styles.badgeWarn]}>
            {attendanceComplete ? "Attendance Complete" : `${missingIds.length} Missing Attendance`}
          </Text>
        </View>
        {!attendanceComplete ? (
          <Text style={styles.missingWarning}>
            Missing attendance for: {missingCandidates.map((c) => c.name).join(", ")}
          </Text>
        ) : null}
      </View>

      {banner ? <Text style={styles.banner}>{banner}</Text> : null}
      {notice ? <Text style={styles.notice}>{notice}</Text> : null}
      {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}

      <Text style={styles.sectionTitle}>Equipment Checklist</Text>

      {items.map((item) => (
        <View key={item.key} style={styles.itemCard}>
          <View style={styles.itemHeader}>
            <View style={styles.itemInfo}>
              <Text style={styles.itemLabel}>{item.label}</Text>
              <Text style={styles.itemKey}>Key: {item.key}</Text>
            </View>
            <Pressable
              style={[styles.toggleButton, item.available ? styles.availBtn : styles.unavailBtn]}
              onPress={() => toggleAvailable(item.key)}
              accessibilityRole="button"
              accessibilityLabel={`Toggle ${item.label} availability`}
            >
              <Text style={[styles.toggleText, item.available ? styles.availText : styles.unavailText]}>
                {item.available ? "Available" : "Unavailable"}
              </Text>
            </Pressable>
          </View>
          <TextInput
            style={styles.noteInput}
            placeholder="Equipment note (e.g. 1 unit faulty)"
            placeholderTextColor="#888"
            value={item.note ?? ""}
            onChangeText={(text) => setItemNote(item.key, text)}
          />
        </View>
      ))}

      {/* Add Custom Item */}
      <View style={styles.addCard}>
        <Text style={styles.addTitle}>Add Equipment Item</Text>
        <View style={styles.addRow}>
          <TextInput
            style={[styles.input, styles.flex1]}
            placeholder="Item key (e.g. printer)"
            placeholderTextColor="#888"
            value={newKey}
            onChangeText={setNewKey}
          />
          <TextInput
            style={[styles.input, styles.flex2]}
            placeholder="Label (e.g. Hall Printer)"
            placeholderTextColor="#888"
            value={newLabel}
            onChangeText={setNewLabel}
          />
          <Pressable style={styles.addBtn} onPress={addItem} accessibilityRole="button" accessibilityLabel="Add item">
            <Text style={styles.addBtnText}>+ Add</Text>
          </Pressable>
        </View>
      </View>

      {/* Actions */}
      <View style={styles.actionContainer}>
        <Pressable
          style={[styles.saveBtn, saving && styles.disabledBtn]}
          onPress={() => void handleSave(false)}
          disabled={saving}
          accessibilityRole="button"
          accessibilityLabel="Save Checklist"
        >
          <Text style={styles.saveBtnText}>{saving ? "Saving…" : "Save Checklist (In Progress)"}</Text>
        </Pressable>

        <Pressable
          style={[
            styles.completeBtn,
            (!attendanceComplete || saving || isAssessmentCompleted) && styles.disabledBtn,
          ]}
          onPress={() => void handleSave(true)}
          disabled={!attendanceComplete || saving || isAssessmentCompleted}
          accessibilityRole="button"
          accessibilityLabel="Complete Assessment"
        >
          <Text style={styles.completeBtnText}>
            {isAssessmentCompleted
              ? "✓ Assessment Already Completed"
              : attendanceComplete
                ? "Complete Assessment (Gate Passed)"
                : `Complete Assessment (${missingIds.length} Missing Attendance)`}
          </Text>
        </Pressable>
      </View>
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
  idCard: {
    backgroundColor: "#fff",
    borderRadius: 8,
    padding: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "#e0e0e0",
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: "#333",
    marginBottom: 6,
  },
  idRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  idStat: {
    fontSize: 13,
    color: "#444",
  },
  bold: {
    fontWeight: "700",
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    fontSize: 11,
    fontWeight: "600",
  },
  badgeSuccess: {
    backgroundColor: "#e8f5e9",
    color: "#2e7d32",
  },
  badgeWarn: {
    backgroundColor: "#fff3e0",
    color: "#e65100",
  },
  missingWarning: {
    fontSize: 12,
    color: "#c62828",
    marginTop: 8,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: "600",
    color: "#333",
    marginBottom: 10,
  },
  itemCard: {
    backgroundColor: "#fff",
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: "#e0e0e0",
  },
  itemHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  itemInfo: {
    flex: 1,
  },
  itemLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: "#111",
  },
  itemKey: {
    fontSize: 11,
    color: "#777",
  },
  toggleButton: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 4,
    borderWidth: 1,
  },
  availBtn: {
    backgroundColor: "#e8f5e9",
    borderColor: "#2e7d32",
  },
  unavailBtn: {
    backgroundColor: "#ffebee",
    borderColor: "#c62828",
  },
  toggleText: {
    fontSize: 12,
    fontWeight: "600",
  },
  availText: {
    color: "#2e7d32",
  },
  unavailText: {
    color: "#c62828",
  },
  noteInput: {
    borderWidth: 1,
    borderColor: "#e8e8e8",
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    fontSize: 12,
    backgroundColor: "#fafafa",
  },
  addCard: {
    backgroundColor: "#fff",
    borderRadius: 8,
    padding: 12,
    marginTop: 8,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "#e0e0e0",
  },
  addTitle: {
    fontSize: 13,
    fontWeight: "600",
    color: "#444",
    marginBottom: 6,
  },
  addRow: {
    flexDirection: "row",
    gap: 6,
  },
  input: {
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    fontSize: 12,
    backgroundColor: "#fff",
  },
  flex1: { flex: 1 },
  flex2: { flex: 2 },
  addBtn: {
    backgroundColor: "#444",
    paddingHorizontal: 12,
    justifyContent: "center",
    borderRadius: 4,
  },
  addBtnText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "600",
  },
  actionContainer: {
    gap: 10,
    marginTop: 10,
  },
  saveBtn: {
    backgroundColor: "#1a73e8",
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: "center",
  },
  saveBtnText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
  },
  completeBtn: {
    backgroundColor: "#2e7d32",
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: "center",
  },
  completeBtnText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "700",
  },
  disabledBtn: {
    opacity: 0.5,
  },
  banner: {
    backgroundColor: "#fff3e0",
    color: "#e65100",
    padding: 10,
    borderRadius: 6,
    marginBottom: 10,
    fontSize: 13,
  },
  notice: {
    backgroundColor: "#e8f5e9",
    color: "#2e7d32",
    padding: 10,
    borderRadius: 6,
    marginBottom: 10,
    fontSize: 13,
  },
  error: {
    backgroundColor: "#ffebee",
    color: "#c62828",
    padding: 10,
    borderRadius: 6,
    marginBottom: 10,
    fontSize: 13,
  },
});
