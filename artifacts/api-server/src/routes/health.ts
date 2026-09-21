import { Router, type IRouter } from "express";
import { HealthCheckResponse, ReadinessCheckResponse } from "@workspace/api-zod";
import { isDatabaseReady } from "../services/health";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

router.get("/readyz", async (_req, res): Promise<void> => {
  const ready = await isDatabaseReady();
  const data = ReadinessCheckResponse.parse({
    status: ready ? "ready" : "not_ready",
  });
  res.status(ready ? 200 : 503).json(data);
});

export default router;
