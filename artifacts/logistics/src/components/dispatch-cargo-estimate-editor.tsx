import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export interface DispatchCargoEstimateDraft {
  peso: string;
  volumen: string;
}

interface DispatchCargoEstimateEditorProps {
  pesoOdooKg: number | null;
  volumenOdooM3: number | null;
  draft: DispatchCargoEstimateDraft;
  onChange: (draft: DispatchCargoEstimateDraft) => void;
  disabled?: boolean;
  zeroMeansMissing?: boolean;
  compact?: boolean;
}

export function parsePositiveEstimate(value: string): number | null | undefined {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

export function hasOdooMeasure(
  value: number | null | undefined,
  zeroMeansMissing = false,
) {
  return value != null && (!zeroMeansMissing || value > 0);
}

export function effectiveCargoMeasure(
  odooValue: number | null | undefined,
  estimateValue: string,
  zeroMeansMissing = false,
) {
  if (hasOdooMeasure(odooValue, zeroMeansMissing)) return odooValue;
  return parsePositiveEstimate(estimateValue) ?? null;
}

export function cargoEstimateDraftValid(draft: DispatchCargoEstimateDraft) {
  return (
    parsePositiveEstimate(draft.peso) !== undefined &&
    parsePositiveEstimate(draft.volumen) !== undefined
  );
}

function EstimateField({
  label,
  unit,
  odooValue,
  estimateValue,
  onEstimateChange,
  disabled,
  zeroMeansMissing,
  testId,
}: {
  label: string;
  unit: "kg" | "m³";
  odooValue: number | null;
  estimateValue: string;
  onEstimateChange: (value: string) => void;
  disabled?: boolean;
  zeroMeansMissing: boolean;
  testId: string;
}) {
  const fromOdoo = hasOdooMeasure(odooValue, zeroMeansMissing);
  const parsedEstimate = parsePositiveEstimate(estimateValue);
  const invalid = parsedEstimate === undefined;

  return (
    <div className="space-y-1.5 rounded-md border bg-background p-3">
      <div className="flex items-center justify-between gap-2">
        <Label className="text-xs">{label}</Label>
        <Badge variant={fromOdoo ? "outline" : parsedEstimate ? "secondary" : "outline"} className="text-[10px]">
          {fromOdoo ? "Odoo" : parsedEstimate ? "Estimación del despacho" : "Sin dato"}
        </Badge>
      </div>
      {fromOdoo ? (
        <>
          <p className="font-semibold">{odooValue} {unit}</p>
          <p className="text-[11px] text-muted-foreground">
            Solo lectura. El dato de Odoo siempre tiene prioridad.
          </p>
        </>
      ) : (
        <>
          <div className="flex gap-2">
            <Input
              type="number"
              min="0.01"
              step="any"
              value={estimateValue}
              onChange={(event) => onEstimateChange(event.target.value)}
              placeholder={`Estimación en ${unit}`}
              disabled={disabled}
              data-testid={testId}
            />
            {estimateValue && (
              <Button
                type="button"
                variant="outline"
                onClick={() => onEstimateChange("")}
                disabled={disabled}
              >
                Limpiar
              </Button>
            )}
          </div>
          <p className={`text-[11px] ${invalid ? "text-destructive" : "text-muted-foreground"}`}>
            {invalid
              ? "Ingresa un valor mayor que cero o deja el campo vacío."
              : "Se guardará únicamente en este despacho."}
          </p>
        </>
      )}
    </div>
  );
}

export function DispatchCargoEstimateEditor({
  pesoOdooKg,
  volumenOdooM3,
  draft,
  onChange,
  disabled,
  zeroMeansMissing = false,
  compact = false,
}: DispatchCargoEstimateEditorProps) {
  return (
    <div className="space-y-2" data-testid="dispatch-cargo-estimate-editor">
      {!compact && (
        <div>
          <p className="text-sm font-semibold">Peso y volumen de la carga</p>
          <p className="text-xs text-muted-foreground">
            Si Odoo no tiene una medida, puedes estimarla para este despacho.
          </p>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <EstimateField
          label="Peso"
          unit="kg"
          odooValue={pesoOdooKg}
          estimateValue={draft.peso}
          onEstimateChange={(peso) => onChange({ ...draft, peso })}
          disabled={disabled}
          zeroMeansMissing={zeroMeansMissing}
          testId="input-peso-estimado-despacho"
        />
        <EstimateField
          label="Volumen"
          unit="m³"
          odooValue={volumenOdooM3}
          estimateValue={draft.volumen}
          onEstimateChange={(volumen) => onChange({ ...draft, volumen })}
          disabled={disabled}
          zeroMeansMissing={zeroMeansMissing}
          testId="input-volumen-estimado-despacho"
        />
      </div>
    </div>
  );
}