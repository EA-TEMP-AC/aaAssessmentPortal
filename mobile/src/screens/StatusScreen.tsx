import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { QueueSnapshot } from "../queue/eventQueue";

type Props = {
  userName: string;
  online: boolean;
  snapshot: QueueSnapshot;
  loginEventsMode: "mock" | "live";
  offlineUntilLabel: string | null;
  banner: string | null;
  loggingOut: boolean;
  onLogout: () => void;
  /** Deletes one parked event from this device. */
  onDeleteParked: (clientEventId: string) => void;
};

function formatWhen(iso: string | null): string {
  if (!iso) return "Never";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Never";
  return date.toLocaleString();
}

export function StatusScreen({
  userName,
  online,
  snapshot,
  loginEventsMode,
  offlineUntilLabel,
  banner,
  loggingOut,
  onLogout,
  onDeleteParked,
}: Props) {
  function confirmDelete(clientEventId: string, type: string) {
    Alert.alert(
      "Delete this event?",
      `The ${type} event was rejected by the server and was never stored there. Deleting removes it from this device for good.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: () => onDeleteParked(clientEventId) },
      ],
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.screen}>
      <Text style={styles.title}>Field session</Text>
      <Text style={styles.name}>{userName}</Text>
      <View style={styles.row}>
        <Text style={styles.label}>Network</Text>
        <Text style={styles.value}>{online ? "Online" : "Offline"}</Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.label}>Queue</Text>
        <Text style={styles.value}>{snapshot.queueLength}</Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.label}>Last sync</Text>
        <Text style={styles.value}>{formatWhen(snapshot.lastSyncAt)}</Text>
      </View>
      {offlineUntilLabel ? (
        <Text style={styles.note}>Offline access until {offlineUntilLabel}</Text>
      ) : null}
      <Text style={styles.note}>Login events: {loginEventsMode}</Text>
      {banner ? <Text style={styles.banner}>{banner}</Text> : null}
      {snapshot.retryMessage ? (
        <Text style={styles.banner}>Waiting to retry: {snapshot.retryMessage}</Text>
      ) : null}
      {snapshot.conflicts.length > 0 ? (
        <View style={styles.conflicts}>
          <Text style={styles.conflictTitle}>Conflicts</Text>
          {snapshot.conflicts.map((conflict) => (
            <Text key={conflict.clientEventId} style={styles.conflictItem}>
              {conflict.type} {conflict.clientEventId.slice(0, 8)} — {conflict.message}
            </Text>
          ))}
        </View>
      ) : null}
      {snapshot.parked.length > 0 ? (
        <View style={styles.conflicts}>
          <Text style={styles.conflictTitle}>Rejected by the server</Text>
          <Text style={styles.parkedHint}>
            These events were not accepted and will not be sent again. Later events keep syncing.
          </Text>
          {snapshot.parked.map((parked) => (
            <View key={parked.clientEventId} style={styles.parkedItem}>
              <Text style={styles.conflictItem}>
                {parked.type} {parked.clientEventId.slice(0, 8)}, captured {formatWhen(parked.capturedAt)}
              </Text>
              <Text style={styles.conflictItem}>
                Reason: {parked.code}: {parked.message}
              </Text>
              <Pressable
                style={styles.deleteButton}
                onPress={() => confirmDelete(parked.clientEventId, parked.type)}
                accessibilityRole="button"
                accessibilityLabel={`Delete rejected ${parked.type} event ${parked.clientEventId.slice(0, 8)}`}
              >
                <Text style={styles.deleteButtonText}>Delete</Text>
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}
      <Pressable
        style={styles.button}
        onPress={onLogout}
        disabled={loggingOut}
        accessibilityRole="button"
        accessibilityLabel="Log out"
      >
        <Text style={styles.buttonText}>{loggingOut ? "Logging out…" : "Log out"}</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flexGrow: 1,
    backgroundColor: "#f7f7f5",
    padding: 24,
    paddingTop: 64,
  },
  title: {
    fontSize: 24,
    fontWeight: "600",
    marginBottom: 4,
  },
  name: {
    fontSize: 15,
    color: "#444",
    marginBottom: 20,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    backgroundColor: "#fff",
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 8,
  },
  label: {
    fontSize: 15,
    color: "#333",
  },
  value: {
    fontSize: 15,
    fontWeight: "600",
  },
  note: {
    marginTop: 8,
    color: "#444",
    fontSize: 13,
  },
  banner: {
    marginTop: 12,
    color: "#6b4e16",
    backgroundColor: "#fff6e0",
    padding: 10,
    borderRadius: 8,
  },
  conflicts: {
    marginTop: 16,
    backgroundColor: "#fff",
    borderRadius: 8,
    padding: 12,
  },
  conflictTitle: {
    fontWeight: "600",
    marginBottom: 8,
  },
  conflictItem: {
    fontSize: 13,
    color: "#8c1d18",
    marginBottom: 6,
  },
  parkedHint: {
    fontSize: 13,
    color: "#444",
    marginBottom: 8,
  },
  parkedItem: {
    borderTopWidth: 1,
    borderTopColor: "#e5e5e0",
    paddingTop: 8,
    marginBottom: 8,
  },
  deleteButton: {
    alignSelf: "flex-start",
    minHeight: 44,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#8c1d18",
    alignItems: "center",
    justifyContent: "center",
  },
  deleteButtonText: {
    color: "#8c1d18",
    fontSize: 15,
    fontWeight: "600",
  },
  button: {
    marginTop: 24,
    backgroundColor: "#1f4b3a",
    borderRadius: 8,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
});
