import { Feather } from "@expo/vector-icons";
import { Stack, useLocalSearchParams } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import React from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  useGetDriverDispatch,
  useUpdateDriverDispatchStatus,
  getGetDriverDispatchQueryKey,
  getListDriverDispatchesQueryKey,
  type DriverStatusUpdateInputEstado,
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

export default function DespachoDetailScreen() {
  const colors = useColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const dispatchId = Number(id);
  const queryClient = useQueryClient();

  const detail = useGetDriverDispatch(dispatchId, {
    query: {
      queryKey: getGetDriverDispatchQueryKey(dispatchId),
      enabled: Number.isFinite(dispatchId),
    },
  });

  const updateStatus = useUpdateDriverDispatchStatus({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: getGetDriverDispatchQueryKey(dispatchId),
        });
        queryClient.invalidateQueries({
          queryKey: getListDriverDispatchesQueryKey(),
        });
      },
      onError: (error) => {
        const apiError = error as ApiErrorLike;
        Alert.alert(
          "No se pudo actualizar",
          apiError?.data?.message ?? "Intenta de nuevo.",
        );
      },
    },
  });

  const setEstado = (estado: DriverStatusUpdateInputEstado, label: string) => {
    Alert.alert("Confirmar", `¿Marcar este despacho como "${label}"?`, [
      { text: "Cancelar", style: "cancel" },
      {
        text: "Confirmar",
        onPress: () =>
          updateStatus.mutate({ id: dispatchId, data: { estado } }),
      },
    ]);
  };

  const d = detail.data;
  const badge = d ? estadoColor(d.estado) : null;

  return (
    <>
      <Stack.Screen
        options={{
          title: d ? `Despacho #${d.id}` : "Despacho",
          headerStyle: { backgroundColor: colors.card },
          headerTintColor: colors.foreground,
        }}
      />
      <ScrollView
        style={[styles.container, { backgroundColor: colors.background }]}
        contentContainerStyle={styles.content}
      >
        {detail.isLoading ? (
          <ActivityIndicator
            color={colors.primary}
            size="large"
            style={{ marginTop: 60 }}
          />
        ) : detail.isError || !d ? (
          <View style={styles.center}>
            <Feather name="alert-circle" size={44} color={colors.mutedForeground} />
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
              No se pudo cargar el despacho
            </Text>
            <Pressable onPress={() => detail.refetch()}>
              <Text style={{ color: colors.primary, marginTop: 8 }}>
                Reintentar
              </Text>
            </Pressable>
          </View>
        ) : (
          <>
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
              <View style={styles.headerRow}>
                <Text style={[styles.title, { color: colors.foreground }]}>
                  Despacho #{d.id}
                </Text>
                {badge && (
                  <View
                    style={[
                      styles.badge,
                      { backgroundColor: badge.bg, borderRadius: colors.radius },
                    ]}
                  >
                    <Text style={[styles.badgeText, { color: badge.fg }]}>
                      {estadoLabel(d.estado)}
                    </Text>
                  </View>
                )}
              </View>

              <InfoRow icon="briefcase" label="Cliente" value={d.clienteNombre} colors={colors} />
              <InfoRow icon="map-pin" label="Destino" value={d.destino} colors={colors} />
              <InfoRow icon="truck" label="Vehículo" value={d.vehiculoModelo} colors={colors} />
              <InfoRow icon="user" label="Ayudante" value={d.ayudanteNombre} colors={colors} />
              <InfoRow
                icon="calendar"
                label="Salida estimada"
                value={formatDate(d.fechaEstimadaSalida)}
                colors={colors}
              />
              <InfoRow
                icon="calendar"
                label="Llegada estimada"
                value={formatDate(d.fechaEstimadaLlegada)}
                colors={colors}
              />
              {d.distanciaKm != null && (
                <InfoRow
                  icon="navigation"
                  label="Distancia"
                  value={`${d.distanciaKm} km`}
                  colors={colors}
                />
              )}
            </View>

            {d.routePoints && d.routePoints.length > 0 && (
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
                <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
                  Ruta
                </Text>
                {[...d.routePoints]
                  .sort((a, b) => a.orden - b.orden)
                  .map((p, i) => (
                    <View key={p.id} style={styles.routeRow}>
                      <View
                        style={[
                          styles.routeDot,
                          { backgroundColor: colors.primary },
                        ]}
                      >
                        <Text
                          style={{
                            color: colors.primaryForeground,
                            fontSize: 11,
                            fontFamily: "Inter_600SemiBold",
                          }}
                        >
                          {i + 1}
                        </Text>
                      </View>
                      <Text
                        style={[styles.routeText, { color: colors.foreground }]}
                      >
                        {p.ubicacion}
                      </Text>
                    </View>
                  ))}
              </View>
            )}

            {(d.estado === "aprobado" || d.estado === "en-ruta") && (
              <View style={styles.actions}>
                {d.estado === "aprobado" && (
                  <Pressable
                    style={({ pressed }) => [
                      styles.actionButton,
                      {
                        backgroundColor: colors.primary,
                        borderRadius: colors.radius,
                      },
                      pressed && { opacity: 0.8 },
                      updateStatus.isPending && { opacity: 0.5 },
                    ]}
                    disabled={updateStatus.isPending}
                    onPress={() => setEstado("en-ruta", "En ruta")}
                  >
                    {updateStatus.isPending ? (
                      <ActivityIndicator color={colors.primaryForeground} />
                    ) : (
                      <>
                        <Feather
                          name="navigation"
                          size={18}
                          color={colors.primaryForeground}
                        />
                        <Text
                          style={[
                            styles.actionText,
                            { color: colors.primaryForeground },
                          ]}
                        >
                          Iniciar ruta
                        </Text>
                      </>
                    )}
                  </Pressable>
                )}
                {d.estado === "en-ruta" && (
                  <Pressable
                    style={({ pressed }) => [
                      styles.actionButton,
                      {
                        backgroundColor: "#16a34a",
                        borderRadius: colors.radius,
                      },
                      pressed && { opacity: 0.8 },
                      updateStatus.isPending && { opacity: 0.5 },
                    ]}
                    disabled={updateStatus.isPending}
                    onPress={() => setEstado("entregado", "Entregado")}
                  >
                    {updateStatus.isPending ? (
                      <ActivityIndicator color="#ffffff" />
                    ) : (
                      <>
                        <Feather name="check-circle" size={18} color="#ffffff" />
                        <Text style={[styles.actionText, { color: "#ffffff" }]}>
                          Marcar entregado
                        </Text>
                      </>
                    )}
                  </Pressable>
                )}
              </View>
            )}
          </>
        )}
      </ScrollView>
    </>
  );
}

