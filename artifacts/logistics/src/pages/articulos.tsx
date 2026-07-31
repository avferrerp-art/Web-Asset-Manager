import React, { useState } from "react";
import {
  useListProducts, getListProductsQueryKey,
  useGetProductStats, getGetProductStatsQueryKey,
  useUpdateProduct, useSyncOdooProducts,
} from "@workspace/api-client-react";
import type { Product } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  Boxes, Search, RefreshCw, Check, ArrowLeft, Edit2,
  CheckCircle2, AlertTriangle, Loader2,
} from "lucide-react";

interface EditDraft {
  id: number;
  pesoKg: number | null;
  largoCm: number | null;
  anchoCm: number | null;
  altoCm: number | null;
}

function volumenCalculado(p: { largoCm?: number | null; anchoCm?: number | null; altoCm?: number | null }): number | null {
  if (!p.largoCm || !p.anchoCm || !p.altoCm) return null;
  return (p.largoCm * p.anchoCm * p.altoCm) / 1_000_000;
}

export default function Articulos() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [soloSinDimensiones, setSoloSinDimensiones] = useState(false);
  const [editing, setEditing] = useState<EditDraft | null>(null);

  const listParams = {
    ...(search.trim() ? { search: search.trim() } : {}),
    ...(soloSinDimensiones ? { soloSinDimensiones: true } : {}),
  };
  const { data: products, isLoading } = useListProducts(listParams, {
    query: { queryKey: getListProductsQueryKey(listParams) },
  });
  const { data: stats } = useGetProductStats({
    query: { queryKey: getGetProductStatsQueryKey() },
  });

  const updateProduct = useUpdateProduct();
  const syncProducts = useSyncOdooProducts();

  function bustCache() {
    queryClient.removeQueries({ queryKey: getListProductsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListProductsQueryKey() });
    queryClient.removeQueries({ queryKey: getGetProductStatsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetProductStatsQueryKey() });
  }

  function handleSave() {
    if (!editing) return;
    updateProduct.mutate(
      {
        id: editing.id,
        data: {
          pesoKg: editing.pesoKg,
          largoCm: editing.largoCm,
          anchoCm: editing.anchoCm,
          altoCm: editing.altoCm,
        },
      },
      {
        onSuccess: () => {
          bustCache();
          setEditing(null);
          toast({ title: "Artículo actualizado" });
        },
        onError: (err) => {
          toast({ title: "Error al guardar", description: String(err), variant: "destructive" });
        },
      },
    );
  }

  function handleSync() {
    syncProducts.mutate(undefined, {
      onSuccess: (result) => {
        bustCache();
        toast({
          title: "Sincronización completada",
          description: `${result.total} artículos procesados (${result.created} nuevos, ${result.updated} actualizados). Los datos manuales se conservaron.`,
        });
      },
      onError: (err) => {
        const msg =
          err && typeof err === "object" && "error" in err && err.error
            ? String(err.error)
            : String(err);
        toast({ title: "Error de sincronización", description: msg, variant: "destructive" });
      },
    });
  }

  const numInput = (
    value: number | null,
    onChange: (v: number | null) => void,
    placeholder: string,
    width = "w-20",
  ) => (
    <Input
      type="number"
      min={0}
      step="0.1"
      placeholder={placeholder}
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value === "" ? null : +e.target.value)}
      className={`h-7 text-xs ${width} text-right`}
    />
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Artículos</h1>
          <p className="text-muted-foreground">
            Catálogo sincronizado desde Odoo. El peso y las dimensiones medidas se guardan aquí y nunca se pierden.
          </p>
        </div>
        <Button onClick={handleSync} disabled={syncProducts.isPending} className="gap-2" data-testid="button-sync-products">
          {syncProducts.isPending
            ? <Loader2 className="w-4 h-4 animate-spin" />
            : <RefreshCw className="w-4 h-4" />}
          {syncProducts.isPending ? "Sincronizando..." : "Sincronizar con Odoo"}
        </Button>
      </div>

      {/* Stats + filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="bg-card border border-border rounded-full px-4 py-1.5 text-sm flex items-center gap-2" data-testid="text-confirmed-counter">
          <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
          <span className="font-semibold">{stats?.confirmados ?? 0} de {stats?.total ?? 0}</span>
          <span className="text-muted-foreground">artículos con dimensiones confirmadas</span>
        </div>
        <div className="relative flex-1 min-w-[220px] max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por nombre o referencia..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-9"
            data-testid="input-search-products"
          />
        </div>
        <Button
          variant={soloSinDimensiones ? "default" : "outline"}
          size="sm"
          onClick={() => setSoloSinDimensiones(v => !v)}
          className="gap-2"
          data-testid="button-filter-sin-dimensiones"
        >
          <AlertTriangle className="w-3.5 h-3.5" />
          Solo sin dimensiones
          {soloSinDimensiones && stats ? ` (${stats.pendientes})` : ""}
        </Button>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <p className="text-center text-muted-foreground py-10">Cargando artículos...</p>
          ) : (products?.length ?? 0) === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Boxes className="w-8 h-8 mx-auto mb-2 opacity-50" />
              {soloSinDimensiones
                ? "Todos los artículos tienen dimensiones confirmadas."
                : "Sin artículos. Pulsa \u201CSincronizar con Odoo\u201D para importar el catálogo."}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-muted-foreground text-left">
                    <th className="px-4 py-2 font-medium">Referencia</th>
                    <th className="px-4 py-2 font-medium">Nombre</th>
                    <th className="px-4 py-2 font-medium">Categoría</th>
                    <th className="px-4 py-2 font-medium text-right">Peso (kg)</th>
                    <th className="px-4 py-2 font-medium text-center">L × A × Al (cm)</th>
                    <th className="px-4 py-2 font-medium text-right">Vol. (m³)</th>
                    <th className="px-4 py-2 font-medium text-center">Estado</th>
                    <th className="px-4 py-2 w-[80px]"></th>
                  </tr>
                </thead>
                <tbody>
                  {products?.map((p: Product) =>
                    editing?.id === p.id ? (
                      <tr key={p.id} className="border-b border-border bg-muted/20" data-testid={`row-product-edit-${p.id}`}>
                        <td className="px-4 py-2 text-muted-foreground">{p.odooRef ?? "—"}</td>
                        <td className="px-4 py-2 font-medium">{p.nombre}</td>
                        <td className="px-4 py-2 text-muted-foreground">{p.categoria ?? "—"}</td>
                        <td className="px-2 py-1.5 text-right">
                          {numInput(editing.pesoKg, v => setEditing({ ...editing, pesoKg: v }), String(p.pesoOdoo || 0))}
                        </td>
                        <td className="px-2 py-1.5">
                          <div className="flex items-center gap-1 justify-center">
                            {numInput(editing.largoCm, v => setEditing({ ...editing, largoCm: v }), "L", "w-16")}
                            <span className="text-muted-foreground">×</span>
                            {numInput(editing.anchoCm, v => setEditing({ ...editing, anchoCm: v }), "A", "w-16")}
                            <span className="text-muted-foreground">×</span>
                            {numInput(editing.altoCm, v => setEditing({ ...editing, altoCm: v }), "Al", "w-16")}
                          </div>
                        </td>
                        <td className="px-2 py-1.5 text-right text-muted-foreground text-xs">
                          {volumenCalculado(editing)?.toFixed(4) ?? "—"}
                        </td>
                        <td className="px-2 py-1.5"></td>
                        <td className="px-2 py-1.5">
                          <div className="flex gap-1 justify-end">
                            <Button size="icon" className="h-6 w-6" onClick={handleSave} disabled={updateProduct.isPending} data-testid={`button-save-product-${p.id}`}>
                              <Check className="w-3 h-3" />
                            </Button>
                            <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setEditing(null)}>
                              <ArrowLeft className="w-3 h-3" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      <tr key={p.id} className="border-b border-border/50 hover:bg-muted/10" data-testid={`row-product-${p.id}`}>
                        <td className="px-4 py-2.5 text-muted-foreground">{p.odooRef ?? "—"}</td>
                        <td className="px-4 py-2.5 font-medium">{p.nombre}</td>
                        <td className="px-4 py-2.5 text-muted-foreground">{p.categoria ?? "—"}</td>
                        <td className="px-4 py-2.5 text-right">
                          {p.pesoKg != null
                            ? <span className="font-medium">{p.pesoKg}</span>
                            : <span className="text-muted-foreground">{p.pesoOdoo || "—"}</span>}
                        </td>
                        <td className="px-4 py-2.5 text-center text-muted-foreground">
                          {p.largoCm && p.anchoCm && p.altoCm
                            ? `${p.largoCm} × ${p.anchoCm} × ${p.altoCm}`
                            : "—"}
                        </td>
                        <td className="px-4 py-2.5 text-right text-muted-foreground">
                          {volumenCalculado(p)?.toFixed(4) ?? "—"}
                        </td>
                        <td className="px-4 py-2.5 text-center">
                          {p.dimensionesConfirmadas ? (
                            <Badge className="bg-green-500/15 text-green-500 border-green-500/30 gap-1" variant="outline">
                              <CheckCircle2 className="w-3 h-3" /> Confirmado
                            </Badge>
                          ) : (
                            <Badge className="bg-yellow-500/15 text-yellow-500 border-yellow-500/30 gap-1" variant="outline">
                              <AlertTriangle className="w-3 h-3" /> Sin medir
                            </Badge>
                          )}
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex justify-end">
                            <Button
                              variant="ghost" size="icon" className="h-7 w-7"
                              onClick={() => setEditing({
                                id: p.id,
                                pesoKg: p.pesoKg ?? null,
                                largoCm: p.largoCm ?? null,
                                anchoCm: p.anchoCm ?? null,
                                altoCm: p.altoCm ?? null,
                              })}
                              data-testid={`button-edit-product-${p.id}`}
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ),
                  )}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
