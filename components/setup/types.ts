import type { ResolvedProposal } from "@/lib/engineer-proposal";
import type { SetupExplanation } from "@/lib/setup-explain";

export type SetupUpload = { id: string; filename: string; file_size: number; setup_kind: "commercial" | "fixed" | "open" | "unknown"; source: string; decoder: string | null; decoded_at: string | null; created_at: string };
export type SetupContext = {
  key: string;
  car: { id: number; name: string };
  track: { id: number; name: string; variant: string | null };
  races: number;
  uploads: SetupUpload[];
};
export type ChatMessage = {
  id: string; role: "user" | "assistant"; content: string; createdAt: string;
  setupId?: string; setupName?: string; onProposal?: boolean; mentions?: Array<{ id: string; name: string }>;
  proposal?: ResolvedProposal;
};
export type CompareChange = { label: string; name: string; group: string; before: string; after: string; explanation: string; category: string; settable: boolean };
export type CompareResult = {
  base: { id: string; name: string };
  comparison: { id: string; name: string };
  totalParameters: number;
  skippedCount: number;
  summary: string;
  changes: CompareChange[];
  explanation: SetupExplanation;
};
export type LibraryItem = { carFolder: string; filename: string; provider: string; kind: string; condition: string; track: string; week: number | null; size: number; modifiedAt: string };
