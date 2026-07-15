import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  useGetDriverMe,
  useListDriverDispatches,
  getGetDriverMeQueryKey,
  getListDriverDispatchesQueryKey,
  type Dispatch,
} from "@workspace/api-client-react";

type ApiErrorLike = { status?: number; data?: { message?: string } | null };

import { estadoColor, estadoLabel } from "@/constants/estados";
import { useColors } from "@/hooks/useColors";

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("es-DO", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export default function DispatchesScreen() {
  const colors = useColors();
  const router = useRouter();

  const me = useGetDriverMe({
    query: { queryKey: getGetDriverMeQueryKey(), retry: false },
  });
  const dispatches = useListDriverDispatches({
    query: {
      queryKey: getListDriverDispatchesQueryKey(),
      enabled: me.isSuccess,
    },
  });

  const notLinked =
    me.isError && (me.error as ApiErrorLike)?.status === 404;

  if (me.isLoading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  if (notLinked) {
    const data = (me.error as ApiErrorLike).data;
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <Feather name="user-x" size={44} color={colors.mutedForeground} />
        <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
          Cuenta no vinculada
        </Text>
        <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
          {data?.message ??
            "Tu cuenta no está vinculada a un chofer. Pide al administrador que registre tu email en Personal."}
        </Text>
      </View>
    );
  }

  if (me.isError) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <Feather name="wifi-off" size={44} color={colors.mutedForeground} />
        <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
          Error de conexión
        </Text>
        <Pressable onPress={() => me.refetch()}>
          <Text style={{ color: colors.primary, marginTop: 8 }}>
            Reintentar
          </Text>
        </Pressable>
      </View>
    );
  }

  const renderItem = ({ item }: { item: Dispatch }) => {
    const badge = estadoColor(item.estado);
    return (
      <Pressable
        style={({ pressed }) => [
          styles.card,
          {
            backgroundColor: colors.card,
            borderColor: colors.border,
            borderRadius: colors.radius,
          },
          pressed && { opacity: 0.8 },
        ]}
        onPress={() => router.push(`/despacho/${item.id}`)}
      >
        <View style={styles.cardHeader}>
          <Text style={[styles.cardTitle, { color: colors.foreground }]}>
            Despacho #{item.id}
          </Text>
          <View
            style={[
              styles.badge,
              { backgroundColor: badge.bg, borderRadius: colors.radius },
            ]}
          >
            <Text style={[styles.badgeText, { color: badge.fg }]}>
              {estadoLabel(item.estado)}
            </Text>
          </View>
        </View>
        {item.clienteNombre && (
          <View style={styles.row}>
            <Feather name="briefcase" size={14} color={colors.mutedForeground} />
            <Text style={[styles.rowText, { color: colors.foreground }]}>
              {item.clienteNombre}
            </Text>
          </View>
        )}
        {item.destino && (
          <View style={styles.row}>
            <Feather name="map-pin" size={14} color={colors.mutedForeground} />
            <Text style={[styles.rowText, { color: colors.foreground }]}>
              {item.destino}
            </Text>
          </View>
        )}
        <View style={styles.row}>
          <Feather name="calendar" size={14} color={colors.mutedForeground} />
          <Text style={[styles.rowText, { color: colors.mutedForeground }]}>
            Salida: {formatDate(item.fechaEstimadaSalida)}
          </Text>
        </View>
        {item.vehiculoModelo && (
          <View style={styles.row}>
            <Feather name="truck" size={14} color={colors.mutedForeground} />
            <Text style={[styles.rowText, { color: colors.mutedForeground }]}>
              {item.vehiculoModelo}
            </Text>
          </View>
        )}
      </Pressable>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <FlatList
        data={dispatches.data ?? []}
        keyExtractor={(item) => String(item.id)}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={dispatches.isRefetching}
            onRefresh={() => dispatches.refetch()}
            tintColor={colors.primary}
          />
        }
        ListEmptyComponent={
          dispatches.isLoading ? (
            <ActivityIndicator
              color={colors.primary}
              size="large"
              style={{ marginTop: 60 }}
            />
          ) : (
            <View style={styles.center}>
              <Feather
                name="inbox"
                size={44}
                color={colors.mutedForeground}
                style={{ marginTop: 60 }}
              />
              <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
                Sin despachos
              </Text>
              <Text
                style={[styles.emptyText, { color: colors.mutedForeground }]}
              >
                No tienes despachos asignados por el momento.
              </Text>
            </View>
          )
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  list: { padding: 16, paddingBottom: 100 },
  card: {
    borderWidth: 1,
    padding: 16,
    marginBottom: 12,
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  cardTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  badge: { paddingHorizontal: 10, paddingVertical: 4 },
  badgeText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 6,
  },
  rowText: { fontSize: 14, fontFamily: "Inter_400Regular", flex: 1 },
  emptyTitle: {
    fontSize: 17,
    fontFamily: "Inter_600SemiBold",
    marginTop: 14,
    textAlign: "center",
  },
  emptyText: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    marginTop: 6,
    textAlign: "center",
  },
});
