import { useState } from "react";
import {
  getListTrasladosQueryKey,
  useListTraslados,
  type TrasladoSummary,
} from "@workspace/api-client-react";
import { AlertCircle, ArrowRight, ArrowRightLeft, PackageSearch, Search, Truck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatTrasladoMedida } from "@/lib/traslado-medidas";
import { matchesSearch } from "@/lib/search";
import { TrasladoStatusBadge } from "@/lib/traslado-status";
import type { ViajeSelectedOrder } from "@/components/viaje-wizard";

interface PendingTrasladosCardProps {
  dispatchProgressByTrasladoId: Map<number, DispatchProgress>;
  isLoadingDispatches: boolean;
  dispatchesError: Error | null;
  onPlan: (traslado: TrasladoSummary) => void;
  onCreateDispatch: (traslado: TrasladoSummary) => void;
  tripMode?: boolean;
  selectedTripKeys?: Set<string>;
  onToggleTripOrder?: (order: ViajeSelectedOrder) => void;
}

export interface DispatchProgress {
  partialCount: number;
  assignedPesoKg: number;
  assignedVolumenM3: number;
  hasComplete: boolean;
}

const PARTIAL_DISPATCH_ELIGIBLE_STATES = new Set([
  "planificado",
  "en_carga",
  "en_transito",
]);

