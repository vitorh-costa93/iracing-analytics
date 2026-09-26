/** Corpo da resposta de GET /api/telemetry/reference. Referência ausente no Storage (arquivo sumido
 * ou limite diário de download) é um estado esperado, não uma falha do servidor: responde 200 com
 * status "unavailable" e reference null, o cliente mostra o aviso sem gerar 500 no console. */
export type StoredReference = { original_filename: string; channels: unknown; sample_count: number; uploaded_at: string };

export function buildReferenceBody(reference: StoredReference | null, csv: string | null | undefined) {
  if (!reference) return { status: "ok" as const, reference: null };
  if (csv == null) {
    return { status: "unavailable" as const, reference: null, message: "Referência indisponível agora (arquivo ausente ou limite diário de download atingido)." };
  }
  return {
    status: "ok" as const,
    reference: { filename: reference.original_filename, channels: reference.channels, sampleCount: reference.sample_count, uploadedAt: reference.uploaded_at, csv },
  };
}
