import React, { useState } from "react";
import {
  useListSales, getListSalesQueryKey,
  useListVehicles, getListVehiclesQueryKey,
  useListSaleItems, getListSaleItemsQueryKey,
  useListProducts, getListProductsQueryKey,
  useLinkSaleItemProduct, getListUnlinkedSaleItemsQueryKey,
} from "@workspace/api-client-react";
import type { Vehicle, Sale } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  CheckCircle2, ChevronRight, ChevronLeft, Package, ClipboardList, Truck,
  Check, Unlink, Search, Loader2, AlertTriangle,
} from "lucide-react";

interface Props {
  open: boolean;
  onClose: () => void;
  initialSaleId?: number;
  initialSale?: Sale;
  onVehicleAssigned?: (saleId: number, vehicleId: number) => void;
}

const STEPS = [
  { label: "Orden", icon: ClipboardList },
  { label: "Partidas", icon: Package },
  { label: "Flota", icon: Truck },
];

function utilColor(pct: number) {
  if (pct > 100) return "bg-red-500";
  if (pct >= 85) return "bg-yellow-500";
  return "bg-green-500";
}

function utilLabel(pct: number) {
  if (pct > 100) return "text-red-600 dark:text-red-400";
  if (pct >= 85) return "text-yellow-600 dark:text-yellow-400";
  return "text-green-600 dark:text-green-400";
}

import { formatCarga, sinDatoCarga } from "@/lib/carga";
import { classifyFleet } from "@/lib/fleet";

