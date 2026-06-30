import { test, expect, request } from "@playwright/test";

const BASE_API = "http://localhost:80/api";

async function createRoute(
  apiContext: Awaited<ReturnType<typeof request.newContext>>,
  nombre: string,
  tipo = "sencillo"
) {
  const res = await apiContext.post(`${BASE_API}/routes`, {
    data: { nombre, tipo, origen: "OrigenTest", destino: "DestinoTest" },
  });
  expect(res.ok()).toBeTruthy();
  return res.json() as Promise<{ id: number; nombre: string; tolls: unknown[] }>;
}

async function addToll(
  apiContext: Awaited<ReturnType<typeof request.newContext>>,
  routeId: number,
  nombre: string
) {
  const res = await apiContext.post(`${BASE_API}/routes/${routeId}/tolls`, {
    data: { nombre },
  });
  expect(res.ok()).toBeTruthy();
  return res.json();
}

async function deleteRoute(
  apiContext: Awaited<ReturnType<typeof request.newContext>>,
  routeId: number
) {
  await apiContext.delete(`${BASE_API}/routes/${routeId}`);
}

test.describe("Rutas flows", () => {
  let apiContext: Awaited<ReturnType<typeof request.newContext>>;
  const createdRouteIds: number[] = [];

  test.beforeAll(async () => {
    apiContext = await request.newContext({ baseURL: BASE_API });
  });

  test.afterAll(async () => {
    for (const id of createdRouteIds) {
      await deleteRoute(apiContext, id).catch(() => {});
    }
    await apiContext.dispose();
  });

  test("create a Sencillo route, add 2 casetas, card shows '2 casetas'", async ({ page }) => {
    const routeName = `RutaE2E-${Date.now()}`;

    await page.goto("/rutas");
    await page.waitForLoadState("networkidle");

    await page.getByRole("button", { name: /nueva ruta/i }).click();
    await expect(page.getByRole("dialog")).toBeVisible();

    const sencilloTab = page.getByRole("tab", { name: /sencillo/i });
    await sencilloTab.click();

    await page.getByLabel(/nombre de la ruta/i).fill(routeName);
    await page.getByLabel(/origen/i).fill("Ciudad A");
    await page.getByLabel(/destino/i).fill("Ciudad B");

    await page.getByRole("button", { name: /crear ruta/i }).click();

    await expect(page.getByRole("dialog")).not.toBeVisible({ timeout: 10_000 });

    const card = page.locator("[class*='card']", { hasText: routeName });
    await expect(card).toBeVisible();

    const editBtn = card.getByRole("button").filter({ has: page.locator("svg") }).nth(1);
    await editBtn.click();

    await expect(page.getByRole("dialog", { name: /editar ruta/i })).toBeVisible();

    const tollInput = page.getByPlaceholder(/nombre de la caseta/i);
    const agregarBtn = page.getByRole("button", { name: /agregar/i }).last();

    await tollInput.fill("Caseta Norte");
    await agregarBtn.click();
    await expect(page.getByText("Caseta Norte")).toBeVisible();

    await tollInput.fill("Caseta Sur");
    await agregarBtn.click();
    await expect(page.getByText("Caseta Sur")).toBeVisible();

    const routeRes = await apiContext.get(`${BASE_API}/routes`);
    const routes = (await routeRes.json()) as Array<{ id: number; nombre: string }>;
    const created = routes.find((r) => r.nombre === routeName);
    if (created) createdRouteIds.push(created.id);

    await page.getByRole("button", { name: /cancelar/i }).click();
    await expect(page.getByRole("dialog")).not.toBeVisible();

    await expect(card.getByText(/2 casetas/i)).toBeVisible();
  });

  test("toggle a route as favorita and it moves to the top", async ({ page }) => {
    const routeName = `RutaFav-${Date.now()}`;
    const route = await createRoute(apiContext, routeName);
    createdRouteIds.push(route.id);

    await page.goto("/rutas");
    await page.waitForLoadState("networkidle");

    const card = page.locator("[class*='card']", { hasText: routeName });
    await expect(card).toBeVisible();

    const starBtn = card.getByRole("button", { name: /agregar a favoritas/i });
    await starBtn.click();

    await expect(page.getByText(/agregada a favoritas/i)).toBeVisible({ timeout: 8_000 });

    await page.waitForTimeout(500);

    const allCards = page.locator("[class*='card']");
    const firstCardText = await allCards.first().textContent();
    expect(firstCardText).toContain(routeName);
  });

  test("delete a route and it disappears from the list", async ({ page }) => {
    const routeName = `RutaDel-${Date.now()}`;
    const route = await createRoute(apiContext, routeName);

    await page.goto("/rutas");
    await page.waitForLoadState("networkidle");

    const card = page.locator("[class*='card']", { hasText: routeName });
    await expect(card).toBeVisible();

    const trashBtn = card.getByRole("button").filter({ has: page.locator("svg") }).last();
    await trashBtn.click();

    await expect(page.getByRole("alertdialog")).toBeVisible();
    await expect(page.getByText(/eliminar ruta/i)).toBeVisible();

    await page.getByRole("button", { name: /eliminar/i }).last().click();

    await expect(page.getByText(/ruta eliminada/i)).toBeVisible({ timeout: 8_000 });

    await expect(card).not.toBeVisible({ timeout: 8_000 });
  });
});

