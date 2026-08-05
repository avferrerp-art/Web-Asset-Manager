// peso_total / volumen_total pueden ser null: "sin dato en Odoo" se representa
// con null, nunca con 0 (un cero se lee como dato real). Las columnas de
// dimensiones manuales (products.peso_kg, largo/ancho/alto, sale_items.largo…)
// quedan dormidas en la DB con sus datos — reversible a propósito.
export const name = "0005_sales_totales_nullable";
export const sql = `
ALTER TABLE sales ALTER COLUMN peso_total DROP NOT NULL;
ALTER TABLE sales ALTER COLUMN volumen_total DROP NOT NULL;
`;
