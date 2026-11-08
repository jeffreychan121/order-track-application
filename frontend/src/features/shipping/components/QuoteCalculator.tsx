import React, { useEffect, useState } from 'react';
import { ApiError, api } from '../../../shared/api';
import { money } from '../../../shared/format';
import type { AnyRecord } from '../../../shared/types';
import { AccountPostageProducts, type AccountMerchantLocation } from './AccountPostageProducts';
import { ShippingAccountSelect } from './ShippingAccountSelect';
import { LocationFields, ShippingRateError } from './ShippingFormFields';
import { useShippingAccounts } from '../hooks/useShippingAccounts';
import { Alert, Box, Button, CircularProgress, Paper, Radio, Select, Stack, TextField, Typography } from '../../../shared/mui';

/** 查询承运商报价并可把所选报价写入已保存的 Shipment。 */
export function QuoteCalculator({ defaultOrigin, defaultDestination, defaultPackage, orderNo, shipmentId, order, shipment, onApplied, carrierSelector, carrier = '', carrierId, carrierCode = '', integrationType = '' }: { defaultOrigin: AnyRecord; defaultDestination: AnyRecord; defaultPackage: AnyRecord; orderNo?: string; shipmentId?: number; order?: AnyRecord; shipment?: AnyRecord; onApplied?: (order: AnyRecord) => void; carrierSelector?: React.ReactNode; carrier?: string; carrierId?: number; carrierCode?: string; integrationType?: string }) {
  const { accounts, loading: accountsLoading, error: accountsError, defaultAccountId } = useShippingAccounts();
  const [accountProfileId, setAccountProfileId] = useState(shipment?.shipping_account_profile_id || '');
  const [origin, setOrigin] = useState(defaultOrigin); const [destination, setDestination] = useState(defaultDestination); const [pkg, setPkg] = useState(defaultPackage);
  const [rates, setRates] = useState<AnyRecord[]>([]); const [selected, setSelected] = useState(''); const [loading, setLoading] = useState(false); const [saving, setSaving] = useState(false); const [error, setError] = useState(''); const [errorCode, setErrorCode] = useState(''); const [message, setMessage] = useState(''); const [accountProductsOpen, setAccountProductsOpen] = useState(false);
  /** 地址、包裹或账号改变后使旧报价失效，避免应用不匹配的价格。 */
  const resetQuote = () => { setRates([]); setSelected(''); setError(''); setErrorCode(''); setMessage(''); };
  const pricingAccountAvailable = accounts.some(item => item.id === accountProfileId && item.enabled && item.pricing_enabled && item.configured);
  useEffect(() => { if (!accountProfileId && defaultAccountId) setAccountProfileId(defaultAccountId); }, [accountProfileId, defaultAccountId]);
  /** 修改地址后清除当前报价，避免把旧路线的费用展示或保存到 Shipment。 */
  const changeLocation = (which: 'origin' | 'destination', key: string, value: string) => { resetQuote(); if (which === 'origin') setOrigin((prev: AnyRecord) => ({ ...prev, [key]: value })); else setDestination((prev: AnyRecord) => ({ ...prev, [key]: value })); };
  /** 使用报价账号登记的揽收点作为起点，并同步使旧报价失效。 */
  const useAccountLocation = (location: AccountMerchantLocation) => { resetQuote(); setOrigin((previous: AnyRecord) => ({ ...previous, type: 'MERCHANT_LOCATION', suburb: location.suburb || '', state: location.state || '', postcode: location.postcode || '', country: 'AU' })); };
  /** 包裹数据变化后必须重新报价，已选服务不能继续沿用。 */
  const changePackage = (key: string, value: string) => { resetQuote(); setPkg((prev: AnyRecord) => ({ ...prev, [key]: value })); };
  /** 调用报价 API 前先验证适配器、账号、澳洲邮编和完整包裹尺寸。 */
  const requestRates = async () => {
    resetQuote();
    if (carrierCode === 'TNT') { setError('TNT rate service is not implemented. No request was sent.'); return; }
    if (integrationType && integrationType !== 'AUSTRALIA_POST') { setError(`${carrier || 'This carrier'} has no configured rate adapter.`); return; }
    if (!pricingAccountAvailable) { setError('Select a configured pricing account.'); return; }
    if (!/^\d{4}$/.test(origin.postcode) || !/^\d{4}$/.test(destination.postcode)) { setError('Origin and destination postcodes must contain four digits.'); return; }
    if (![pkg.weight, pkg.length, pkg.width, pkg.height].every((value: string) => Number(value) > 0)) { setError('Enter a positive package weight and all three outer dimensions.'); return; }
    setLoading(true);
    try { const result = await api('/api/shipping/rates', { method: 'POST', body: JSON.stringify({ origin, destination, packages: [{ weight: pkg.weight, length: pkg.length, width: pkg.width, height: pkg.height }], shipping_account_profile_id: accountProfileId, ...(carrierId ? { carrier_id: carrierId } : {}), ...(orderNo ? { order_no: orderNo, shipment_id: shipmentId } : {}) }) }); setRates(result.rates || []); if (!result.rates?.length) setMessage('No eligible services were returned for this account, route and parcel. Your entered details are unchanged.'); }
    catch (err: any) { setError(err.message); setErrorCode(err instanceof ApiError ? err.code || '' : ''); } finally { setLoading(false); }
  };
  /** 只将本次查询返回且用户选中的 quote_id 应用到已保存 Shipment。 */
  const applyRate = async () => { if (!selected || !shipmentId) return; setSaving(true); setError(''); try { const updated = await api(`/api/shipping/shipments/${shipmentId}/apply-rate`, { method: 'POST', body: JSON.stringify({ quote_id: selected }) }); onApplied?.(updated); } catch (err: any) { setError(err.message); } finally { setSaving(false); } };
  const productsInShipment = shipment && order ? order.line_items.filter((line: AnyRecord) => line.tracking_group === shipment.tracking_group).map((line: AnyRecord) => `${line.sku} × ${line.quantity}`).join(', ') : '';
  return <Box>
    {order && shipment && <Typography variant="body2" color="text.secondary" mb={1.2}>{shipment.carrier} · {shipment.tracking_number || 'Tracking number not entered'}</Typography>}
    <Paper className="api-test-query-panel" variant="outlined" sx={{ p: { xs: 1.5, sm: 2 }, mb: 1.5 }}>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: integrationType === 'AUSTRALIA_POST' && carrierCode !== 'TNT' ? 'minmax(200px, 280px) minmax(0, 1fr)' : 'minmax(220px, 280px)', lg: integrationType === 'AUSTRALIA_POST' && carrierCode !== 'TNT' ? 'minmax(220px, 280px) minmax(320px, 520px)' : 'minmax(220px, 280px)' }, gap: 1.5, alignItems: 'start' }}>
        {carrierSelector && <Box sx={{ minWidth: 0 }}>{carrierSelector}</Box>}
        {integrationType === 'AUSTRALIA_POST' && carrierCode !== 'TNT' && <Box sx={{ minWidth: 0 }}>
          <ShippingAccountSelect accounts={accounts} loading={accountsLoading} value={accountProfileId} onChange={value => { resetQuote(); setAccountProfileId(value); }} missingProfile={shipment?.shipping_account_profile_id ? { id: shipment.shipping_account_profile_id, label: shipment.shipping_account_label || 'Saved pricing account', account_number_masked: shipment.shipping_account_number_masked } : null}/>
          <Box sx={{ display: 'flex', justifyContent: 'flex-start', mt: .5 }}>
            <AccountPostageProducts profileId={accountProfileId} onUseMerchantLocation={useAccountLocation} open={accountProductsOpen} onOpenChange={setAccountProductsOpen}/>
          </Box>
        </Box>}
      </Box>
      {integrationType === 'AUSTRALIA_POST' && accountsError && <Alert severity="error" sx={{ mt: 1.5 }}>Unable to load pricing account profiles: {accountsError}</Alert>}
    </Paper>
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 1.2, mb: 1.5 }}>
      <LocationFields title="Ship From" value={origin} onChange={(k,v) => changeLocation('origin',k,v)}/><LocationFields title="Ship To" value={destination} onChange={(k,v) => changeLocation('destination',k,v)} disabled={Boolean(orderNo)}/>
    </Box>
    {order && <Typography variant="caption" color="text.secondary" display="block" mb={1}>Shipment products: {productsInShipment || 'No associated products'}</Typography>}
    <Paper variant="outlined" sx={{ p: 1.5, mb: 1.5 }}><Stack className="package-info-heading" direction="row" spacing={1} sx={{ justifyContent: 'space-between', alignItems: 'baseline' }}><Typography variant="h6">Package Information</Typography>{order && <Typography variant="body2" color="text.secondary">Product weight {Number(defaultPackage.weight || 0).toFixed(3)} kg</Typography>}</Stack><Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(4, 1fr)' }, gap: 1.2, mt: 1 }}>
      {(['weight','length','width','height'] as const).map((key, index) => <TextField key={key} size="small" type="number" label={['Weight (kg)','Length (cm)','Width (cm)','Height (cm)'][index]} value={pkg[key]} slotProps={{ htmlInput: { min: .001, step: .001 } }} onChange={e => changePackage(key,e.target.value)} />)}
    </Box></Paper>
    <Stack className="quote-rate-actions" direction="row" sx={{ justifyContent: 'flex-end', mb: 1.5 }}><Button variant="contained" onClick={requestRates} disabled={loading || carrierCode === 'TNT' || (integrationType === 'AUSTRALIA_POST' && !pricingAccountAvailable)}>{loading ? 'Getting Rates…' : 'Get Rates'}</Button></Stack>
    {error && <ShippingRateError message={error} code={errorCode} onViewAccountDetails={accountProfileId ? () => setAccountProductsOpen(true) : undefined} />}{message && <Alert severity="info" sx={{ mb: 1.5 }}>{message}</Alert>}{loading && <Box sx={{ textAlign: 'center', py: 2 }}><CircularProgress size={25}/></Box>}
    {rates.length > 0 && <><Typography variant="h6" mb={.25}>Available Shipping Services</Typography><Typography variant="body2" color="text.secondary" mb={1}>These services were returned as eligible for the selected account, route and package. Select one to review its price{shipmentId ? ' and apply it to this Shipment.' : '.'}</Typography><Stack spacing={1}>{rates.map((rate: AnyRecord) => <Paper component="label" key={rate.quote_id} variant="outlined" sx={{ p: 1.5, cursor: 'pointer', borderColor: selected === rate.quote_id ? 'primary.main' : undefined, bgcolor: selected === rate.quote_id ? 'action.selected' : undefined }}><Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}><Radio size="small" checked={selected === rate.quote_id} onChange={() => setSelected(rate.quote_id)} slotProps={{ input: { 'aria-label': `Select ${rate.service_name}` } }}/><Box sx={{ flex: 1, minWidth: 0 }}><Typography fontWeight={700}>{rate.service_name}</Typography><Typography variant="body2" color="text.secondary">Australia Post Product ID: {rate.product_id || 'Not returned'}</Typography></Box><Box sx={{ textAlign: 'right', flexShrink: 0 }}><Typography variant="caption" color="text.secondary" display="block">Shipping {money(rate.shipping_cost)}</Typography><Typography variant="caption" color="text.secondary" display="block">Fuel {money(rate.fuel_surcharge)} · GST {money(rate.gst)}</Typography><Typography fontWeight={700}>Total {money(rate.total_cost)}</Typography></Box></Stack></Paper>)}</Stack>
      {shipmentId && <Stack className="quote-rate-actions" direction="row" sx={{ justifyContent: 'flex-end', mt: 1.5 }}><Button variant="contained" onClick={applyRate} disabled={!selected || saving}>{saving ? 'Applying…' : 'Apply Shipping Fee'}</Button></Stack>}
    </>}
  </Box>;
}
