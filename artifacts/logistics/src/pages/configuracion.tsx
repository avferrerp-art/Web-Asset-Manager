import React, { useState } from "react";
import {
  useListFuelPrices,
  getListFuelPricesQueryKey,
  useUpdateFuelPrice,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Fuel, Pencil, X, Check } from "lucide-react";

const FUEL_LABELS: Record<string, string> = {
  gasolina: "Gasolina",
  diesel: "Diésel",
  gas: "Gas (GNV)",
};

const FUEL_ORDER = ["gasolina", "diesel", "gas"];
const DEFAULT_PRICE = 1.5;

export default function Configuracion() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: fuelPrices, isLoading } = useListFuelPrices({
    query: { queryKey: getListFuelPricesQueryKey() },
  });

  const updateFuelPrice = useUpdateFuelPrice();

  const [editing, setEditing] = useState<string | null>(null);
  const [editValue, setEditValue] = useState<string>("");

  function startEdit(tipo: string, current: number) {
    setEditing(tipo);
    setEditValue(current.toFixed(4));
  }

  function cancelEdit() {
    setEditing(null);
    setEditValue("");
  }

  function saveEdit(tipo: string) {
    const val = parseFloat(editValue);
    if (isNaN(val) || val <= 0) {
      toast({ title: "Precio inválido. Ingresa un número positivo.", variant: "destructive" });
      return;
    }
    updateFuelPrice.mutate(
      { tipoCombustible: tipo, data: { precioPorLitro: val } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListFuelPricesQueryKey() });
          toast({ title: `Precio de ${FUEL_LABELS[tipo] ?? tipo} actualizado correctamente.` });
          setEditing(null);
          setEditValue("");
        },
        onError: () => {
          toast({ title: "Error al guardar el precio.", variant: "destructive" });
        },
      }
    );
  }

  const allRows = FUEL_ORDER.map((tipo) => {
    const found = fuelPrices?.find((p) => p.tipoCombustible === tipo);
    return {
      tipoCombustible: tipo,
      precioPorLitro: found?.precioPorLitro ?? DEFAULT_PRICE,
      updatedAt: found?.updatedAt ?? null,
    };
  });

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Configuración</h1>
        <p className="text-muted-foreground">Parámetros del sistema. Los cambios aplican de inmediato en todos los cálculos de costos.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Fuel className="w-5 h-5 text-primary" />
            Precios de Combustible
          </CardTitle>
          <CardDescription>
            Precio por litro según tipo de combustible. Estos valores se usan para estimar los costos de combustible en despachos.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-14 bg-muted animate-pulse rounded-md" />
              ))}
            </div>
          ) : (
            <div className="space-y-3">
              {allRows.map((price) => {
                const isEditing = editing === price.tipoCombustible;
                return (
                  <div
                    key={price.tipoCombustible}
                    className="flex items-center justify-between gap-4 p-3 rounded-lg border border-border bg-card"
                  >
                    <div className="min-w-0">
                      <div className="font-medium text-sm">{FUEL_LABELS[price.tipoCombustible] ?? price.tipoCombustible}</div>
                      <div className="text-xs text-muted-foreground capitalize">{price.tipoCombustible}</div>
                    </div>

                    {isEditing ? (
                      <div className="flex items-center gap-2 flex-1 max-w-[240px]">
                        <div className="relative flex-1">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                          <Input
                            data-testid={`input-price-${price.tipoCombustible}`}
                            type="number"
                            step="0.0001"
                            min="0"
                            className="pl-7 h-8 text-sm"
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") saveEdit(price.tipoCombustible);
                              if (e.key === "Escape") cancelEdit();
                            }}
                            autoFocus
                          />
                        </div>
                        <span className="text-xs text-muted-foreground shrink-0">/L</span>
                        <Button
                          data-testid={`btn-save-${price.tipoCombustible}`}
                          size="icon"
                          variant="default"
                          className="h-8 w-8 shrink-0"
                          onClick={() => saveEdit(price.tipoCombustible)}
                          disabled={updateFuelPrice.isPending}
                        >
                          <Check className="w-4 h-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 shrink-0"
                          onClick={cancelEdit}
                        >
                          <X className="w-4 h-4" />
                        </Button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-3">
                        <span className="font-bold text-lg tabular-nums" data-testid={`price-display-${price.tipoCombustible}`}>
                          ${price.precioPorLitro.toFixed(4)}<span className="text-sm font-normal text-muted-foreground">/L</span>
                        </span>
                        <Button
                          data-testid={`btn-edit-${price.tipoCombustible}`}
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8"
                          onClick={() => startEdit(price.tipoCombustible, price.precioPorLitro)}
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
