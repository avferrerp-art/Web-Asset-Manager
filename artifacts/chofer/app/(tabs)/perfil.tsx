import { useAuth, useUser } from "@clerk/expo";
import { Feather } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";
import React from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  useGetDriverMe,
  getGetDriverMeQueryKey,
} from "@workspace/api-client-react";

import { useColors } from "@/hooks/useColors";

export default function PerfilScreen() {
  const colors = useColors();
  const { signOut } = useAuth();
  const { user } = useUser();
  const queryClient = useQueryClient();
  const me = useGetDriverMe({
    query: { queryKey: getGetDriverMeQueryKey(), retry: false },
  });

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View
        style={[
          styles.card,
          {
            backgroundColor: colors.card,
            borderColor: colors.border,
            borderRadius: colors.radius,
          },
        ]}
      >
        <View style={[styles.avatar, { backgroundColor: colors.primary }]}>
          <Feather name="user" size={30} color={colors.primaryForeground} />
        </View>
        {me.isLoading ? (
          <ActivityIndicator color={colors.primary} />
        ) : me.data ? (
          <>
            <Text style={[styles.name, { color: colors.foreground }]}>
              {me.data.nombre}
            </Text>
            <Text style={[styles.detail, { color: colors.mutedForeground }]}>
              {me.data.email ?? ""}
            </Text>
            {me.data.telefono ? (
              <Text style={[styles.detail, { color: colors.mutedForeground }]}>
                {me.data.telefono}
              </Text>
            ) : null}
          </>
        ) : (
          <>
            <Text style={[styles.name, { color: colors.foreground }]}>
              {user?.primaryEmailAddress?.emailAddress ?? "Chofer"}
            </Text>
            <Text style={[styles.detail, { color: colors.mutedForeground }]}>
              Cuenta no vinculada a un chofer
            </Text>
          </>
        )}
      </View>

      <Pressable
        style={({ pressed }) => [
          styles.logoutButton,
          {
            borderColor: colors.destructive,
            borderRadius: colors.radius,
          },
          pressed && { opacity: 0.7 },
        ]}
        onPress={async () => {
          await signOut();
          queryClient.clear();
        }}
      >
        <Feather name="log-out" size={18} color={colors.destructive} />
        <Text style={[styles.logoutText, { color: colors.destructive }]}>
          Cerrar sesión
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  card: {
    borderWidth: 1,
    padding: 24,
    alignItems: "center",
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
  },
  name: { fontSize: 19, fontFamily: "Inter_700Bold" },
  detail: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    marginTop: 4,
  },
  logoutButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderWidth: 1,
    paddingVertical: 14,
    marginTop: 20,
  },
  logoutText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
});
