export function exceedsDispatchCapacity(
  capacidad: { capacidadPeso: number; capacidadVolumen: number },
  carga: { pesoKg: number | null; volumenM3: number | null },
) {
  return (
    (carga.pesoKg !== null && capacidad.capacidadPeso < carga.pesoKg) ||
    (carga.volumenM3 !== null && capacidad.capacidadVolumen < carga.volumenM3)
  );
}