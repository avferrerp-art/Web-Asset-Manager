import React, { useEffect, useRef, useState } from "react";
import {
  useListSales, getListSalesQueryKey,
  useListVehicles, getListVehiclesQueryKey,
  useListSaleItems, getListSaleItemsQueryKey,
  useCreateSaleItem,
  useUpdateSaleItem,
  useDeleteSaleItem,
} from "@workspace/api-client-react";
import type { SaleItem, SaleItemInput, Vehicle, Sale } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  CheckCircle2, ChevronRight, ChevronLeft, Package, ClipboardList, Truck,
  Plus, Trash2, Edit2, Check, X, Download,
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
  { label: "Bultos", icon: Package },
  { label: "Flota", icon: Truck },
];

interface ItemRow {
  id?: number;
  descripcion: string;
  cantidad: number;
  pesoUnitario: number;
  largo: number;
  ancho: number;
  alto: number;
  editing?: boolean;
}

function newBlankRow(): ItemRow {
  return { descripcion: "", cantidad: 1, pesoUnitario: 0, largo: 0, ancho: 0, alto: 0, editing: true };
}

function volM3(item: ItemRow) {
  return (item.largo * item.ancho * item.alto) / 1_000_000;
}

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

export function CargoWizard({ open, onClose, initialSaleId, initialSale, onVehicleAssigned }: Props) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [step, setStep] = useState(initialSaleId ? 2 : 1);
  const [selectedSaleId, setSelectedSaleId] = useState<number | null>(initialSaleId ?? null);
  const [editingRow, setEditingRow] = useState<ItemRow | null>(null);
  const [addingNew, setAddingNew] = useState(false);
  const [newRow, setNewRow] = useState<ItemRow>(newBlankRow());

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

  const createItem = useCreateSaleItem();
  const updateItem = useUpdateSaleItem();
  const deleteItem = useDeleteSaleItem();

  const pendingSales = salesData?.filter(s => s.estado === "pendiente") ?? [];

  const totalPeso = (saleItems ?? []).reduce((s, it) => s + it.cantidad * it.pesoUnitario, 0);
  const totalVol = (saleItems ?? []).reduce((s, it) => s + it.cantidad * volM3(it), 0);

  function invalidateItems() {
    if (selectedSaleId) {
      queryClient.removeQueries({ queryKey: getListSaleItemsQueryKey(selectedSaleId) });
      queryClient.invalidateQueries({ queryKey: getListSaleItemsQueryKey(selectedSaleId) });
    }
    queryClient.removeQueries({ queryKey: getListSalesQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListSalesQueryKey() });
  }

  function handleClose() {
    onClose();
    setTimeout(() => {
      setStep(initialSaleId ? 2 : 1);
      setSelectedSaleId(initialSaleId ?? null);
      setEditingRow(null);
      setAddingNew(false);
      setNewRow(newBlankRow());
    }, 300);
  }

  function handleImportTotals() {
    if (!selectedSale || !selectedSaleId) return;
    const volCm3 = selectedSale.volumenTotal * 1_000_000;
    const side = Math.cbrt(volCm3);
    const input: SaleItemInput = {
      descripcion: "Carga general (importado)",
      cantidad: 1,
      pesoUnitario: selectedSale.pesoTotal,
      largo: parseFloat(side.toFixed(1)),
      ancho: parseFloat(side.toFixed(1)),
      alto: parseFloat(side.toFixed(1)),
    };
    createItem.mutate({ saleId: selectedSaleId, data: input }, {
      onSuccess: () => {
        invalidateItems();
        toast({ title: "Totales importados como fila genérica" });
      },
    });
  }

  function handleSaveNewRow() {
    if (!selectedSaleId || !newRow.descripcion) return;
    createItem.mutate(
      { saleId: selectedSaleId, data: { ...newRow } },
      {
        onSuccess: () => {
          invalidateItems();
          setAddingNew(false);
          setNewRow(newBlankRow());
        },
        onError: () => toast({ title: "Error al guardar el bulto", variant: "destructive" }),
      }
    );
  }

  function handleSaveEdit() {
    if (!editingRow?.id) return;
    updateItem.mutate(
      { itemId: editingRow.id, data: { ...editingRow } },
      {
        onSuccess: () => {
          invalidateItems();
          setEditingRow(null);
        },
        onError: () => toast({ title: "Error al actualizar el bulto", variant: "destructive" }),
      }
    );
  }

  function handleDelete(id: number) {
    deleteItem.mutate(
      { itemId: id },
      {
        onSuccess: () => invalidateItems(),
        onError: () => toast({ title: "Error al eliminar el bulto", variant: "destructive" }),
      }
    );
  }

  const rankedVehicles: Array<{
    vehicle: Vehicle;
    weightPct: number;
    volPct: number;
    maxPct: number;
    canFit: boolean;
  }> = (vehicles ?? [])
    .map(v => {
      const weightPct = v.capacidadPeso > 0 ? (totalPeso / v.capacidadPeso) * 100 : Infinity;
      const volPct = v.capacidadVolumen > 0 ? (totalVol / v.capacidadVolumen) * 100 : Infinity;
      return {
        vehicle: v,
        weightPct,
        volPct,
        maxPct: Math.max(weightPct, volPct),
        canFit: weightPct <= 100 && volPct <= 100,
      };
    })
    .sort((a, b) => a.maxPct - b.maxPct);

  const isPending = createItem.isPending || updateItem.isPending || deleteItem.isPending;

  return (
    <Dialog open={open} onOpenChange={o => !o && handleClose()}>
      <DialogContent className="sm:max-w-[740px] max-h-[90vh] overflow-y-auto">
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
                    <div className="flex items-center justify-between gap-3 min-w-0">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${
                          selectedSaleId === sale.id ? "border-primary bg-primary" : "border-border"
                        }`}>
                          {selectedSaleId === sale.id && <div className="w-2 h-2 rounded-full bg-white" />}
                        </div>
                        <div className="min-w-0">
                          <div className="font-semibold text-sm truncate">#{sale.id} — {sale.cliente}</div>
                          <div className="text-xs text-muted-foreground truncate">
                            {sale.destino} · {sale.pesoTotal} kg · {sale.volumenTotal} m³
                          </div>
                        </div>
                      </div>
                      <Badge variant="outline" className="text-[10px] shrink-0">{sale.tipoMaterial ?? "—"}</Badge>
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

        {/* ── STEP 2: Item detail ─────────────────────────────────────────── */}
        {step === 2 && (
          <div className="space-y-4">
            {selectedSale && (
              <div className="bg-muted/60 rounded-md px-3 py-2 text-sm flex flex-wrap gap-x-4 gap-y-1">
                <span><span className="font-semibold">Cliente:</span> {selectedSale.cliente}</span>
                <span><span className="font-semibold">Destino:</span> {selectedSale.destino}</span>
                <span><span className="font-semibold">Peso actual:</span> {selectedSale.pesoTotal} kg</span>
                <span><span className="font-semibold">Volumen actual:</span> {selectedSale.volumenTotal} m³</span>
              </div>
            )}

            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">Detalle de Bultos</h3>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1 text-xs h-8"
                  onClick={handleImportTotals}
                  disabled={isPending || !selectedSale}
                >
                  <Download className="w-3 h-3" /> Importar totales actuales
                </Button>
                <Button
                  size="sm"
                  className="gap-1 text-xs h-8"
                  onClick={() => { setAddingNew(true); setNewRow(newBlankRow()); }}
                  disabled={addingNew}
                >
                  <Plus className="w-3 h-3" /> Agregar bulto
                </Button>
              </div>
            </div>

            <div className="rounded-md border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="text-xs">
                    <TableHead>Descripción</TableHead>
                    <TableHead className="text-right">Cant.</TableHead>
                    <TableHead className="text-right">Largo (cm)</TableHead>
                    <TableHead className="text-right">Ancho (cm)</TableHead>
                    <TableHead className="text-right">Alto (cm)</TableHead>
                    <TableHead className="text-right">Peso U. (kg)</TableHead>
                    <TableHead className="text-right">Vol. (m³)</TableHead>
                    <TableHead className="w-[70px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoadingItems ? (
                    <TableRow><TableCell colSpan={8} className="h-12 text-center text-sm text-muted-foreground">Cargando...</TableCell></TableRow>
                  ) : (saleItems ?? []).length === 0 && !addingNew ? (
                    <TableRow>
                      <TableCell colSpan={8} className="h-16 text-center text-sm text-muted-foreground">
                        Sin bultos. Agrega uno o importa los totales de la orden.
                      </TableCell>
                    </TableRow>
                  ) : (
                    <>
                      {(saleItems ?? []).map(item => (
                        <TableRow key={item.id} className="text-xs">
                          {editingRow?.id === item.id ? (
                            <>
                              <TableCell>
                                <Input className="h-7 text-xs" value={editingRow.descripcion}
                                  onChange={e => setEditingRow(r => r ? { ...r, descripcion: e.target.value } : r)} />
                              </TableCell>
                              <TableCell>
                                <Input className="h-7 text-xs w-16 text-right" type="number" min="1" value={editingRow.cantidad}
                                  onChange={e => setEditingRow(r => r ? { ...r, cantidad: +e.target.value } : r)} />
                              </TableCell>
                              <TableCell>
                                <Input className="h-7 text-xs w-20 text-right" type="number" min="0" value={editingRow.largo}
                                  onChange={e => setEditingRow(r => r ? { ...r, largo: +e.target.value } : r)} />
                              </TableCell>
                              <TableCell>
                                <Input className="h-7 text-xs w-20 text-right" type="number" min="0" value={editingRow.ancho}
                                  onChange={e => setEditingRow(r => r ? { ...r, ancho: +e.target.value } : r)} />
                              </TableCell>
                              <TableCell>
                                <Input className="h-7 text-xs w-20 text-right" type="number" min="0" value={editingRow.alto}
                                  onChange={e => setEditingRow(r => r ? { ...r, alto: +e.target.value } : r)} />
                              </TableCell>
                              <TableCell>
                                <Input className="h-7 text-xs w-20 text-right" type="number" min="0" value={editingRow.pesoUnitario}
                                  onChange={e => setEditingRow(r => r ? { ...r, pesoUnitario: +e.target.value } : r)} />
                              </TableCell>
                              <TableCell className="text-right text-muted-foreground">
                                {(editingRow.cantidad * volM3(editingRow)).toFixed(3)}
                              </TableCell>
                              <TableCell>
                                <div className="flex gap-1">
                                  <button onClick={handleSaveEdit} disabled={isPending}
                                    className="p-1 rounded hover:bg-green-500/10 text-green-600">
                                    <Check className="w-3.5 h-3.5" />
                                  </button>
                                  <button onClick={() => setEditingRow(null)}
                                    className="p-1 rounded hover:bg-destructive/10 text-destructive">
                                    <X className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </TableCell>
                            </>
                          ) : (
                            <>
                              <TableCell className="font-medium">{item.descripcion}</TableCell>
                              <TableCell className="text-right">{item.cantidad}</TableCell>
                              <TableCell className="text-right">{item.largo}</TableCell>
                              <TableCell className="text-right">{item.ancho}</TableCell>
                              <TableCell className="text-right">{item.alto}</TableCell>
                              <TableCell className="text-right">{item.pesoUnitario}</TableCell>
                              <TableCell className="text-right">
                                {(item.cantidad * volM3(item)).toFixed(3)}
                              </TableCell>
                              <TableCell>
                                <div className="flex gap-1">
                                  <button onClick={() => setEditingRow({ ...item })}
                                    className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground">
                                    <Edit2 className="w-3.5 h-3.5" />
                                  </button>
                                  <button onClick={() => handleDelete(item.id)} disabled={isPending}
                                    className="p-1 rounded hover:bg-destructive/10 text-destructive">
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </TableCell>
                            </>
                          )}
                        </TableRow>
                      ))}

                      {addingNew && (
                        <TableRow className="text-xs bg-primary/5">
                          <TableCell>
                            <Input className="h-7 text-xs" placeholder="Descripción" value={newRow.descripcion}
                              onChange={e => setNewRow(r => ({ ...r, descripcion: e.target.value }))} />
                          </TableCell>
                          <TableCell>
                            <Input className="h-7 text-xs w-16 text-right" type="number" min="1" value={newRow.cantidad}
                              onChange={e => setNewRow(r => ({ ...r, cantidad: +e.target.value }))} />
                          </TableCell>
                          <TableCell>
                            <Input className="h-7 text-xs w-20 text-right" type="number" min="0" value={newRow.largo}
                              onChange={e => setNewRow(r => ({ ...r, largo: +e.target.value }))} />
                          </TableCell>
                          <TableCell>
                            <Input className="h-7 text-xs w-20 text-right" type="number" min="0" value={newRow.ancho}
                              onChange={e => setNewRow(r => ({ ...r, ancho: +e.target.value }))} />
                          </TableCell>
                          <TableCell>
                            <Input className="h-7 text-xs w-20 text-right" type="number" min="0" value={newRow.alto}
                              onChange={e => setNewRow(r => ({ ...r, alto: +e.target.value }))} />
                          </TableCell>
                          <TableCell>
                            <Input className="h-7 text-xs w-20 text-right" type="number" min="0" value={newRow.pesoUnitario}
                              onChange={e => setNewRow(r => ({ ...r, pesoUnitario: +e.target.value }))} />
                          </TableCell>
                          <TableCell className="text-right text-muted-foreground">
                            {(newRow.cantidad * volM3(newRow)).toFixed(3)}
                          </TableCell>
                          <TableCell>
                            <div className="flex gap-1">
                              <button onClick={handleSaveNewRow} disabled={isPending || !newRow.descripcion}
                                className="p-1 rounded hover:bg-green-500/10 text-green-600 disabled:opacity-40">
                                <Check className="w-3.5 h-3.5" />
                              </button>
                              <button onClick={() => setAddingNew(false)}
                                className="p-1 rounded hover:bg-destructive/10 text-destructive">
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </>
                  )}
                </TableBody>
              </Table>
            </div>

            {/* Running totals */}
            {(saleItems ?? []).length > 0 && (
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-muted/50 rounded-md px-4 py-2.5 border border-border/50">
                  <div className="text-xs text-muted-foreground">Peso total calculado</div>
                  <div className="text-lg font-bold">{totalPeso.toFixed(2)} <span className="text-sm font-normal text-muted-foreground">kg</span></div>
                </div>
                <div className="bg-muted/50 rounded-md px-4 py-2.5 border border-border/50">
                  <div className="text-xs text-muted-foreground">Volumen total calculado</div>
                  <div className="text-lg font-bold">{totalVol.toFixed(4)} <span className="text-sm font-normal text-muted-foreground">m³</span></div>
                </div>
              </div>
            )}

            <div className="flex justify-between pt-2">
              {!initialSaleId && (
                <Button variant="outline" onClick={() => setStep(1)} className="gap-1">
                  <ChevronLeft className="w-4 h-4" /> Atrás
                </Button>
              )}
              <div className="flex-1" />
              <Button
                disabled={(saleItems ?? []).length === 0}
                onClick={() => setStep(3)}
                className="gap-1"
              >
                Ver Compatibilidad <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          </div>
        )}

        {/* ── STEP 3: Fleet compatibility ─────────────────────────────────── */}
        {step === 3 && (
          <div className="space-y-4">
            <div className="bg-muted/60 rounded-md px-3 py-2 text-sm flex flex-wrap gap-x-4 gap-y-1">
              <span><span className="font-semibold">Carga planificada:</span> {totalPeso.toFixed(2)} kg · {totalVol.toFixed(4)} m³</span>
              <span><span className="font-semibold">Bultos:</span> {(saleItems ?? []).length} tipo(s)</span>
            </div>

            <h3 className="text-sm font-semibold">Vehículos disponibles — ordenados por ajuste</h3>

            {rankedVehicles.length === 0 ? (
              <div className="py-8 text-center text-muted-foreground border border-dashed rounded-lg">
                Sin vehículos registrados en la flota.
              </div>
            ) : (
              <div className="space-y-3 max-h-[400px] overflow-y-auto pr-1">
                {rankedVehicles.map(({ vehicle, weightPct, volPct, maxPct, canFit }) => {
                  const wPct = Math.min(weightPct, 120);
                  const vPct = Math.min(volPct, 120);
                  return (
                    <div
                      key={vehicle.id}
                      className={`rounded-lg border p-4 space-y-3 transition-colors ${
                        canFit
                          ? "border-green-500/30 bg-green-500/5"
                          : "border-border bg-muted/20 opacity-75"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="font-semibold text-sm flex items-center gap-2">
                            <Truck className="w-4 h-4" />
                            {vehicle.modelo}
                            {vehicle.placa && <span className="text-xs font-normal text-muted-foreground">({vehicle.placa})</span>}
                          </div>
                          <div className="text-xs text-muted-foreground mt-0.5">
                            Capacidad: {vehicle.capacidadPeso} kg · {vehicle.capacidadVolumen} m³
                            {vehicle.tipo === "tercero" && " · [Tercero]"}
                          </div>
                        </div>
                        {canFit && onVehicleAssigned && selectedSaleId && (
                          <Button
                            size="sm"
                            className="shrink-0 gap-1 text-xs"
                            onClick={() => {
                              onVehicleAssigned(selectedSaleId, vehicle.id);
                              handleClose();
                            }}
                          >
                            <Check className="w-3 h-3" /> Asignar este vehículo
                          </Button>
                        )}
                        {!canFit && (
                          <Badge variant="outline" className="text-xs text-destructive border-destructive/40 shrink-0">
                            No cabe
                          </Badge>
                        )}
                      </div>

                      {/* Weight bar */}
                      <div className="space-y-1">
                        <div className="flex justify-between text-xs">
                          <span className="text-muted-foreground">Peso: {totalPeso.toFixed(1)} / {vehicle.capacidadPeso} kg</span>
                          <span className={`font-semibold ${utilLabel(weightPct)}`}>{weightPct.toFixed(0)}%</span>
                        </div>
                        <div className="h-2 bg-muted rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${utilColor(weightPct)}`}
                            style={{ width: `${Math.min(wPct, 100)}%` }}
                          />
                        </div>
                      </div>

                      {/* Volume bar */}
                      <div className="space-y-1">
                        <div className="flex justify-between text-xs">
                          <span className="text-muted-foreground">Volumen: {totalVol.toFixed(4)} / {vehicle.capacidadVolumen} m³</span>
                          <span className={`font-semibold ${utilLabel(volPct)}`}>{volPct.toFixed(0)}%</span>
                        </div>
                        <div className="h-2 bg-muted rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${utilColor(volPct)}`}
                            style={{ width: `${Math.min(vPct, 100)}%` }}
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
                <ChevronLeft className="w-4 h-4" /> Editar Bultos
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
