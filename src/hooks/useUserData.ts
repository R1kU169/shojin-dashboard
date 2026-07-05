import { useEffect, useState } from "react";
import { isValidAtcoderId } from "../lib/api";
import { getProblems, getProblemModels, loadSubmissions } from "../lib/cache";
import type { Submission, Problem, ProblemModels } from "../lib/types";

interface UserDataState {
  phase: "loading" | "ready" | "error";
  progress: number;
  error?: string;
  subs?: Submission[];
  problems?: Problem[];
  models?: ProblemModels;
}

export function useUserData(userId: string): UserDataState {
  const [state, setState] = useState<UserDataState>({
    phase: "loading",
    progress: 0,
  });

  useEffect(() => {
    let cancelled = false;
    if (!isValidAtcoderId(userId)) {
      setState({ phase: "error", progress: 0, error: "IDの形式が不正です" });
      return;
    }
    setState({ phase: "loading", progress: 0 });
    (async () => {
      try {
        const [problems, models] = await Promise.all([
          getProblems(),
          getProblemModels(),
        ]);
        const subs = await loadSubmissions(userId, (n) => {
          if (!cancelled) setState((s) => ({ ...s, progress: n }));
        });
        if (!cancelled) {
          setState({
            phase: "ready",
            progress: subs.length,
            subs,
            problems,
            models,
          });
        }
      } catch (e) {
        if (!cancelled) {
          setState({ phase: "error", progress: 0, error: String(e) });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  return state;
}
