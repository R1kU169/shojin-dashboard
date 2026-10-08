// コーナーケースを裏で作る Worker。最大のケースは1つ作るのに1秒ほどかかるので、画面を止めないよう別スレッドで作る。
import { buildSpec, generateCase } from "./casegen/index.ts";
import type { GeneratedCase, Overrides } from "./casegen/index.ts";

export interface CaseGenRequest {
  format: string;
  constraints: string;
  overrides: Overrides;
  seed: string;
  maxBytes: number;
  newlineBytes: number;
}

export type CaseGenMessage =
  | { type: "case"; case: GeneratedCase; index: number; total: number }
  | { type: "error"; id: string; label: string; message: string; index: number; total: number }
  | { type: "done" };

const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<CaseGenRequest>) => void) | null;
  postMessage(m: CaseGenMessage): void;
};

ctx.onmessage = (e) => {
  const req = e.data;
  const spec = buildSpec(req.format, req.constraints, req.overrides);
  const total = spec.presets.length;
  spec.presets.forEach((p, index) => {
    try {
      ctx.postMessage({ type: "case", case: generateCase(spec, p, req.seed, req.maxBytes, req.newlineBytes), index, total });
    } catch (err) {
      ctx.postMessage({ type: "error", id: p.id, label: p.label, message: String((err as Error)?.message ?? err), index, total });
    }
  });
  ctx.postMessage({ type: "done" });
};