export function PendingTrasladosCard({
  dispatchProgressByTrasladoId,
  isLoadingDispatches,
  dispatchesError,
  onPlan,
  onCreateDispatch,
  tripMode = false,
  selectedTripKeys = new Set(),
  onToggleTripOrder,
}: PendingTrasladosCardProps) {
  const [search, setSearch] = useState("");
  const {
    data: traslados,
    isLoading,
    isError,
    error,
  } = useListTraslados(undefined, {
    query: {
      queryKey: getListTrasladosQueryKey(),
      refetchInterval: 30_000,
    },
  });

  const eligibleTraslados = (traslados ?? []).filter((traslado) => {
    const progress = dispatchProgressByTrasladoId.get(traslado.id);
    return (
      traslado.estadoLogistico === "por_planificar"
      || (
        PARTIAL_DISPATCH_ELIGIBLE_STATES.has(traslado.estadoLogistico)
        && Boolean(progress?.partialCount)
      )
    )
    && !traslado.mismoAlmacen
    && traslado.almacenOrigen !== null
    && traslado.almacenDestino !== null
    && !progress?.hasComplete
    && !(tripMode && progress?.partialCount);
  });
  const pendingTraslados = search.trim()
    ? eligibleTraslados.filter((traslado) => matchesSearch(search, [
        traslado.referencia,
        traslado.id,
        `#${traslado.id}`,
        traslado.almacenOrigen?.codigo,
        traslado.almacenOrigen?.nombre,
        traslado.almacenDestino?.codigo,
        traslado.almacenDestino?.nombre,
      ]))
    : eligibleTraslados;

  return (
    <Card className="min-w-0" data-testid="card-pending-traslados">
      <CardHeader>
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <CardTitle className="flex items-center gap-2">
              <ArrowRightLeft className="h-5 w-5 text-primary" />
              Traslados por Planificar
            </CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              Movimientos entre almacenes que requieren transporte y aún no tienen un despacho activo.
            </p>
          </div>
          <div className="relative flex-1 min-w-[220px] max-w-sm">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Buscar por referencia o almacén..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="pl-8 h-9"
              data-testid="input-search-pending-traslados"
            />
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="max-h-[420px] overflow-auto [&>div]:overflow-visible">
        <Table>
          <TableHeader className="sticky top-0 bg-card z-10">
            <TableRow>
              <TableHead>Referencia</TableHead>
              <TableHead>Origen → Destino</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead>Peso</TableHead>
              <TableHead>Volumen</TableHead>
                <TableHead className="w-[220px]">{tripMode ? "Incluir" : ""}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading || isLoadingDispatches ? (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center">
                  Cargando traslados...
                </TableCell>
              </TableRow>
            ) : isError || dispatchesError ? (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center text-destructive">
                  <span className="inline-flex items-center gap-2">
                    <AlertCircle className="h-4 w-4" />
                    {dispatchesError?.message
                      ?? (error instanceof Error ? error.message : "No se pudieron cargar los traslados.")}
                  </span>
                </TableCell>
              </TableRow>
            ) : pendingTraslados.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-32 text-center">
                  {search.trim() ? (
                    <span className="text-muted-foreground">
                      Sin resultados para "{search.trim()}"
                    </span>
                  ) : (
                    <div className="flex flex-col items-center gap-1.5 py-2" data-testid="empty-state-pending-traslados">
                      <PackageSearch className="w-8 h-8 text-muted-foreground/50" />
                      <p className="font-medium text-foreground">No hay traslados pendientes de planificar</p>
                      <p className="text-sm text-muted-foreground max-w-md">
                        Las reubicaciones dentro del mismo almacén y los traslados que ya tienen despacho no aparecen aquí.
                      </p>
                    </div>
                  )}
                </TableCell>
              </TableRow>
            ) : pendingTraslados.map((traslado) => {
              const progress = dispatchProgressByTrasladoId.get(traslado.id);
              return (
              <TableRow key={traslado.id} data-testid={`row-pending-traslado-${traslado.id}`}>
                <TableCell className="font-medium">
                  {traslado.referencia || `#${traslado.id}`}
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{traslado.almacenOrigen!.nombre}</span>
                    <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="font-medium">{traslado.almacenDestino!.nombre}</span>
                    {traslado.cruzaPlaza && (
                      <Badge
                        variant="outline"
                        className="border-purple-500/50 bg-purple-500/10 text-[10px] text-purple-600 dark:text-purple-400"
                      >
                        Cruza Plaza
                      </Badge>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  <TrasladoStatusBadge
                    estadoLogistico={traslado.estadoLogistico}
                    estadoOdoo={traslado.estadoOdoo}
                  />
                </TableCell>
                <TableCell>
                  {progress?.partialCount ? (
                    <div className="text-xs" data-testid={`text-partial-progress-traslado-${traslado.id}`}>
                      <div className="font-medium">
                        {progress.assignedPesoKg} kg asignados
                        {traslado.pesoCalculadoKg != null ? ` / ${traslado.pesoCalculadoKg} kg` : ""}
                      </div>
                      <div className="text-muted-foreground">
                        {progress.partialCount} {progress.partialCount === 1 ? "camión" : "camiones"}
                      </div>
                    </div>
                  ) : (
                    <span className={traslado.pesoEfectivoKg == null ? "text-xs italic text-muted-foreground" : ""}>
                      {formatTrasladoMedida(traslado.pesoEfectivoKg, "kg")}
                      {traslado.origenPeso === "estimado" ? " (estimado)" : ""}
                    </span>
                  )}
                </TableCell>
                <TableCell>
                  <span className={traslado.volumenCalculadoM3 == null ? "text-xs italic text-muted-foreground" : ""}>
                    {formatTrasladoMedida(traslado.volumenCalculadoM3, "m³")}
                  </span>
                </TableCell>
                <TableCell>
                    {tripMode ? (
                      <div className="flex justify-end">
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-primary"
                          checked={selectedTripKeys.has(`traslado:${traslado.id}`)}
                          onChange={() => onToggleTripOrder?.({
                            key: `traslado:${traslado.id}`,
                            tipo: "traslado",
                            id: traslado.id,
                            titulo: traslado.referencia || `Traslado #${traslado.id}`,
                            subtitulo: `${traslado.almacenOrigen?.nombre ?? "Origen"} → ${traslado.almacenDestino?.nombre ?? "Destino"}`,
                            pesoKg: traslado.pesoCalculadoKg,
                            volumenM3: traslado.volumenCalculadoM3,
                          })}
                          aria-label={`Incluir traslado ${traslado.referencia || traslado.id} en viaje`}
                          data-testid={`checkbox-viaje-traslado-${traslado.id}`}
                        />
                      </div>
                    ) : (
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-1"
                          onClick={() => onPlan(traslado)}
                          data-testid={`button-plan-traslado-${traslado.id}`}
                        >
                          <PackageSearch className="h-3.5 w-3.5" />
                          Planificar
                        </Button>
                        <Button
                          size="sm"
                          className="gap-1 font-semibold shadow-sm"
                          onClick={() => onCreateDispatch(traslado)}
                          data-testid={`button-create-traslado-dispatch-${traslado.id}`}
                        >
                          <Truck className="h-3.5 w-3.5" />
                          Crear Despacho
                        </Button>
                      </div>
                    )}
                </TableCell>
              </TableRow>
            )})}
          </TableBody>
        </Table>
        </div>
      </CardContent>
    </Card>
  );
}