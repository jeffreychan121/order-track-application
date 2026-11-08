import { useEffect, useState } from 'react';
import { api } from '../../../shared/api';
import type { AnyRecord } from '../../../shared/types';
import { ApiTestingPageShell } from '../../api-testing/ApiTestingPageShell';
import { QuoteCalculator } from '../components/QuoteCalculator';
import { defaultShippingDestination, defaultShippingOrigin } from '../defaults';
import { Alert, Box, FormControl, InputLabel, MenuItem, Paper, Select } from '../../../shared/mui';

/** 运费测试页只展示启用承运商；默认选择有已实现报价适配器的承运商。 */
export function ShippingRatesPage() {
  const [carriers, setCarriers] = useState<AnyRecord[]>([]); const [carrierId, setCarrierId] = useState<number | ''>(''); const selectedCarrier = carriers.find(item => item.id === Number(carrierId));
  useEffect(() => { api('/api/carriers?active_only=true').then((items: AnyRecord[]) => { setCarriers(items); setCarrierId(items.find(item => item.is_active && item.code !== 'TNT')?.id || items.find(item => item.is_active)?.id || ''); }).catch(() => setCarriers([])); }, []);
  const carrierSelector = <FormControl size="small" fullWidth><InputLabel>Carrier</InputLabel><Select label="Carrier" value={carrierId} onChange={e => setCarrierId(Number(e.target.value))}>{carriers.map(item => <MenuItem key={item.id} value={item.id}>{item.name}</MenuItem>)}</Select></FormControl>;
  return <ApiTestingPageShell title="Shipping Rates" description="Request contract pricing for a destination and parcel. Select an account, enter package details, then review eligible services.">
    {selectedCarrier?.code === 'TNT'
      ? <Paper className="api-test-query-panel" variant="outlined" sx={{ p: { xs: 1.5, sm: 2 } }}><Box sx={{ width: { xs: '100%', sm: 320 }, maxWidth: '100%', mb: 1.5 }}>{carrierSelector}</Box><Alert severity="info">TNT rate service is not implemented.</Alert></Paper>
      : selectedCarrier
        ? <QuoteCalculator key={selectedCarrier.id} carrierSelector={carrierSelector} carrier={selectedCarrier.name} carrierId={selectedCarrier.id} carrierCode={selectedCarrier.code} integrationType={selectedCarrier.integration_type} defaultOrigin={defaultShippingOrigin()} defaultDestination={defaultShippingDestination()} defaultPackage={{ weight: '', length: '', width: '', height: '' }} />
        : <Paper className="api-test-query-panel" variant="outlined" sx={{ p: { xs: 1.5, sm: 2 } }}><Box sx={{ width: { xs: '100%', sm: 320 }, maxWidth: '100%', mb: 1.5 }}>{carrierSelector}</Box><Alert severity="info">No active carriers are available.</Alert></Paper>}
  </ApiTestingPageShell>;
}
