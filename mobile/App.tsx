import { StatusBar } from "expo-status-bar";
import { StyleSheet, Text, View } from "react-native";

/**
 * Assessor mobile placeholder. Offline/geo flows land in M-01+.
 */
export default function App() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>AA Assessor</Text>
      <Text style={styles.subtitle}>Mobile scaffold — no feature code yet.</Text>
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f7f7f5",
    padding: 24,
  },
  title: {
    fontSize: 24,
    fontWeight: "600",
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: "#444",
    textAlign: "center",
  },
});