function InfoRow({
  icon,
  label,
  value,
  colors,
}: {
  icon: React.ComponentProps<typeof Feather>["name"];
  label: string;
  value?: string | null;
  colors: ReturnType<typeof useColors>;
}) {
  if (!value) return null;
  return (
    <View style={styles.infoRow}>
      <Feather name={icon} size={15} color={colors.mutedForeground} />
      <Text style={[styles.infoLabel, { color: colors.mutedForeground }]}>
        {label}
      </Text>
      <Text style={[styles.infoValue, { color: colors.foreground }]}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16, paddingBottom: 40 },
  center: { alignItems: "center", marginTop: 60 },
  card: {
    borderWidth: 1,
    padding: 16,
    marginBottom: 14,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  title: { fontSize: 18, fontFamily: "Inter_700Bold" },
  badge: { paddingHorizontal: 10, paddingVertical: 4 },
  badgeText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  sectionTitle: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
    marginBottom: 10,
  },
  infoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 8,
  },
  infoLabel: { fontSize: 13, fontFamily: "Inter_400Regular", width: 120 },
  infoValue: { fontSize: 14, fontFamily: "Inter_500Medium", flex: 1 },
  routeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 8,
  },
  routeDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  routeText: { fontSize: 14, fontFamily: "Inter_400Regular", flex: 1 },
  actions: { gap: 10, marginTop: 4 },
  actionButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 15,
  },
  actionText: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
});
