import React, { useState } from "react";
import { Link } from "wouter";
import {
  useListSales, getListSalesQueryKey,
  useListVehicles, getListVehiclesQueryKey,
  useListSaleItems, getListSaleItemsQueryKey,
  useCreateSaleItem, useUpdateSaleItem, useDeleteSaleItem,
  useListProducts, getListProductsQueryKey,
} from "@workspace/api-client-react";
import type { SaleItem, Product } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  CheckCircle2, ChevronRight, PackageOpen, Truck, Weight,
  Plus, Trash2, Edit2, BarChart3, ArrowLeft, Check,
  Search, AlertTriangle, X, ExternalLink,
} from "lucide-react";

const STEPS = [
  { label: "Selección de Orden", icon: PackageOpen },
  { label: "Detalle de Bultos", icon: Weight },
  { label: "Compatibilidad de Flota", icon: Truck },
];

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

interface ItemDraft {
  id?: number;
  productId?: number | null;
  descripcion: string;
  cantidad: number;
  pesoUnitario: number;
  largo: number;
  ancho: number;
  alto: number;
}

const emptyDraft = (): ItemDraft => ({
  productId: null, descripcion: "", cantidad: 1, pesoUnitario: 0, largo: 0, ancho: 0, alto: 0,
});

function itemVolume(item: ItemDraft | SaleItem): number {
  return (item.largo * item.ancho * item.alto) / 1_000_000;
}

