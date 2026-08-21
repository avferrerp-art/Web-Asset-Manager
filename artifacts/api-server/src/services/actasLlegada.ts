import { actasLlegadaTable, db, type ActaLlegada } from "@workspace/db";
import { eq, sql } from "drizzle-orm";

export const HORAS_RECEPCION_SIN_VALIDAR = 24;
export const TOLERANCIA_RELOJ_MINUTOS = 10;

const ISO_DATE_TIME_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:[Zz]|[+-]\d{2}:\d{2})$/;

function normalizeOptionalText(value: string | null | undefined): string | null {
  return value == null || value.trim() === "" ? null : value;
}

export function parseFechaLlegada(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const match = ISO_DATE_TIME_PATTERN.exec(value);
  if (!match) return null;

  const [, yearText, monthText, dayText, hourText, minuteText, secondText] =
    match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonth ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function isFechaLlegadaFutura(
  fechaLlegada: Date,
  now: Date = new Date(),
): boolean {
  return (
    fechaLlegada.getTime() >
    now.getTime() + TOLERANCIA_RELOJ_MINUTOS * 60_000
  );
}

export function serializeActaLlegada(acta: ActaLlegada) {
  return {
    ...acta,
    fechaLlegada: acta.fechaLlegada.toISOString(),
    confirmadaAt: acta.confirmadaAt?.toISOString() ?? null,
    createdAt: acta.createdAt.toISOString(),
  };
}

export async function getActaPorDespacho(despachoId: number) {
  const [acta] = await db
    .select()
    .from(actasLlegadaTable)
    .where(eq(actasLlegadaTable.despachoId, despachoId));
  return acta ?? null;
}

export async function registrarLlegada(
  despachoId: number,
  input: {
    fechaLlegada: Date;
    novedadesViaje?: string | null;
    registradaPorId: number | null;
  },
) {
  const fechaLlegada = input.fechaLlegada;
  const novedadesViaje = normalizeOptionalText(input.novedadesViaje);
  const [acta] = await db
    .insert(actasLlegadaTable)
    .values({
      despachoId,
      fechaLlegada,
      novedadesViaje,
      registradaPorId: input.registradaPorId,
    })
    .onConflictDoUpdate({
      target: actasLlegadaTable.despachoId,
      set: { fechaLlegada, novedadesViaje, registradaPorId: input.registradaPorId },
    })
    .returning();
  return acta;
}

export async function confirmarRecepcion(
  despachoId: number,
  input: {
    recibidoPor?: string | null;
    novedadesRecepcion?: string | null;
    confirmadaPorId: number | null;
  },
) {
  const update = {
    confirmadaAt: sql<Date>`COALESCE(${actasLlegadaTable.confirmadaAt}, NOW())`,
    confirmadaPorId: sql<number | null>`CASE
      WHEN ${actasLlegadaTable.confirmadaAt} IS NULL
        THEN ${input.confirmadaPorId}::integer
      ELSE ${actasLlegadaTable.confirmadaPorId}
    END`,
    recibidoPor: undefined as string | null | undefined,
    novedadesRecepcion: undefined as string | null | undefined,
  };
  if ("recibidoPor" in input) {
    update.recibidoPor = normalizeOptionalText(input.recibidoPor);
  }
  if ("novedadesRecepcion" in input) {
    update.novedadesRecepcion = normalizeOptionalText(input.novedadesRecepcion);
  }
  const [acta] = await db
    .update(actasLlegadaTable)
    .set(update)
    .where(eq(actasLlegadaTable.despachoId, despachoId))
    .returning();
  return acta ?? null;
}