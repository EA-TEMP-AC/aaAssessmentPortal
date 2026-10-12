import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { CachedBatchData } from "../domain/batch";

type Props = {
  batchData: CachedBatchData | null;
  online: boolean;
  downloading: boolean;
  onDownload: () => Promise<void>;
  notice: string | null;
  banner: string | null;
};

export function BatchScreen({
  batchData,
  online,
  downloading,
  onDownload,
  notice,
  banner,
}: Props) {
  const batch = batchData?.batch;
  const roster = batchData?.roster ?? [];

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Assigned Batch</Text>
        <Text style={styles.subtitle}>
          {online ? "Online — Server Connected" : "Offline Mode — Using Cached Data"}
        </Text>
      </View>

      {notice ? <Text style={styles.notice}>{notice}</Text> : null}
      {banner ? <Text style={styles.banner}>{banner}</Text> : null}

      {batch ? (
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.batchId}>Batch #{batch.id.slice(-8)}</Text>
            <View style={styles.statusBadge}>
              <Text style={styles.statusText}>{batch.status}</Text>
            </View>
          </View>

          <View style={styles.infoRow}>
            <Text style={styles.label}>Type & Mode:</Text>
            <Text style={styles.value}>
              {batch.type} • {batch.mode}
            </Text>
          </View>

          <View style={styles.infoRow}>
            <Text style={styles.label}>Assessment Dates:</Text>
            <Text style={styles.value}>
              {batch.assessmentStartDate} to {batch.assessmentEndDate}
            </Text>
          </View>

          <View style={styles.infoRow}>
            <Text style={styles.label}>Language:</Text>
            <Text style={styles.value}>{batch.assessmentLanguage}</Text>
          </View>

          <View style={styles.infoRow}>
            <Text style={styles.label}>Roster Candidates:</Text>
            <Text style={styles.value}>
              {roster.filter((c) => c.active).length} active ({roster.length} total)
            </Text>
          </View>

          {batchData.downloadedAt ? (
            <View style={styles.cacheInfo}>
              <Text style={styles.cacheText}>
                Cached for offline use: {new Date(batchData.downloadedAt).toLocaleString()}
              </Text>
            </View>
          ) : null}
        </View>
      ) : (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>No Batch Cached Offline</Text>
          <Text style={styles.emptyText}>
            Connect online and download your assigned batch to work offline in the field.
          </Text>
        </View>
      )}

      <Pressable
        style={[styles.downloadButton, (!online || downloading) && styles.disabledButton]}
        onPress={() => void onDownload()}
        disabled={!online || downloading}
        accessibilityRole="button"
        accessibilityLabel="Download Assigned Batch"
      >
        {downloading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.downloadButtonText}>
            {batch ? "↻ Re-download Batch & Roster" : "⬇ Download Assigned Batch for Offline Use"}
          </Text>
        )}
      </Pressable>
      {!online ? (
        <Text style={styles.offlineHint}>
          Connect to network to download or refresh assigned batch data.
        </Text>
      ) : null}

      {roster.length > 0 ? (
        <View style={styles.rosterSection}>
          <Text style={styles.sectionTitle}>Downloaded Roster Candidates</Text>
          {roster.map((candidate) => (
            <View key={candidate.id} style={styles.candidateRow}>
              <View>
                <Text style={styles.candidateName}>{candidate.name}</Text>
                <Text style={styles.candidateRef}>
                  Ref: {candidate.externalRef ?? candidate.id.slice(-6)}
                </Text>
              </View>
              <Text style={candidate.active ? styles.activeBadge : styles.inactiveBadge}>
                {candidate.active ? "Active" : "Inactive"}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
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
  card: {
    backgroundColor: "#fff",
    borderRadius: 10,
    padding: 16,
    borderWidth: 1,
    borderColor: "#e0e0e0",
    marginBottom: 16,
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
    paddingBottom: 8,
  },
  batchId: {
    fontSize: 18,
    fontWeight: "700",
    color: "#111",
  },
  statusBadge: {
    backgroundColor: "#e3f2fd",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  statusText: {
    color: "#1565c0",
    fontSize: 12,
    fontWeight: "600",
  },
  infoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 6,
  },
  label: {
    fontSize: 13,
    color: "#666",
  },
  value: {
    fontSize: 13,
    fontWeight: "600",
    color: "#222",
  },
  cacheInfo: {
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: "#f0f0f0",
  },
  cacheText: {
    fontSize: 11,
    color: "#2e7d32",
    fontWeight: "500",
  },
  emptyCard: {
    backgroundColor: "#fff",
    borderRadius: 10,
    padding: 24,
    alignItems: "center",
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "#e0e0e0",
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#444",
    marginBottom: 6,
  },
  emptyText: {
    fontSize: 13,
    color: "#777",
    textAlign: "center",
  },
  downloadButton: {
    backgroundColor: "#1a73e8",
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: "center",
  },
  disabledButton: {
    opacity: 0.5,
  },
  downloadButtonText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "600",
  },
  offlineHint: {
    fontSize: 12,
    color: "#e65100",
    textAlign: "center",
    marginTop: 6,
  },
  rosterSection: {
    marginTop: 20,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: "600",
    color: "#333",
    marginBottom: 10,
  },
  candidateRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "#fff",
    padding: 12,
    borderRadius: 6,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: "#eee",
  },
  candidateName: {
    fontSize: 14,
    fontWeight: "600",
    color: "#111",
  },
  candidateRef: {
    fontSize: 11,
    color: "#777",
  },
  activeBadge: {
    fontSize: 11,
    color: "#2e7d32",
    fontWeight: "600",
  },
  inactiveBadge: {
    fontSize: 11,
    color: "#999",
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
