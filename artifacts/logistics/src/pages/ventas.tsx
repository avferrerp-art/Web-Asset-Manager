import React, { useState, useRef } from "react";
import { useLocation } from "wouter";
import {
  useListSales, getListSalesQueryKey,
  useCreateSale, useUpdateSale, useDeleteSale,
  useListUnlinkedSaleItems, getListUnlinkedSaleItemsQueryKey
} from "@workspace/api-client-react";
import type { Sale } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus, Edit2, Trash2, Upload, Loader2, FileText, X, PackageSearch, AlertTriangle, Unlink } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { OdooBadge } from "@/components/odoo-sync-card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { CargoWizard } from "@/components/cargo-wizard";
import { SaleDetailSheet } from "@/components/sale-detail-sheet";
import { Search } from "lucide-react";
import { matchesSearch } from "@/lib/search";
import { formatCarga, sinDatoCarga } from "@/lib/carga";

const saleSchema = z.object({
  cliente: z.string().min(1, "Requerido"),
  vendedor: z.string().optional(),
  personaContacto: z.string().optional(),
  numeroCel: z.string().optional(),
  tipoMaterial: z.string().optional(),
  destino: z.string().min(1, "Requerido"),
  // Vacío = sin dato (null); nunca representar sin-dato con 0
  pesoTotal: z.union([z.literal(""), z.coerce.number().min(0)]).optional(),
  volumenTotal: z.union([z.literal(""), z.coerce.number().min(0)]).optional(),
  estado: z.string().default("pendiente"),
  notas: z.string().optional()
});

const ESTADO_BADGE: Record<string, React.ReactElement> = {
  pendiente:  <Badge variant="outline" className="text-orange-500 border-orange-500/50">Pendiente</Badge>,
  despachado: <Badge variant="outline" className="text-blue-500 border-blue-500/50">Despachado</Badge>,
  entregado:  <Badge variant="outline" className="text-green-500 border-green-500/50">Entregado</Badge>,
  cancelado:  <Badge variant="outline" className="text-red-500 border-red-500/50">Cancelado</Badge>,
};

const FILTERS = [
  { key: "todas",      label: "Todas" },
  { key: "pendiente",  label: "Pendiente" },
  { key: "despachado", label: "Despachado" },
  { key: "entregado",  label: "Entregado" },
  { key: "cancelado",  label: "Cancelado" },
] as const;

type FilterKey = (typeof FILTERS)[number]["key"];

/* Estado de entrega (Odoo) — mismos colores que el detalle */
const ENTREGA_BADGE: Record<string, React.ReactElement> = {
  sin_albaran: <Badge variant="outline" className="text-muted-foreground border-muted-foreground/40">Sin albarán</Badge>,
  pendiente:   <Badge variant="outline" className="text-orange-500 border-orange-500/50">Pendiente</Badge>,
  parcial:     <Badge variant="outline" className="text-amber-500 border-amber-500/50">Parcial</Badge>,
  entregado:   <Badge variant="outline" className="text-green-500 border-green-500/50">Entregado</Badge>,
  cancelado:   <Badge variant="outline" className="text-red-500 border-red-500/50">Cancelado</Badge>,
};

const ENTREGA_FILTERS = [
  { key: "todas",       label: "Todas" },
  { key: "sin_albaran", label: "Sin albarán" },
  { key: "pendiente",   label: "Pendiente" },
  { key: "parcial",     label: "Parcial" },
  { key: "entregado",   label: "Entregado" },
  { key: "cancelado",   label: "Cancelado" },
  { key: "accion",      label: "Requieren acción" },
] as const;

type EntregaFilterKey = (typeof ENTREGA_FILTERS)[number]["key"];

const ACCION_STATES = new Set(["pendiente", "parcial", "sin_albaran"]);

function matchesEntregaFilter(estadoEntrega: string, filter: EntregaFilterKey): boolean {
  if (filter === "todas") return true;
  if (filter === "accion") return ACCION_STATES.has(estadoEntrega);
  return estadoEntrega === filter;
}

/** Código corto del almacén: "LEC/Existencias" → "LEC", "Urbin" → "Urbin" */
function almacenCodigo(almacenOrigen?: string | null): string | null {
  if (!almacenOrigen) return null;
  return almacenOrigen.split("/")[0] || null;
}

