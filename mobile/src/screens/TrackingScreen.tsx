import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { CachedBatchData } from "../domain/batch";
import type { LoginEventType } from "../queue/types";
import {
  TRACKING_TITLES,
  type TrackingHistoryRow,
  type TrackingRole,
  type TrackingWindow,
} from "../tracking/tracking";

type Props = {
  role: TrackingRole;
  batchData: CachedBatchData;
  online: boolean;
  window: TrackingWindow;
  history: TrackingHistoryRow[];
  recording: LoginEventType | null;
  /** The result of the last recording on this screen. */
  lastResult: string | null;
  banner: string | null;
  onRecord: (type: LoginEventType) => void;
};

const WINDOW_TEXT: Record<Exclude<TrackingWindow, "open">, string> = {
  before: "The assessment has not started. Location can be recorded from the start date.",
  after: "The assessment dates have passed. Location can no longer be recorded for this batch.",
};

const RECORD_LABELS: Record<TrackingRole, Record<LoginEventType, string>> = {
  candidate: { login: "Check in with location", logout: "Check out with location" },
  proctor: { login: "Geo-tag arrival", logout: "Geo-tag departure" },
};

function formatWhen(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

export function TrackingScreen({
  role,
  batchData,
  online,
  window,
  history,
  recording,
  lastResult,
  banner,
  onRecord,
}: Props) {
  const batch = batchData.batch;
  const closed = window !== "open";
  const disabled = closed || recording !== null;

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>{TRACKING_TITLES[role]}</Text>
      <Text style={styles.subtitle}>
        {online ? "Online. Events sync straight away." : "Offline. Events are saved on this device and sync later."}
      </Text>

      {banner ? <Text style={styles.banner}>{banner}</Text> : null}
      {lastResult ? <Text style={styles.notice}>{lastResult}</Text> : null}

      <View style={styles.card}>
        <Text style={styles.batchId}>Batch #{batch.id.slice(-8)}</Text>
        <Text style={styles.value}>
          {batch.assessmentStartDate} to {batch.assessmentEndDate} (IST)
        </Text>
        {closed ? <Text style={styles.closed}>{WINDOW_TEXT[window]}</Text> : null}
      </View>

      {(["login", "logout"] as const).map((type) => (
        <Pressable
          key={type}
          style={[styles.button, type === "logout" && styles.buttonQuiet, disabled && styles.disabledButton]}
          onPress={() => onRecord(type)}
          disabled={disabled}
          accessibilityRole="button"
          accessibilityLabel={RECORD_LABELS[role][type]}
        >
          {recording === type ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>{RECORD_LABELS[role][type]}</Text>
          )}
        </Pressable>
      ))}
      <Text style={styles.hint}>
        If the device cannot get a location, the event is still saved and the reason is recorded.
      </Text>

      <Text style={styles.sectionTitle}>Recorded for this batch</Text>
      {history.length === 0 ? (
        <Text style={styles.hint}>Nothing recorded yet.</Text>
      ) : (
        history.map((row) => (
          <View key={row.clientEventId} style={styles.historyRow}>
            <Text style={styles.historyHead}>
              {row.type === "login" ? "Login" : "Logout"} at {formatWhen(row.capturedAt)}
            </Text>
            <Text style={styles.value}>{row.location}</Text>
            <Text style={row.state === "conflict" || row.state === "parked" ? styles.conflict : styles.value}>{row.detail}</Text>
          </View>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    backgroundColor: "#f7f7f5",
    padding: 20,
    paddingTop: 56,
  },
  title: {
    fontSize: 24,
    fontWeight: "600",
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 13,
    color: "#555",
    marginBottom: 16,
  },
  card: {
    backgroundColor: "#fff",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#e0e0e0",
    padding: 16,
    marginBottom: 16,
  },
  batchId: {
    fontSize: 16,
    fontWeight: "700",
    color: "#222",
    marginBottom: 4,
  },
  value: {
    fontSize: 13,
    color: "#444",
  },
  closed: {
    marginTop: 8,
    fontSize: 13,
    color: "#8a4b00",
  },
  button: {
    backgroundColor: "#1a73e8",
    borderRadius: 6,
    paddingVertical: 14,
    alignItems: "center",
    marginBottom: 10,
  },
  buttonQuiet: {
    backgroundColor: "#3c4043",
  },
  disabledButton: {
    opacity: 0.5,
  },
  buttonText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "600",
  },
  hint: {
    fontSize: 12,
    color: "#666",
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "600",
    marginTop: 8,
    marginBottom: 8,
  },
  historyRow: {
    backgroundColor: "#fff",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#e0e0e0",
    padding: 12,
    marginBottom: 8,
  },
  historyHead: {
    fontSize: 14,
    fontWeight: "600",
    color: "#222",
    marginBottom: 2,
  },
  conflict: {
    fontSize: 13,
    color: "#b3261e",
    fontWeight: "600",
  },
  notice: {
    backgroundColor: "#e6f4ea",
    color: "#0d652d",
    padding: 10,
    borderRadius: 6,
    marginBottom: 12,
    fontSize: 13,
  },
  banner: {
    backgroundColor: "#fce8e6",
    color: "#b3261e",
    padding: 10,
    borderRadius: 6,
    marginBottom: 12,
    fontSize: 13,
  },
});
