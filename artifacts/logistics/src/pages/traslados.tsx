import React, { useState } from "react";
import {
  useListTraslados, getListTrasladosQueryKey,
  useListAlmacenes, getListAlmacenesQueryKey
} from "@workspace/api-client-react";
import type { ListTrasladosParams, TrasladoSummary } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Search, ArrowRight, Info, ArrowRightLeft, AlertCircle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { matchesSearch } from "@/lib/search";
import { formatTrasladoMedida } from "@/lib/traslado-medidas";
import { TrasladoDetailSheet } from "@/components/traslado-detail-sheet";
import { TrasladoStatusBadge } from "@/lib/traslado-status";

export default function Traslados() {
  const [search, setSearch] = useState("");
  const [origenFilter, setOrigenFilter] = useState<string>("todos");
  const [destinoFilter, setDestinoFilter] = useState<string>("todos");
  const [estadoFilter, setEstadoFilter] = useState<string>("todos");
  const [selectedTraslado, setSelectedTraslado] = useState<TrasladoSummary | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  // We fetch warehouses to provide filter options
  const { data: almacenes } = useListAlmacenes({
    query: { queryKey: getListAlmacenesQueryKey() }
  });

  const listParams: ListTrasladosParams = {
    ...(search.trim() ? { search: search.trim() } : {}),
    ...(origenFilter !== "todos" ? { almacenOrigenId: Number(origenFilter) } : {}),
    ...(destinoFilter !== "todos" ? { almacenDestinoId: Number(destinoFilter) } : {}),
    ...(estadoFilter !== "todos" ? { estadoLogistico: estadoFilter } : {}),
  };
  const { data: traslados, isLoading, isError, error } = useListTraslados(
    listParams,
    {
      query: { queryKey: getListTrasladosQueryKey(listParams) }
    }
  );

  const filteredTraslados = (traslados ?? []).filter(t => {
    // Local fallback keeps the same accent-insensitive behavior if cached data is shown.
    if (search.trim()) {
      const match = matchesSearch(search, [
        t.referencia,
        t.id,
        `#${t.id}`,
        t.almacenOrigen?.nombre,
        t.almacenDestino?.nombre
      ]);
      if (!match) return false;
    }
    
    return true;
  });

  const formatDate = (iso?: string | null) => {
    if (!iso) return "—";
    return new Date(iso).toLocaleDateString("es-VE", {
      day: "2-digit", month: "short", year: "numeric"
    });
  };

  return (
    <div className="space-y-6">
      <TrasladoDetailSheet
        traslado={selectedTraslado}
        open={detailOpen}
        onOpenChange={setDetailOpen}
      />
      
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground flex items-center gap-3">
            <ArrowRightLeft className="w-8 h-8 text-primary" />
            Traslados
          </h1>
          <p className="text-muted-foreground mt-1">
            Movimientos internos de almacén (stock.picking de tipo internal).
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-4 items-center">
        <div className="relative flex-1 min-w-[220px] max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por referencia o almacén..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-9"
            data-testid="input-search-traslados"
          />
        </div>

        <select
          className="h-9 px-3 py-1 rounded-md border border-input bg-background text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          value={origenFilter}
          onChange={(e) => setOrigenFilter(e.target.value)}
          data-testid="select-origen"
        >
          <option value="todos">Origen: Todos</option>
          {almacenes?.map(almacen => (
            <option key={almacen.id} value={almacen.id}>{almacen.nombre}</option>
          ))}
        </select>

        <select
          className="h-9 px-3 py-1 rounded-md border border-input bg-background text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          value={destinoFilter}
          onChange={(e) => setDestinoFilter(e.target.value)}
          data-testid="select-destino"
        >
          <option value="todos">Destino: Todos</option>
          {almacenes?.map(almacen => (
            <option key={almacen.id} value={almacen.id}>{almacen.nombre}</option>
          ))}
        </select>

        <select
          className="h-9 px-3 py-1 rounded-md border border-input bg-background text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          value={estadoFilter}
          onChange={(e) => setEstadoFilter(e.target.value)}
          data-testid="select-estado"
        >
          <option value="todos">Estado: Todos</option>
          <option value="por_planificar">Por planificar</option>
          <option value="planificado">Planificado</option>
          <option value="en_carga">En carga</option>
          <option value="en_transito">En tránsito</option>
          <option value="entregado">Entregado</option>
          <option value="confirmado_odoo">Confirmado Odoo</option>
          <option value="cancelado">Cancelado</option>
        </select>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Referencia</TableHead>
                <TableHead>Origen &rarr; Destino</TableHead>
                <TableHead>Fecha Programada</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="text-right">Artículos</TableHead>
                <TableHead className="text-right">Peso</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={6} className="h-24 text-center">Cargando traslados...</TableCell></TableRow>
              ) : isError ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-24 text-center text-destructive">
                    <span className="inline-flex items-center gap-2">
                      <AlertCircle className="h-4 w-4" />
                      {error instanceof Error ? error.message : "No se pudieron cargar los traslados."}
                    </span>
                  </TableCell>
                </TableRow>
              ) : filteredTraslados.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                  {search.trim() || origenFilter !== "todos" || destinoFilter !== "todos" || estadoFilter !== "todos"
                    ? "Sin resultados para los filtros actuales."
                    : "No hay traslados registrados."}
                </TableCell></TableRow>
              ) : filteredTraslados.map((traslado) => {
                const sameWarehouse = traslado.mismoAlmacen;
                
                return (
                  <TableRow
                    key={traslado.id}
                    data-testid={`row-traslado-${traslado.id}`}
                    className={`cursor-pointer transition-colors hover:bg-accent/40 ${sameWarehouse ? "opacity-60 bg-muted/20" : ""}`}
                    onClick={() => { setSelectedTraslado(traslado); setDetailOpen(true); }}
                  >
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        {traslado.referencia || `#${traslado.id}`}
                        {sameWarehouse && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Info className="w-3.5 h-3.5 text-muted-foreground" />
                            </TooltipTrigger>
                            <TooltipContent>
                              Reubicación interna en el mismo almacén (no requiere transporte).
                            </TooltipContent>
                          </Tooltip>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2 text-sm">
                        <span className="font-medium truncate max-w-[150px]" title={traslado.almacenOrigen?.nombre || "—"}>
                          {traslado.almacenOrigen?.nombre || "—"}
                        </span>
                        <ArrowRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                        <span className="font-medium truncate max-w-[150px]" title={traslado.almacenDestino?.nombre || "—"}>
                          {traslado.almacenDestino?.nombre || "—"}
                        </span>
                        
                        {traslado.cruzaPlaza && (
                          <Badge variant="outline" className="ml-2 border-purple-500/50 text-purple-600 dark:text-purple-400 bg-purple-500/10 text-[10px] px-1.5 py-0">
                            Cruza Plaza
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {formatDate(traslado.fechaProgramada)}
                    </TableCell>
                    <TableCell>
                      <TrasladoStatusBadge
                        estadoLogistico={traslado.estadoLogistico}
                        estadoOdoo={traslado.estadoOdoo}
                      />
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {traslado.cantidadLineas}
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      <span className={traslado.origenPeso !== "odoo" ? "text-xs text-muted-foreground italic" : ""}>
                        {formatTrasladoMedida(traslado.pesoEfectivoKg, "kg")}
                        {traslado.origenPeso === "estimado" ? " (estimado)" : ""}
                      </span>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}