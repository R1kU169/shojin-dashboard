import { useEffect, useState } from "react";
import { isValidAtcoderId } from "../lib/api";
import { getProblems, getProblemModels, peekSubmissions, refreshSubmissions } from "../lib/cache";
import type { Submission, Problem, ProblemModels } from "../lib/types";

interface UserDataState {
  phase: "loading" | "ready" | "error";
  progress: number;
  error?: string;
  subs?: Submission[];
  problems?: Problem[];
  models?: ProblemModels;
  /** 手元のデータを表示しながら、kenkoooo から最新の提出を取っている */
  refreshing?: boolean;
  /** 最新の提出を取れず、手元のデータ(staleAt の時点)を表示している */
  stale?: boolean;
  staleAt?: number;
}

/**
 * ユーザーの提出履歴と問題データ。手元にデータ(IndexedDB のキャッシュかスナップショット)があれば
 * まずそれで表示し、kenkoooo からの差分の取得は裏で行って届いたら差し替える。
 * kenkoooo が混んで遅いときでも、2回目以降の訪問や部員のページは待たずに開ける。
 */
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
      // 問題データの読み込みと、提出履歴(手元を見て、古ければ kenkoooo から差分)の取得は並べて進める
      const resources = Promise.all([getProblems(), getProblemModels()]);
      const local = await peekSubmissions(userId).catch(() => null);
      const shown = !!local && local.list.length > 0;
      const refresh = local?.fresh
        ? null
        : refreshSubmissions(userId, (n) => {
            if (!cancelled && !shown) setState((s) => ({ ...s, progress: n }));
          });
      refresh?.catch(() => {}); // 失敗は下の await で扱う(問題データを待つ間に未処理にしない)
      const [problems, models] = await resources;
      if (cancelled) return;
      // 手元のデータで先に表示する(10分以内に取ったものなら、提出0件でもそのまま確定)
      if (local && (shown || !refresh)) {
        setState({
          phase: "ready",
          progress: local.list.length,
          subs: local.list,
          problems,
          models,
          refreshing: !!refresh,
        });
      }
      if (!refresh) return;
      try {
        const r = await refresh;
        if (cancelled) return;
        setState({
          phase: "ready",
          progress: r.list.length,
          subs: r.list,
          problems,
          models,
          stale: !r.live,
          staleAt: r.live ? undefined : r.at,
        });
      } catch (e) {
        if (cancelled) return;
        // 先に表示したデータがあれば、それを残して「最新を取れなかった」とだけ伝える
        if (shown) setState((s) => ({ ...s, refreshing: false, stale: true, staleAt: local.at }));
        else setState({ phase: "error", progress: 0, error: String(e) });
      }
    })().catch((e) => {
      if (!cancelled) setState({ phase: "error", progress: 0, error: String(e) });
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  return state;
}
