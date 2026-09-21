import React, { useState } from "react";
import {
  useGetOdooStatus,
  getGetOdooStatusQueryKey,
  useTestOdooConnection,
  useSyncOdooNow,
  getListSalesQueryKey,
  useListOdooAlerts,
  getListOdooAlertsQueryKey,
  useResolveOdooAlert,
  useSyncOdooDeliveries,
  useBackfillOdooInternalTransfers,
  getListTrasladosQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { deriveSyncStatusVisibility } from "./odoo-sync-status";
import { Loader2, Plug, RefreshCw, CheckCircle2, XCircle, AlertCircle, Truck, History, Package } from "lucide-react";

const ODOO_STATUS_POLL_MS = 60_000;

function fmtDateTime(iso: string) {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "fecha desconocida";
  return date.toLocaleString("es-VE", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function OdooSyncCard() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  const { data: status, isLoading } = useGetOdooStatus({
    query: {
      queryKey: getGetOdooStatusQueryKey(),
      staleTime: ODOO_STATUS_POLL_MS,
      refetchInterval: ODOO_STATUS_POLL_MS,
      refetchIntervalInBackground: false,
    },
  });

  const { data: alerts } = useListOdooAlerts(undefined, {
    query: {
      queryKey: getListOdooAlertsQueryKey(),
      staleTime: ODOO_STATUS_POLL_MS,
      refetchInterval: ODOO_STATUS_POLL_MS,
      refetchIntervalInBackground: false,
    },
  });
  const resolveAlertMutation = useResolveOdooAlert();
  const handleResolveAlert = (id: number) => {
    resolveAlertMutation.mutate(
      { id },
      {
        onSuccess: () => {
          queryClient.removeQueries({ queryKey: getListOdooAlertsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getListOdooAlertsQueryKey() });
        },
      },
    );
  };

  const testMutation = useTestOdooConnection();
  const syncMutation = useSyncOdooNow();
  const syncDeliveriesMutation = useSyncOdooDeliveries();
  const backfillTransfersMutation = useBackfillOdooInternalTransfers();

  const handleSyncDeliveries = () => {
    syncDeliveriesMutation.mutate(undefined, {
      onSuccess: (data) => {
        refresh();
        queryClient.invalidateQueries({ queryKey: getListSalesQueryKey() });
        queryClient.removeQueries({ queryKey: getListOdooAlertsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListOdooAlertsQueryKey() });
        if (data.ok) {
          const parts: string[] = [];
          if (data.created > 0) parts.push(`${data.created} creado${data.created !== 1 ? "s" : ""}`);
          if (data.updated > 0) parts.push(`${data.updated} actualizado${data.updated !== 1 ? "s" : ""}`);
          if (data.deleted > 0) parts.push(`${data.deleted} eliminado${data.deleted !== 1 ? "s" : ""}`);
          if (data.alertsCreated > 0)
            parts.push(`${data.alertsCreated} alerta${data.alertsCreated !== 1 ? "s" : ""}`);
          toast({
            title:
              parts.length > 0
                ? `Albaranes: ${parts.join(", ")}`
                : "Albaranes sincronizados — sin cambios",
          });
        }
      },
      onError: (err: unknown) => {
        refresh();
        const anyErr = err as { response?: { data?: { error?: string } }; message?: string };
        toast({
          title: "Error al sincronizar albaranes",
          description: anyErr?.response?.data?.error ?? anyErr?.message ?? "Error desconocido",
          variant: "destructive",
        });
      },
    });
  };

  const refresh = () => {
    queryClient.removeQueries({ queryKey: getGetOdooStatusQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetOdooStatusQueryKey() });
  };

  const handleBackfillTransfers = () => {
    backfillTransfersMutation.mutate(undefined, {
      onSuccess: (data) => {
        refresh();
        queryClient.removeQueries({ queryKey: getListTrasladosQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListTrasladosQueryKey() });
        if (data.ok) {
          const parts: string[] = [];
          if (data.transfersCreated > 0) {
            parts.push(`${data.transfersCreated} creado${data.transfersCreated !== 1 ? "s" : ""}`);
          }
          if (data.transfersUpdated > 0) {
            parts.push(`${data.transfersUpdated} actualizado${data.transfersUpdated !== 1 ? "s" : ""}`);
          }
          toast({
            title:
              parts.length > 0
                ? `Traslados históricos: ${parts.join(", ")}`
                : "Traslados históricos importados — sin cambios",
          });
        }
      },
      onError: (err: unknown) => {
        refresh();
        const anyErr = err as { response?: { data?: { error?: string } }; message?: string };
        toast({
          title: "Error al importar traslados históricos",
          description: anyErr?.response?.data?.error ?? anyErr?.message ?? "Error desconocido",
          variant: "destructive",
        });
      },
    });
  };

  const handleTest = () => {
    setTestResult(null);
    testMutation.mutate(undefined, {
      onSuccess: (data) => {
        setTestResult(
          data.ok
            ? { ok: true, message: `Conexión exitosa con ${data.url}` }
            : { ok: false, message: data.error ?? "Error desconocido" },
        );
      },
      onError: (err: unknown) => {
        const anyErr = err as { response?: { data?: { error?: string } }; message?: string };
        setTestResult({
          ok: false,
          message: anyErr?.response?.data?.error ?? anyErr?.message ?? "Error de conexión",
        });
      },
    });
  };

  const handleSync = () => {
    setTestResult(null);
    syncMutation.mutate({}, {
      onSuccess: (data) => {
        refresh();
        queryClient.invalidateQueries({ queryKey: getListSalesQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListSalesQueryKey({ status: "pendiente" }) });
        queryClient.invalidateQueries({ queryKey: getListOdooAlertsQueryKey() });
        if (data.ok) {
          const parts: string[] = [];
          if (data.imported > 0)
            parts.push(`${data.imported} importada${data.imported !== 1 ? "s" : ""}`);
          if (data.updated.length > 0)
            parts.push(`${data.updated.length} actualizada${data.updated.length !== 1 ? "s" : ""}`);
          if (data.alertsCreated > 0)
            parts.push(`${data.alertsCreated} alerta${data.alertsCreated !== 1 ? "s" : ""}`);
          toast({
            title:
              parts.length > 0
                ? `Sincronización: ${parts.join(", ")}`
                : "Sincronización completada — sin cambios",
            description:
              [...data.orders, ...data.updated].length > 0
                ? `Órdenes: ${[...data.orders, ...data.updated].join(", ")}`
                : undefined,
          });
        }
      },
      onError: (err: unknown) => {
        refresh();
        const anyErr = err as { response?: { data?: { error?: string } }; message?: string };
        toast({
          title: "Error al sincronizar con Odoo",
          description: anyErr?.response?.data?.error ?? anyErr?.message ?? "Error desconocido",
          variant: "destructive",
        });
      },
    });
  };

  if (isLoading) return null;

  const configured = status?.configured ?? false;
  const ordersVisibility = deriveSyncStatusVisibility({
    result: status?.lastResult,
    completedAt: status?.lastSyncAt,
    stale: status?.ordersSyncStale,
  });
  const deliveriesVisibility = deriveSyncStatusVisibility({
    result: status?.lastDeliveriesResult,
    completedAt: status?.lastDeliveriesSyncAt,
    stale: status?.deliveriesSyncStale,
  });
  const productsVisibility = deriveSyncStatusVisibility({
    result: status?.lastProductsResult,
    completedAt: status?.lastProductsSyncAt,
    stale: status?.productsSyncStale,
  });
  const ordersNeverSynced = configured && ordersVisibility.neverSynced;
  const ordersStale = configured && ordersVisibility.stale;
  const deliveriesNeverSynced = configured && deliveriesVisibility.neverSynced;
  const deliveriesStale = configured && deliveriesVisibility.stale;
  const productsNeverSynced = configured && productsVisibility.neverSynced;
  const productsStale = configured && productsVisibility.stale;

  return (
    <Card data-testid="card-odoo-sync">
      <CardContent className="py-4">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3 justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <div className={`p-2 rounded-md ${configured ? "bg-primary/15" : "bg-muted"}`}>
              <Plug className={`w-5 h-5 ${configured ? "text-primary" : "text-muted-foreground"}`} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="font-semibold text-sm">Integración Odoo</p>
                {configured ? (
                  <Badge variant="outline" className="text-green-500 border-green-500/50" data-testid="badge-odoo-configured">
                    Configurada
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-orange-500 border-orange-500/50" data-testid="badge-odoo-not-configured">
                    Sin configurar
                  </Badge>
                )}
                {configured && status?.lastResult === "error" && (
                  <Badge variant="outline" className="text-red-500 border-red-500/50">
                    Último intento falló
                  </Badge>
                )}
                {configured && status?.lastResult === "running" && (
                  <Badge
                    variant="outline"
                    className={
                      ordersStale
                        ? "text-red-500 border-red-500/50"
                        : "text-blue-500 border-blue-500/50"
                    }
                  >
                    {ordersStale ? (
                      <AlertCircle className="mr-1 h-3 w-3" />
                    ) : (
                      <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                    )}
                    {ordersStale ? "Sincronización atascada" : "Sincronizando"}
                  </Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5 truncate" data-testid="text-odoo-detail">
                {!configured
                  ? "Faltan los secretos ODOO_URL, ODOO_DB, ODOO_USERNAME y ODOO_API_KEY."
                  : status?.lastResult === "running"
                    ? status.ordersSyncStartedAt
                      ? `Sincronización iniciada: ${fmtDateTime(status.ordersSyncStartedAt)}${status.lastSyncAt ? ` · último intento finalizado: ${fmtDateTime(status.lastSyncAt)}` : ""}`
                      : "Sincronización en curso"
                    : status?.lastResult === "error" && status.lastSyncAt
                      ? `Último intento fallido: ${fmtDateTime(status.lastSyncAt)}`
                      : status?.lastSyncAt
                        ? `Última sincronización exitosa: ${fmtDateTime(status.lastSyncAt)} · ${status.importedCount} importada${status.importedCount !== 1 ? "s" : ""}, ${status.skippedCount} ya existente${status.skippedCount !== 1 ? "s" : ""}`
                        : `Conectado a ${status?.serverUrl} · aún sin sincronizaciones`}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <Button
              data-testid="button-odoo-test"
              variant="outline"
              size="sm"
              onClick={handleTest}
              disabled={testMutation.isPending}
              className="gap-1.5"
            >
              {testMutation.isPending ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Plug className="w-3.5 h-3.5" />
              )}
              Probar conexión
            </Button>
            <Button
              data-testid="button-odoo-sync"
              size="sm"
              onClick={handleSync}
              disabled={syncMutation.isPending}
              className="gap-1.5"
            >
              {syncMutation.isPending ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <RefreshCw className="w-3.5 h-3.5" />
              )}
              Sincronizar ahora
            </Button>
          </div>
        </div>

        {ordersNeverSynced && (
          <div
            className="mt-3 flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400"
            data-testid="warning-odoo-never-synced"
          >
            <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span>Odoo está configurado, pero las órdenes nunca se han sincronizado.</span>
          </div>
        )}

        {ordersStale && (
          <div
            className="mt-3 flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400"
            data-testid="warning-odoo-stale"
          >
            <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span>La sincronización de órdenes superó el tiempo esperado sin completar.</span>
          </div>
        )}

        {testResult && (
          <div
            data-testid="text-odoo-test-result"
            className={`mt-3 flex items-start gap-2 rounded-md border px-3 py-2 text-xs ${
              testResult.ok
                ? "border-green-500/30 bg-green-500/10 text-green-600 dark:text-green-400"
                : "border-destructive/40 bg-destructive/10 text-destructive"
            }`}
          >
            {testResult.ok ? (
              <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            ) : (
              <XCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            )}
            <span>{testResult.message}</span>
          </div>
        )}

        {configured && (
          <div
            className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 justify-between rounded-md border px-3 py-2"
            data-testid="section-odoo-deliveries"
          >
            <div className="flex items-center gap-2 min-w-0 flex-wrap">
              <Truck className="w-4 h-4 shrink-0 text-muted-foreground" />
              <p className="font-semibold text-xs">Albaranes</p>
              {status?.lastDeliveriesResult === "ok" && (
                <Badge variant="outline" className="text-green-500 border-green-500/50 text-[10px]">
                  OK
                </Badge>
              )}
              {status?.lastDeliveriesResult === "error" && (
                <Badge variant="outline" className="text-red-500 border-red-500/50 text-[10px]">
                  Último intento falló
                </Badge>
              )}
              {status?.lastDeliveriesResult === "running" && (
                <Badge
                  variant="outline"
                  className={`text-[10px] ${
                    deliveriesStale
                      ? "text-red-500 border-red-500/50"
                      : "text-blue-500 border-blue-500/50"
                  }`}
                >
                  {deliveriesStale ? (
                    <AlertCircle className="mr-1 h-3 w-3" />
                  ) : (
                    <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                  )}
                  {deliveriesStale ? "Sincronización atascada" : "Sincronizando"}
                </Badge>
              )}
              <p className="text-xs text-muted-foreground truncate" data-testid="text-odoo-deliveries-detail">
                {status?.lastDeliveriesResult === "running"
                  ? status.deliveriesSyncStartedAt
                    ? `Sincronización iniciada: ${fmtDateTime(status.deliveriesSyncStartedAt)}${status.lastDeliveriesSyncAt ? ` · último intento finalizado: ${fmtDateTime(status.lastDeliveriesSyncAt)}` : ""}`
                    : "Sincronización en curso"
                  : status?.lastDeliveriesResult === "error" && status.lastDeliveriesSyncAt
                    ? `Último intento fallido: ${fmtDateTime(status.lastDeliveriesSyncAt)}`
                    : status?.lastDeliveriesSyncAt
                      ? `Última sincronización exitosa: ${fmtDateTime(status.lastDeliveriesSyncAt)} · ${status.deliveriesCreatedCount} creado${status.deliveriesCreatedCount !== 1 ? "s" : ""}, ${status.deliveriesUpdatedCount} actualizado${status.deliveriesUpdatedCount !== 1 ? "s" : ""}`
                      : "Aún sin sincronizaciones de albaranes"}
              </p>
              {deliveriesNeverSynced && (
                <Badge
                  variant="outline"
                  className="text-amber-600 border-amber-500/50 text-[10px]"
                  data-testid="warning-odoo-deliveries-never-synced"
                >
                  Nunca sincronizados
                </Badge>
              )}
              {deliveriesStale && (
                <Badge
                  variant="outline"
                  className="text-amber-600 border-amber-500/50 text-[10px]"
                  data-testid="warning-odoo-deliveries-stale"
                >
                  Sincronización atascada
                </Badge>
              )}
            </div>
            <Button
              data-testid="button-odoo-sync-deliveries"
              variant="outline"
              size="sm"
              onClick={handleSyncDeliveries}
              disabled={syncDeliveriesMutation.isPending}
              className="gap-1.5 shrink-0"
            >
              {syncDeliveriesMutation.isPending ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <RefreshCw className="w-3.5 h-3.5" />
              )}
              Sincronizar albaranes
            </Button>
            {status?.lastDeliveriesResult === "error" && status?.lastDeliveriesError && (
              <div
                className="w-full flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
                data-testid="text-odoo-deliveries-last-error"
              >
                <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                <span>{status.lastDeliveriesError}</span>
              </div>
            )}
          </div>
        )}

        {configured && (
          <div
            className="mt-3 rounded-md border px-3 py-2"
            data-testid="section-odoo-products"
          >
            <div className="flex items-center gap-2 min-w-0 flex-wrap">
              <Package className="w-4 h-4 shrink-0 text-muted-foreground" />
              <p className="font-semibold text-xs">Productos</p>
              {status?.lastProductsResult === "ok" && (
                <Badge variant="outline" className="text-green-500 border-green-500/50 text-[10px]">
                  OK
                </Badge>
              )}
              {status?.lastProductsResult === "error" && (
                <Badge variant="outline" className="text-red-500 border-red-500/50 text-[10px]">
                  Último intento falló
                </Badge>
              )}
              {status?.lastProductsResult === "running" && (
                <Badge
                  variant="outline"
                  className={`text-[10px] ${
                    productsStale
                      ? "text-red-500 border-red-500/50"
                      : "text-blue-500 border-blue-500/50"
                  }`}
                >
                  {productsStale ? (
                    <AlertCircle className="mr-1 h-3 w-3" />
                  ) : (
                    <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                  )}
                  {productsStale ? "Sincronización atascada" : "Sincronizando"}
                </Badge>
              )}
              <p className="text-xs text-muted-foreground truncate" data-testid="text-odoo-products-detail">
                {status?.lastProductsResult === "running"
                  ? status.productsSyncStartedAt
                    ? `Sincronización iniciada: ${fmtDateTime(status.productsSyncStartedAt)}${status.lastProductsSyncAt ? ` · último intento finalizado: ${fmtDateTime(status.lastProductsSyncAt)}` : ""}`
                    : "Sincronización en curso"
                  : status?.lastProductsResult === "error" && status.lastProductsSyncAt
                    ? `Último intento fallido: ${fmtDateTime(status.lastProductsSyncAt)}`
                    : status?.lastProductsSyncAt
                      ? `Última sincronización exitosa: ${fmtDateTime(status.lastProductsSyncAt)} · ${status.productsCreatedCount} creado${status.productsCreatedCount !== 1 ? "s" : ""}, ${status.productsUpdatedCount} actualizado${status.productsUpdatedCount !== 1 ? "s" : ""}`
                      : "Aún sin sincronizaciones de productos"}
              </p>
              {productsNeverSynced && (
                <Badge
                  variant="outline"
                  className="text-amber-600 border-amber-500/50 text-[10px]"
                  data-testid="warning-odoo-products-never-synced"
                >
                  Nunca sincronizados
                </Badge>
              )}
            </div>
            {productsStale && (
              <div
                className="mt-2 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
                data-testid="warning-odoo-products-stale"
              >
                <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                <span>La sincronización de productos superó el tiempo esperado sin completar.</span>
              </div>
            )}
            {status?.lastProductsResult === "error" && status.lastProductsError && (
              <div
                className="mt-2 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
                data-testid="text-odoo-products-last-error"
              >
                <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                <span>{status.lastProductsError}</span>
              </div>
            )}
          </div>
        )}

        {configured && (
          <div
            className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 justify-between rounded-md border px-3 py-2"
            data-testid="section-odoo-historical-transfers"
          >
            <div className="flex items-center gap-2 min-w-0 flex-wrap">
              <History className="w-4 h-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0">
                <p className="font-semibold text-xs">Traslados históricos</p>
                <p className="text-xs text-muted-foreground">
                  Importa movimientos internos anteriores a la sincronización incremental.
                </p>
              </div>
            </div>
            <Button
              data-testid="button-odoo-backfill-transfers"
              variant="outline"
              size="sm"
              onClick={handleBackfillTransfers}
              disabled={backfillTransfersMutation.isPending}
              className="gap-1.5 shrink-0"
            >
              {backfillTransfersMutation.isPending ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <History className="w-3.5 h-3.5" />
              )}
              Importar traslados históricos
            </Button>
          </div>
        )}

        {alerts && alerts.length > 0 && (
          <div className="mt-3 space-y-2" data-testid="list-odoo-alerts">
            {alerts.map((alert) => (
              <div
                key={alert.id}
                className="flex items-start justify-between gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs"
                data-testid={`alert-odoo-${alert.id}`}
              >
                <div className="flex items-start gap-2 min-w-0">
                  <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0 text-amber-500" />
                  <span className="text-amber-700 dark:text-amber-400">{alert.mensaje}</span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-[11px] shrink-0"
                  disabled={resolveAlertMutation.isPending}
                  onClick={() => handleResolveAlert(alert.id)}
                  data-testid={`button-resolve-alert-${alert.id}`}
                >
                  Marcar resuelta
                </Button>
              </div>
            ))}
          </div>
        )}

        {configured && status?.lastResult === "error" && status?.lastError && !testResult && (
          <div className="mt-3 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive" data-testid="text-odoo-last-error">
            <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span>{status.lastError}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function OdooBadge({ odooRef }: { odooRef?: string | null }) {
  if (!odooRef) return null;
  return (
    <Badge
      variant="outline"
      className="text-purple-400 border-purple-500/50 ml-1.5 text-[10px] px-1.5 py-0"
      title="Importada desde Odoo"
    >
      Odoo {odooRef}
    </Badge>
  );
}
