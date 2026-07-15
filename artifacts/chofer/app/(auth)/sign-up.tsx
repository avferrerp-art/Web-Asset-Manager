import { useAuth, useSignUp } from "@clerk/expo";
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

export default function SignUpScreen() {
  const { signUp, errors, fetchStatus } = useSignUp();
  const { isSignedIn } = useAuth();
  const router = useRouter();
  const colors = useColors();

  const [emailAddress, setEmailAddress] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [code, setCode] = React.useState("");
  const [generalError, setGeneralError] = React.useState<string | null>(null);

  const loading = fetchStatus === "fetching";

  const inputStyle = [
    styles.input,
    {
      backgroundColor: colors.card,
      borderColor: colors.border,
      color: colors.foreground,
      borderRadius: colors.radius,
    },
  ];

  const handleSubmit = async () => {
    setGeneralError(null);
    const { error } = await signUp.password({ emailAddress, password });
    if (error) {
      setGeneralError("No se pudo crear la cuenta. Revisa los datos.");
      return;
    }
    await signUp.verifications.sendEmailCode();
  };

  const handleVerify = async () => {
    setGeneralError(null);
    await signUp.verifications.verifyEmailCode({ code });
    if (signUp.status === "complete") {
      await signUp.finalize({
        navigate: ({ session, decorateUrl }) => {
          if (session?.currentTask) return;
          const url = decorateUrl("/");
          if (!url.startsWith("http")) {
            router.replace(url as Href);
          }
        },
      });
    } else {
      setGeneralError("No se pudo verificar el código.");
    }
  };

  if (signUp.status === "complete" || isSignedIn) return null;

  const verifying =
    signUp.status === "missing_requirements" &&
    signUp.unverifiedFields.includes("email_address") &&
    signUp.missingFields.length === 0;

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]}>
      <KeyboardAwareScrollViewCompat
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.container}>
          {verifying ? (
            <>
              <Text style={[styles.title, { color: colors.foreground }]}>
                Verifica tu email
              </Text>
              <Text
                style={[styles.subtitle, { color: colors.mutedForeground }]}
              >
                Te enviamos un código a {emailAddress}
              </Text>
              <TextInput
                style={inputStyle}
                value={code}
                placeholder="Código de verificación"
                placeholderTextColor={colors.mutedForeground}
                onChangeText={setCode}
                keyboardType="numeric"
              />
              {errors.fields.code && (
                <Text style={styles.error}>{errors.fields.code.message}</Text>
              )}
              {generalError && <Text style={styles.error}>{generalError}</Text>}
              <Pressable
                style={({ pressed }) => [
                  styles.button,
                  {
                    backgroundColor: colors.primary,
                    borderRadius: colors.radius,
                  },
                  loading && styles.buttonDisabled,
                  pressed && styles.buttonPressed,
                ]}
                onPress={handleVerify}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator color={colors.primaryForeground} />
                ) : (
                  <Text
                    style={[
                      styles.buttonText,
                      { color: colors.primaryForeground },
                    ]}
                  >
                    Verificar
                  </Text>
                )}
              </Pressable>
              <Pressable
                style={({ pressed }) => [
                  styles.secondaryButton,
                  pressed && styles.buttonPressed,
                ]}
                onPress={() => signUp.verifications.sendEmailCode()}
              >
                <Text style={{ color: colors.primary }}>
                  Reenviar código
                </Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text style={[styles.title, { color: colors.foreground }]}>
                Crear cuenta
              </Text>
              <Text
                style={[styles.subtitle, { color: colors.mutedForeground }]}
              >
                Usa el mismo email registrado por el administrador
              </Text>

              <Text style={[styles.label, { color: colors.foreground }]}>
                Email
              </Text>
              <TextInput
                style={inputStyle}
                autoCapitalize="none"
                value={emailAddress}
                placeholder="tu@email.com"
                placeholderTextColor={colors.mutedForeground}
                onChangeText={setEmailAddress}
                keyboardType="email-address"
              />
              {errors.fields.emailAddress && (
                <Text style={styles.error}>
                  {errors.fields.emailAddress.message}
                </Text>
              )}

              <Text style={[styles.label, { color: colors.foreground }]}>
                Contraseña
              </Text>
              <TextInput
                style={inputStyle}
                value={password}
                placeholder="Contraseña"
                placeholderTextColor={colors.mutedForeground}
                secureTextEntry
                onChangeText={setPassword}
              />
              {errors.fields.password && (
                <Text style={styles.error}>
                  {errors.fields.password.message}
                </Text>
              )}
              {generalError && <Text style={styles.error}>{generalError}</Text>}

              <Pressable
                style={({ pressed }) => [
                  styles.button,
                  {
                    backgroundColor: colors.primary,
                    borderRadius: colors.radius,
                  },
                  (!emailAddress || !password || loading) &&
                    styles.buttonDisabled,
                  pressed && styles.buttonPressed,
                ]}
                onPress={handleSubmit}
                disabled={!emailAddress || !password || loading}
              >
                {loading ? (
                  <ActivityIndicator color={colors.primaryForeground} />
                ) : (
                  <Text
                    style={[
                      styles.buttonText,
                      { color: colors.primaryForeground },
                    ]}
                  >
                    Crear cuenta
                  </Text>
                )}
              </Pressable>

              <View style={styles.linkContainer}>
                <Text style={{ color: colors.mutedForeground }}>
                  ¿Ya tienes cuenta?{" "}
                </Text>
                <Link href="/(auth)/sign-in">
                  <Text style={{ color: colors.primary, fontWeight: "600" }}>
                    Iniciar sesión
                  </Text>
                </Link>
              </View>

              {/* Required for sign-up flows (Clerk bot protection) */}
              <View nativeID="clerk-captcha" />
            </>
          )}
        </View>
      </KeyboardAwareScrollViewCompat>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { flexGrow: 1, justifyContent: "center" },
  container: { padding: 24 },
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
  secondaryButton: {
    marginTop: 16,
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
