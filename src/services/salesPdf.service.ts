import PDFDocument from "pdfkit";
import { resolve } from "node:path";
import type { printableSales } from "./ventas.service.js";
const hour = (value: string) => {
  const [h, m] = value.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
};
const money = (n: unknown) => `Bs ${Number(n).toFixed(2)}`;
export async function salesPdf(
  sales: Awaited<ReturnType<typeof printableSales>>,
): Promise<Buffer> {
  const doc = new PDFDocument({
    size: "A4",
    margin: 42,
    bufferPages: true,
    autoFirstPage: false,
    info: { Title: "DAP elegancia - Pedidos", Author: "DAP elegancia" },
  });
  doc.registerFont("Body", resolve("assets/fonts/manrope-400.woff"));
  doc.registerFont("Bold", resolve("assets/fonts/manrope-700.woff"));
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (b: Buffer) => chunks.push(b));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
  const ink = "#0c3b45",
    muted = "#60797d";
  let y = 0;
  function page(order: string) {
    doc.addPage();
    doc.fillColor(ink).font("Bold").fontSize(23).text("DAP elegancia", 42, 40);
    doc.fontSize(12).text(`Pedido ${order}`, 42, 76);
    y = 106;
  }
  function space(h: number, order: string) {
    if (y + h > 770) page(`${order} (continuación)`);
  }
  function line(label: string, value: string, order: string) {
    const text = `${label}: ${value || "-"}`;
    doc.font("Body").fontSize(10);
    const height = doc.heightOfString(text, { width: 510 }) + 9;
    space(height, order);
    doc
      .fillColor(ink)
      .font("Body")
      .fontSize(10)
      .text(text, 42, y, { width: 510 });
    y += height;
  }
  for (const sale of sales) {
    const order = `V-${String(sale.numero_diario).padStart(3, "0")}`;
    page(order);
    if (sale.tipo === "Cambio" && sale.venta_origen)
      line(
        "Cambio del pedido",
        `V-${String(sale.venta_origen.numero_diario).padStart(3, "0")} / ${new Intl.DateTimeFormat("es-BO", { timeZone: "America/La_Paz" }).format(sale.venta_origen.fecha)}`,
        order,
      );
    line(
      "Fecha",
      new Intl.DateTimeFormat("es-BO", {
        timeZone: "America/La_Paz",
        dateStyle: "short",
        timeStyle: "short",
      }).format(sale.fecha),
      order,
    );
    line("Cliente", sale.cliente_nombre ?? sale.cliente.nombre ?? "", order);
    line("Celular", sale.cliente_celular ?? sale.cliente.celular, order);
    line("Dirección", sale.direccion_entrega ?? "", order);
    if (sale.link_ubicacion) line("Ubicación", sale.link_ubicacion, order);
    line(
      "Entrega",
      sale.departamento_destino
        ? `Envío a ${sale.departamento_destino.replaceAll("_", " ")}${sale.ciudad_provincia ? ` / ${sale.ciudad_provincia}` : ""}`
        : "Delivery local",
      order,
    );
    line(
      "Horario de entrega",
      sale.hora_entrega_desde
        ? `${hour(sale.hora_entrega_desde)}${sale.hora_entrega_hasta ? ` a ${hour(sale.hora_entrega_hasta)}` : ""}`
        : "Sin horario registrado",
      order,
    );
    y += 12;
    const header = () => {
      space(32, order);
      doc.rect(42, y, 510, 26).fill("#cff0ea");
      doc
        .fillColor(ink)
        .font("Bold")
        .fontSize(9)
        .text("Prenda / color / talla", 50, y + 8, { width: 275 })
        .text("Cant.", 325, y + 8, { width: 40 })
        .text("Precio", 375, y + 8, { width: 72, align: "right" })
        .text("Importe", 457, y + 8, { width: 86, align: "right" });
      y += 34;
    };
    header();
    for (const d of sale.detalles) {
      const title =
        (sale.tipo === "Cambio"
          ? `${d.tipo === "Devolucion" ? "Devolver" : "Entregar"}: `
          : "") +
        [
          d.nombre_vestido ?? d.variante.vestido.nombre,
          d.color ?? d.variante.color,
          d.talla ?? "",
          d.ubicacion_almacen ? `Almacén ${d.ubicacion_almacen}` : "",
        ]
          .filter(Boolean)
          .join(" / ");
      doc.font("Body").fontSize(10);
      const height = Math.max(
        25,
        doc.heightOfString(title, { width: 265 }) + 15,
      );
      if (y + height > 770) {
        page(`${order} (continuación)`);
        header();
      }
      doc
        .fillColor(ink)
        .font("Body")
        .fontSize(10)
        .text(title, 50, y, { width: 265 })
        .text(String(d.cantidad), 325, y, { width: 40 })
        .text(money(d.precio_unitario_aplicado), 375, y, {
          width: 72,
          align: "right",
        })
        .text(
          money(
            Number(d.precio_unitario_aplicado) *
              d.cantidad *
              (d.tipo === "Devolucion" ? -1 : 1),
          ),
          457,
          y,
          { width: 86, align: "right" },
        );
      y += height;
      doc
        .moveTo(42, y - 7)
        .lineTo(552, y - 7)
        .strokeColor("#dfeae8")
        .stroke();
    }
    y += 12;
    space(160, order);
    line("Prendas", `${sale.total_prendas} unidades`, order);
    line("Subtotal de prendas", money(sale.monto_vestidos), order);
    if (sale.tipo === "Cambio")
      line("Valor devuelto", money(sale.monto_devolucion), order);
    else line("Delivery adicional", money(sale.adicional_delivery), order);
    if (sale.departamento_destino && sale.tipo !== "Cambio")
      line("Costo de envío departamental", money(sale.costo_envio), order);
    doc
      .font("Bold")
      .fontSize(16)
      .fillColor(ink)
      .text(
        sale.tipo === "Cambio"
          ? Number(sale.total_cobrado) > 0
            ? `A COBRAR: ${money(sale.total_cobrado)}`
            : Number(sale.total_cobrado) < 0
              ? `A DEVOLVER: ${money(-Number(sale.total_cobrado))}`
              : "SIN DIFERENCIA"
          : `TOTAL: ${money(sale.total_cobrado)}`,
        42,
        y + 5,
      );
    y += 32;
    doc
      .font("Body")
      .fontSize(9)
      .fillColor(muted)
      .text("Comprobante de pedido", 42, y);
  }
  const count = doc.bufferedPageRange().count;
  for (let i = 0; i < count; i++) {
    doc.switchToPage(i);
    doc
      .fillColor(muted)
      .font("Body")
      .fontSize(8)
      .text(`${i + 1} / ${count}`, 42, 785, {
        width: 510,
        align: "right",
        lineBreak: false,
      });
  }
  doc.end();
  return done;
}