export function CargoWizard({ open, onClose, initialSaleId, initialSale, onVehicleAssigned }: Props) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [step, setStep] = useState(initialSaleId ? 2 : 1);
  const [selectedSaleId, setSelectedSaleId] = useState<number | null>(initialSaleId ?? null);

  const { data: salesData, isLoading: isLoadingSales } = useListSales(
    { status: "pendiente" },
    { query: { queryKey: getListSalesQueryKey({ status: "pendiente" }), enabled: !initialSaleId } }
  );

  const selectedSale: Sale | null = initialSale ?? salesData?.find(s => s.id === selectedSaleId) ?? null;

  const { data: vehicles } = useListVehicles({
    query: { queryKey: getListVehiclesQueryKey() },
  });

  const { data: saleItems, isLoading: isLoadingItems } = useListSaleItems(
    selectedSaleId ?? 0,
    {
      query: {
        queryKey: getListSaleItemsQueryKey(selectedSaleId ?? 0),
        enabled: !!selectedSaleId,
      },
    }
  );

  const linkItem = useLinkSaleItemProduct();

  // ── Manual product linking for unlinked items ──────────────────────────
  const [linkingItemId, setLinkingItemId] = useState<number | null>(null);
  const [linkSearch, setLinkSearch] = useState("");
  const trimmedLinkSearch = linkSearch.trim();
  const { data: linkResults, isLoading: isSearchingLink } = useListProducts(
    { search: trimmedLinkSearch },
    {
      query: {
        queryKey: getListProductsQueryKey({ search: trimmedLinkSearch }),
        enabled: linkingItemId !== null && trimmedLinkSearch.length > 0,
      },
    }
  );

  function invalidateItems() {
    if (selectedSaleId) {
      queryClient.removeQueries({ queryKey: getListSaleItemsQueryKey(selectedSaleId) });
      queryClient.invalidateQueries({ queryKey: getListSaleItemsQueryKey(selectedSaleId) });
    }
    queryClient.removeQueries({ queryKey: getListSalesQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListSalesQueryKey() });
  }

  function handleLinkProduct(itemId: number, productId: number) {
    linkItem.mutate({ itemId, data: { productId } }, {
      onSuccess: () => {
        setLinkingItemId(null);
        setLinkSearch("");
        invalidateItems();
        queryClient.removeQueries({ queryKey: getListUnlinkedSaleItemsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListUnlinkedSaleItemsQueryKey() });
        toast({ title: "Artículo vinculado", description: "La partida quedó asociada al catálogo." });
      },
      onError: () => toast({ title: "No se pudo vincular la partida", variant: "destructive" }),
    });
  }

  const pendingSales = salesData?.filter(s => s.estado === "pendiente") ?? [];

  // Totales de la venta: SIEMPRE los de Odoo (null = sin dato, nunca 0)
  const totalPeso = sinDatoCarga(selectedSale?.pesoTotal) ? null : selectedSale!.pesoTotal!;
  const totalVol = sinDatoCarga(selectedSale?.volumenTotal) ? null : selectedSale!.volumenTotal!;
  const sinPeso = totalPeso == null;
  const sinVolumen = totalVol == null;

  function handleClose() {
    onClose();
    setTimeout(() => {
      setStep(initialSaleId ? 2 : 1);
      setSelectedSaleId(initialSaleId ?? null);
      setLinkingItemId(null);
      setLinkSearch("");
    }, 300);
  }

  // fleet.ts es la única fuente de verdad: los compatibles van primero,
  // ordenados del ajuste más apretado al más holgado (el primero es el
  // SUGERIDO). Dimensión sin dato → 0 (no restringe), pero la recomendación
  // se marca incompleta con el aviso de arriba.
  const fleetClass = classifyFleet(vehicles ?? [], totalPeso ?? 0, totalVol ?? 0);
  const rankedVehicles: Array<{
    vehicle: Vehicle;
    weightPct: number;
    volPct: number;
    maxPct: number;
    canFit: boolean;
  }> = [...fleetClass.fit, ...fleetClass.unfit].map(c => ({
    vehicle: c.vehicle as Vehicle,
    weightPct: c.weightPct,
    volPct: c.volPct,
    maxPct: c.maxPct,
    canFit: c.isFit,
  }));

  const sinDatos = sinPeso && sinVolumen;

  return (
    <Dialog open={open} onOpenChange={o => !o && handleClose()}>
      <DialogContent className="sm:max-w-[740px] grid-cols-[minmax(0,1fr)] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-lg">Planificar Carga</DialogTitle>
        </DialogHeader>

        {/* Step indicator */}
        <div className="flex items-center gap-0 mb-4">
          {STEPS.map((s, i) => {
            const idx = i + 1;
            const done = step > idx;
            const active = step === idx;
            const Icon = s.icon;
            return (
              <React.Fragment key={idx}>
                <div className="flex flex-col items-center gap-1 flex-1">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold border-2 transition-colors ${
                    done ? "bg-primary border-primary text-primary-foreground"
                    : active ? "bg-primary/20 border-primary text-primary"
                    : "bg-muted border-border text-muted-foreground"
                  }`}>
                    {done ? <CheckCircle2 className="w-4 h-4" /> : <Icon className="w-4 h-4" />}
                  </div>
                  <span className={`text-[11px] font-medium ${
                    active ? "text-primary" : done ? "text-primary/70" : "text-muted-foreground"
                  }`}>{s.label}</span>
                </div>
                {i < STEPS.length - 1 && (
                  <div className={`h-[2px] flex-1 mb-5 transition-colors ${step > idx ? "bg-primary" : "bg-border"}`} />
                )}
              </React.Fragment>
            );
          })}
        </div>

        {/* ── STEP 1: Select sale ─────────────────────────────────────────── */}
        {step === 1 && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Selecciona la orden de venta pendiente a planificar.
            </p>
            {isLoadingSales ? (
              <div className="space-y-2">
                {[1, 2, 3].map(i => <div key={i} className="h-14 bg-muted animate-pulse rounded-md" />)}
              </div>
            ) : pendingSales.length === 0 ? (
              <div className="py-12 text-center text-muted-foreground border border-dashed border-border rounded-lg">
                No hay órdenes de venta pendientes.
              </div>
            ) : (
              <div className="space-y-2 max-h-[340px] overflow-y-auto pr-1">
                {pendingSales.map(sale => (
                  <button
                    key={sale.id}
                    onClick={() => setSelectedSaleId(sale.id)}
                    className={`w-full text-left p-3 rounded-lg border transition-colors ${
                      selectedSaleId === sale.id
                        ? "border-primary bg-primary/10"
                        : "border-border bg-card hover:bg-accent/30"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3 min-w-0">
                      <div className="flex items-start gap-3 min-w-0 flex-1">
                        <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 mt-0.5 ${
                          selectedSaleId === sale.id ? "border-primary bg-primary" : "border-border"
                        }`}>
                          {selectedSaleId === sale.id && <div className="w-2 h-2 rounded-full bg-white" />}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="font-semibold text-sm truncate">#{sale.id} — {sale.cliente}</div>
                          <div className="text-xs text-muted-foreground truncate" title={sale.destino}>
                            {sale.destino}
                          </div>
                          <div className="text-xs text-muted-foreground whitespace-nowrap">
                            {formatCarga(sale.pesoTotal, "kg")} · {formatCarga(sale.volumenTotal, "m³")}
                          </div>
                        </div>
                      </div>
                      <Badge variant="outline" className="text-[10px] shrink-0 max-w-[120px] truncate block">{sale.tipoMaterial ?? "—"}</Badge>
                    </div>
                  </button>
                ))}
              </div>
            )}
            <div className="flex justify-end pt-2">
              <Button disabled={!selectedSaleId} onClick={() => setStep(2)} className="gap-1">
                Siguiente <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          </div>
        )}

        {/* ── STEP 2: Partidas (solo lectura + vincular al catálogo) ──────── */}
        {step === 2 && (
          <div className="space-y-4">
            {selectedSale && (
              <div className="bg-muted/60 rounded-md px-3 py-2 text-sm flex flex-wrap gap-x-4 gap-y-1">
                <span><span className="font-semibold">Cliente:</span> {selectedSale.cliente}</span>
                <span><span className="font-semibold">Destino:</span> {selectedSale.destino}</span>
                <span><span className="font-semibold">Peso (Odoo):</span> {formatCarga(selectedSale.pesoTotal, "kg")}</span>
                <span><span className="font-semibold">Volumen (Odoo):</span> {formatCarga(selectedSale.volumenTotal, "m³")}</span>
              </div>
            )}

            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">Partidas de la orden</h3>
              <span className="text-xs text-muted-foreground">
                El peso y volumen provienen de Odoo; aquí solo puedes vincular partidas al catálogo.
              </span>
            </div>

            <div className="rounded-md border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="text-xs">
                    <TableHead>Descripción</TableHead>
                    <TableHead className="text-right">Cantidad</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoadingItems ? (
                    <TableRow><TableCell colSpan={2} className="h-12 text-center text-sm text-muted-foreground">Cargando...</TableCell></TableRow>
                  ) : (saleItems ?? []).length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={2} className="h-16 text-center text-sm text-muted-foreground">
                        Esta orden no tiene partidas registradas.
                      </TableCell>
                    </TableRow>
                  ) : (
                    (saleItems ?? []).map(item => (
                      <React.Fragment key={item.id}>
                        <TableRow className="text-xs">
                          <TableCell className="font-medium">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span>{item.descripcion}</span>
                              {item.productId == null && (
                                <Badge
                                  variant="outline"
                                  className="text-purple-500 border-purple-500/50 bg-purple-500/10 text-[10px] gap-1 cursor-pointer"
                                  data-testid={`badge-item-sin-vincular-${item.id}`}
                                  onClick={() => {
                                    setLinkingItemId(linkingItemId === item.id ? null : item.id);
                                    setLinkSearch("");
                                  }}
                                >
                                  <Unlink className="w-3 h-3" /> Sin vincular
                                </Badge>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-right">{item.cantidad}</TableCell>
                        </TableRow>
                        {item.productId == null && linkingItemId === item.id && (
                          <TableRow className="bg-purple-500/5">
                            <TableCell colSpan={2} className="py-2">
                              <div className="space-y-2">
                                <div className="relative">
                                  <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                                  <Input
                                    autoFocus
                                    data-testid={`input-link-search-${item.id}`}
                                    className="h-8 text-xs pl-8"
                                    placeholder="Buscar artículo por nombre o referencia..."
                                    value={linkSearch}
                                    onChange={e => setLinkSearch(e.target.value)}
                                  />
                                </div>
                                {trimmedLinkSearch.length > 0 && (
                                  <div className="max-h-44 overflow-y-auto rounded border divide-y">
                                    {isSearchingLink ? (
                                      <div className="p-2 text-xs text-muted-foreground flex items-center gap-2">
                                        <Loader2 className="w-3 h-3 animate-spin" /> Buscando...
                                      </div>
                                    ) : (linkResults ?? []).length === 0 ? (
                                      <div className="p-2 text-xs text-muted-foreground">Sin resultados.</div>
                                    ) : (linkResults ?? []).slice(0, 20).map(p => (
                                      <div key={p.id} className="flex items-center justify-between gap-2 p-2 text-xs">
                                        <div className="min-w-0">
                                          <div className="font-medium truncate">{p.nombre}</div>
                                          <div className="text-muted-foreground">
                                            {p.odooRef ?? "sin ref."}
                                            {p.pesoOdoo > 0 ? ` · ${p.pesoOdoo} kg (Odoo)` : " · sin peso en Odoo"}
                                          </div>
                                        </div>
                                        <Button
                                          size="sm"
                                          className="h-7 text-xs shrink-0"
                                          data-testid={`button-link-${item.id}-${p.id}`}
                                          disabled={linkItem.isPending}
                                          onClick={() => handleLinkProduct(item.id, p.id)}
                                        >
                                          Asignar
                                        </Button>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </React.Fragment>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>

            {/* Totales de Odoo */}
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-muted/50 rounded-md px-4 py-2.5 border border-border/50">
                <div className="text-xs text-muted-foreground">Peso total (Odoo)</div>
                <div className="text-lg font-bold" data-testid="text-wizard-peso">
                  {totalPeso != null
                    ? <>{totalPeso} <span className="text-sm font-normal text-muted-foreground">kg</span></>
                    : <span className="text-sm font-medium text-yellow-600 dark:text-yellow-400">sin dato en Odoo</span>}
                </div>
              </div>
              <div className="bg-muted/50 rounded-md px-4 py-2.5 border border-border/50">
                <div className="text-xs text-muted-foreground">Volumen total (Odoo)</div>
                <div className="text-lg font-bold" data-testid="text-wizard-volumen">
                  {totalVol != null
                    ? <>{totalVol} <span className="text-sm font-normal text-muted-foreground">m³</span></>
                    : <span className="text-sm font-medium text-yellow-600 dark:text-yellow-400">sin dato en Odoo</span>}
                </div>
              </div>
            </div>

            <div className="flex justify-between pt-2">
              {!initialSaleId && (
                <Button variant="outline" onClick={() => setStep(1)} className="gap-1">
                  <ChevronLeft className="w-4 h-4" /> Atrás
                </Button>
              )}
              <div className="flex-1" />
              <Button
                disabled={sinDatos}
                onClick={() => setStep(3)}
                className="gap-1"
                data-testid="button-wizard-flota"
              >
                Ver Compatibilidad <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
            {sinDatos && (
              <div className="flex items-start gap-2 text-xs bg-red-500/10 border border-red-500/40 rounded-md px-3 py-2" data-testid="warning-wizard-sin-datos">
                <AlertTriangle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                Esta venta no tiene peso ni volumen en Odoo: no se puede recomendar un vehículo.
                Corrige los datos del artículo en Odoo, o usa el Calculador de Carga para simular con valores manuales.
              </div>
            )}
          </div>
        )}

        {/* ── STEP 3: Fleet compatibility ─────────────────────────────────── */}
        {step === 3 && (
          <div className="space-y-4">
            {(sinPeso || sinVolumen) && !sinDatos && (
              <div className="flex items-start gap-2 text-xs bg-yellow-500/10 border border-yellow-500/40 rounded-md px-3 py-2" data-testid="warning-wizard-incompleta">
                <AlertTriangle className="w-4 h-4 text-yellow-500 shrink-0 mt-0.5" />
                <span>
                  <strong>Recomendación incompleta:</strong> la venta no tiene {sinVolumen ? "volumen" : "peso"} en Odoo,
                  así que la compatibilidad considera solo {sinVolumen ? "el peso" : "el volumen"}. Verifica que la carga
                  quepa físicamente antes de despachar.
                </span>
              </div>
            )}
            {(vehicles ?? []).length === 0 ? (
              <div className="py-12 text-center text-muted-foreground border border-dashed border-border rounded-lg">
                No hay vehículos registrados en la flota.
              </div>
            ) : (
              <div className="space-y-3 max-h-[380px] overflow-y-auto pr-1">
                {rankedVehicles.map(({ vehicle, weightPct, volPct, canFit }, idx) => {
                  const wPct = Number.isFinite(weightPct) ? weightPct : 100;
                  const vPct = Number.isFinite(volPct) ? volPct : 100;
                  return (
                    <div
                      key={vehicle.id}
                      className={`rounded-lg border p-4 space-y-3 ${
                        canFit && idx === 0 ? "border-primary bg-primary/5" : "border-border bg-card"
                      } ${!canFit ? "opacity-60" : ""}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="font-semibold text-sm truncate">{vehicle.modelo}</span>
                          <span className="text-xs text-muted-foreground shrink-0">{vehicle.placa}</span>
                          {canFit && idx === 0 && (
                            <Badge className="text-[10px] shrink-0" data-testid="cargo-badge-sugerido">
                              ⭐ SUGERIDO · {rankedVehicles[0].maxPct.toFixed(0)}% uso
                            </Badge>
                          )}
                        </div>
                        {canFit && onVehicleAssigned && selectedSaleId && (
                          <Button
                            size="sm"
                            className="h-7 text-xs gap-1 shrink-0"
                            onClick={() => {
                              onVehicleAssigned(selectedSaleId, vehicle.id);
                              handleClose();
                            }}
                          >
                            <Check className="w-3 h-3" /> Asignar este vehículo
                          </Button>
                        )}
                      </div>

                      {/* Weight bar */}
                      <div className="space-y-1">
                        <div className="flex justify-between text-xs">
                          <span className="text-muted-foreground">
                            Peso: {sinPeso ? "sin dato en Odoo — no considerado" : `${totalPeso!.toFixed(1)} / ${vehicle.capacidadPeso} kg`}
                          </span>
                          {!sinPeso && <span className={`font-semibold ${utilLabel(weightPct)}`}>{weightPct.toFixed(0)}%</span>}
                        </div>
                        <div className="h-2 bg-muted rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${sinPeso ? "bg-muted-foreground/30" : utilColor(weightPct)}`}
                            style={{ width: `${sinPeso ? 0 : Math.min(wPct, 100)}%` }}
                          />
                        </div>
                      </div>

                      {/* Volume bar */}
                      <div className="space-y-1">
                        <div className="flex justify-between text-xs">
                          <span className="text-muted-foreground">
                            Volumen: {sinVolumen ? "sin dato en Odoo — no considerado" : `${totalVol!.toFixed(4)} / ${vehicle.capacidadVolumen} m³`}
                          </span>
                          {!sinVolumen && <span className={`font-semibold ${utilLabel(volPct)}`}>{volPct.toFixed(0)}%</span>}
                        </div>
                        <div className="h-2 bg-muted rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${sinVolumen ? "bg-muted-foreground/30" : utilColor(volPct)}`}
                            style={{ width: `${sinVolumen ? 0 : Math.min(vPct, 100)}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="flex justify-between pt-2">
              <Button variant="outline" onClick={() => setStep(2)} className="gap-1">
                <ChevronLeft className="w-4 h-4" /> Ver Partidas
              </Button>
              <Button variant="ghost" onClick={handleClose}>
                Cerrar
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
