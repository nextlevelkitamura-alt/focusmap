'use client';

import { useEffect, useState, useCallback } from 'react';
import { createClient } from '@/utils/supabase/client';
import { getUsageInfo, type UsageInfo } from '@/lib/usage-guard';

export interface UseUsageResult {
  personal: UsageInfo | null;
  workspace: UsageInfo | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useUsage(spaceId: string | null, userId: string | null): UseUsageResult {
  const [personal, setPersonal] = useState<UsageInfo | null>(null);
  const [workspace, setWorkspace] = useState<UsageInfo | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchUsage = useCallback(async () => {
    if (!userId) {
      setPersonal(null);
      setWorkspace(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const supabase = createClient();
      const { data } = await supabase.auth.getUser();
      const email = data.user?.id === userId ? data.user.email ?? null : null;
      const result = await getUsageInfo(supabase, spaceId, userId, email);
      setPersonal(result.personal);
      setWorkspace(result.workspace);
    } catch (e) {
      setError(e instanceof Error ? e.message : '使用量の取得に失敗しました');
    } finally {
      setLoading(false);
    }
  }, [spaceId, userId]);

  useEffect(() => {
    fetchUsage();
  }, [fetchUsage]);

  // 実行完了時に他の場所から refresh を呼べるようにエクスポート
  return { personal, workspace, loading, error, refresh: fetchUsage };
}
