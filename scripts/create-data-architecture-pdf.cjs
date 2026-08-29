const fs = require("fs");
const path = require("path");
const PDFDocument = require("pdfkit");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "docs", "DATA_ARCHITECTURE.md"), "utf8");
const output = path.join(root, "output", "pdf", "racing-analytics-data-architecture.pdf");
fs.mkdirSync(path.dirname(output), { recursive: true });

const doc = new PDFDocument({ size: "A4", margins: { top: 48, bottom: 48, left: 46, right: 46 }, info: { Title: "Racing Analytics - Arquitetura de Dados", Author: "Racing Analytics" } });
doc.pipe(fs.createWriteStream(output));

const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
const bottom = () => doc.page.height - doc.page.margins.bottom;
function ensure(height) { if (doc.y + height > bottom()) doc.addPage(); }
function body(text, options = {}) {
  doc.font(options.mono ? "Courier" : "Helvetica").fontSize(options.size ?? 8.7).fillColor(options.color ?? "#283342");
  const height = doc.heightOfString(text, { width, lineGap: options.lineGap ?? 2 });
  ensure(height + 5);
  doc.text(text, { width, lineGap: options.lineGap ?? 2 });
  doc.moveDown(options.gap ?? 0.45);
}
function heading(text, level) {
  const size = level === 1 ? 22 : 14;
  ensure(size + 18);
  doc.font("Helvetica-Bold").fontSize(size).fillColor(level === 1 ? "#124b8d" : "#0f3b70").text(text, { width });
  doc.moveDown(level === 1 ? 0.7 : 0.4);
}
function rule() { doc.moveTo(doc.page.margins.left, doc.y).lineTo(doc.page.width - doc.page.margins.right, doc.y).lineWidth(0.5).strokeColor("#c8d3df").stroke(); doc.moveDown(0.55); }

heading("Racing Analytics", 1);
doc.font("Helvetica").fontSize(11).fillColor("#52677c").text("Arquitetura de dados - fontes, fluxo, schema e auditoria", { width });
doc.moveDown(0.35);
doc.font("Helvetica").fontSize(8).fillColor("#718295").text("Inventário conferido em 27/08/2026. Gerado a partir de docs/DATA_ARCHITECTURE.md.");
doc.moveDown(0.8); rule();

let code = false;
for (const rawLine of source.replace(/\r/g, "").split("\n")) {
  const line = rawLine.trimEnd();
  if (line.startsWith("```")) { code = !code; continue; }
  if (!line.trim()) { doc.moveDown(0.25); continue; }
  if (line.startsWith("# ")) { continue; }
  if (line.startsWith("## ")) { heading(line.slice(3), 2); rule(); continue; }
  if (line.startsWith("### ")) { heading(line.slice(4), 2); continue; }
  if (code) { body(line, { mono: true, size: 7.4, color: "#1e4d79", lineGap: 1, gap: 0.1 }); continue; }
  if (line.startsWith("|") && !/^\|[-| ]+\|$/.test(line)) {
    const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
    body(cells.join("  |  "), { size: 7.1, color: "#263849", lineGap: 1, gap: 0.18 });
    continue;
  }
  if (/^\|[-| ]+\|$/.test(line)) continue;
  body(line.replace(/^[-*] /, "- "), { size: 8.7 });
}

const pages = doc.bufferedPageRange().count;
for (let index = 0; index < pages; index += 1) {
  doc.switchToPage(index);
  doc.font("Helvetica").fontSize(7.5).fillColor("#718295").text(`Racing Analytics - Arquitetura de Dados  |  ${index + 1}/${pages}`, doc.page.margins.left, doc.page.height - 30, { width, align: "right" });
}
doc.end();
console.log(output);
