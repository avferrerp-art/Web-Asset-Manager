import React, { useState } from "react";
import {
  useListSaleItems,
  getListSaleItemsQueryKey,
  useListSaleDeliveries,
  getListSaleDeliveriesQueryKey,
  useSyncOdooDeliveries,
} from "@workspace/api-client-react";
import type { Sale, Delivery, DeliveryItem, SaleItem } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  RefreshCw,
  Loader2,
  ChevronDown,
  ChevronRight,
  Info,
  Warehouse,
  AlertCircle,
  Package,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

/* ─── Helpers ─── */

function fmtDate(iso?: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("es-VE", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/* ─── Estado LogiFleet badge ─── */
const ESTADO_LOGIFLEET: Record<string, React.ReactElement> = {
  pendiente: (
    <Badge variant="outline" className="text-orange-500 border-orange-500/50" data-testid="badge-logifleet-estado">
      Pendiente
    </Badge>
  ),
  despachado: (
    <Badge variant="outline" className="text-blue-500 border-blue-500/50" data-testid="badge-logifleet-estado">
      Despachado
    </Badge>
  ),
  entregado: (
    <Badge variant="outline" className="text-green-500 border-green-500/50" data-testid="badge-logifleet-estado">
      Entregado
    </Badge>
  ),
  cancelado: (
    <Badge variant="outline" className="text-red-500 border-red-500/50" data-testid="badge-logifleet-estado">
      Cancelado
    </Badge>
  ),
};

/* ─── Estado Entrega (Odoo) badge ─── */
const ESTADO_ENTREGA_ODOO: Record<string, React.ReactElement> = {
  sin_albaran: (
    <Badge variant="outline" className="text-muted-foreground border-muted-foreground/40" data-testid="badge-odoo-estadoentrega">
      Sin albarán
    </Badge>
  ),
  pendiente: (
    <Badge variant="outline" className="text-orange-500 border-orange-500/50" data-testid="badge-odoo-estadoentrega">
      Pendiente
    </Badge>
  ),
  parcial: (
    <Badge variant="outline" className="text-amber-500 border-amber-500/50" data-testid="badge-odoo-estadoentrega">
      Parcial
    </Badge>
  ),
  entregado: (
    <Badge variant="outline" className="text-green-500 border-green-500/50" data-testid="badge-odoo-estadoentrega">
      Entregado
    </Badge>
  ),
  cancelado: (
    <Badge variant="outline" className="text-red-500 border-red-500/50" data-testid="badge-odoo-estadoentrega">
      Cancelado
    </Badge>
  ),
};

/* ─── Estado Albarán badge (en español) ─── */
const ESTADO_ALBARAN_MAP: Record<string, { label: string; className: string }> = {
  draft:     { label: "Borrador",  className: "text-muted-foreground border-muted-foreground/40 bg-muted/30" },
  waiting:   { label: "En espera", className: "text-muted-foreground border-muted-foreground/40 bg-muted/30" },
  confirmed: { label: "Confirmado",className: "text-amber-500 border-amber-500/50 bg-amber-500/10" },
  assigned:  { label: "Listo",     className: "text-blue-500 border-blue-500/50 bg-blue-500/10" },
  done:      { label: "Hecho",     className: "text-green-500 border-green-500/50 bg-green-500/10" },
  cancel:    { label: "Cancelado", className: "text-red-500 border-red-500/50 bg-red-500/10" },
};

function AlbaranEstadoBadge({ estado }: { estado: string }) {
  const cfg = ESTADO_ALBARAN_MAP[estado] ?? { label: estado, className: "text-muted-foreground border-muted-foreground/40" };
  return (
    <Badge
      variant="outline"
      className={cfg.className}
      data-testid={`badge-albaran-estado-${estado}`}
    >
      {cfg.label}
    </Badge>
  );
}

/* ─── Discrepancy note ─── */
function DiscrepancyNote({ estado, estadoEntrega }: { estado: string; estadoEntrega: string }) {
  if (estado === estadoEntrega) return null;

  const notes: Record<string, string> = {
    "pendiente:entregado":
      "La mercancía ya salió del almacén según Odoo, pero no se registró un despacho en LogiFleet.",
    "pendiente:parcial":
      "Una parte de la mercancía ya fue entregada según Odoo, pero el despacho en LogiFleet sigue pendiente.",
    "pendiente:cancelado":
      "Los albaranes de Odoo están cancelados, pero esta venta todavía figura como pendiente en LogiFleet.",
    "despachado:entregado":
      "Odoo registra la entrega como completada; puedes actualizar el estado en LogiFleet cuando lo confirmes.",
    "despachado:cancelado":
      "Los albaranes en Odoo fueron cancelados mientras el despacho en LogiFleet seguía activo.",
    "entregado:pendiente":
      "LogiFleet marca esta venta como entregada, pero en Odoo los albaranes aún están pendientes.",
  };

  const key = `${estado}:${estadoEntrega}`;
  const msg =
    notes[key] ??
    "El estado interno de LogiFleet y el estado de entrega de Odoo no coinciden — esto es habitual cuando los procesos de almacén y logística avanzan de forma independiente.";

  return (
    <div className="flex items-start gap-2 rounded-md border border-blue-500/30 bg-blue-500/10 px-3 py-2 text-xs text-blue-700 dark:text-blue-300 mt-2">
      <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
      <span>{msg}</span>
    </div>
  );
}

/* ─── Partidas tab (sale items) ─── */
function PartidaTab({ saleId }: { saleId: number }) {
  const { data: items, isLoading, error } = useListSaleItems(saleId, {
    query: { queryKey: getListSaleItemsQueryKey(saleId) },
  });

  if (isLoading) {
    return (
      <div className="space-y-2 pt-2">
        {[1, 2, 3].map((i) => <Skeleton key={i} className="h-8 w-full" />)}
      </div>
    );
  }

  if (error) {
    const anyErr = error as { response?: { data?: { error?: string } }; message?: string };
    return (
      <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive mt-2">
        <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
        <span>{anyErr?.response?.data?.error ?? anyErr?.message ?? "Error al cargar partidas"}</span>
      </div>
    );
  }

  if (!items || items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-10 text-center text-muted-foreground gap-2">
        <Package className="w-8 h-8 opacity-40" />
        <p className="text-sm">Esta orden no tiene partidas registradas.</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Descripción</TableHead>
            <TableHead className="text-right">Cant.</TableHead>
            <TableHead className="text-right">Peso unit. (kg)</TableHead>
            <TableHead className="text-right">Peso total (kg)</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item: SaleItem) => (
            <TableRow key={item.id} data-testid={`row-sale-item-${item.id}`}>
              <TableCell className="min-w-0">
                <span className="block truncate max-w-[280px]" title={item.descripcion}>
                  {item.descripcion}
                </span>
              </TableCell>
              <TableCell className="text-right">{item.cantidad}</TableCell>
              <TableCell className="text-right">{item.pesoUnitario}</TableCell>
              <TableCell className="text-right">{(item.cantidad * item.pesoUnitario).toFixed(2)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/* ─── Delivery Item Row ─── */
function DeliveryItemRow({ item }: { item: DeliveryItem }) {
  const incomplete = item.cantidadEntregada < item.cantidadDemanda;
  return (
    <TableRow data-testid={`row-delivery-item-${item.id}`} className={incomplete ? "bg-amber-500/5" : undefined}>
      <TableCell className="min-w-0">
        <span className="block truncate max-w-[220px]" title={item.descripcion}>
          {item.descripcion}
        </span>
      </TableCell>
      <TableCell className="text-right">{item.cantidadDemanda}</TableCell>
      <TableCell className={`text-right font-medium ${incomplete ? "text-amber-600 dark:text-amber-400" : ""}`}>
        {item.cantidadEntregada}
        {incomplete && <span className="ml-1 text-[10px] font-normal opacity-70">(incompleto)</span>}
      </TableCell>
      <TableCell className="text-right text-muted-foreground">{item.uom ?? "—"}</TableCell>
    </TableRow>
  );
}

/* ─── Single delivery card ─── */
function DeliveryCard({ delivery, allDeliveries }: { delivery: Delivery; allDeliveries: Delivery[] }) {
  const isCancelled = delivery.estado === "cancel";
  const [expanded, setExpanded] = useState(!isCancelled);

  // Find backorder parent name if present
  const backorderParent = delivery.backorderDeOdooId
    ? allDeliveries.find((d) => d.odooId === delivery.backorderDeOdooId)
    : null;

  return (
    <div
      data-testid={`card-albaran-${delivery.id}`}
      className={`rounded-lg border ${
        isCancelled
          ? "border-muted/50 bg-muted/20 opacity-60"
          : "border-border bg-card"
      }`}
    >
      {/* Card header */}
      <button
        className="w-full flex items-center justify-between px-4 py-3 text-left gap-2"
        onClick={() => setExpanded((p) => !p)}
        aria-expanded={expanded}
      >
        <div className="flex items-center gap-3 min-w-0">
          <span className="font-mono text-sm font-semibold truncate min-w-0" title={delivery.nombre}>
            {delivery.nombre}
          </span>
          <AlbaranEstadoBadge estado={delivery.estado} />
          {isCancelled && (
            <span className="text-[10px] text-muted-foreground italic">
              No cuenta para el estado de entrega
            </span>
          )}
        </div>
        <div className="shrink-0 text-muted-foreground">
          {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-3">
          {/* Backorder note */}
          {delivery.backorderDeOdooId && (
            <div className="flex items-start gap-2 rounded-md border border-purple-500/30 bg-purple-500/10 px-3 py-2 text-xs text-purple-700 dark:text-purple-300">
              <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span>
                Orden parcial generada desde otro albarán
                {backorderParent
                  ? `: ${backorderParent.nombre}`
                  : ` (ID Odoo: ${delivery.backorderDeOdooId})`}
              </span>
            </div>
          )}

          {/* Metadata grid */}
          <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-muted-foreground">
            {delivery.almacenOrigen && (
              <>
                <span className="font-medium text-foreground/70">Almacén de origen</span>
                <span className="truncate" title={delivery.almacenOrigen}>{delivery.almacenOrigen}</span>
              </>
            )}
            {delivery.tipoOperacion && (
              <>
                <span className="font-medium text-foreground/70">Tipo de operación</span>
                <span className="truncate" title={delivery.tipoOperacion}>{delivery.tipoOperacion}</span>
              </>
            )}
            <span className="font-medium text-foreground/70">Fecha programada</span>
            <span>{fmtDate(delivery.fechaProgramada)}</span>
            <span className="font-medium text-foreground/70">Fecha efectiva</span>
            <span>{fmtDate(delivery.fechaEfectiva)}</span>
          </div>

          {/* Lines table */}
          {delivery.items && delivery.items.length > 0 ? (
            <div className="overflow-x-auto rounded-md border border-border/50">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/30">
                    <TableHead className="text-xs">Producto</TableHead>
                    <TableHead className="text-xs text-right">Demanda</TableHead>
                    <TableHead className="text-xs text-right">Entregado</TableHead>
                    <TableHead className="text-xs text-right">Unidad</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {delivery.items.map((item) => (
                    <DeliveryItemRow key={item.id} item={item} />
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground italic">Sin líneas de detalle.</p>
          )}
        </div>
      )}
    </div>
  );
}

/* ─── Entregas tab ─── */
function EntregasTab({
  saleId,
  almacenesMultiples,
}: {
  saleId: number;
  almacenesMultiples?: boolean;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [isSyncing, setIsSyncing] = useState(false);

  const {
    data: deliveries,
    isLoading,
    error,
  } = useListSaleDeliveries(saleId, {
    query: { queryKey: getListSaleDeliveriesQueryKey(saleId) },
  });

  const syncMutation = useSyncOdooDeliveries();

  const handleSync = () => {
    setIsSyncing(true);
    toast({
      title: "Sincronizando entregas…",
      description: "Esto puede tardar unos segundos mientras se recorren todos los albaranes.",
    });
    syncMutation.mutate(undefined, {
      onSuccess: (data) => {
        // Cache-bust pattern: removeQueries + invalidateQueries together
        queryClient.removeQueries({ queryKey: getListSaleDeliveriesQueryKey(saleId) });
        queryClient.invalidateQueries({ queryKey: getListSaleDeliveriesQueryKey(saleId) });
        setIsSyncing(false);
        toast({
          title: "Entregas actualizadas",
          description: `${data.created} nuevas, ${data.updated} actualizadas, ${data.itemsUpserted} líneas procesadas.`,
        });
      },
      onError: (err: unknown) => {
        setIsSyncing(false);
        const anyErr = err as { response?: { data?: { error?: string } }; message?: string };
        toast({
          title: "Error al sincronizar entregas",
          description: anyErr?.response?.data?.error ?? anyErr?.message ?? "Error desconocido",
          variant: "destructive",
        });
      },
    });
  };

  const syncButton = (
    <Button
      data-testid="button-sync-deliveries"
      variant="outline"
      size="sm"
      className="gap-1.5 shrink-0"
      onClick={handleSync}
      disabled={isSyncing || syncMutation.isPending}
    >
      {isSyncing || syncMutation.isPending ? (
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
      ) : (
        <RefreshCw className="w-3.5 h-3.5" />
      )}
      Actualizar entregas
    </Button>
  );

  if (isLoading) {
    return (
      <div className="space-y-3 pt-2">
        {[1, 2].map((i) => (
          <Skeleton key={i} className="h-20 w-full rounded-lg" />
        ))}
      </div>
    );
  }

  if (error) {
    const anyErr = error as { response?: { data?: { error?: string } }; message?: string };
    return (
      <div className="space-y-3 pt-2">
        <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span>{anyErr?.response?.data?.error ?? anyErr?.message ?? "Error al cargar entregas"}</span>
        </div>
        {syncButton}
      </div>
    );
  }

  if (!deliveries || deliveries.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-10 text-center gap-3">
        <Warehouse className="w-8 h-8 text-muted-foreground opacity-40" />
        <div>
          <p className="text-sm font-medium">Esta orden todavía no tiene entregas registradas en Odoo.</p>
          <p className="text-xs text-muted-foreground mt-1">
            Sincroniza para importar los albaranes más recientes.
          </p>
        </div>
        {syncButton}
      </div>
    );
  }

  // Separate active from cancelled (cancelled go last, already ordered by endpoint)
  const active = deliveries.filter((d) => d.estado !== "cancel");
  const cancelled = deliveries.filter((d) => d.estado === "cancel");
  const ordered = [...active, ...cancelled];

  return (
    <div className="space-y-3 pt-1">
      {/* Multi-warehouse warning */}
      {almacenesMultiples && (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
          <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span>
            Esta orden sale de más de un almacén — puede requerir más de un despacho.
          </span>
        </div>
      )}

      <div className="flex justify-end">{syncButton}</div>

      {cancelled.length > 0 && active.length === 0 && (
        <p className="text-xs text-muted-foreground italic px-1">
          Todos los albaranes están cancelados y no cuentan para el estado de entrega.
        </p>
      )}

      <div className="space-y-2">
        {ordered.map((delivery) => (
          <DeliveryCard key={delivery.id} delivery={delivery} allDeliveries={deliveries} />
        ))}
      </div>
    </div>
  );
}

/* ─── Main export: SaleDetailSheet ─── */

interface SaleDetailSheetProps {
  sale: Sale | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SaleDetailSheet({ sale, open, onOpenChange }: SaleDetailSheetProps) {
  if (!sale) return null;

  const estadoLF = sale.estado;
  const estadoOdoo = sale.estadoEntrega ?? "sin_albaran";
  const discrepant = estadoLF !== estadoOdoo;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-2xl flex flex-col gap-0 p-0 overflow-hidden"
      >
        {/* Sticky header */}
        <div className="flex-shrink-0 px-6 pt-6 pb-4 border-b border-border space-y-3">
          <SheetHeader>
            <SheetTitle className="min-w-0">
              <span className="block truncate" title={`#${sale.id} — ${sale.cliente}`}>
                #{sale.id} — {sale.cliente}
              </span>
            </SheetTitle>
          </SheetHeader>

          {/* Meta row */}
          <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-muted-foreground">
            <span className="font-medium text-foreground/70">Destino</span>
            <span className="truncate min-w-0" title={sale.destino}>{sale.destino}</span>

            {sale.vendedor && (
              <>
                <span className="font-medium text-foreground/70">Vendedor</span>
                <span className="truncate min-w-0" title={sale.vendedor}>{sale.vendedor}</span>
              </>
            )}

            {sale.personaContacto && (
              <>
                <span className="font-medium text-foreground/70">Contacto</span>
                <span className="truncate min-w-0">
                  {sale.personaContacto}
                  {sale.numeroCel ? ` · ${sale.numeroCel}` : ""}
                </span>
              </>
            )}

            <span className="font-medium text-foreground/70">Carga</span>
            <span>
              {sale.pesoTotalOdoo != null
                ? `${sale.pesoTotalOdoo} kg`
                : `${sale.pesoTotal} kg`}{" "}
              ·{" "}
              {sale.volumenTotalOdoo != null
                ? `${sale.volumenTotalOdoo} m³`
                : `${sale.volumenTotal} m³`}
              {sale.pesoTotalOdoo != null && (
                <span className="ml-1 text-purple-400 text-[10px]">(Odoo)</span>
              )}
            </span>

            {sale.almacenOrigen && (
              <>
                <span className="font-medium text-foreground/70">Almacén origen</span>
                <span className="truncate min-w-0" title={sale.almacenOrigen}>
                  {sale.almacenOrigen}
                  {sale.almacenesMultiples && (
                    <span className="ml-1 text-amber-500 text-[10px]">(múltiples)</span>
                  )}
                </span>
              </>
            )}
          </div>

          {/* Dual badges */}
          <div className="flex flex-wrap items-start gap-4 pt-1">
            <div className="space-y-1">
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex items-center gap-1.5 cursor-help">
                    <span className="text-[11px] text-muted-foreground font-medium">Despacho LogiFleet:</span>
                    {ESTADO_LOGIFLEET[estadoLF] ?? (
                      <Badge variant="outline" data-testid="badge-logifleet-estado">{estadoLF}</Badge>
                    )}
                  </div>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-[220px] text-xs">
                  Estado interno del proceso logístico en LogiFleet. Refleja si la venta está pendiente de despacho, en ruta o entregada por el chofer.
                </TooltipContent>
              </Tooltip>
            </div>

            <div className="space-y-1">
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex items-center gap-1.5 cursor-help">
                    <span className="text-[11px] text-muted-foreground font-medium">Entrega Odoo:</span>
                    {ESTADO_ENTREGA_ODOO[estadoOdoo] ?? (
                      <Badge variant="outline" data-testid="badge-odoo-estadoentrega">{estadoOdoo}</Badge>
                    )}
                  </div>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-[220px] text-xs">
                  Estado de entrega según los albaranes (stock.picking) sincronizados desde Odoo. Indica si la mercancía ya salió del almacén.
                </TooltipContent>
              </Tooltip>
            </div>
          </div>

          {/* Discrepancy note */}
          {discrepant && (
            <DiscrepancyNote estado={estadoLF} estadoEntrega={estadoOdoo} />
          )}
        </div>

        {/* Scrollable tabs body */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          <Tabs defaultValue="partidas">
            <TabsList>
              <TabsTrigger value="partidas">Partidas</TabsTrigger>
              <TabsTrigger value="entregas">Entregas</TabsTrigger>
            </TabsList>

            <TabsContent value="partidas">
              <PartidaTab saleId={sale.id} />
            </TabsContent>

            <TabsContent value="entregas">
              <EntregasTab
                saleId={sale.id}
                almacenesMultiples={sale.almacenesMultiples}
              />
            </TabsContent>
          </Tabs>
        </div>
      </SheetContent>
    </Sheet>
  );
}
