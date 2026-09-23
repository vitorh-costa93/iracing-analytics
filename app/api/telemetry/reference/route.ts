import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { readTelemetryText } from "@/lib/telemetry-storage";

const BUCKET = "telemetry-references";
const MAX_BYTES = 10 * 1024 * 1024;

function parseIds(request: NextRequest) {
  const carId = Number(request.nextUrl.searchParams.get("carId"));
  const trackId = Number(request.nextUrl.searchParams.get("trackId"));
  if (!Number.isInteger(carId) || carId <= 0 || !Number.isInteger(trackId) || trackId <= 0) {
    throw new Error("Carro e pista inválidos");
  }
  return { carId, trackId };
}

// Single-user app: the driver is whichever row synced most recently, same lookup every other route
// already uses. This used to call Garage61 live (/me/accounts) just to resolve the SAME id on
// every single reference-tab load -- no telemetry involved here, purely wasted API load.
async function currentDriverId() {
  const { data, error } = await supabaseAdmin.from("drivers").select("id").order("updated_at", { ascending: false }).limit(1).single();
  if (error || !data) throw new Error("Driver não encontrado");
  return data.id as string;
}

function inspectCsv(text: string) {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 20) throw new Error("O CSV precisa conter cabeçalho e amostras de uma volta");
  const delimiter = (lines[0].match(/;/g)?.length ?? 0) > (lines[0].match(/,/g)?.length ?? 0) ? ";" : ",";
  const channels = lines[0].split(delimiter).map((item) => item.replace(/^"|"$/g, "").trim());
  const keys = channels.map((item) => item.toLowerCase().replace(/[^a-z0-9]/g, ""));
  if (!keys.includes("lapdistpct") || !keys.includes("speed")) {
    throw new Error("A referência precisa conter pelo menos os canais LapDistPct e Speed");
  }
  return { channels, sampleCount: lines.length - 1 };
}

export async function GET(request: NextRequest) {
  try {
    const { carId, trackId } = parseIds(request);
    const driverId = await currentDriverId();
    const { data: reference, error } = await supabaseAdmin.from("telemetry_references")
      .select("storage_path, original_filename, channels, sample_count, uploaded_at")
      .eq("driver_id", driverId).eq("car_id", carId).eq("track_id", trackId).maybeSingle();
    if (error) throw error;
    if (!reference) return NextResponse.json({ status: "ok", reference: null });
    const csv = await readTelemetryText(reference.storage_path, BUCKET);
    if (csv == null) throw new Error("Referência indisponível agora (arquivo ausente ou limite diário de download atingido)");
    return NextResponse.json({ status: "ok", reference: {
      filename: reference.original_filename, channels: reference.channels, sampleCount: reference.sample_count,
      uploadedAt: reference.uploaded_at, csv,
    }});
  } catch (error) {
    return NextResponse.json({ status: "error", message: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const origin = request.headers.get("origin");
    if (!origin || origin !== request.nextUrl.origin) {
      return NextResponse.json({ status: "error", message: "Origem do upload não autorizada" }, { status: 403 });
    }
    const form = await request.formData();
    const file = form.get("file");
    const carId = Number(form.get("carId"));
    const trackId = Number(form.get("trackId"));
    if (!(file instanceof File)) return NextResponse.json({ status: "error", message: "Selecione um arquivo CSV" }, { status: 400 });
    if (!Number.isInteger(carId) || !Number.isInteger(trackId)) return NextResponse.json({ status: "error", message: "Carro e pista inválidos" }, { status: 400 });
    if (file.size <= 0 || file.size > MAX_BYTES) return NextResponse.json({ status: "error", message: "O CSV deve ter no máximo 10 MB" }, { status: 400 });
    const text = await file.text();
    const inspected = inspectCsv(text);
    const driverId = await currentDriverId();
    const path = `${driverId}/${carId}/${trackId}/reference.csv`;
    const { error: uploadError } = await supabaseAdmin.storage.from(BUCKET).upload(path, new Blob([text], { type: "text/csv" }), { upsert: true, contentType: "text/csv" });
    if (uploadError) throw uploadError;
    const { error: metadataError } = await supabaseAdmin.from("telemetry_references").upsert({
      driver_id: driverId, car_id: carId, track_id: trackId, storage_path: path,
      original_filename: file.name.slice(0, 255), file_size: file.size, channels: inspected.channels,
      sample_count: inspected.sampleCount, uploaded_at: new Date().toISOString(),
    }, { onConflict: "driver_id,car_id,track_id" });
    if (metadataError) throw metadataError;
    return NextResponse.json({ status: "ok", reference: { filename: file.name, ...inspected, uploadedAt: new Date().toISOString(), csv: text } });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ status: "error", message }, { status: message.includes("precisa") ? 400 : 500 });
  }
}