export default function Carga() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [step, setStep] = useState(1);
  const [selectedSaleId, setSelectedSaleId] = useState<number | null>(null);
  const [editingItem, setEditingItem] = useState<ItemDraft | null>(null);
  const [isAddingNew, setIsAddingNew] = useState(false);
  const [newDraft, setNewDraft] = useState<ItemDraft>(emptyDraft());
  const [showUnfit, setShowUnfit] = useState(false);
  const [productSearch, setProductSearch] = useState("");
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);

  const { data: sales, isLoading: isLoadingSales } = useListSales(undefined, {
    query: { queryKey: getListSalesQueryKey() }
  });
  const { data: vehicles } = useListVehicles({
    query: { queryKey: getListVehiclesQueryKey() }
  });
  const { data: items, isLoading: isLoadingItems } = useListSaleItems(
    selectedSaleId ?? 0,
    { query: { queryKey: getListSaleItemsQueryKey(selectedSaleId ?? 0), enabled: !!selectedSaleId } }
  );

  const trimmedSearch = productSearch.trim();
  const { data: productResults, isLoading: isSearchingProducts } = useListProducts(
    { search: trimmedSearch },
    {
      query: {
        queryKey: getListProductsQueryKey({ search: trimmedSearch }),
        enabled: isAddingNew && trimmedSearch.length > 0,
      },
    }
  );

  const createItem = useCreateSaleItem();
  const updateItem = useUpdateSaleItem();
  const deleteItem = useDeleteSaleItem();

  const selectedSale = sales?.find(s => s.id === selectedSaleId);

  const totalPeso = (items ?? []).reduce((s, it) => s + it.cantidad * it.pesoUnitario, 0);
  const totalVolumen = (items ?? []).reduce((s, it) => s + it.cantidad * itemVolume(it), 0);

  function invalidateItems() {
    if (selectedSaleId) {
      queryClient.invalidateQueries({ queryKey: getListSaleItemsQueryKey(selectedSaleId) });
      queryClient.invalidateQueries({ queryKey: getListSalesQueryKey() });
    }
  }

  function handleSelectSale(saleId: number) {
    setSelectedSaleId(saleId);
    setStep(2);
  }

  function handleAddItem() {
    if (!selectedSaleId || !newDraft.descripcion.trim()) return;
    createItem.mutate(
      { saleId: selectedSaleId, data: newDraft },
      {
        onSuccess: () => {
          invalidateItems();
          setNewDraft(emptyDraft());
          setIsAddingNew(false);
          setProductSearch("");
          setSelectedProduct(null);
          toast({ title: "Bulto añadido" });
        },
      }
    );
  }

  function handleUpdateItem() {
    if (!editingItem?.id) return;
    updateItem.mutate(
      { itemId: editingItem.id, data: editingItem },
      {
        onSuccess: () => {
          invalidateItems();
          setEditingItem(null);
          toast({ title: "Bulto actualizado" });
        },
      }
    );
  }

  function handleDeleteItem(id: number) {
    deleteItem.mutate(
      { itemId: id },
      {
        onSuccess: () => {
          invalidateItems();
          toast({ title: "Bulto eliminado" });
        },
      }
    );
  }

  function handleImportTotals() {
    if (!selectedSale || !selectedSaleId) return;
    const vol = selectedSale.volumenTotal;
    const peso = selectedSale.pesoTotal;
    const lSide = Math.cbrt(vol * 1_000_000);
    createItem.mutate(
      {
        saleId: selectedSaleId,
        data: {
          descripcion: `[ESTIMADO] ${selectedSale.tipoMaterial || "Carga general"}`,
          cantidad: 1,
          pesoUnitario: peso,
          largo: parseFloat(lSide.toFixed(1)),
          ancho: parseFloat(lSide.toFixed(1)),
          alto: parseFloat(lSide.toFixed(1)),
        },
      },
      {
        onSuccess: () => {
          invalidateItems();
          toast({
            title: "Totales importados como bulto estimado",
            description: "Las dimensiones son una estimación (cubo equivalente). Ajusta las medidas reales del bulto antes de planificar.",
          });
        },
      }
    );
  }

  function handleReset() {
    setStep(1);
    setSelectedSaleId(null);
    setEditingItem(null);
    setIsAddingNew(false);
    setNewDraft(emptyDraft());
    setProductSearch("");
    setSelectedProduct(null);
  }

  function handleSelectProduct(product: Product) {
    setSelectedProduct(product);
    setProductSearch("");
    setNewDraft(draft => ({
      ...draft,
      productId: product.id,
      descripcion: product.nombre,
      pesoUnitario: product.pesoKg ?? 0,
      largo: product.largoCm ?? 0,
      ancho: product.anchoCm ?? 0,
      alto: product.altoCm ?? 0,
    }));
  }

  function handleClearProduct() {
    setSelectedProduct(null);
    setNewDraft(draft => ({ ...draft, productId: null }));
  }

  // Classify fleet: fit vehicles (weight & volume utilization ≤ 100%, capacities > 0)
  // sorted by utilization descending (tightest fit first = suggested).
  const classifiedVehicles = (vehicles ?? []).map(vehicle => {
    const hasCapacity = vehicle.capacidadPeso > 0 && vehicle.capacidadVolumen > 0;
    const weightPct = hasCapacity ? (totalPeso / vehicle.capacidadPeso) * 100 : NaN;
    const volPct = hasCapacity ? (totalVolumen / vehicle.capacidadVolumen) * 100 : NaN;
    const maxPct = Math.max(weightPct, volPct);
    const isFit = hasCapacity && Number.isFinite(maxPct) && maxPct <= 100;
    return { vehicle, hasCapacity, weightPct, volPct, maxPct, isFit };
  });
  const fitVehicles = classifiedVehicles
    .filter(v => v.isFit)
    .sort((a, b) => b.maxPct - a.maxPct);
  const unfitVehicles = classifiedVehicles.filter(v => !v.isFit);

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Calculador de Carga</h1>
          <p className="text-muted-foreground">Planifica el llenado de unidades por peso y volumen.</p>
        </div>
        {step > 1 && (
          <Button variant="ghost" onClick={handleReset} className="gap-2">
            <ArrowLeft className="w-4 h-4" /> Nueva consulta
          </Button>
        )}
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-2">
        {STEPS.map((s, i) => {
          const n = i + 1;
          const isDone = step > n;
          const isActive = step === n;
          return (
            <React.Fragment key={n}>
              <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium transition-colors
                ${isActive ? "bg-primary text-primary-foreground" :
                  isDone ? "bg-primary/20 text-primary" :
                  "bg-muted text-muted-foreground"}`}
              >
                {isDone
                  ? <Check className="w-3.5 h-3.5" />
                  : <s.icon className="w-3.5 h-3.5" />}
                <span className="hidden sm:inline">{s.label}</span>
                <span className="sm:hidden">{n}</span>
              </div>
              {i < STEPS.length - 1 && (
                <div className={`flex-1 h-px ${step > n ? "bg-primary/40" : "bg-border"}`} />
              )}
            </React.Fragment>
          );
        })}
      </div>

      {/* ── STEP 1: Select Sale ── */}
      {step === 1 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <PackageOpen className="w-4 h-4 text-primary" />
              Selecciona una Orden de Venta
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {isLoadingSales ? (
              <p className="text-center text-muted-foreground py-10">Cargando órdenes...</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-muted-foreground text-left">
                    <th className="px-4 py-2 font-medium">ID</th>
                    <th className="px-4 py-2 font-medium">Cliente</th>
                    <th className="px-4 py-2 font-medium">Destino</th>
                    <th className="px-4 py-2 font-medium">Peso</th>
                    <th className="px-4 py-2 font-medium">Volumen</th>
                    <th className="px-4 py-2 font-medium">Estado</th>
                    <th className="px-4 py-2 w-[100px]"></th>
                  </tr>
                </thead>
                <tbody>
                  {sales?.length === 0 && (
                    <tr><td colSpan={7} className="text-center py-10 text-muted-foreground">Sin órdenes registradas.</td></tr>
                  )}
                  {sales?.map(sale => (
                    <tr key={sale.id} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                      <td className="px-4 py-3 font-medium">#{sale.id}</td>
                      <td className="px-4 py-3">{sale.cliente}</td>
                      <td className="px-4 py-3 text-muted-foreground">{sale.destino}</td>
                      <td className="px-4 py-3">{sale.pesoTotal} kg</td>
                      <td className="px-4 py-3">{sale.volumenTotal} m³</td>
                      <td className="px-4 py-3">
                        <Badge variant="outline" className="capitalize text-xs">{sale.estado}</Badge>
                      </td>
                      <td className="px-4 py-3">
                        <Button size="sm" onClick={() => handleSelectSale(sale.id)} className="gap-1">
                          Seleccionar <ChevronRight className="w-3.5 h-3.5" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── STEP 2: Item detail ── */}
      {step === 2 && selectedSale && (
        <div className="space-y-4">
          {/* Order summary */}
          <div className="bg-muted/50 rounded-lg px-4 py-3 flex flex-wrap gap-4 text-sm">
            <div><span className="text-muted-foreground">Orden:</span> <span className="font-medium">#{selectedSale.id}</span></div>
            <div><span className="text-muted-foreground">Cliente:</span> <span className="font-medium">{selectedSale.cliente}</span></div>
            <div><span className="text-muted-foreground">Destino:</span> <span className="font-medium">{selectedSale.destino}</span></div>
          </div>

          {/* Running totals */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-card border border-border rounded-lg p-4 text-center">
              <div className="text-xs text-muted-foreground mb-1">Peso Total</div>
              <div className="text-2xl font-bold">{totalPeso.toFixed(1)} <span className="text-base font-normal text-muted-foreground">kg</span></div>
            </div>
            <div className="bg-card border border-border rounded-lg p-4 text-center">
              <div className="text-xs text-muted-foreground mb-1">Volumen Total</div>
              <div className="text-2xl font-bold">{totalVolumen.toFixed(3)} <span className="text-base font-normal text-muted-foreground">m³</span></div>
            </div>
          </div>

          {/* Items table */}
          <Card>
            <CardHeader className="pb-2 flex-row items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <Weight className="w-4 h-4 text-primary" />
                Bultos / Partidas
              </CardTitle>
              <div className="flex gap-2">
                {(items?.length ?? 0) === 0 && (
                  <Button size="sm" variant="outline" onClick={handleImportTotals} disabled={createItem.isPending}>
                    Importar totales actuales
                  </Button>
                )}
                <Button size="sm" onClick={() => { setIsAddingNew(true); setNewDraft(emptyDraft()); setProductSearch(""); setSelectedProduct(null); }} className="gap-1">
                  <Plus className="w-3.5 h-3.5" /> Añadir bulto
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {isAddingNew && (
                <div className="px-4 py-3 border-b border-border bg-muted/20 space-y-2" data-testid="panel-product-picker">
                  {!selectedProduct ? (
                    <div className="relative">
                      <div className="flex items-center gap-2">
                        <Search className="w-4 h-4 text-muted-foreground shrink-0" />
                        <Input
                          placeholder="Buscar artículo del catálogo (opcional) — o rellena el bulto manualmente abajo"
                          value={productSearch}
                          onChange={e => setProductSearch(e.target.value)}
                          className="h-8 text-sm"
                          data-testid="input-product-search"
                        />
                      </div>
                      {trimmedSearch.length > 0 && (
                        <div className="absolute z-20 mt-1 left-6 right-0 bg-popover border border-border rounded-md shadow-lg max-h-56 overflow-y-auto">
                          {isSearchingProducts ? (
                            <p className="px-3 py-2 text-sm text-muted-foreground">Buscando...</p>
                          ) : (productResults?.length ?? 0) === 0 ? (
                            <p className="px-3 py-2 text-sm text-muted-foreground">Sin artículos que coincidan.</p>
                          ) : (
                            productResults?.map(p => (
                              <button
                                key={p.id}
                                type="button"
                                onClick={() => handleSelectProduct(p)}
                                className="w-full text-left px-3 py-2 text-sm hover:bg-muted/50 flex items-center justify-between gap-2"
                                data-testid={`option-product-${p.id}`}
                              >
                                <span className="truncate">
                                  {p.nombre}
                                  {p.odooRef && <span className="text-muted-foreground ml-1 text-xs">[{p.odooRef}]</span>}
                                </span>
                                {p.dimensionesConfirmadas ? (
                                  <Badge variant="outline" className="text-green-500 border-green-500/50 text-[10px] shrink-0">
                                    {p.pesoKg ?? 0} kg · {p.largoCm ?? 0}×{p.anchoCm ?? 0}×{p.altoCm ?? 0} cm
                                  </Badge>
                                ) : (
                                  <Badge variant="outline" className="text-yellow-500 border-yellow-500/50 text-[10px] shrink-0">
                                    Sin dimensiones
                                  </Badge>
                                )}
                              </button>
                            ))
                          )}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="flex items-center justify-between gap-2 text-sm">
                      <div className="flex items-center gap-2 min-w-0">
                        <CheckCircle2 className="w-4 h-4 text-primary shrink-0" />
                        <span className="truncate font-medium">{selectedProduct.nombre}</span>
                        <span className="text-xs text-muted-foreground shrink-0">artículo del catálogo</span>
                      </div>
                      <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={handleClearProduct} data-testid="button-clear-product">
                        <X className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  )}
                  {selectedProduct && !selectedProduct.dimensionesConfirmadas && (
                    <div className="flex items-start gap-2 text-xs bg-yellow-500/10 border border-yellow-500/40 rounded-md px-3 py-2" data-testid="warning-unconfirmed-dimensions">
                      <AlertTriangle className="w-4 h-4 text-yellow-500 shrink-0 mt-0.5" />
                      <div className="text-yellow-600 dark:text-yellow-400">
                        Este artículo no tiene dimensiones confirmadas: se autocompletó con los datos disponibles (pueden ser 0).{" "}
                        <Link href="/articulos" className="underline font-medium inline-flex items-center gap-0.5">
                          Confirmar dimensiones en Artículos <ExternalLink className="w-3 h-3" />
                        </Link>
                      </div>
                    </div>
                  )}
                </div>
              )}
              {isLoadingItems ? (
                <p className="text-center text-muted-foreground py-6">Cargando...</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-muted-foreground text-left">
                      <th className="px-4 py-2 font-medium">Descripción</th>
                      <th className="px-4 py-2 font-medium text-right">Cant.</th>
                      <th className="px-4 py-2 font-medium text-right">Peso/u (kg)</th>
                      <th className="px-4 py-2 font-medium text-center">L × A × Al (cm)</th>
                      <th className="px-4 py-2 font-medium text-right">Vol. total (m³)</th>
                      <th className="px-4 py-2 w-[80px]"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {(items?.length === 0 && !isAddingNew) && (
                      <tr><td colSpan={6} className="text-center py-8 text-muted-foreground">Sin bultos. Añade uno o importa los totales de la orden.</td></tr>
                    )}
                    {items?.map(item => (
                      editingItem?.id === item.id ? (
                        <tr key={item.id} className="border-b border-border bg-muted/20">
                          <td className="px-2 py-1.5">
                            <Input value={editingItem.descripcion} onChange={e => setEditingItem({...editingItem, descripcion: e.target.value})} className="h-7 text-xs" />
                          </td>
                          <td className="px-2 py-1.5">
                            <Input type="number" min={1} value={editingItem.cantidad} onChange={e => setEditingItem({...editingItem, cantidad: +e.target.value})} className="h-7 text-xs w-16 text-right" />
                          </td>
                          <td className="px-2 py-1.5">
                            <Input type="number" min={0} step="0.1" value={editingItem.pesoUnitario} onChange={e => setEditingItem({...editingItem, pesoUnitario: +e.target.value})} className="h-7 text-xs w-20 text-right" />
                          </td>
                          <td className="px-2 py-1.5">
                            <div className="flex items-center gap-1">
                              <Input type="number" min={0} value={editingItem.largo} onChange={e => setEditingItem({...editingItem, largo: +e.target.value})} className="h-7 text-xs w-16 text-right" />
                              <span className="text-muted-foreground">×</span>
                              <Input type="number" min={0} value={editingItem.ancho} onChange={e => setEditingItem({...editingItem, ancho: +e.target.value})} className="h-7 text-xs w-16 text-right" />
                              <span className="text-muted-foreground">×</span>
                              <Input type="number" min={0} value={editingItem.alto} onChange={e => setEditingItem({...editingItem, alto: +e.target.value})} className="h-7 text-xs w-16 text-right" />
                            </div>
                          </td>
                          <td className="px-2 py-1.5 text-right text-muted-foreground text-xs">
                            {(editingItem.cantidad * itemVolume(editingItem)).toFixed(4)}
                          </td>
                          <td className="px-2 py-1.5">
                            <div className="flex gap-1">
                              <Button size="icon" className="h-6 w-6" onClick={handleUpdateItem} disabled={updateItem.isPending}>
                                <Check className="w-3 h-3" />
                              </Button>
                              <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setEditingItem(null)}>
                                <ArrowLeft className="w-3 h-3" />
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ) : (
                        <tr key={item.id} className="border-b border-border/50 hover:bg-muted/10">
                          <td className="px-4 py-2.5 font-medium">{item.descripcion}</td>
                          <td className="px-4 py-2.5 text-right">{item.cantidad}</td>
                          <td className="px-4 py-2.5 text-right">{item.pesoUnitario}</td>
                          <td className="px-4 py-2.5 text-center text-muted-foreground">
                            {item.largo} × {item.ancho} × {item.alto}
                          </td>
                          <td className="px-4 py-2.5 text-right text-muted-foreground">
                            {(item.cantidad * itemVolume(item)).toFixed(4)}
                          </td>
                          <td className="px-4 py-2.5">
                            <div className="flex gap-1 justify-end">
                              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditingItem({ ...item })}>
                                <Edit2 className="w-3.5 h-3.5" />
                              </Button>
                              <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => handleDeleteItem(item.id)} disabled={deleteItem.isPending}>
                                <Trash2 className="w-3.5 h-3.5" />
                              </Button>
                            </div>
                          </td>
                        </tr>
                      )
                    ))}

                    {/* New item row */}
                    {isAddingNew && (
                      <tr className="border-b border-primary/30 bg-primary/5">
                        <td className="px-2 py-1.5">
                          <Input placeholder="Descripción" value={newDraft.descripcion} onChange={e => setNewDraft({...newDraft, descripcion: e.target.value})} className="h-7 text-xs" autoFocus />
                        </td>
                        <td className="px-2 py-1.5">
                          <Input type="number" min={1} value={newDraft.cantidad} onChange={e => setNewDraft({...newDraft, cantidad: +e.target.value})} className="h-7 text-xs w-16 text-right" />
                        </td>
                        <td className="px-2 py-1.5">
                          <Input type="number" min={0} step="0.1" placeholder="0" value={newDraft.pesoUnitario || ""} onChange={e => setNewDraft({...newDraft, pesoUnitario: +e.target.value})} className="h-7 text-xs w-20 text-right" />
                        </td>
                        <td className="px-2 py-1.5">
                          <div className="flex items-center gap-1">
                            <Input type="number" min={0} placeholder="L" value={newDraft.largo || ""} onChange={e => setNewDraft({...newDraft, largo: +e.target.value})} className="h-7 text-xs w-16 text-right" />
                            <span className="text-muted-foreground">×</span>
                            <Input type="number" min={0} placeholder="A" value={newDraft.ancho || ""} onChange={e => setNewDraft({...newDraft, ancho: +e.target.value})} className="h-7 text-xs w-16 text-right" />
                            <span className="text-muted-foreground">×</span>
                            <Input type="number" min={0} placeholder="Al" value={newDraft.alto || ""} onChange={e => setNewDraft({...newDraft, alto: +e.target.value})} className="h-7 text-xs w-16 text-right" />
                          </div>
                        </td>
                        <td className="px-2 py-1.5 text-right text-muted-foreground text-xs">
                          {newDraft.largo && newDraft.ancho && newDraft.alto
                            ? (newDraft.cantidad * itemVolume(newDraft)).toFixed(4)
                            : "—"}
                        </td>
                        <td className="px-2 py-1.5">
                          <div className="flex gap-1">
                            <Button size="icon" className="h-6 w-6" onClick={handleAddItem} disabled={createItem.isPending || !newDraft.descripcion.trim()}>
                              <Check className="w-3 h-3" />
                            </Button>
                            <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => { setIsAddingNew(false); setProductSearch(""); setSelectedProduct(null); }}>
                              <ArrowLeft className="w-3 h-3" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    )}
                  </tbody>
                  {(items?.length ?? 0) > 0 && (
                    <tfoot>
                      <tr className="bg-muted/30 font-semibold text-sm">
                        <td className="px-4 py-2">TOTAL</td>
                        <td className="px-4 py-2 text-right">{(items ?? []).reduce((s, it) => s + it.cantidad, 0)}</td>
                        <td className="px-4 py-2 text-right">{totalPeso.toFixed(1)} kg</td>
                        <td></td>
                        <td className="px-4 py-2 text-right">{totalVolumen.toFixed(4)} m³</td>
                        <td></td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              )}
            </CardContent>
          </Card>

          <div className="flex justify-end">
            <Button
              onClick={() => setStep(3)}
              disabled={(items?.length ?? 0) === 0}
              className="gap-2"
              size="lg"
            >
              Ver compatibilidad de flota <BarChart3 className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}

      {/* ── STEP 3: Vehicle Compatibility ── */}
      {step === 3 && (
        <div className="space-y-4">
          {/* Load summary pill */}
          <div className="flex gap-3 flex-wrap">
            <div className="bg-card border border-border rounded-full px-4 py-1.5 text-sm flex items-center gap-2">
              <Weight className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="font-semibold">{totalPeso.toFixed(1)} kg</span>
              <span className="text-muted-foreground">· {(items ?? []).reduce((s, it) => s + it.cantidad, 0)} bultos</span>
            </div>
            <div className="bg-card border border-border rounded-full px-4 py-1.5 text-sm flex items-center gap-2">
              <PackageOpen className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="font-semibold">{totalVolumen.toFixed(3)} m³</span>
              <span className="text-muted-foreground">volumétrico</span>
            </div>
          </div>

          {fitVehicles.length === 0 && (
            <Card className="border-yellow-500/40 bg-yellow-500/5" data-testid="card-no-fit-warning">
              <CardContent className="p-4 flex items-start gap-3">
                <Truck className="w-5 h-5 text-yellow-400 mt-0.5 shrink-0" />
                <div>
                  <div className="font-semibold text-yellow-400">Ningún vehículo soporta esta carga</div>
                  <p className="text-sm text-muted-foreground mt-1">
                    El peso o volumen total excede la capacidad de todos los vehículos de la flota.
                    Considera dividir el envío en varios viajes o usar más de un vehículo.
                  </p>
                </div>
              </CardContent>
            </Card>
          )}

          {fitVehicles.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {fitVehicles.map(({ vehicle, weightPct, volPct, maxPct }, idx) => {
                const isSuggested = idx === 0;
                const isWarning = maxPct > 85;

                return (
                  <Card
                    key={vehicle.id}
                    data-testid={`card-vehicle-${vehicle.id}`}
                    className={`transition-colors ${
                      isSuggested ? "border-2 border-primary bg-primary/5 shadow-md" :
                      isWarning ? "border-yellow-500/40 bg-yellow-500/5" :
                      "border-green-500/40 bg-green-500/5"
                    }`}
                  >
                    <CardContent className="p-4 space-y-3">
                      {isSuggested && (
                        <div data-testid="badge-suggested">
                          <Badge className="bg-primary text-primary-foreground">⭐ SUGERIDO</Badge>
                          <p className="text-xs text-muted-foreground mt-1.5">
                            Vehículo más ajustado a la carga — menor consumo estimado
                          </p>
                        </div>
                      )}
                      <div className="flex items-start justify-between">
                        <div>
                          <div className="font-semibold flex items-center gap-2">
                            <Truck className="w-4 h-4 text-muted-foreground" />
                            {vehicle.modelo}
                          </div>
                          <div className="text-xs text-muted-foreground mt-0.5">
                            {vehicle.tipo === "tercero" ? "Tercero" : "Propio"} · {vehicle.placa ?? "Sin placa"}
                          </div>
                        </div>
                        <Badge
                          variant="outline"
                          className={isWarning ? "border-yellow-400 text-yellow-400" : "border-green-500 text-green-500"}
                        >
                          {isWarning ? "Casi lleno" : "Disponible"}
                        </Badge>
                      </div>

                      {/* Weight bar */}
                      <div className="space-y-1">
                        <div className="flex justify-between text-xs text-muted-foreground">
                          <span>Peso</span>
                          <span className={utilizationColor(weightPct)}>
                            {totalPeso.toFixed(1)} / {vehicle.capacidadPeso} kg
                            <span className="ml-1 font-semibold">({Math.min(weightPct, 999).toFixed(0)}%)</span>
                          </span>
                        </div>
                        <div className="h-2 rounded-full bg-muted overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${utilizationBg(weightPct)}`}
                            style={{ width: `${Math.min(weightPct, 100)}%` }}
                          />
                        </div>
                      </div>

                      {/* Volume bar */}
                      <div className="space-y-1">
                        <div className="flex justify-between text-xs text-muted-foreground">
                          <span>Volumen</span>
                          <span className={utilizationColor(volPct)}>
                            {totalVolumen.toFixed(3)} / {vehicle.capacidadVolumen} m³
                            <span className="ml-1 font-semibold">({Math.min(volPct, 999).toFixed(0)}%)</span>
                          </span>
                        </div>
                        <div className="h-2 rounded-full bg-muted overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${utilizationBg(volPct)}`}
                            style={{ width: `${Math.min(volPct, 100)}%` }}
                          />
                        </div>
                      </div>

                      {/* Capacity reference */}
                      <div className="text-[11px] text-muted-foreground border-t border-border pt-2">
                        Capacidad: {vehicle.capacidadPeso} kg · {vehicle.capacidadVolumen} m³
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}

          {/* Unfit vehicles: collapsed section */}
          {unfitVehicles.length > 0 && (
            <div className="space-y-3">
              <Button
                variant="ghost"
                onClick={() => setShowUnfit(v => !v)}
                className="gap-2 text-muted-foreground"
                data-testid="button-toggle-unfit"
              >
                <ChevronRight className={`w-4 h-4 transition-transform ${showUnfit ? "rotate-90" : ""}`} />
                {unfitVehicles.length} vehículo{unfitVehicles.length !== 1 ? "s" : ""} no soporta{unfitVehicles.length !== 1 ? "n" : ""} esta carga
              </Button>
              {showUnfit && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {unfitVehicles.map(({ vehicle, hasCapacity, weightPct, volPct }) => (
                    <Card
                      key={vehicle.id}
                      data-testid={`card-vehicle-${vehicle.id}`}
                      className="border-red-500/40 bg-red-500/5 opacity-80"
                    >
                      <CardContent className="p-4 space-y-3">
                        <div className="flex items-start justify-between">
                          <div>
                            <div className="font-semibold flex items-center gap-2">
                              <Truck className="w-4 h-4 text-muted-foreground" />
                              {vehicle.modelo}
                            </div>
                            <div className="text-xs text-muted-foreground mt-0.5">
                              {vehicle.tipo === "tercero" ? "Tercero" : "Propio"} · {vehicle.placa ?? "Sin placa"}
                            </div>
                          </div>
                          <Badge variant="outline" className="border-red-500 text-red-500">
                            {hasCapacity ? "Excede capacidad" : "Capacidad sin configurar"}
                          </Badge>
                        </div>
                        {hasCapacity ? (
                          <div className="text-xs text-muted-foreground space-y-1">
                            <div>
                              Peso: {totalPeso.toFixed(1)} / {vehicle.capacidadPeso} kg{" "}
                              <span className={utilizationColor(weightPct)}>({Math.min(weightPct, 999).toFixed(0)}%)</span>
                            </div>
                            <div>
                              Volumen: {totalVolumen.toFixed(3)} / {vehicle.capacidadVolumen} m³{" "}
                              <span className={utilizationColor(volPct)}>({Math.min(volPct, 999).toFixed(0)}%)</span>
                            </div>
                          </div>
                        ) : (
                          <p className="text-xs text-muted-foreground">
                            Este vehículo tiene capacidad de peso o volumen en 0. Configura sus capacidades para incluirlo en la comparación.
                          </p>
                        )}
                        <div className="text-[11px] text-muted-foreground border-t border-border pt-2">
                          Capacidad: {vehicle.capacidadPeso} kg · {vehicle.capacidadVolumen} m³
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="flex justify-between pt-2">
            <Button variant="ghost" onClick={() => setStep(2)} className="gap-2">
              <ArrowLeft className="w-4 h-4" /> Volver a bultos
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
