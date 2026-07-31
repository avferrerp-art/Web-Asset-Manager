import { Router, type IRouter } from "express";
import healthRouter from "./health";
import vehiclesRouter from "./vehicles";
import personnelRouter from "./personnel";
import salesRouter from "./sales";
import dispatchesRouter from "./dispatches";
import tollsRouter from "./tolls";
import routesRouter from "./routes";
import dashboardRouter from "./dashboard";
import ordersExtractRouter from "./orders/extract";
import saleItemsRouter from "./sale-items";
import fuelPricesRouter from "./fuel-prices";
import odooRouter from "./odoo";
import productsRouter from "./products";
import driverRouter from "./driver";
import { requireAuth } from "../middlewares/requireAuth";

const router: IRouter = Router();

router.use(healthRouter);
router.use(requireAuth);
router.use(vehiclesRouter);
router.use(personnelRouter);
router.use(salesRouter);
router.use(saleItemsRouter);
router.use(dispatchesRouter);
router.use(tollsRouter);
router.use(routesRouter);
router.use(fuelPricesRouter);
router.use(dashboardRouter);
router.use(ordersExtractRouter);
router.use(odooRouter);
router.use(productsRouter);
router.use(driverRouter);

export default router;
