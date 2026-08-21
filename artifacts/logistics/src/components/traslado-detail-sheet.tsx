import React from "react";
import {
  useGetTraslado,
  getGetTrasladoQueryKey
} from "@workspace/api-client-react";
import type { TrasladoSummary, TrasladoDetail, TrasladoLinea } from "@workspace/api-client-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertCircle,
  Package,
  ArrowRight
} from "lucide-react";
import { formatTrasladoMedida } from "@/lib/traslado-medidas";
import { TrasladoStatusBadge } from "@/lib/traslado-status";

function formatDate(iso?: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("es-VE", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function LineasTable({ lines }: { lines: TrasladoLinea[] }) {
  if (lines.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-10 text-center text-muted-foreground gap-2">
        <Package className="w-8 h-8 opacity-40" />
        <p className="text-sm">No hay líneas registradas para este traslado.</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-md border border-border/50">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/30">
            <TableHead className="text-xs">Producto</TableHead>
            <TableHead className="text-xs text-right">Demanda</TableHead>
            <TableHead className="text-xs text-right">Cantidad</TableHead>
            <TableHead className="text-xs text-right">Diferencia</TableHead>
            <TableHead className="text-xs text-right">Unidad</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {lines.map((line, idx) => {
            const hasDiferencia = line.diferencia !== 0;
            return (
              <TableRow 
                key={`${line.productoId || idx}-${line.codigo}`} 
                className={hasDiferencia ? "bg-amber-500/5 hover:bg-amber-500/10" : "hover:bg-muted/30"}
              >
                <TableCell className="min-w-0">
                  <div className="flex flex-col">
                    <span className="block truncate max-w-[220px] font-medium" title={line.descripcion}>
                      {line.descripcion}
                    </span>
                    {line.codigo && <span className="text-[10px] text-muted-foreground font-mono">{line.codigo}</span>}
                  </div>
                </TableCell>
                <TableCell className="text-right">{line.demanda}</TableCell>
                <TableCell className="text-right font-medium">{line.cantidad}</TableCell>
                <TableCell className={`text-right ${hasDiferencia ? "text-amber-600 dark:text-amber-400 font-semibold" : "text-muted-foreground"}`}>
                  {line.diferencia}
                </TableCell>
                <TableCell className="text-right text-muted-foreground">{line.unidad ?? "—"}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

interface TrasladoDetailSheetProps {
  traslado: TrasladoSummary | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function TrasladoDetailSheet({ traslado: trasladoProp, open, onOpenChange }: TrasladoDetailSheetProps) {
  if (!trasladoProp) return null;
  return <TrasladoDetailSheetInner trasladoSummary={trasladoProp} open={open} onOpenChange={onOpenChange} />;
}

function TrasladoDetailSheetInner({ trasladoSummary, open, onOpenChange }: { trasladoSummary: TrasladoSummary; open: boolean; onOpenChange: (open: boolean) => void; }) {
  const { data: detailData, isLoading, error } = useGetTraslado(trasladoSummary.id, {
    query: { queryKey: getGetTrasladoQueryKey(trasladoSummary.id) }
  });

  const traslado = detailData || (trasladoSummary as TrasladoDetail);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-2xl flex flex-col gap-0 p-0 overflow-hidden"
      >
        <div className="flex-shrink-0 px-6 pt-6 pb-4 border-b border-border space-y-4">
          <SheetHeader>
            <SheetTitle className="min-w-0 flex items-center gap-2">
              <span className="block truncate" title={`Traslado #${traslado.id}`}>
                Traslado {traslado.referencia || `#${traslado.id}`}
              </span>
              {traslado.mismoAlmacen && (
                <Badge variant="secondary" className="text-[10px] uppercase font-bold text-muted-foreground">
                  Interno
                </Badge>
              )}
              {traslado.cruzaPlaza && (
                <Badge variant="outline" className="border-purple-500/50 text-purple-600 dark:text-purple-400 bg-purple-500/10 text-[10px] px-1.5 py-0">
                  Cruza Plaza
                </Badge>
              )}
              <TrasladoStatusBadge
                estadoLogistico={traslado.estadoLogistico}
                estadoOdoo={traslado.estadoOdoo}
              />
            </SheetTitle>
          </SheetHeader>

          <div className="flex items-center gap-4 text-sm bg-muted/20 p-3 rounded-md border border-border/50">
            <div className="flex-1">
              <p className="text-[10px] text-muted-foreground font-semibold uppercase mb-0.5">Origen</p>
              <p className="font-medium truncate" title={traslado.almacenOrigen?.nombre || "—"}>
                {traslado.almacenOrigen?.nombre || "—"}
              </p>
            </div>
            <ArrowRight className="w-5 h-5 text-muted-foreground shrink-0" />
            <div className="flex-1">
              <p className="text-[10px] text-muted-foreground font-semibold uppercase mb-0.5">Destino</p>
              <p className="font-medium truncate" title={traslado.almacenDestino?.nombre || "—"}>
                {traslado.almacenDestino?.nombre || "—"}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs text-muted-foreground">
            <span className="font-medium text-foreground/70">Fecha programada</span>
            <span>{formatDate(traslado.fechaProgramada)}</span>

            <span className="font-medium text-foreground/70">Fecha efectiva</span>
            <span>{formatDate(traslado.fechaEfectiva)}</span>

            <span className="font-medium text-foreground/70">Peso</span>
            <span className={traslado.pesoCalculadoKg == null ? "text-muted-foreground italic" : "text-foreground"}>
              {formatTrasladoMedida(traslado.pesoCalculadoKg, "kg")}
            </span>

            <span className="font-medium text-foreground/70">Volumen</span>
            <span className={traslado.volumenCalculadoM3 == null ? "text-muted-foreground italic" : "text-foreground"}>
              {formatTrasladoMedida(traslado.volumenCalculadoM3, "m³")}
            </span>
          </div>

        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          <h3 className="text-sm font-bold text-foreground mb-4">Líneas del Traslado</h3>
          
          {isLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : error ? (
            <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive mt-2">
              <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span>{(error as any)?.response?.data?.error ?? (error as Error)?.message ?? "Error al cargar las líneas del traslado."}</span>
            </div>
          ) : (
            <LineasTable lines={detailData?.lineas || []} />
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}