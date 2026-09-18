import React, { useEffect, useRef, useState } from "react";
import {
  useListSales,
  useListVehicles, getListVehiclesQueryKey,
  useListProducts, getListProductsQueryKey,
} from "@workspace/api-client-react";
import type { Product, Sale, Vehicle } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { matchesSearch } from "@/lib/search";
import { classifyFleet } from "@/lib/fleet";
import { formatCarga, sinDatoCarga } from "@/lib/carga";
import { roundPartialQuotaSum } from "@/lib/medidas";
import {
  densidadImplausible,
  planFlotaSimultanea,
  planViajesSucesivos,
  type PlanDeReparto,
} from "@/lib/fleet-split";
import {
  CheckCircle2, ChevronRight, PackageOpen, Truck,
  ArrowLeft, AlertTriangle, Info, Search, Loader2, Plus, Trash2,
} from "lucide-react";

function isQuotation(sale: Sale) {
  return sale.odooEstado === "draft" || sale.odooEstado === "sent";
}

function isConfirmedOrder(sale: Sale) {
  return sale.odooEstado == null || sale.odooEstado === "sale" || sale.odooEstado === "done";
}

function CommercialBadge({ sale }: { sale: Sale }) {
  return (
    <Badge variant={isQuotation(sale) ? "secondary" : "outline"} className="text-xs whitespace-nowrap">
      {isQuotation(sale) ? "Cotización" : "Pedido confirmado"}
    </Badge>
  );
}

function utilizationColor(pct: number) {
  if (pct > 100) return "text-red-500";
  if (pct > 85) return "text-yellow-400";
  return "text-green-500";
}
function utilizationBg(pct: number) {
  if (pct > 100) return "bg-red-500";
  if (pct > 85) return "bg-yellow-400";
  return "bg-green-500";
}

function FleetCompatibility({
  vehicles,
  peso,
  volumen,
  noFitExtra,
}: {
  vehicles: Vehicle[];
  peso: number;
  volumen: number | null;
  noFitExtra?: React.ReactNode;
}) {
  const sinPeso = peso == null;
  const sinVolumen = volumen == null;
  const { fit: fitVehicles, unfit: unfitVehicles } = classifyFleet(vehicles, peso, volumen ?? 0);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Truck className="w-4 h-4 text-primary" /> Compatibilidad de Flota
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {fitVehicles.length === 0 && (
          <div className="flex items-start gap-2 text-sm bg-red-500/10 border border-red-500/40 rounded-md px-4 py-3" data-testid="warning-ningun-vehiculo">
            <AlertTriangle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
            Ningún vehículo soporta esta carga. Considera dividir el envío.
          </div>
        )}
        {fitVehicles.map(({ vehicle, weightPct, volPct }, idx) => (
          <div
            key={vehicle.id}
            className={`rounded-lg border p-4 space-y-2 ${idx === 0 ? "border-primary bg-primary/5" : "border-border"}`}
            data-testid={`card-vehicle-fit-${vehicle.id}`}
          >
            <div className="flex items-center justify-between">
              <div className="font-semibold flex items-center gap-2">
                {vehicle.modelo}
                {idx === 0 && (
                  <Badge className="gap-1" data-testid="badge-sugerido">
                    <CheckCircle2 className="w-3 h-3" /> SUGERIDO
                  </Badge>
                )}
              </div>
              <span className="text-xs text-muted-foreground">{vehicle.placa}</span>
            </div>
            <div className="space-y-1">
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">
                  Peso: {sinPeso ? "sin dato" : `${peso.toFixed(1)} / ${vehicle.capacidadPeso} kg`}
                </span>
                {!sinPeso && <span className={`font-semibold ${utilizationColor(weightPct)}`}>{weightPct.toFixed(0)}%</span>}
              </div>
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div className={`h-full rounded-full ${utilizationBg(weightPct)}`} style={{ width: `${Math.min(weightPct, 100)}%` }} />
              </div>
            </div>
            <div className="space-y-1">
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">
                  Volumen: {sinVolumen ? "sin dato en Odoo — no considerado" : `${volumen.toFixed(3)} / ${vehicle.capacidadVolumen} m³`}
                </span>
                {!sinVolumen && <span className={`font-semibold ${utilizationColor(volPct)}`}>{volPct.toFixed(0)}%</span>}
              </div>
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div className={`h-full rounded-full ${sinVolumen ? "bg-muted-foreground/30" : utilizationBg(volPct)}`} style={{ width: `${sinVolumen ? 0 : Math.min(volPct, 100)}%` }} />
              </div>
            </div>
          </div>
        ))}
        {unfitVehicles.length > 0 && (
          <p className="text-xs text-muted-foreground">
            {unfitVehicles.length} vehículo{unfitVehicles.length === 1 ? "" : "s"} sin capacidad suficiente (o sin capacidades registradas).
          </p>
        )}
        {fitVehicles.length === 0 && noFitExtra}
      </CardContent>
    </Card>
  );
}

