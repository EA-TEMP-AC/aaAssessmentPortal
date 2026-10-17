import { ScrollView, StyleSheet, Text, View } from "react-native";
import type { RosterCandidate } from "../domain/batch";

type Props = {
  assessorName: string;
  roster: RosterCandidate[];
};

/**
 * X-39. Exam-day sheet for the assessor: each student's sign-in id and first password, so the
 * assessor can hand them out. A student who has changed their password shows no password.
 */
export function CredentialsScreen({ assessorName, roster }: Props) {
  const students = roster.filter((c) => c.active);
  return (
    <ScrollView contentContainerStyle={styles.screen}>
      <Text style={styles.title}>Logins</Text>
      <Text style={styles.sub}>Assessor: {assessorName}</Text>
      <Text style={styles.note}>Give each student their own sign-in id and password. Keep this screen private.</Text>
      {students.length === 0 ? <Text style={styles.empty}>No students on this batch.</Text> : null}
      {students.map((c) => (
        <View key={c.id} style={styles.card} accessibilityLabel={`Login for ${c.name}`}>
          <Text style={styles.name}>{c.name}</Text>
          {c.externalRef ? <Text style={styles.small}>Ref: {c.externalRef}</Text> : null}
          {c.login ? (
            <>
              <Text style={styles.line}>Sign-in id: {c.login.loginId}</Text>
              <Text style={styles.line}>
                {c.login.initialPassword
                  ? `Password: ${c.login.initialPassword}`
                  : "Password: changed by the student"}
              </Text>
            </>
          ) : (
            <Text style={styles.small}>No login yet. Ask the office.</Text>
          )}
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flexGrow: 1, backgroundColor: "#f7f7f5", padding: 24, paddingTop: 64 },
  title: { fontSize: 24, fontWeight: "600", marginBottom: 4 },
  sub: { fontSize: 15, color: "#444", marginBottom: 8 },
  note: { fontSize: 13, color: "#666", marginBottom: 16 },
  empty: { fontSize: 15, color: "#666" },
  card: { backgroundColor: "#fff", borderRadius: 8, padding: 14, marginBottom: 8 },
  name: { fontSize: 16, fontWeight: "600", marginBottom: 2 },
  small: { fontSize: 13, color: "#666" },
  line: { fontSize: 15, color: "#222", marginTop: 4 },
});
