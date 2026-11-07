import { useEffect, useMemo, useState } from 'react';
import { api } from '../../../shared/api';
import type { ShippingAccountProfile } from '../../../shared/types';

/** 加载服务端允许使用的运费报价账号档案，不在浏览器保存凭据。 */
export function useShippingAccounts() {
  const [accounts, setAccounts] = useState<ShippingAccountProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    api<ShippingAccountProfile[]>('/api/shipping/accounts')
      .then(items => {
        if (!active) return;
        // 响应结构异常时给出可恢复的加载错误，避免页面后续对非数组调用筛选方法而崩溃。
        if (!Array.isArray(items)) throw new Error('The server returned an invalid shipping account list.');
        setAccounts(items);
      })
      .catch(reason => { if (active) setError(reason instanceof Error ? reason.message : 'Unable to load shipping accounts.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const defaultAccountId = useMemo(() => {
    const available = accounts.filter(account => account.enabled && account.pricing_enabled && account.configured);
    return (available.find(account => account.default_for_pricing) || available[0])?.id || '';
  }, [accounts]);

  return { accounts, loading, error, defaultAccountId };
}
