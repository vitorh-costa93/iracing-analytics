import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

type Row = { season_id: number; season_name: string; rating_category: "formula_car" | "sports_car"; series_name: string; starts: number; wins: number };

function parseCsvLine(line: string, delimiter: string) {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') { cell += '"'; index += 1; }
      else quoted = !quoted;
    } else if (char === delimiter && !quoted) { cells.push(cell); cell = ""; }
    else cell += char;
  }
  cells.push(cell);
  return cells.map((value) => value.trim());
}

function normalizeHeader(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "_").replace(/^_+|_+$/g, "");
}

function normalizeCategory(value: string): "formula_car" | "sports_car" | null {
  const key = value.toLowerCase().replace(/[^a-z]/g, "");
  if (["formulacar", "formula", "f"].includes(key)) return "formula_car";
  if (["sportscar", "sports", "gt", "s"].includes(key)) return "sports_car";
  return null;
}

function parseRows(csv: string): { rows: Row[]; errors: string[] } {
  const lines = csv.replace(/^﻿/, "").split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) throw new Error("CSV vazio ou sem linhas de dados");
  const delimiter = (lines[0].match(/;/g)?.length ?? 0) > (lines[0].match(/,/g)?.length ?? 0) ? ";" : ",";
  const headers = parseCsvLine(lines[0], delimiter).map(normalizeHeader);
  const required = ["season_id", "season_name", "rating_category", "series_name", "starts", "wins"];
  const missing = required.filter((name) => !headers.includes(name));
  if (missing.length) throw new Error(`Colunas ausentes no CSV: ${missing.join(", ")}. Cabeçalho esperado: ${required.join(",")}`);
  const index = (name: string) => headers.indexOf(name);

  const rows: Row[] = [];
  const errors: string[] = [];
  for (let lineIndex = 1; lineIndex < lines.length; lineIndex += 1) {
    const cells = parseCsvLine(lines[lineIndex], delimiter);
    const rowLabel = `linha ${lineIndex + 1}`;
    const seasonId = Number(cells[index("season_id")]);
    const seasonName = cells[index("season_name")];
    const category = normalizeCategory(cells[index("rating_category")]);
    const seriesName = cells[index("series_name")];
    const starts = Number(cells[index("starts")]);
    const wins = Number(cells[index("wins")]);
    if (!Number.isInteger(seasonId)) { errors.push(`${rowLabel}: season_id inválido`); continue; }
    if (!seasonName) { errors.push(`${rowLabel}: season_name vazio`); continue; }
    if (!category) { errors.push(`${rowLabel}: rating_category deve ser formula_car ou sports_car`); continue; }
    if (!seriesName) { errors.push(`${rowLabel}: series_name vazio`); continue; }
    if (!Number.isInteger(starts) || starts < 0) { errors.push(`${rowLabel}: starts inválido`); continue; }
    if (!Number.isInteger(wins) || wins < 0 || wins > starts) { errors.push(`${rowLabel}: wins inválido (deve ser >= 0 e <= starts)`); continue; }
    rows.push({ season_id: seasonId, season_name: seasonName, rating_category: category, series_name: seriesName, starts, wins });
  }
  return { rows, errors };
}

export async function POST(request: NextRequest) {
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new Error("Envie um arquivo CSV");
    if (!file.name.toLowerCase().endsWith(".csv")) throw new Error("O arquivo precisa ter extensão .csv");
    if (file.size > 2 * 1024 * 1024) throw new Error("CSV muito grande (limite de 2 MB)");
    const text = await file.text();
    const { rows, errors } = parseRows(text);
    if (!rows.length) throw new Error(`Nenhuma linha válida encontrada. ${errors.join("; ")}`);

    const { data: driver, error: driverError } = await supabaseAdmin.from("drivers").select("id").order("updated_at", { ascending: false }).limit(1).single();
    if (driverError || !driver) throw new Error("Piloto não encontrado");

    const payload = rows.map((row) => ({
      driver_id: driver.id,
      season_id: row.season_id,
      season_name: row.season_name,
      rating_category: row.rating_category,
      series_name: row.series_name,
      starts: row.starts,
      wins: row.wins,
      source: "csv_upload",
      captured_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }));
    const { error: upsertError } = await supabaseAdmin.from("official_series_results").upsert(payload, { onConflict: "driver_id,season_id,series_name" });
    if (upsertError) throw upsertError;

    return NextResponse.json({ status: "ok", imported: rows.length, skipped: errors.length, errors });
  } catch (error) {
    return NextResponse.json({ status: "error", message: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
