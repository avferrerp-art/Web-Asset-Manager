export interface OdooConfig {
  url: string;
  db: string;
  username: string;
  apiKey: string;
}

export class OdooError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OdooError";
  }
}

export function getOdooConfig(): OdooConfig | null {
  const url = process.env.ODOO_URL;
  const db = process.env.ODOO_DB;
  const username = process.env.ODOO_USERNAME;
  const apiKey = process.env.ODOO_API_KEY;
  if (!url || !db || !username || !apiKey) return null;
  return { url: url.replace(/\/+$/, ""), db, username, apiKey };
}

interface JsonRpcResponse {
  jsonrpc: string;
  id: number;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: { name?: string; message?: string; debug?: string };
  };
}

async function jsonRpc(
  config: OdooConfig,
  service: string,
  method: string,
  args: unknown[],
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`${config.url}/jsonrpc`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "call",
        params: { service, method, args },
        id: Date.now(),
      }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err);
    throw new OdooError(
      `No se pudo conectar al servidor Odoo (${config.url}): ${cause}`,
    );
  }

  if (!response.ok) {
    throw new OdooError(
      `El servidor Odoo respondió HTTP ${response.status} en ${config.url}/jsonrpc`,
    );
  }

  let payload: JsonRpcResponse;
  try {
    payload = (await response.json()) as JsonRpcResponse;
  } catch {
    throw new OdooError(
      `El servidor Odoo devolvió una respuesta no válida (¿la URL apunta a un servidor Odoo?)`,
    );
  }

  if (payload.error) {
    const detail =
      payload.error.data?.message ?? payload.error.message ?? "Error desconocido";
    throw new OdooError(`Error de Odoo: ${detail}`);
  }
  return payload.result;
}

export async function authenticate(config: OdooConfig): Promise<number> {
  const result = await jsonRpc(config, "common", "authenticate", [
    config.db,
    config.username,
    config.apiKey,
    {},
  ]);
  if (typeof result !== "number" || !result) {
    throw new OdooError(
      "Credenciales inválidas: Odoo rechazó el usuario o la API key (verifique también el nombre de la base de datos).",
    );
  }
  return result;
}

export async function executeKw(
  config: OdooConfig,
  uid: number,
  model: string,
  method: string,
  args: unknown[],
  kwargs: Record<string, unknown> = {},
): Promise<unknown> {
  return jsonRpc(config, "object", "execute_kw", [
    config.db,
    uid,
    config.apiKey,
    model,
    method,
    args,
    kwargs,
  ]);
}
