import { Pressable, StyleSheet, Text, View } from "react-native";

type Props = {
  onSignOut: () => void;
  signingOut: boolean;
};

export function PasswordChangeScreen({ onSignOut, signingOut }: Props) {
  return (
    <View style={styles.screen}>
      <Text style={styles.title}>Password change required</Text>
      <Text style={styles.body}>
        An administrator requires a new password before field use. Change it on the web portal, then
        sign in here again.
      </Text>
      <Pressable
        style={styles.button}
        onPress={onSignOut}
        disabled={signingOut}
        accessibilityRole="button"
        accessibilityLabel="Sign out"
      >
        <Text style={styles.buttonText}>{signingOut ? "Signing out…" : "Sign out"}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#f7f7f5",
    justifyContent: "center",
    padding: 24,
  },
  title: {
    fontSize: 22,
    fontWeight: "600",
    marginBottom: 12,
  },
  body: {
    fontSize: 15,
    color: "#333",
    marginBottom: 20,
  },
  button: {
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
