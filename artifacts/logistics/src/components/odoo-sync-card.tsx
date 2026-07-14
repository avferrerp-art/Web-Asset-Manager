import React, { useState } from "react";
import {
  useGetOdooStatus,
  getGetOdooStatusQueryKey,
  useTestOdooConnection,
  useSyncOdooNow,
  getListSalesQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Plug, RefreshCw, CheckCircle2, XCircle, AlertCircle } from "lucide-react";

function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString("es-VE", {
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
    query: { queryKey: getGetOdooStatusQueryKey(), refetchInterval: 60_000 },
  });

  const testMutation = useTestOdooConnection();
  const syncMutation = useSyncOdooNow();

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: getGetOdooStatusQueryKey() });
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
    syncMutation.mutate(undefined, {
      onSuccess: (data) => {
        refresh();
        queryClient.invalidateQueries({ queryKey: getListSalesQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListSalesQueryKey({ status: "pendiente" }) });
        if (data.ok) {
          toast({
            title:
              data.imported > 0
                ? `Se importaron ${data.imported} orden${data.imported !== 1 ? "es" : ""} de Odoo`
                : "Sincronización completada — sin órdenes nuevas",
            description:
              data.orders.length > 0 ? `Órdenes: ${data.orders.join(", ")}` : undefined,
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
              </div>
              <p className="text-xs text-muted-foreground mt-0.5 truncate" data-testid="text-odoo-detail">
                {!configured
                  ? "Faltan los secretos ODOO_URL, ODOO_DB, ODOO_USERNAME y ODOO_API_KEY."
                  : status?.lastSyncAt
                    ? `Última sincronización: ${fmtDateTime(status.lastSyncAt)} · ${status.importedCount} importada${status.importedCount !== 1 ? "s" : ""}, ${status.skippedCount} ya existente${status.skippedCount !== 1 ? "s" : ""}`
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
