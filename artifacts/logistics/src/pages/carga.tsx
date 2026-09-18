import React, { useState } from "react";
import {
  useListSales,
  useListVehicles, getListVehiclesQueryKey,
} from "@workspace/api-client-react";
import type { Sale } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { matchesSearch } from "@/lib/search";
import { classifyFleet } from "@/lib/fleet";
import { formatCarga, sinDatoCarga } from "@/lib/carga";
import {
  CheckCircle2, ChevronRight, PackageOpen, Truck,
  ArrowLeft, AlertTriangle, Info, Search,
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

export default function Carga() {
  const [selectedSaleId, setSelectedSaleId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("todos");
  const [statusFilter, setStatusFilter] = useState("todos");
  // Valores efectivos para el cálculo: se inicializan con los totales de Odoo
  // de la venta y el operador puede sobrescribirlos para simular.
  const [pesoManual, setPesoManual] = useState<string>("");
  const [volumenManual, setVolumenManual] = useState<string>("");

  const { data: sales, isLoading: isLoadingSales } = useListSales({ includeQuotations: true });
  const { data: vehicles } = useListVehicles({
    query: { queryKey: getListVehiclesQueryKey() }
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

  const { fit: fitVehicles, unfit: unfitVehicles } = puedeCalcular
    ? classifyFleet(vehicles ?? [], peso ?? 0, volumen ?? 0)
    : { fit: [], unfit: [] };

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Calculador de Carga</h1>
          <p className="text-muted-foreground">
            Recomienda el vehículo según el peso y volumen de Odoo de la venta (o valores manuales para simular).
          </p>
        </div>
        {selectedSale && (
          <Button variant="ghost" onClick={handleReset} className="gap-2" data-testid="button-nueva-consulta">
            <ArrowLeft className="w-4 h-4" /> Nueva consulta
          </Button>
        )}
      </div>

      {/* ── Select sale ── */}
      {!selectedSale && (
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
      {selectedSale && (
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
                          Peso: {sinPeso ? "sin dato" : `${(peso ?? 0).toFixed(1)} / ${vehicle.capacidadPeso} kg`}
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
                          Volumen: {sinVolumen ? "sin dato en Odoo — no considerado" : `${(volumen ?? 0).toFixed(3)} / ${vehicle.capacidadVolumen} m³`}
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
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
