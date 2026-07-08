import type { Problem, ProblemModels, Submission } from "./types";

// scripts/build-snapshot.mjs が public/snapshot/ に書き出す静的データを、
// 同一オリジンから読む。base は相対(vite.config: base "./")なので、
// document のベースURL(.../shojin-dashboard/)基準で解決される。
const SNAP = `${import.meta.env.BASE_URL}snapshot`;

async function snapJson<T>(file: string): Promise<T | null> {
  try {
    const res = await fetch(`${SNAP}/${file}`, { cache: "no-cache" });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    // スナップショット未デプロイやオフライン時は null を返し、呼び出し側で
    // kenkoooo への直接アクセスにフォールバックさせる。
    return null;
  }
}

export const snapshotProblems = () => snapJson<Problem[]>("problems.json");

export const snapshotModels = () => snapJson<ProblemModels>("problem-models.json");

export interface SubsSnapshot {
  at: number;
  watermark: number;
  list: Submission[];
}

export const snapshotSubs = (user: string) =>
  snapJson<SubsSnapshot>(`subs/${user.toLowerCase()}.json`);
