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
  useCompleteDriverRoutePoint,
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

  const completePoint = useCompleteDriverRoutePoint({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: getGetDriverDispatchQueryKey(dispatchId),
        });
      },
      onError: (error) => {
        const apiError = error as ApiErrorLike;
        Alert.alert(
          "No se pudo actualizar la parada",
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

  const togglePoint = (pointId: number, completado: boolean) => {
    completePoint.mutate({
      id: dispatchId,
      pointId,
      data: { completado: !completado },
    });
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

            {(d.pesoTotal != null || d.volumenTotal != null) && (
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
                  Carga
                </Text>
                <View style={styles.loadGrid}>
                  {d.pesoTotal != null && (
                    <View style={[styles.loadItem, { backgroundColor: colors.background, borderRadius: colors.radius }]}>
                      <Feather name="package" size={20} color={colors.primary} />
                      <Text style={[styles.loadValue, { color: colors.foreground }]}>
                        {d.pesoTotal.toLocaleString("es-DO")} kg
                      </Text>
                      <Text style={[styles.loadLabel, { color: colors.mutedForeground }]}>Peso total</Text>
                    </View>
                  )}
                  {d.volumenTotal != null && (
                    <View style={[styles.loadItem, { backgroundColor: colors.background, borderRadius: colors.radius }]}>
                      <Feather name="box" size={20} color={colors.primary} />
                      <Text style={[styles.loadValue, { color: colors.foreground }]}>
                        {d.volumenTotal.toLocaleString("es-DO")} m³
                      </Text>
                      <Text style={[styles.loadLabel, { color: colors.mutedForeground }]}>Volumen total</Text>
                    </View>
                  )}
                </View>
                {d.saleItems && d.saleItems.length > 0 && (
                  <>
                    <Text style={[styles.subSectionTitle, { color: colors.mutedForeground }]}>
                      Órdenes incluidas
                    </Text>
                    {d.saleItems.map((item) => (
                      <View key={item.id} style={[styles.saleItemRow, { borderColor: colors.border }]}>
                        <View style={styles.saleItemMain}>
                          <Text style={[styles.saleItemDesc, { color: colors.foreground }]}>
                            {item.descripcion}
                          </Text>
                          <Text style={[styles.saleItemMeta, { color: colors.mutedForeground }]}>
                            Cant: {item.cantidad} · {item.pesoUnitario} kg/u
                          </Text>
                        </View>
                        <Text style={[styles.saleItemDims, { color: colors.mutedForeground }]}>
                          {item.largo}×{item.ancho}×{item.alto} m
                        </Text>
                      </View>
                    ))}
                  </>
                )}
              </View>
            )}

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
                  .map((p, i) => {
                    const isCompleted = p.completado;
                    const canToggle = d.estado === "en-ruta";
                    return (
                      <Pressable
                        key={p.id}
                        style={({ pressed }) => [
                          styles.routeRow,
                          canToggle && pressed && { opacity: 0.7 },
                        ]}
                        onPress={canToggle ? () => togglePoint(p.id, isCompleted) : undefined}
                        disabled={!canToggle || completePoint.isPending}
                      >
                        <View
                          style={[
                            styles.routeDot,
                            {
                              backgroundColor: isCompleted ? "#16a34a" : colors.primary,
                            },
                          ]}
                        >
                          {isCompleted ? (
                            <Feather name="check" size={13} color="#ffffff" />
                          ) : (
                            <Text
                              style={{
                                color: colors.primaryForeground,
                                fontSize: 11,
                                fontFamily: "Inter_600SemiBold",
                              }}
                            >
                              {i + 1}
                            </Text>
                          )}
                        </View>
                        <Text
                          style={[
                            styles.routeText,
                            {
                              color: isCompleted ? colors.mutedForeground : colors.foreground,
                              textDecorationLine: isCompleted ? "line-through" : "none",
                            },
                          ]}
                        >
                          {p.ubicacion}
                        </Text>
                        {canToggle && (
                          <Feather
                            name={isCompleted ? "check-square" : "square"}
                            size={18}
                            color={isCompleted ? "#16a34a" : colors.mutedForeground}
                          />
                        )}
                      </Pressable>
                    );
                  })}
                {d.estado === "en-ruta" && (
                  <Text style={[styles.routeHint, { color: colors.mutedForeground }]}>
                    Toca una parada para marcarla como completada.
                  </Text>
                )}
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
  subSectionTitle: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
    marginTop: 12,
    marginBottom: 6,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  infoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 8,
  },
  infoLabel: { fontSize: 13, fontFamily: "Inter_400Regular", width: 120 },
  infoValue: { fontSize: 14, fontFamily: "Inter_500Medium", flex: 1 },
  loadGrid: {
    flexDirection: "row",
    gap: 10,
  },
  loadItem: {
    flex: 1,
    padding: 12,
    alignItems: "center",
    gap: 4,
  },
  loadValue: { fontSize: 17, fontFamily: "Inter_700Bold", marginTop: 4 },
  loadLabel: { fontSize: 12, fontFamily: "Inter_400Regular" },
  saleItemRow: {
    flexDirection: "row",
    alignItems: "center",
    borderTopWidth: 1,
    paddingTop: 8,
    marginTop: 8,
    gap: 8,
  },
  saleItemMain: { flex: 1 },
  saleItemDesc: { fontSize: 14, fontFamily: "Inter_500Medium" },
  saleItemMeta: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  saleItemDims: { fontSize: 11, fontFamily: "Inter_400Regular" },
  routeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 8,
    minHeight: 34,
  },
  routeDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  routeText: { fontSize: 14, fontFamily: "Inter_400Regular", flex: 1 },
  routeHint: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    marginTop: 10,
    textAlign: "center",
  },
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
