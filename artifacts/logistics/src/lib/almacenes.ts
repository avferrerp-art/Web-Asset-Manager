/**
 * Mapeo de almacén de Odoo → ciudad de origen usada en el campo `origen`
 * de las rutas de peaje.
 *
 * El código de almacén es el prefijo antes de "/" en `almacenOrigen`
 * (ej. "LEC/Existencias" → "LEC").
 *
 * Para agregar un almacén nuevo, solo hay que añadir una línea al mapa.
 */
const ALMACEN_CIUDAD: Record<string, string> = {
  CCS: "Caracas",
  LEC: "Lechería",
};

/** Código corto del almacén: "LEC/Existencias" → "LEC", "Urbin" → "Urbin" */
export function almacenCodigo(almacenOrigen?: string | null): string | null {
  if (!almacenOrigen) return null;
  return almacenOrigen.split("/")[0] || null;
}

/**
 * Ciudad de origen para un `almacenOrigen`.
 * Devuelve null (y loguea el código) si el almacén no está mapeado,
 * en cuyo caso el wizard se comporta exactamente como antes.
 */
export function almacenCiudad(almacenOrigen?: string | null): string | null {
  const codigo = almacenCodigo(almacenOrigen);
  if (!codigo) return null;
  const ciudad = ALMACEN_CIUDAD[codigo];
  if (!ciudad) {
    console.info(`[almacenes] Código de almacén sin ciudad mapeada: "${codigo}" (${almacenOrigen})`);
    return null;
  }
  return ciudad;
}

/** Comparación tolerante a acentos y mayúsculas ("Lecheria" ≈ "Lechería") */
export function ciudadCoincide(a?: string | null, b?: string | null): boolean {
  if (!a || !b) return false;
  const norm = (s: string) =>
    s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
  return norm(a) === norm(b);
}
