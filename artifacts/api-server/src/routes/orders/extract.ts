import { Router } from "express";
import multer from "multer";
import PDFParser from "pdf2json";
import { anthropic } from "@workspace/integrations-anthropic-ai";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

function extractTextFromPdf(buffer: Buffer): Promise<string> {
  return new Promise((resolve, reject) => {
    const parser = new PDFParser(null, true);

    parser.on("pdfParser_dataError", (err) => {
      reject(err instanceof Error ? err : new Error(String(err)));
    });

    parser.on("pdfParser_dataReady", () => {
      const text = parser.getRawTextContent();
      resolve(text);
    });

    parser.parseBuffer(buffer);
  });
}

router.post("/orders/extract", upload.single("file"), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: "Se requiere un archivo PDF" });
    return;
  }

  let text: string;
  try {
    text = await extractTextFromPdf(req.file.buffer);
  } catch {
    res.status(400).json({ error: "No se pudo leer el PDF. Asegúrese de que el archivo sea válido." });
    return;
  }

  if (!text || text.trim().length < 10) {
    res.status(400).json({ error: "El PDF no contiene texto legible." });
    return;
  }

  const prompt = `Eres un asistente que extrae datos de órdenes de compra/despacho logístico.
Del siguiente texto de una orden, extrae los campos indicados y devuelve ÚNICAMENTE un objeto JSON válido sin explicaciones ni texto adicional.

Campos a extraer:
- cliente: nombre de la empresa o persona destinataria del pedido (Bill To o nombre del cliente)
- vendedor: nombre del vendedor o representante de ventas (campo Salesperson)
- destino: ciudad, estado y país de entrega del destinatario
- tipoMaterial: descripción del producto o material (campo Description; si hay varios ítems, concaténalos separados por "; ")
- notas: número de orden o referencia (ej: "Order # S00983")
- fechaEntrega: fecha de entrega en formato YYYY-MM-DD si está disponible
- numeroOrden: número de orden exacto (ej: "S00983")

Si un campo no está disponible en el texto, devuelve null para ese campo.

Texto de la orden:
${text}

Responde SOLO con el JSON, sin markdown, sin explicaciones.`;

  let extracted: Record<string, string | null>;
  try {
    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 8192,
      messages: [{ role: "user", content: prompt }],
    });

    const block = message.content[0];
    if (block.type !== "text") {
      res.status(500).json({ error: "Respuesta inesperada del modelo de IA." });
      return;
    }

    const raw = block.text.trim().replace(/^```json\s*/i, "").replace(/```\s*$/, "");
    extracted = JSON.parse(raw);
  } catch (err) {
    req.log.error({ err }, "Error calling Anthropic API or parsing response");
    res.status(500).json({ error: "Error al procesar el documento con IA." });
    return;
  }

  res.json(extracted);
});

export default router;