type ArticleRow = {
  rowId: number;
  product: Product;
  quantity: string;
};

function parseQuantity(value: string): number | null {
  if (!/^[1-9]\d*$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function SplitPlan({ plan }: { plan: PlanDeReparto<Vehicle> }) {
  const simultaneous = plan.estrategia === "flota-simultanea";
  return (
    <div className="rounded-lg border border-border p-3 space-y-2">
      <div className="font-medium text-sm">
        {simultaneous ? "Flota simultánea" : "Viajes sucesivos"}
      </div>
      {!plan.viable ? (
        <p className="text-xs text-muted-foreground">{plan.motivoNoViable}</p>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            {simultaneous
              ? `${plan.tramos.length} camión${plan.tramos.length === 1 ? "" : "es"} distinto${plan.tramos.length === 1 ? "" : "s"}, una salida por vehículo.`
              : `${plan.tramos.length} viaje${plan.tramos.length === 1 ? "" : "s"} sucesivo${plan.tramos.length === 1 ? "" : "s"} con el mismo camión.`}
          </p>
          <div className="space-y-1">
            {plan.tramos.map((tramo) => (
              <div key={tramo.orden} className="text-xs flex flex-wrap justify-between gap-2 rounded bg-muted/40 px-2 py-1.5">
                <span>
                  {simultaneous ? `Camión ${tramo.orden}` : `Viaje ${tramo.orden}`}:{" "}
                  <strong>{tramo.vehiculo.modelo}</strong> ({tramo.vehiculo.placa})
                </span>
                <span className="text-muted-foreground">
                  Peso: {tramo.pesoKg == null ? "sin dato" : formatCarga(tramo.pesoKg, "kg")} · Volumen: {tramo.volumenM3 == null ? "sin dato" : formatCarga(tramo.volumenM3, "m³")}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export default function Carga() {
  const [mode, setMode] = useState<"order" | "articles">("order");
  const [selectedSaleId, setSelectedSaleId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("todos");
  const [statusFilter, setStatusFilter] = useState("todos");
  // Valores efectivos para el cálculo: se inicializan con los totales de Odoo
  // de la venta y el operador puede sobrescribirlos para simular.
  const [pesoManual, setPesoManual] = useState<string>("");
  const [volumenManual, setVolumenManual] = useState<string>("");
  const [productSearch, setProductSearch] = useState("");
  const [debouncedProductSearch, setDebouncedProductSearch] = useState("");
  const [articleRows, setArticleRows] = useState<ArticleRow[]>([]);
  const nextRowId = useRef(1);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDebouncedProductSearch(productSearch.trim());
    }, 350);
    return () => window.clearTimeout(timeout);
  }, [productSearch]);

  const { data: sales, isLoading: isLoadingSales } = useListSales({ includeQuotations: true });
  const { data: vehicles } = useListVehicles({
    query: { queryKey: getListVehiclesQueryKey() }
  });
  const productParams = { search: debouncedProductSearch };
  const productQuery = useListProducts(productParams, {
    query: {
      queryKey: getListProductsQueryKey(productParams),
      enabled: mode === "articles" && debouncedProductSearch.length > 0,
    },
  });

  const selectedSale = sales?.find(s => s.id === selectedSaleId) ?? null;

  const statuses = Array.from(new Set((sales ?? []).map(s => s.estado))).sort();
  const filteredSales = (sales ?? []).filter(s =>
    (typeFilter === "todos" || (typeFilter === "cotizaciones" ? isQuotation(s) : isConfirmedOrder(s))) &&
    (statusFilter === "todos" || s.estado === statusFilter) &&
    matchesSearch(search.trim(), [s.id, s.cliente, s.destino, s.odooRef])
  );

  function handleSelectSale(sale: Sale) {
    setSelectedSaleId(sale.id);
    setPesoManual(!sinDatoCarga(sale.pesoTotal) ? String(sale.pesoTotal) : "");
    setVolumenManual(!sinDatoCarga(sale.volumenTotal) ? String(sale.volumenTotal) : "");
  }

  function handleReset() {
    setSelectedSaleId(null);
    setPesoManual("");
    setVolumenManual("");
  }

  const peso = pesoManual.trim() === "" ? null : Math.max(0, +pesoManual) || null;
  const volumen = volumenManual.trim() === "" ? null : Math.max(0, +volumenManual) || null;

  const sinPeso = peso == null;
  const sinVolumen = volumen == null;
  // Recomendación incompleta: falta volumen (se recomienda solo por peso).
  const recomendacionIncompleta = !sinPeso && sinVolumen;

  // Sin peso NO se recomienda vehículo: pasar 0 a la clasificación sugeriría
  // silenciosamente el camión más chico. Si solo falta volumen, se clasifica
  // por peso (volumen 0 no restringe) con el aviso de recomendación incompleta.
  const puedeCalcular = !sinPeso;

  const computedRows = articleRows.map((row) => {
    const quantity = parseQuantity(row.quantity);
    const pesoSubtotal = quantity != null && row.product.pesoOdoo != null
      ? row.product.pesoOdoo * quantity
      : null;
    const volumenSubtotal = quantity != null && row.product.volumenOdoo != null
      ? row.product.volumenOdoo * quantity
      : null;
    const overflow = (pesoSubtotal != null && (
      !Number.isFinite(pesoSubtotal) || !Number.isFinite(roundPartialQuotaSum(pesoSubtotal))
    )) || (volumenSubtotal != null && (
      !Number.isFinite(volumenSubtotal) || !Number.isFinite(roundPartialQuotaSum(volumenSubtotal))
    ));
    return { ...row, quantityValue: quantity, pesoSubtotal, volumenSubtotal, overflow };
  });
  const hasInvalidQuantity = computedRows.some(row => row.quantityValue == null);
  const missingWeightRows = articleRows.filter(row => row.product.pesoOdoo == null).length;
  const missingVolumeRows = articleRows.filter(row => row.product.volumenOdoo == null).length;
  const knownWeightRows = computedRows.filter(row => row.quantityValue != null && row.product.pesoOdoo != null);
  const knownVolumeRows = computedRows.filter(row => row.quantityValue != null && row.product.volumenOdoo != null);
  const rawWeightSum = knownWeightRows.reduce((sum, row) => sum + (row.pesoSubtotal ?? 0), 0);
  const rawVolumeSum = knownVolumeRows.reduce((sum, row) => sum + (row.volumenSubtotal ?? 0), 0);
  const summedWeight = roundPartialQuotaSum(rawWeightSum);
  const summedVolume = roundPartialQuotaSum(rawVolumeSum);
  const hasArithmeticOverflow = computedRows.some(row => row.overflow)
    || !Number.isFinite(rawWeightSum)
    || !Number.isFinite(rawVolumeSum)
    || !Number.isFinite(summedWeight)
    || !Number.isFinite(summedVolume);
  const hasPrecisionLoss = (knownWeightRows.length > 0 && rawWeightSum > 0 && summedWeight === 0)
    || (knownVolumeRows.length > 0 && rawVolumeSum > 0 && summedVolume === 0);
  const articlesPeso = knownWeightRows.length === 0 || hasArithmeticOverflow ? null : summedWeight;
  const articlesVolumen = knownVolumeRows.length === 0 || hasArithmeticOverflow ? null : summedVolume;
  const articlesCalculationValid = articleRows.length > 0
    && !hasInvalidQuantity
    && !hasArithmeticOverflow
    && !hasPrecisionLoss;
  const articlesCanRecommend = articlesCalculationValid && articlesPeso != null;
  const articleFleet = articlesCanRecommend
    ? classifyFleet(vehicles ?? [], articlesPeso, articlesVolumen ?? 0)
    : { fit: [], unfit: [] };
  const simultaneousPlan = articlesCanRecommend && articleFleet.fit.length === 0
    ? planFlotaSimultanea(vehicles ?? [], articlesPeso, articlesVolumen)
    : null;
  const successivePlan = articlesCanRecommend && articleFleet.fit.length === 0
    ? planViajesSucesivos(vehicles ?? [], articlesPeso, articlesVolumen)
    : null;
  const densityWarning = articlesCalculationValid
    ? densidadImplausible(articlesPeso, articlesVolumen)
    : null;
  const showingCurrentSearch = productSearch.trim() === debouncedProductSearch;

  function addProduct(product: Product) {
    const rowId = nextRowId.current;
    nextRowId.current += 1;
    setArticleRows(rows => [...rows, {
      rowId,
      product,
      quantity: "1",
    }]);
  }

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Calculador de Carga</h1>
          <p className="text-muted-foreground">
            {mode === "order"
              ? "Recomienda el vehículo según el peso y volumen de Odoo de la venta (o valores manuales para simular)."
              : "Estima vehículos para una lista de artículos, sin crear órdenes ni despachos."}
          </p>
        </div>
        {mode === "order" && selectedSale && (
          <Button variant="ghost" onClick={handleReset} className="gap-2" data-testid="button-nueva-consulta">
            <ArrowLeft className="w-4 h-4" /> Nueva consulta
          </Button>
        )}
      </div>

      <div className="inline-flex rounded-md border border-border p-1 bg-muted/30" data-testid="mode-selector-carga">
        <Button
          size="sm"
          variant={mode === "order" ? "default" : "ghost"}
          onClick={() => setMode("order")}
          data-testid="button-mode-order"
        >
          Desde una orden
        </Button>
        <Button
          size="sm"
          variant={mode === "articles" ? "default" : "ghost"}
          onClick={() => setMode("articles")}
          data-testid="button-mode-articles"
        >
          Armar de cero
        </Button>
      </div>

      {/* ── Select sale ── */}
      {mode === "order" && !selectedSale && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <PackageOpen className="w-4 h-4 text-primary" />
              Selecciona una Orden de Venta
            </CardTitle>
            <div className="flex flex-wrap items-end gap-3 pt-2">
            <div className="relative flex-1 min-w-[240px]">
              <Search className="absolute left-2.5 top-1/2 translate-y-0 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Buscar cliente, destino, #orden o ref. Odoo..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="pl-8 h-9"
                data-testid="input-search-sales-carga"
              />
            </div>
            <div className="space-y-1">
              <label id="label-tipo-carga" className="text-xs text-muted-foreground">Tipo</label>
              <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger aria-labelledby="label-tipo-carga" className="w-[200px] h-9" data-testid="select-tipo-carga">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos</SelectItem>
                  <SelectItem value="cotizaciones">Cotizaciones</SelectItem>
                  <SelectItem value="pedidos">Pedidos confirmados</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label id="label-estado-carga" className="text-xs text-muted-foreground">Estado</label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger aria-labelledby="label-estado-carga" className="w-[180px] h-9" data-testid="select-estado-carga">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos</SelectItem>
                  {statuses.map(status => <SelectItem key={status} value={status}>{status}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {isLoadingSales ? (
              <p className="text-center text-muted-foreground py-10">Cargando órdenes...</p>
            ) : (
              <div className="max-h-[420px] overflow-y-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-muted-foreground text-left">
                      <th className="px-4 py-2 font-medium">ID</th>
                      <th className="px-4 py-2 font-medium">Cliente</th>
                      <th className="px-4 py-2 font-medium">Destino</th>
                      <th className="px-4 py-2 font-medium">Peso (Odoo)</th>
                      <th className="px-4 py-2 font-medium">Volumen (Odoo)</th>
                      <th className="px-4 py-2 font-medium">Estado</th>
                      <th className="px-4 py-2 w-[100px]"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredSales.length === 0 && (
                      <tr><td colSpan={7} className="text-center py-10 text-muted-foreground">
                        {sales?.length ? "No hay órdenes que coincidan con la búsqueda y los filtros." : "Sin órdenes registradas."}
                      </td></tr>
                    )}
                    {filteredSales.map(sale => (
                      <tr key={sale.id} className="border-b border-border/50 hover:bg-muted/20 transition-colors" data-testid={`row-sale-carga-${sale.id}`}>
                        <td className="px-4 py-3 font-medium">
                          <div className="flex flex-col items-start gap-1">
                            <span>#{sale.id}</span>
                            <CommercialBadge sale={sale} />
                          </div>
                        </td>
                        <td className="px-4 py-3">{sale.cliente}</td>
                        <td className="px-4 py-3 text-muted-foreground">{sale.destino}</td>
                        <td className="px-4 py-3">
                          {sinDatoCarga(sale.pesoTotal)
                            ? <span className="text-muted-foreground italic text-xs">sin dato en Odoo</span>
                            : formatCarga(sale.pesoTotal, "kg")}
                        </td>
                        <td className="px-4 py-3">
                          {sinDatoCarga(sale.volumenTotal)
                            ? <span className="text-muted-foreground italic text-xs">sin dato en Odoo</span>
                            : formatCarga(sale.volumenTotal, "m³")}
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant="outline" className="capitalize text-xs">{sale.estado}</Badge>
                        </td>
                        <td className="px-4 py-3">
                          <Button size="sm" onClick={() => handleSelectSale(sale)} className="gap-1" data-testid={`button-select-sale-${sale.id}`}>
                            Seleccionar <ChevronRight className="w-3.5 h-3.5" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Calculation ── */}
      {mode === "order" && selectedSale && (
        <div className="space-y-4">
          {/* Order summary */}
          <div className="bg-muted/50 rounded-lg px-4 py-3 flex flex-wrap gap-4 text-sm">
            <div><span className="text-muted-foreground">Orden:</span> <span className="font-medium">#{selectedSale.id}</span></div>
            <CommercialBadge sale={selectedSale} />
            <div><span className="text-muted-foreground">Cliente:</span> <span className="font-medium">{selectedSale.cliente}</span></div>
            <div><span className="text-muted-foreground">Destino:</span> <span className="font-medium">{selectedSale.destino}</span></div>
            <div>
              <span className="text-muted-foreground">Odoo:</span>{" "}
              <span className="font-medium" data-testid="text-odoo-totales">
                {formatCarga(selectedSale.pesoTotal, "kg")} · {formatCarga(selectedSale.volumenTotal, "m³")}
              </span>
            </div>
          </div>

          {/* Effective values (editable to simulate) */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Valores para el cálculo</CardTitle>
              <p className="text-xs text-muted-foreground">
                Pre-cargados desde Odoo. Puedes escribirlos a mano para simular otra carga — esto no modifica la venta.
              </p>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Peso (kg)</label>
                  <Input
                    type="number" min={0} step="0.1"
                    value={pesoManual}
                    onChange={e => setPesoManual(e.target.value)}
                    placeholder="sin dato en Odoo"
                    data-testid="input-peso-calculo"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Volumen (m³)</label>
                  <Input
                    type="number" min={0} step="0.01"
                    value={volumenManual}
                    onChange={e => setVolumenManual(e.target.value)}
                    placeholder="sin dato en Odoo"
                    data-testid="input-volumen-calculo"
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Warnings */}
          {sinPeso && sinVolumen && (
            <div className={`flex items-start gap-2 text-sm border rounded-md px-4 py-3 ${isQuotation(selectedSale) ? "bg-muted/50 border-border" : "bg-red-500/10 border-red-500/40"}`} data-testid="warning-sin-datos">
              {isQuotation(selectedSale)
                ? <Info className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
                : <AlertTriangle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />}
              <span>
                {isQuotation(selectedSale)
                  ? "Es esperable que una cotización aún no tenga peso ni volumen en Odoo. Puedes introducir valores manuales para estimar la carga; sin peso no se recomienda un vehículo."
                  : "Esta venta no tiene peso ni volumen en Odoo. No se puede recomendar un vehículo: escribe valores manuales para simular, o corrige los datos del artículo en Odoo."}
              </span>
            </div>
          )}
          {recomendacionIncompleta && (
            <div className="flex items-start gap-2 text-sm bg-yellow-500/10 border border-yellow-500/40 rounded-md px-4 py-3" data-testid="warning-recomendacion-incompleta">
              <AlertTriangle className="w-4 h-4 text-yellow-500 shrink-0 mt-0.5" />
              <span>
                <strong>Recomendación incompleta:</strong> la venta no tiene volumen en Odoo, así que la
                recomendación considera <strong>solo el peso</strong>. Verifica que la carga quepa físicamente
                en el vehículo antes de despachar.
              </span>
            </div>
          )}
          {sinPeso && !sinVolumen && (
            <div className="flex items-start gap-2 text-sm bg-red-500/10 border border-red-500/40 rounded-md px-4 py-3" data-testid="warning-sin-peso">
              <AlertTriangle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
              <span>
                <strong>No se puede recomendar por peso:</strong> la venta no tiene peso en Odoo.
                Escribe un peso manual para simular, o corrige los datos del artículo en Odoo.
              </span>
            </div>
          )}

          {/* Fleet */}
          {puedeCalcular && (
            <FleetCompatibility vehicles={vehicles ?? []} peso={peso!} volumen={volumen} />
          )}
        </div>
      )}

      {mode === "articles" && (
        <div className="space-y-4" data-testid="articles-load-builder">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <PackageOpen className="w-4 h-4 text-primary" />
                Buscar artículos
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                Busca por nombre o referencia. Los resultados se consultan en Odoo a través del servidor.
              </p>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  value={productSearch}
                  onChange={event => setProductSearch(event.target.value)}
                  placeholder="Buscar por nombre o referencia..."
                  className="pl-8"
                  data-testid="input-search-products-carga"
                />
              </div>
              {productSearch.trim() === "" ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                  Escribe una búsqueda para consultar artículos.
                </p>
              ) : !showingCurrentSearch || productQuery.isLoading || productQuery.isFetching ? (
                <p className="text-sm text-muted-foreground flex items-center justify-center gap-2 py-4">
                  <Loader2 className="w-4 h-4 animate-spin" /> Buscando artículos...
                </p>
              ) : productQuery.isError ? (
                <div className="text-sm text-red-500 border border-red-500/40 bg-red-500/10 rounded-md px-3 py-2">
                  No se pudieron buscar los artículos: {String(productQuery.error)}
                </div>
              ) : (productQuery.data?.length ?? 0) === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No hay artículos que coincidan con la búsqueda.
                </p>
              ) : (
                <div className="max-h-64 overflow-y-auto rounded-md border">
                  {productQuery.data?.map(product => (
                    <div key={product.id} className="flex items-center justify-between gap-3 border-b last:border-b-0 px-3 py-2">
                      <div className="min-w-0">
                        <div className="font-medium text-sm truncate">{product.nombre}</div>
                        <div className="text-xs text-muted-foreground">
                          {product.odooRef ?? "sin referencia"} · Peso: {product.pesoOdoo == null ? "sin dato" : formatCarga(product.pesoOdoo, "kg")} · Volumen: {product.volumenOdoo == null ? "sin dato" : formatCarga(product.volumenOdoo, "m³")}
                        </div>
                      </div>
                      <Button size="sm" variant="outline" className="gap-1 shrink-0" onClick={() => addProduct(product)} data-testid={`button-add-product-${product.id}`}>
                        <Plus className="w-3.5 h-3.5" /> Agregar
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-3">
                <CardTitle className="text-base">Artículos de la carga</CardTitle>
                {articleRows.length > 0 && (
                  <Button variant="ghost" size="sm" onClick={() => setArticleRows([])} data-testid="button-clear-articles">
                    Vaciar lista
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {computedRows.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">
                  Agrega artículos para calcular la carga.
                </p>
              ) : (
                <div className="space-y-2">
                  {computedRows.map(row => {
                    const quantityInvalid = row.quantityValue == null;
                    return (
                      <div key={row.rowId} className={`rounded-md border p-3 ${quantityInvalid || row.overflow ? "border-red-500/50 bg-red-500/5" : "border-border"}`} data-testid={`article-row-${row.rowId}`}>
                        <div className="flex items-start gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-sm">{row.product.nombre}</div>
                            <div className="text-xs text-muted-foreground">{row.product.odooRef ?? "sin referencia"}</div>
                          </div>
                          <div className="w-28">
                            <label className="text-xs text-muted-foreground">Cantidad</label>
                            <Input
                              inputMode="numeric"
                              value={row.quantity}
                              onChange={event => setArticleRows(rows => rows.map(item => (
                                item.rowId === row.rowId ? { ...item, quantity: event.target.value } : item
                              )))}
                              aria-invalid={quantityInvalid}
                              className="h-8"
                              data-testid={`input-quantity-${row.rowId}`}
                            />
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 mt-4 shrink-0"
                            onClick={() => setArticleRows(rows => rows.filter(item => item.rowId !== row.rowId))}
                            aria-label={`Eliminar ${row.product.nombre}`}
                            data-testid={`button-remove-article-${row.rowId}`}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                        <div className="mt-2 text-xs text-muted-foreground flex flex-wrap gap-x-5 gap-y-1">
                          <span>
                            Peso subtotal: {row.pesoSubtotal == null || row.overflow ? "sin dato" : formatCarga(roundPartialQuotaSum(row.pesoSubtotal), "kg")}
                          </span>
                          <span>
                            Volumen subtotal: {row.volumenSubtotal == null || row.overflow ? "sin dato" : formatCarga(roundPartialQuotaSum(row.volumenSubtotal), "m³")}
                          </span>
                        </div>
                        {quantityInvalid && (
                          <p className="text-xs text-red-500 mt-1">La cantidad debe ser un entero positivo seguro.</p>
                        )}
                        {row.overflow && (
                          <p className="text-xs text-red-500 mt-1">La cantidad produce un total demasiado grande para calcularlo con seguridad.</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {articleRows.length > 0 && (
            <>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Totales desde Odoo</CardTitle>
                </CardHeader>
                <CardContent className="grid sm:grid-cols-2 gap-3">
                  <div className="rounded-md bg-muted/50 p-3">
                    <div className="text-xs text-muted-foreground">Peso total</div>
                    <div className="text-xl font-semibold">{articlesPeso == null ? "sin dato" : formatCarga(articlesPeso, "kg")}</div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {missingWeightRows} de {articleRows.length} fila{articleRows.length === 1 ? "" : "s"} sin peso en Odoo.
                    </div>
                  </div>
                  <div className="rounded-md bg-muted/50 p-3">
                    <div className="text-xs text-muted-foreground">Volumen total</div>
                    <div className="text-xl font-semibold">{articlesVolumen == null ? "sin dato" : formatCarga(articlesVolumen, "m³")}</div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {missingVolumeRows} de {articleRows.length} fila{articleRows.length === 1 ? "" : "s"} sin volumen en Odoo.
                    </div>
                  </div>
                </CardContent>
              </Card>

              {hasInvalidQuantity && (
                <div className="flex items-start gap-2 text-sm bg-red-500/10 border border-red-500/40 rounded-md px-4 py-3" data-testid="warning-invalid-quantity">
                  <AlertTriangle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                  Corrige todas las cantidades. No se mostrarán recomendaciones ni repartos mientras haya cantidades vacías o inválidas.
                </div>
              )}
              {hasArithmeticOverflow && (
                <div className="flex items-start gap-2 text-sm bg-red-500/10 border border-red-500/40 rounded-md px-4 py-3" data-testid="warning-arithmetic-overflow">
                  <AlertTriangle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                  El cálculo excede el rango numérico seguro. Reduce las cantidades antes de solicitar una recomendación.
                </div>
              )}
              {hasPrecisionLoss && !hasArithmeticOverflow && (
                <div className="flex items-start gap-2 text-sm bg-red-500/10 border border-red-500/40 rounded-md px-4 py-3" data-testid="warning-measurement-precision">
                  <AlertTriangle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                  Una medida positiva es menor que la precisión mínima de 0,001. No se puede recomendar un vehículo sin redondear esa carga a cero.
                </div>
              )}
              {articlesCalculationValid && missingWeightRows === articleRows.length && (
                <div className="flex items-start gap-2 text-sm bg-red-500/10 border border-red-500/40 rounded-md px-4 py-3" data-testid="warning-no-article-weight">
                  <AlertTriangle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                  Ningún artículo tiene peso en Odoo. Sin peso total no se puede recomendar un vehículo.
                </div>
              )}
              {articlesCalculationValid && missingWeightRows > 0 && missingWeightRows < articleRows.length && (
                <div className="flex items-start gap-2 text-sm bg-yellow-500/10 border border-yellow-500/40 rounded-md px-4 py-3">
                  <AlertTriangle className="w-4 h-4 text-yellow-500 shrink-0 mt-0.5" />
                  <span><strong>Peso incompleto:</strong> el total es parcial porque faltan datos en {missingWeightRows} de {articleRows.length} filas.</span>
                </div>
              )}
              {articlesCalculationValid && missingVolumeRows === articleRows.length && (
                <div className="flex items-start gap-2 text-sm bg-yellow-500/10 border border-yellow-500/40 rounded-md px-4 py-3">
                  <AlertTriangle className="w-4 h-4 text-yellow-500 shrink-0 mt-0.5" />
                  Ningún artículo tiene volumen en Odoo. La estimación considera solo el peso; verifica que la carga quepa físicamente.
                </div>
              )}
              {articlesCalculationValid && missingVolumeRows > 0 && missingVolumeRows < articleRows.length && (
                <div className="flex items-start gap-2 text-sm bg-yellow-500/10 border border-yellow-500/40 rounded-md px-4 py-3">
                  <AlertTriangle className="w-4 h-4 text-yellow-500 shrink-0 mt-0.5" />
                  <span><strong>Volumen incompleto:</strong> el total es parcial porque faltan datos en {missingVolumeRows} de {articleRows.length} filas.</span>
                </div>
              )}
              {densityWarning && (
                <div className="flex items-start gap-2 text-sm bg-yellow-500/10 border border-yellow-500/40 rounded-md px-4 py-3" data-testid="warning-density">
                  <AlertTriangle className="w-4 h-4 text-yellow-500 shrink-0 mt-0.5" />
                  {densityWarning}
                </div>
              )}

              {articlesCanRecommend && (
                <FleetCompatibility
                  vehicles={vehicles ?? []}
                  peso={articlesPeso!}
                  volumen={articlesVolumen}
                  noFitExtra={simultaneousPlan && successivePlan ? (
                    <div className="space-y-3 pt-1" data-testid="informational-split-plans">
                      <div>
                        <div className="font-medium text-sm">Opciones informativas de reparto</div>
                        <p className="text-xs text-muted-foreground">
                          Estas estrategias son estimaciones; no crean órdenes, despachos ni viajes.
                        </p>
                      </div>
                      <SplitPlan plan={simultaneousPlan} />
                      <SplitPlan plan={successivePlan} />
                    </div>
                  ) : null}
                />
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
