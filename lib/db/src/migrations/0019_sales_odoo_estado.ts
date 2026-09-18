export const name = "0019_sales_odoo_estado";

export const sql = `
  ALTER TABLE sales ADD COLUMN IF NOT EXISTS odoo_estado text;
  UPDATE sales SET odoo_estado = 'sale' WHERE odoo_estado IS NULL;
`;