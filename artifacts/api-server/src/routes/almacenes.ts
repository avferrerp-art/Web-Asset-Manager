import { asc, eq } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { ListAlmacenesResponse } from "@workspace/api-zod";
import { almacenesTable, db } from "@workspace/db";

const router: IRouter = Router();

router.get("/almacenes", async (_req, res): Promise<void> => {
  const almacenes = await db
    .select()
    .from(almacenesTable)
    .where(eq(almacenesTable.activo, true))
    .orderBy(asc(almacenesTable.plaza), asc(almacenesTable.nombre));

  const response = ListAlmacenesResponse.parse(
    almacenes.map((almacen) => ({
      ...almacen,
      createdAt: almacen.createdAt.toISOString(),
    })),
  );
  res.json(response);
});

export default router;