export default function Ventas() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [activeFilter, setActiveFilter] = useState<FilterKey>("todas");
  const [entregaFilter, setEntregaFilter] = useState<EntregaFilterKey>("todas");
  const [search, setSearch] = useState("");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingSale, setEditingSale] = useState<any>(null);
  const [, navigate] = useLocation();
  const [cargoWizardOpen, setCargoWizardOpen] = useState(false);
  const [cargoWizardSaleId, setCargoWizardSaleId] = useState<number | undefined>();
  const [cargoWizardSale, setCargoWizardSale] = useState<any>(null);
  const [isExtracting, setIsExtracting] = useState(false);
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);
  const [extractError, setExtractError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedSale, setSelectedSale] = useState<Sale | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const { data: sales, isLoading } = useListSales(undefined, {
    query: { queryKey: getListSalesQueryKey() }
  });

  const { data: unlinkedItems } = useListUnlinkedSaleItems({
    query: { queryKey: getListUnlinkedSaleItemsQueryKey() }
  });
  const salesWithUnlinked = new Set((unlinkedItems ?? []).map(it => it.ventaId));

  const statusFiltered = activeFilter === "todas"
    ? (sales ?? [])
    : (sales ?? []).filter(s => s.estado === activeFilter);

  const entregaFiltered = statusFiltered.filter(s =>
    matchesEntregaFilter(s.estadoEntrega, entregaFilter));

  const filteredSales = search.trim()
    ? entregaFiltered.filter(s =>
        matchesSearch(search, [s.cliente, s.destino, s.odooRef, s.id, `#${s.id}`, ...(s.albaranNombres ?? [])]))
    : entregaFiltered;

  const countByStatus = (key: string) =>
    key === "todas" ? (sales?.length ?? 0) : (sales?.filter(s => s.estado === key).length ?? 0);

  const countByEntrega = (key: EntregaFilterKey) =>
    (sales ?? []).filter(s => matchesEntregaFilter(s.estadoEntrega, key)).length;

  // Discrepancias:
  // - masiva y esperada: pendiente en LogiFleet pero ya entregado en Odoo → tratamiento discreto (contador arriba + fila atenuada)
  // - rara y grave: despachado en LogiFleet pero Odoo NO lo registra entregado → ícono de advertencia por fila
  const isEntregadoSinDespacho = (s: Sale) => s.estado === "pendiente" && s.estadoEntrega === "entregado";
  const isDespachadoNoEntregado = (s: Sale) => s.estado === "despachado" && s.estadoEntrega !== "entregado";
  const entregadoSinDespachoCount = (sales ?? []).filter(isEntregadoSinDespacho).length;

  const createMutation = useCreateSale();
  const updateMutation = useUpdateSale();
  const deleteMutation = useDeleteSale();

  const form = useForm<z.infer<typeof saleSchema>>({
    resolver: zodResolver(saleSchema),
    defaultValues: {
      cliente: "",
      vendedor: "",
      personaContacto: "",
      numeroCel: "",
      tipoMaterial: "",
      destino: "",
      pesoTotal: "",
      volumenTotal: "",
      estado: "pendiente",
      notas: ""
    }
  });

  const handleFileUpload = async (file: File) => {
    setIsExtracting(true);
    setExtractError(null);
    setUploadedFileName(file.name);

    const formData = new FormData();
    formData.append("file", file);

    try {
      const response = await fetch("/api/orders/extract", {
        method: "POST",
        body: formData,
      });

      const data = await response.json();

      if (!response.ok) {
        setExtractError(data.error ?? "Error al procesar el documento.");
        return;
      }

      // Pre-fill form with extracted data (only if the field has a value)
      if (data.cliente) form.setValue("cliente", data.cliente);
      if (data.vendedor) form.setValue("vendedor", data.vendedor);
      if (data.destino) form.setValue("destino", data.destino);
      if (data.tipoMaterial) form.setValue("tipoMaterial", data.tipoMaterial);

      // Build notes from order reference + delivery date
      const notasParts: string[] = [];
      if (data.notas) notasParts.push(data.notas);
      if (data.fechaEntrega) notasParts.push(`Entrega: ${data.fechaEntrega}`);
      if (notasParts.length > 0) form.setValue("notas", notasParts.join(" | "));

      toast({ title: "Orden procesada correctamente", description: "Los campos han sido completados automáticamente." });
    } catch {
      setExtractError("Error de conexión al procesar el archivo.");
    } finally {
      setIsExtracting(false);
    }
  };

  const onSubmit = (values: z.infer<typeof saleSchema>) => {
    // Campo vacío = sin dato → null (nunca 0)
    const data = {
      ...values,
      pesoTotal: values.pesoTotal === "" || values.pesoTotal == null ? null : values.pesoTotal,
      volumenTotal: values.volumenTotal === "" || values.volumenTotal == null ? null : values.volumenTotal,
    };
    if (editingSale) {
      updateMutation.mutate({ id: editingSale.id, data }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListSalesQueryKey() });
          setIsDialogOpen(false);
          toast({ title: "Orden de venta actualizada correctamente" });
        }
      });
    } else {
      createMutation.mutate({ data }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListSalesQueryKey() });
          setIsDialogOpen(false);
          toast({ title: "Orden de venta creada correctamente" });
        }
      });
    }
  };

  const handleEdit = (sale: any) => {
    setEditingSale(sale);
    setUploadedFileName(null);
    setExtractError(null);
    form.reset({
      cliente: sale.cliente,
      vendedor: sale.vendedor || "",
      personaContacto: sale.personaContacto || "",
      numeroCel: sale.numeroCel || "",
      tipoMaterial: sale.tipoMaterial || "",
      destino: sale.destino,
      pesoTotal: sale.pesoTotal ?? "",
      volumenTotal: sale.volumenTotal ?? "",
      estado: sale.estado,
      notas: sale.notas || ""
    });
    setIsDialogOpen(true);
  };

  const handleDelete = (id: number) => {
    if (confirm("¿Deseas eliminar esta orden de venta?")) {
      deleteMutation.mutate({ id }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListSalesQueryKey() });
          toast({ title: "Orden de venta eliminada" });
        }
      });
    }
  };

  const handleDialogClose = (open: boolean) => {
    setIsDialogOpen(open);
    if (!open) {
      setEditingSale(null);
      setUploadedFileName(null);
      setExtractError(null);
      form.reset();
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  return (
    <div className="space-y-6">
      <SaleDetailSheet
        sale={selectedSale}
        open={detailOpen}
        onOpenChange={setDetailOpen}
      />
      <CargoWizard
        open={cargoWizardOpen}
        onClose={() => { setCargoWizardOpen(false); setCargoWizardSaleId(undefined); setCargoWizardSale(null); }}
        initialSaleId={cargoWizardSaleId}
        initialSale={cargoWizardSale}
        onVehicleAssigned={(saleId, vehicleId) => {
          try {
            sessionStorage.setItem("pendingDispatch", JSON.stringify({ saleId, vehicleId }));
          } catch {}
          navigate("/pre-despacho");
        }}
      />
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Órdenes de Venta</h1>
          <p className="text-muted-foreground">Gestión de solicitudes de entrega.</p>
        </div>
        <Dialog open={isDialogOpen} onOpenChange={handleDialogClose}>
          <DialogTrigger asChild>
            <Button data-testid="button-add-sale" className="gap-2">
              <Plus className="w-4 h-4" /> Nueva Orden
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[580px] max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editingSale ? "Editar Orden" : "Nueva Orden"}</DialogTitle>
            </DialogHeader>

            {/* PDF Upload Section (only for new orders) */}
            {!editingSale && (
              <div className="space-y-2">
                <div
                  className={`border-2 border-dashed rounded-lg p-4 transition-colors cursor-pointer hover:bg-muted/30 ${
                    isExtracting ? "opacity-60 pointer-events-none" : "border-muted-foreground/30 hover:border-primary/50"
                  }`}
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    const file = e.dataTransfer.files[0];
                    if (file) handleFileUpload(file);
                  }}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleFileUpload(file);
                    }}
                  />
                  <div className="flex flex-col items-center gap-2 text-center">
                    {isExtracting ? (
                      <>
                        <Loader2 className="w-8 h-8 text-primary animate-spin" />
                        <p className="text-sm font-medium text-foreground">Procesando orden con IA...</p>
                        <p className="text-xs text-muted-foreground">Extrayendo datos del documento</p>
                      </>
                    ) : uploadedFileName ? (
                      <>
                        <FileText className="w-8 h-8 text-green-500" />
                        <p className="text-sm font-medium text-foreground">{uploadedFileName}</p>
                        <p className="text-xs text-muted-foreground">Haz clic para reemplazar</p>
                      </>
                    ) : (
                      <>
                        <Upload className="w-8 h-8 text-muted-foreground" />
                        <p className="text-sm font-medium text-foreground">Cargar orden PDF</p>
                        <p className="text-xs text-muted-foreground">
                          Arrastra un PDF o haz clic para seleccionar · Los campos se pre-llenarán automáticamente
                        </p>
                      </>
                    )}
                  </div>
                </div>

                {extractError && (
                  <Alert variant="destructive" className="py-2">
                    <AlertDescription className="flex items-center justify-between">
                      <span className="text-sm">{extractError}</span>
                      <button onClick={() => setExtractError(null)}><X className="w-4 h-4" /></button>
                    </AlertDescription>
                  </Alert>
                )}

                {uploadedFileName && !isExtracting && !extractError && (
                  <p className="text-xs text-green-600 text-center">
                    ✓ Datos extraídos. Revisa y completa los campos manuales (peso, volumen, contacto).
                  </p>
                )}
              </div>
            )}

            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">

                {/* Nro de Orden (solo visible al editar, de solo lectura) */}
                {editingSale && (
                  <div className="space-y-1">
                    <label className="text-sm font-medium leading-none">Nro de Orden</label>
                    <Input value={`#${editingSale.id}`} readOnly className="bg-muted text-muted-foreground cursor-not-allowed" />
                  </div>
                )}

                {/* Vendedor */}
                <FormField control={form.control} name="vendedor" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Vendedor</FormLabel>
                    <FormControl><Input data-testid="input-vendedor" placeholder="Nombre del vendedor" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                {/* Cliente */}
                <FormField control={form.control} name="cliente" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Cliente</FormLabel>
                    <FormControl><Input data-testid="input-cliente" placeholder="Nombre del cliente o empresa" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                {/* Persona Contacto + Número Cel */}
                <div className="grid grid-cols-2 gap-4">
                  <FormField control={form.control} name="personaContacto" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Persona de Contacto</FormLabel>
                      <FormControl><Input data-testid="input-contacto" placeholder="Nombre del contacto" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="numeroCel" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Número Celular</FormLabel>
                      <FormControl><Input data-testid="input-cel" placeholder="+52 55 0000 0000" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>

                {/* Destino */}
                <FormField control={form.control} name="destino" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Destino</FormLabel>
                    <FormControl><Input data-testid="input-destino" placeholder="Ciudad o dirección de entrega" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                {/* Tipo de Material */}
                <FormField control={form.control} name="tipoMaterial" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Tipo de Material</FormLabel>
                    <FormControl><Input data-testid="input-material" placeholder="Ej. Cajas NAP, Bobinas, Pallets..." {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                {/* Peso + Volumen */}
                <div className="grid grid-cols-2 gap-4">
                  <FormField control={form.control} name="pesoTotal" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Peso Total (kg)</FormLabel>
                      <FormControl><Input data-testid="input-peso" type="number" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="volumenTotal" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Volumen Total (m³)</FormLabel>
                      <FormControl><Input data-testid="input-volumen" type="number" step="0.01" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>

                {/* Estado (solo al editar) */}
                {editingSale && (
                  <FormField control={form.control} name="estado" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Estado</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-estado"><SelectValue placeholder="Seleccionar estado" /></SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="pendiente">Pendiente</SelectItem>
                          <SelectItem value="despachado">Despachado</SelectItem>
                          <SelectItem value="entregado">Entregado</SelectItem>
                          <SelectItem value="cancelado">Cancelado</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />
                )}

                {/* Notas */}
                <FormField control={form.control} name="notas" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Notas</FormLabel>
                    <FormControl><Input data-testid="input-notas" placeholder="Instrucciones especiales, urgencia, etc." {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                <div className="flex justify-end pt-2">
                  <Button data-testid="button-submit-sale" type="submit" disabled={createMutation.isPending || updateMutation.isPending || isExtracting}>
                    {editingSale ? "Actualizar" : "Crear"}
                  </Button>
                </div>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="relative flex-1 min-w-[220px] max-w-sm">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Buscar por cliente, destino, referencia, #orden o albarán..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-8 h-9"
          data-testid="input-search-sales"
        />
      </div>

      {/* Status filter pills (despacho) */}
      <div className="flex flex-wrap gap-2 items-center">
        <span className="text-xs font-medium text-muted-foreground w-[64px]">Despacho</span>
        {FILTERS.map(({ key, label }) => {
          const count = countByStatus(key);
          const isActive = activeFilter === key;
          const colorMap: Record<string, string> = {
            pendiente:  "data-[active=true]:bg-orange-500/20 data-[active=true]:border-orange-500 data-[active=true]:text-orange-400",
            despachado: "data-[active=true]:bg-blue-500/20 data-[active=true]:border-blue-500 data-[active=true]:text-blue-400",
            entregado:  "data-[active=true]:bg-green-500/20 data-[active=true]:border-green-500 data-[active=true]:text-green-400",
            cancelado:  "data-[active=true]:bg-red-500/20 data-[active=true]:border-red-500 data-[active=true]:text-red-400",
          };
          return (
            <button
              key={key}
              data-testid={`filter-${key}`}
              data-active={isActive}
              onClick={() => setActiveFilter(key)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-full border text-sm font-medium transition-colors
                ${isActive
                  ? `border-primary bg-primary/20 text-primary ${colorMap[key] ?? ""}`
                  : "border-border bg-card text-muted-foreground hover:bg-accent/30 hover:text-foreground"}
              `}
            >
              {label}
              {!isLoading && (
                <span className={`text-[11px] rounded-full px-1.5 py-0.5 font-bold min-w-[20px] text-center
                  ${isActive ? "bg-primary/30" : "bg-muted"}`}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Entrega (Odoo) filter pills */}
      <div className="flex flex-wrap gap-2 items-center">
        <span className="text-xs font-medium text-muted-foreground w-[64px]">Entrega</span>
        {ENTREGA_FILTERS.map(({ key, label }) => {
          const count = countByEntrega(key);
          const isActive = entregaFilter === key;
          const colorMap: Record<string, string> = {
            sin_albaran: "data-[active=true]:bg-muted data-[active=true]:border-muted-foreground data-[active=true]:text-foreground",
            pendiente:   "data-[active=true]:bg-orange-500/20 data-[active=true]:border-orange-500 data-[active=true]:text-orange-400",
            parcial:     "data-[active=true]:bg-amber-500/20 data-[active=true]:border-amber-500 data-[active=true]:text-amber-400",
            entregado:   "data-[active=true]:bg-green-500/20 data-[active=true]:border-green-500 data-[active=true]:text-green-400",
            cancelado:   "data-[active=true]:bg-red-500/20 data-[active=true]:border-red-500 data-[active=true]:text-red-400",
            accion:      "data-[active=true]:bg-amber-500/20 data-[active=true]:border-amber-500 data-[active=true]:text-amber-400",
          };
          return (
            <button
              key={key}
              data-testid={`filter-entrega-${key}`}
              data-active={isActive}
              onClick={() => setEntregaFilter(key)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-full border text-sm font-medium transition-colors
                ${key === "accion" ? "border-dashed" : ""}
                ${isActive
                  ? `border-primary bg-primary/20 text-primary ${colorMap[key] ?? ""}`
                  : "border-border bg-card text-muted-foreground hover:bg-accent/30 hover:text-foreground"}
              `}
            >
              {key === "accion" && <AlertTriangle className="w-3.5 h-3.5" />}
              {label}
              {!isLoading && (
                <span className={`text-[11px] rounded-full px-1.5 py-0.5 font-bold min-w-[20px] text-center
                  ${isActive ? "bg-primary/30" : "bg-muted"}`}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Discrepancia masiva (discreta): entregado en Odoo sin despacho en LogiFleet */}
      {!isLoading && entregadoSinDespachoCount > 0 && (
        <p className="text-xs text-muted-foreground" data-testid="text-entregado-sin-despacho">
          {entregadoSinDespachoCount} ventas ya entregadas en Odoo sin despacho registrado en LogiFleet (filas atenuadas).
        </p>
      )}

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ID</TableHead>
                <TableHead>Cliente / Contacto</TableHead>
                <TableHead>Destino / Material</TableHead>
                <TableHead>Carga</TableHead>
                <TableHead>Despacho</TableHead>
                <TableHead>Entrega</TableHead>
                <TableHead className="w-[160px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={7} className="h-24 text-center">Cargando...</TableCell></TableRow>
              ) : filteredSales.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                  {search.trim()
                    ? `Sin resultados para "${search.trim()}"`
                    : activeFilter === "todas" ? "Sin órdenes registradas." : `Sin órdenes con estado "${activeFilter}".`}
                </TableCell></TableRow>
              ) : filteredSales.map((sale) => (
                <TableRow
                  key={sale.id}
                  data-testid={`row-sale-${sale.id}`}
                  className={`cursor-pointer hover:bg-accent/40 ${isEntregadoSinDespacho(sale) ? "opacity-60" : ""}`}
                  onClick={() => { setSelectedSale(sale); setDetailOpen(true); }}
                >
                  <TableCell className="font-medium">
                    #{sale.id}
                    <OdooBadge odooRef={sale.odooRef} />
                  </TableCell>
                  <TableCell>
                    <div className="font-medium">{sale.cliente}</div>
                    {sale.personaContacto && (
                      <div className="text-xs text-muted-foreground">{sale.personaContacto}{sale.numeroCel ? ` · ${sale.numeroCel}` : ""}</div>
                    )}
                    {sale.vendedor && (
                      <div className="text-xs text-muted-foreground/70">Vend: {sale.vendedor}</div>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="text-sm">{sale.destino}</div>
                    {sale.tipoMaterial && (
                      <div className="text-xs text-muted-foreground">{sale.tipoMaterial}</div>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="text-sm" data-testid={`text-peso-${sale.id}`}>
                      {sinDatoCarga(sale.pesoTotal)
                        ? <span className="text-muted-foreground italic text-xs">sin dato en Odoo</span>
                        : formatCarga(sale.pesoTotal, "kg")}
                    </div>
                    <div className="text-sm text-muted-foreground" data-testid={`text-volumen-${sale.id}`}>
                      {sinDatoCarga(sale.volumenTotal)
                        ? <span className="italic text-xs">sin dato en Odoo</span>
                        : formatCarga(sale.volumenTotal, "m³")}
                    </div>
                    {salesWithUnlinked.has(sale.id) && (
                      <Badge
                        variant="outline"
                        className="mt-1 text-purple-500 border-purple-500/50 bg-purple-500/10 text-[10px] gap-1"
                        data-testid={`badge-sin-vincular-${sale.id}`}
                      >
                        <Unlink className="w-3 h-3" /> Partidas sin vincular
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>{ESTADO_BADGE[sale.estado] ?? <Badge>{sale.estado}</Badge>}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      {ENTREGA_BADGE[sale.estadoEntrega] ?? <Badge variant="outline">{sale.estadoEntrega}</Badge>}
                      {isDespachadoNoEntregado(sale) && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span data-testid={`icon-discrepancia-${sale.id}`}>
                              <AlertTriangle className="w-4 h-4 text-red-500" />
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>
                            Despachado en LogiFleet, pero Odoo aún no lo registra como entregado.
                          </TooltipContent>
                        </Tooltip>
                      )}
                      {sale.almacenesMultiples && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span data-testid={`icon-multialmacen-${sale.id}`}>
                              <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>
                            Esta orden tuvo movimientos en más de un almacén.
                          </TooltipContent>
                        </Tooltip>
                      )}
                    </div>
                    {almacenCodigo(sale.almacenOrigen) && (
                      <div className="text-[10px] text-muted-foreground mt-0.5">{almacenCodigo(sale.almacenOrigen)}</div>
                    )}
                  </TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <div className="flex justify-end gap-1">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            data-testid={`button-cargo-plan-${sale.id}`}
                            variant="ghost"
                            size="sm"
                            className="gap-1 text-xs px-2"
                            onClick={(e) => { e.stopPropagation(); setCargoWizardSaleId(sale.id); setCargoWizardSale(sale); setCargoWizardOpen(true); }}
                          >
                            <PackageSearch className="w-3.5 h-3.5" /> Planificar
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          Abre el plan de carga y continúa en Pre-Despacho para crear el despacho
                        </TooltipContent>
                      </Tooltip>
                      <Button data-testid={`button-edit-sale-${sale.id}`} variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); handleEdit(sale); }}>
                        <Edit2 className="w-4 h-4" />
                      </Button>
                      <Button data-testid={`button-delete-sale-${sale.id}`} variant="ghost" size="icon" className="text-destructive" onClick={(e) => { e.stopPropagation(); handleDelete(sale.id); }}>
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
