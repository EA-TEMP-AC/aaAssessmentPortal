import { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

type Props = {
  online: boolean;
  notice: string | null;
  error: string | null;
  submitting: boolean;
  onSubmit: (email: string, password: string) => void;
};

export function LoginScreen({ online, notice, error, submitting, onSubmit }: Props) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  function submit() {
    onSubmit(email.trim(), password);
  }

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.card}>
        <Text style={styles.title}>AA Assessor</Text>
        <Text style={styles.subtitle}>Sign in to record login and logout on this device.</Text>
        <Text style={styles.online}>{online ? "Online" : "Offline"}</Text>
        {notice ? <Text style={styles.notice}>{notice}</Text> : null}
        <TextInput
          style={styles.input}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          placeholder="Email"
          value={email}
          onChangeText={setEmail}
          editable={!submitting}
          accessibilityLabel="Email"
        />
        <TextInput
          style={styles.input}
          secureTextEntry
          placeholder="Password"
          value={password}
          onChangeText={setPassword}
          editable={!submitting}
          accessibilityLabel="Password"
        />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Pressable
          style={[styles.button, submitting ? styles.buttonDisabled : null]}
          onPress={submit}
          disabled={submitting}
          accessibilityRole="button"
          accessibilityLabel="Sign in"
        >
          {submitting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Sign in</Text>
          )}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#f7f7f5",
    justifyContent: "center",
    padding: 24,
  },
  card: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: "600",
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: "#444",
    marginBottom: 12,
  },
  online: {
    fontSize: 13,
    fontWeight: "600",
    marginBottom: 12,
    color: "#1f4b3a",
  },
  notice: {
    fontSize: 14,
    color: "#6b4e16",
    backgroundColor: "#fff6e0",
    padding: 10,
    borderRadius: 8,
    marginBottom: 12,
  },
  input: {
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
    fontSize: 16,
  },
  error: {
    color: "#8c1d18",
    marginBottom: 12,
  },
  button: {
    backgroundColor: "#1f4b3a",
    borderRadius: 8,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  buttonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
});
