import { useSignIn } from "@clerk/expo";
import { Feather } from "@expo/vector-icons";
import { type Href, Link, useRouter } from "expo-router";
import React from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { KeyboardAwareScrollViewCompat } from "@/components/KeyboardAwareScrollViewCompat";
import { useColors } from "@/hooks/useColors";

export default function SignInScreen() {
  const { signIn, errors, fetchStatus } = useSignIn();
  const router = useRouter();
  const colors = useColors();

  const [emailAddress, setEmailAddress] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [generalError, setGeneralError] = React.useState<string | null>(null);

  const loading = fetchStatus === "fetching";

  const handleSubmit = async () => {
    setGeneralError(null);
    const { error } = await signIn.password({ emailAddress, password });
    if (error) {
      setGeneralError(
        "No se pudo iniciar sesión. Verifica tu email y contraseña.",
      );
      return;
    }

    if (signIn.status === "complete") {
      await signIn.finalize({
        navigate: ({ session, decorateUrl }) => {
          if (session?.currentTask) return;
          const url = decorateUrl("/");
          if (!url.startsWith("http")) {
            router.replace(url as Href);
          }
        },
      });
    } else {
      setGeneralError("No se pudo completar el inicio de sesión.");
    }
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]}>
      <KeyboardAwareScrollViewCompat
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.container}>
          <View
            style={[styles.logoCircle, { backgroundColor: colors.primary }]}
          >
            <Feather name="truck" size={34} color={colors.primaryForeground} />
          </View>
          <Text style={[styles.title, { color: colors.foreground }]}>
            LogiFleet Chofer
          </Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
            Inicia sesión para ver tus despachos asignados
          </Text>

          <Text style={[styles.label, { color: colors.foreground }]}>
            Email
          </Text>
          <TextInput
            style={[
              styles.input,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
                color: colors.foreground,
                borderRadius: colors.radius,
              },
            ]}
            autoCapitalize="none"
            value={emailAddress}
            placeholder="tu@email.com"
            placeholderTextColor={colors.mutedForeground}
            onChangeText={setEmailAddress}
            keyboardType="email-address"
          />
          {errors.fields.identifier && (
            <Text style={styles.error}>
              {errors.fields.identifier.message}
            </Text>
          )}

          <Text style={[styles.label, { color: colors.foreground }]}>
            Contraseña
          </Text>
          <TextInput
            style={[
              styles.input,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
                color: colors.foreground,
                borderRadius: colors.radius,
              },
            ]}
            value={password}
            placeholder="Contraseña"
            placeholderTextColor={colors.mutedForeground}
            secureTextEntry
            onChangeText={setPassword}
          />
          {errors.fields.password && (
            <Text style={styles.error}>{errors.fields.password.message}</Text>
          )}
          {generalError && <Text style={styles.error}>{generalError}</Text>}

          <Pressable
            style={({ pressed }) => [
              styles.button,
              {
                backgroundColor: colors.primary,
                borderRadius: colors.radius,
              },
              (!emailAddress || !password || loading) && styles.buttonDisabled,
              pressed && styles.buttonPressed,
            ]}
            onPress={handleSubmit}
            disabled={!emailAddress || !password || loading}
          >
            {loading ? (
              <ActivityIndicator color={colors.primaryForeground} />
            ) : (
              <Text
                style={[styles.buttonText, { color: colors.primaryForeground }]}
              >
                Iniciar sesión
              </Text>
            )}
          </Pressable>

          <View style={styles.linkContainer}>
            <Text style={{ color: colors.mutedForeground }}>
              ¿No tienes cuenta?{" "}
            </Text>
            <Link href="/(auth)/sign-up">
              <Text style={{ color: colors.primary, fontWeight: "600" }}>
                Crear cuenta
              </Text>
            </Link>
          </View>
        </View>
      </KeyboardAwareScrollViewCompat>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { flexGrow: 1, justifyContent: "center" },
  container: { padding: 24 },
  logoCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
    marginBottom: 16,
  },
  title: {
    fontSize: 26,
    fontFamily: "Inter_700Bold",
    textAlign: "center",
  },
  subtitle: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    marginTop: 6,
    marginBottom: 28,
  },
  label: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    marginBottom: 6,
    marginTop: 12,
  },
  input: {
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
  },
  error: { color: "#f87171", marginTop: 6, fontSize: 13 },
  button: {
    marginTop: 24,
    paddingVertical: 14,
    alignItems: "center",
  },
  buttonDisabled: { opacity: 0.5 },
  buttonPressed: { opacity: 0.8 },
  buttonText: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  linkContainer: {
    flexDirection: "row",
    justifyContent: "center",
    marginTop: 20,
  },
});
