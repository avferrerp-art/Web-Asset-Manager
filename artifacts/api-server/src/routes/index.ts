import { Router, type IRouter } from "express";
import healthRouter from "./health";
import vehiclesRouter from "./vehicles";
import personnelRouter from "./personnel";
import salesRouter from "./sales";
import dispatchesRouter from "./dispatches";
import tollsRouter from "./tolls";
import dashboardRouter from "./dashboard";

const router: IRouter = Router();

router.use(healthRouter);
router.use(vehiclesRouter);
router.use(personnelRouter);
router.use(salesRouter);
router.use(dispatchesRouter);
router.use(tollsRouter);
router.use(dashboardRouter);

export default router;