test.describe("Dispatch toll calculation", () => {
  let apiContext: Awaited<ReturnType<typeof request.newContext>>;
  let testRouteId: number;

  test.beforeAll(async () => {
    apiContext = await request.newContext({ baseURL: BASE_API });

    const routeRes = await apiContext.post(`${BASE_API}/routes`, {
      data: {
        nombre: "RutaPeajeSpec",
        tipo: "sencillo",
        origen: "AlphaCity",
        destino: "BetaCity",
      },
    });
    const route = (await routeRes.json()) as { id: number };
    testRouteId = route.id;

    await apiContext.post(`${BASE_API}/routes/${testRouteId}/tolls`, {
      data: { nombre: "Caseta 1" },
    });
    await apiContext.post(`${BASE_API}/routes/${testRouteId}/tolls`, {
      data: { nombre: "Caseta 2" },
    });
  });

  test.afterAll(async () => {
    await apiContext.delete(`${BASE_API}/routes/${testRouteId}`).catch(() => {});
    await apiContext.dispose();
  });

  test("selecting vehicle with tarifaPeaje and a route shows computed toll cost", async ({
    page,
  }) => {
    const vehiclesRes = await apiContext.get(`${BASE_API}/vehicles`);
    const vehicles = (await vehiclesRes.json()) as Array<{
      id: number;
      modelo: string;
      tarifaPeaje: number | null;
    }>;
    const vehicle = vehicles.find((v) => v.tarifaPeaje != null && v.tarifaPeaje > 0);
    expect(vehicle, "A vehicle with tarifaPeaje must exist").toBeTruthy();

    const dispatchesRes = await apiContext.get(`${BASE_API}/dispatches`);
    const dispatches = (await dispatchesRes.json()) as Array<{
      id: number;
      estado: string;
    }>;
    const dispatch = dispatches.find((d) =>
      ["pre-despacho", "aprobado"].includes(d.estado)
    );
    expect(dispatch, "An editable dispatch must exist").toBeTruthy();

    const expectedTotal = (2 * vehicle!.tarifaPeaje!).toFixed(2);

    await page.goto("/despachos");
    await page.waitForLoadState("networkidle");

    const row = page.getByRole("row").filter({ hasText: `#${dispatch!.id}` });
    await row.click();

    await expect(page.getByText(`Despacho #${dispatch!.id}`)).toBeVisible();

    await page.getByRole("button", { name: /editar/i }).click();

    await expect(page.getByLabel(/vehículo/i)).toBeVisible();

    const vehicleSelect = page.getByLabel(/vehículo/i);
    await vehicleSelect.click();
    await page.getByRole("option", { name: new RegExp(vehicle!.modelo.trim()) }).click();

    const routeSelect = page.getByLabel(/ruta predefinida/i);
    await routeSelect.click();
    await page
      .getByRole("option", { name: /RutaPeajeSpec.*AlphaCity.*BetaCity/ })
      .click();

    await expect(page.getByText(/peajes calculados/i)).toBeVisible({ timeout: 8_000 });
    await expect(page.getByText(`$${expectedTotal}`)).toBeVisible();
    await expect(page.getByText(/2 casetas/i)).toBeVisible();
  });
});
