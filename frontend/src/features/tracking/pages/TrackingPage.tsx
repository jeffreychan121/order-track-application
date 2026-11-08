import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { api } from '../../../shared/api';
import type { AnyRecord } from '../../../shared/types';
import { ApiTestingPageShell } from '../../api-testing/ApiTestingPageShell';
import { TrackingResult } from '../components/TrackingDisplay';
import { Alert, Box, Button, CircularProgress, FormControl, InputLabel, MenuItem, Paper, Select, Stack, TextField } from '../../../shared/mui';

/** 手动追踪页；先选择承运商和运单号，再展示标准化追踪事件。 */
export function TrackingPage() {
  const location = useLocation();
  const [carriers, setCarriers] = useState<AnyRecord[]>([]); const [carrier, setCarrier] = useState(''); const [trackingNumber, setTrackingNumber] = useState(''); const [result, setResult] = useState<AnyRecord | null>(null); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  useEffect(() => { api('/api/carriers?active_only=true').then((items: AnyRecord[]) => { setCarriers(items); setCarrier(current => current || items.find(item => item.is_active)?.name || ''); }).catch(err => setError(err.message)); }, []);
  const tntSelected = carrier.toLowerCase().includes('tnt');
  // TNT 当前未接入：前端拦截后不发出误导性的 Australia Post 请求。
  /** 支持表单提交和从订单页面带入查询参数，并统一展示 API 错误。 */
  const query = async (number = trackingNumber, selectedCarrier = carrier) => { if (selectedCarrier.toLowerCase().includes('tnt')) { setError('TNT tracking is not implemented.'); return; } setBusy(true); setError(''); setResult(null); try { const value = await api('/api/orders/tracking', { method: 'POST', body: JSON.stringify({ carrier: selectedCarrier, tracking_number: number.trim() }) }); setResult(value); } catch (err: any) { setError(err.message); } finally { setBusy(false); } };
  useEffect(() => { const state = location.state as AnyRecord | null; if (state?.tracking_number) { setCarrier(state.carrier); setTrackingNumber(state.tracking_number); query(state.tracking_number, state.carrier); } }, [location.state]);
  return <ApiTestingPageShell title="Tracking" description="Look up a carrier tracking number and review the latest shipment events.">
    <Paper variant="outlined" sx={{ p: { xs: 1.8, md: 2.5 } }}><Stack className="tracking-query-form" direction={{ xs: 'column', md: 'row' }} spacing={1.5} sx={{ alignItems: 'stretch' }}><FormControl size="small" sx={{ minWidth: 230 }}><InputLabel>Carrier</InputLabel><Select label="Carrier" value={carrier} onChange={e => { setCarrier(e.target.value); setResult(null); setError(''); }}>{carriers.map(item => <MenuItem key={item.id} value={item.name}>{item.name}</MenuItem>)}</Select></FormControl><TextField size="small" label="Tracking Number" value={trackingNumber} onChange={e => { setTrackingNumber(e.target.value); setResult(null); setError(''); }} fullWidth onKeyDown={e => e.key === 'Enter' && trackingNumber.trim() && !tntSelected && query()}/><Button variant="contained" disabled={busy || !carrier || !trackingNumber.trim() || tntSelected} onClick={() => query()}>{busy ? 'Tracking…' : 'Track'}</Button></Stack>{tntSelected && <Alert severity="info" sx={{ mt: 2 }}>TNT tracking is not implemented.</Alert>}{busy && <Box sx={{ textAlign: 'center', p: 3 }}><CircularProgress size={26}/></Box>}{error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}{result && <TrackingResult data={result} onRefresh={() => query()}/>}</Paper>
  </ApiTestingPageShell>;
}
