import { useEffect, useState } from 'react';
import { Add } from '@mui/icons-material';
import { ApiError, api } from '../../../shared/api';
import { money } from '../../../shared/format';
import type { AnyRecord } from '../../../shared/types';
import { useConfirm } from '../../../shared/hooks/useConfirm';
import { AccountPostageProducts, type AccountMerchantLocation } from './AccountPostageProducts';
import { ShippingAccountSelect } from './ShippingAccountSelect';
import { LocationFields, ShippingRateError } from './ShippingFormFields';
import { useShippingAccounts } from '../hooks/useShippingAccounts';
import { defaultShippingOrigin, orderShippingDestination } from '../defaults';
import { Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, FormControl, InputLabel, Checkbox, FormControlLabel, FormGroup, MenuItem, Paper, Radio, Select, Stack, List, ListItemButton, ListItemText, Tooltip, TextField, Typography } from '../../../shared/mui';

/** 为订单行分配独立 Shipment，查询报价后再保存计划或应用运费。 */
export function ShippingQuoteDialog({ order, shipment, onClose, onApplied }: { order: AnyRecord; shipment: AnyRecord | null; onClose: () => void; onApplied: (order: AnyRecord) => void }) {
  const { confirm, confirmDialog } = useConfirm();
  const { accounts, loading: accountsLoading, error: accountsError, defaultAccountId } = useShippingAccounts();
  type PlannerDraft = { carrierId: number | ''; accountProfileId: string; lineIds: number[]; origin: AnyRecord; destination: AnyRecord; pkg: { weight: string; length: string; width: string; height: string } };
  const lines = order.line_items as AnyRecord[];
  const makeDraft = (item: AnyRecord | null, fallbackCarrier: number | '' = ''): PlannerDraft => {
    // 每个 Shipment 独立建立草稿；净重从已分配订单行派生，不再额外维护一份易失同步的重量状态。
    const assigned = item?.order_line_ids || [];
    const netWeight = lines.filter(line => assigned.includes(line.id)).reduce((sum, line) => sum + Number(line.product_weight_g || 0) * Number(line.quantity), 0);
    const savedPackage = item?.packages?.[0];
    return { carrierId: item?.carrier_id || fallbackCarrier, accountProfileId: item?.shipping_account_profile_id || '', lineIds: assigned,
      origin: item?.origin || defaultShippingOrigin(), destination: item?.destination || orderShippingDestination(order.shipping_address, order.address_line2),
      pkg: { weight: savedPackage ? String(savedPackage.weight_gross_g / 1000) : netWeight ? (netWeight / 1000).toFixed(3) : '',
        length: savedPackage ? String(savedPackage.length_mm / 10) : '', width: savedPackage ? String(savedPackage.width_mm / 10) : '', height: savedPackage ? String(savedPackage.height_mm / 10) : '' } };
  };
  const [carriers, setCarriers] = useState<AnyRecord[]>([]); const [currentShipment, setCurrentShipment] = useState<AnyRecord | null>(shipment);
  const [drafts, setDrafts] = useState<Record<string, PlannerDraft>>(() => ({ [String(shipment?.id ?? 'new')]: makeDraft(shipment) }));
  const draftKey = String(currentShipment?.id ?? 'new'); const draft = drafts[draftKey] || makeDraft(currentShipment);
  const { carrierId, accountProfileId, lineIds, origin, destination, pkg } = draft;
  const [formDirty, setFormDirty] = useState(false);
  /** 按当前 Shipment ID 更新独立草稿，避免切换计划时相互覆盖。 */
  const updateDraft = (changes: Partial<PlannerDraft>) => { setFormDirty(true); setDrafts(previous => ({ ...previous, [draftKey]: { ...(previous[draftKey] || draft), ...changes } })); };
  const setCarrierId = (value: number | '') => updateDraft({ carrierId: value });
  const setOrigin = (update: AnyRecord | ((current: AnyRecord) => AnyRecord)) => updateDraft({ origin: typeof update === 'function' ? update(origin) : update });
  const setDestination = (update: AnyRecord | ((current: AnyRecord) => AnyRecord)) => updateDraft({ destination: typeof update === 'function' ? update(destination) : update });
  const setPkg = (update: PlannerDraft['pkg'] | ((current: PlannerDraft['pkg']) => PlannerDraft['pkg'])) => updateDraft({ pkg: typeof update === 'function' ? update(pkg) : update });
  const [rates, setRates] = useState<AnyRecord[]>([]); const [selectedRate, setSelectedRate] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [errorCode, setErrorCode] = useState(''); const [message, setMessage] = useState(''); const [accountProductsOpen, setAccountProductsOpen] = useState(false);
  useEffect(() => { api('/api/carriers').then((items: AnyRecord[]) => { setCarriers(items); if (carrierId === '' && !shipment) { const first = items.find(item => item.is_active); if (first) setCarrierId(first.id); } }).catch(err => setError(err.message)); }, []);
  // 异步加载到可用账号后，为当前尚未指定账号的草稿选择服务端默认档案。
  useEffect(() => {
    if (!defaultAccountId || accountProfileId) return;
    setDrafts(previous => ({ ...previous, [draftKey]: { ...(previous[draftKey] || draft), accountProfileId: defaultAccountId } }));
  }, [accountProfileId, defaultAccountId, draftKey]);
  const carrier = carriers.find(item => item.id === Number(carrierId));
  const pricingAccountAvailable = accounts.some(item => item.id === accountProfileId && item.enabled && item.pricing_enabled && item.configured);
  /** 已分配给其他 Shipment 的订单行不能重复选择。 */
  const alreadyAllocated = (line: AnyRecord) => (order.shipments || []).some((other: AnyRecord) => other.id !== currentShipment?.id && other.order_line_ids?.includes(line.id));
  const selectedLines = lines.filter(line => lineIds.includes(line.id));
  const netWeightG = selectedLines.reduce((sum, line) => sum + Number(line.product_weight_g || 0) * Number(line.quantity), 0);
  // 输入条件变化后旧报价不再匹配当前地址/包裹，必须立即清除避免误应用。
  /** 任何影响服务资格的输入改变后，清除旧报价及其选择。 */
  const invalidate = () => { setRates([]); setSelectedRate(''); setMessage(''); setError(''); setErrorCode(''); };
  /** 同步切换订单行分配和净重；实际包裹重量仍允许用户补充包装重量。 */
  const toggleLine = (line: AnyRecord) => { invalidate(); const next = lineIds.includes(line.id) ? lineIds.filter(id => id !== line.id) : [...lineIds, line.id]; const grams = lines.filter(item => next.includes(item.id)).reduce((sum, item) => sum + Number(item.product_weight_g || 0) * Number(item.quantity), 0); updateDraft({ lineIds: next, pkg: { ...pkg, weight: grams ? (grams / 1000).toFixed(3) : '' } }); };
  /** 修改地址时同步更新当前 Shipment 草稿并让之前的报价失效。 */
  const updateLocation = (which: 'origin' | 'destination', key: string, value: string) => { invalidate(); if (which === 'origin') setOrigin((old: AnyRecord) => ({ ...old, [key]: value })); else setDestination((old: AnyRecord) => ({ ...old, [key]: value })); };
  /** 将所选合同档案的揽收地点带入起运地址。 */
  const useAccountLocation = (location: AccountMerchantLocation) => { invalidate(); setOrigin((old: AnyRecord) => ({ ...old, type: 'MERCHANT_LOCATION', suburb: location.suburb || '', state: location.state || '', postcode: location.postcode || '', country: 'AU' })); };
  /** 修改任一外包装尺寸或毛重时清除报价，避免误用旧价格。 */
  const updatePackage = (key: string, value: string) => { invalidate(); setPkg(old => ({ ...old, [key]: value })); };
  const packages = Object.values(pkg).every(value => Number(value) > 0) ? [{ weight_kg: pkg.weight, length_cm: pkg.length, width_cm: pkg.width, height_cm: pkg.height }] : [];
  /** 目前只支持澳洲地址，因此要求州缩写和四位邮编符合格式。 */
  const addressValid = (value: AnyRecord) => Boolean(value.suburb?.trim() && /^[A-Z]{2,3}$/.test(value.state || '') && /^\d{4}$/.test(value.postcode || '') && /^[A-Z]{2}$/.test(value.country || ''));
  /** 查询前校验承运商适配器、账号、未占用订单行、地址和毛重。 */
  const requestRates = async () => { invalidate(); setError(''); if (!carrier) { setError('Select an active carrier.'); return; } if (carrier.code === 'TNT') { setError('TNT rate service is not implemented.'); return; } if (!ratesSupported) { setError(`No Australia Post rate adapter is configured for ${carrier.name}.`); return; } if (!pricingAccountAvailable) { setError('Select a configured pricing account.'); return; } if (!lineIds.length) { setError('Select at least one unassigned order line.'); return; } if (!addressValid(origin) || !addressValid(destination)) { setError('Enter valid Australian origin and destination suburbs, states and postcodes.'); return; } if (!packages.length) { setError('Enter package gross weight and all outer dimensions.'); return; } if (Number(pkg.weight) * 1000 < netWeightG) { setError('Package gross weight cannot be less than selected product net weight.'); return; }
    setBusy(true); try { const result = await api(`/api/shipping/orders/${encodeURIComponent(order.order_id)}/quotes/preview`, { method: 'POST', body: JSON.stringify({ carrier_id: carrier.id, shipping_account_profile_id: accountProfileId, order_line_ids: lineIds, ...(currentShipment?.id ? { shipment_id: currentShipment.id, tracking_number: currentShipment.tracking_number } : {}), origin, destination, packages }) }); setRates(result.rates || []); if (!result.rates?.length) setMessage('No eligible services were returned. Your selected order lines and package details are unchanged.'); }
    catch (err: any) { setError(err.message); setErrorCode(err instanceof ApiError ? err.code || '' : ''); } finally { setBusy(false); } };
  /** 不带 quote_id 时只保存 Shipment 计划；带 quote_id 时应用缓存中的报价。 */
  const savePlan = async (quoteId?: string) => { setBusy(true); setError(''); setErrorCode(''); try { const saved = quoteId ? await api(`/api/shipping/orders/${encodeURIComponent(order.order_id)}/quotes/apply`, { method: 'POST', body: JSON.stringify({ quote_id: quoteId }) }) : await api(`/api/shipping/orders/${encodeURIComponent(order.order_id)}/shipments/save`, { method: 'POST', body: JSON.stringify({ carrier_id: carrier?.id, shipping_account_profile_id: pricingAccountAvailable ? accountProfileId : undefined, order_line_ids: lineIds, ...(currentShipment?.id ? { shipment_id: currentShipment.id, tracking_number: currentShipment.tracking_number } : {}), origin, destination, packages }) });
      onApplied(saved); const assigned = saved.shipments.find((item: AnyRecord) => item.id === currentShipment?.id) || saved.shipments.find((item: AnyRecord) => lineIds.every(id => item.order_line_ids?.includes(id)) && item.order_line_ids?.length === lineIds.length); if (assigned) { setCurrentShipment(assigned); setDrafts(previous => ({ ...previous, [String(assigned.id)]: makeDraft(assigned) })); } setFormDirty(false); invalidate();
    } catch (err: any) { setError(err.message); setErrorCode(err instanceof ApiError ? err.code || '' : ''); } finally { setBusy(false); } };
  /** 开始新的 Shipment 草稿，保留其他计划各自的编辑内容。 */
  const addAnother = () => { setDrafts(previous => ({ ...previous, new: { ...makeDraft(null, carriers.find(item => item.is_active)?.id || ''), accountProfileId: defaultAccountId } })); setCurrentShipment(null); setFormDirty(false); invalidate(); };
  /** 关闭时若当前计划有未保存修改，先由用户确认是否丢弃。 */
  const handleClose = async () => { if (formDirty && !await confirm({ title: 'Discard unsaved changes?', message: 'Discard unsaved changes to this Shipment plan?', confirmText: 'Discard Changes', confirmColor: 'error' })) return; onClose(); };
  const ratesSupported = carrier?.integration_type === 'AUSTRALIA_POST' && carrier.code !== 'TNT';
  return <><Dialog className="shipping-quote-dialog" open onClose={handleClose} fullWidth maxWidth="lg"><DialogTitle>Shipping Planner · {order.order_id}{currentShipment && <Typography variant="body2" color="text.secondary">Shipment {currentShipment.id} · {currentShipment.carrier}</Typography>}</DialogTitle>
    <DialogContent dividers><Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: 'minmax(260px, .85fr) minmax(440px, 1.5fr)' }, gap: 2 }}>
      <Paper className="planner-shipment-panel" variant="outlined" sx={{ p: 1.5 }}><Stack direction="row" spacing={1} sx={{ justifyContent: 'space-between', alignItems: 'center', mb: .5 }}><Typography variant="h6">Shipping Plan</Typography><Button size="small" startIcon={<Add/>} onClick={addAnother}>Add Shipment</Button></Stack><Typography className="planner-panel-hint" variant="caption" color="text.secondary">Choose a saved Shipment to edit or start a new one.</Typography>{order.shipments.length ? <List className="planner-shipment-list" disablePadding>{order.shipments.map((item: AnyRecord) => { const selected = currentShipment?.id === item.id; const savedCarrier = carriers.find(candidate => candidate.id === item.carrier_id); const quoteSaved = item.shipping_quote_status === 'quoted'; return <ListItemButton key={item.id} className="planner-shipment-option" selected={selected} onClick={() => { setDrafts(previous => previous[String(item.id)] ? previous : { ...previous, [String(item.id)]: makeDraft(item) }); setCurrentShipment(item); setFormDirty(false); invalidate(); }}><ListItemText primary={<Typography variant="body2" fontWeight={650}>Shipment {item.id} · {item.carrier}</Typography>} secondary={item.related_skus?.join(', ') || 'No order lines assigned'}/><Chip size="small" color={quoteSaved ? 'success' : 'default'} variant={quoteSaved ? 'filled' : 'outlined'} label={quoteSaved ? money(item.shipping_fee) : savedCarrier?.code === 'TNT' ? 'Rates unavailable' : 'Not quoted'}/></ListItemButton>; })}</List> : <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>No shipment plans saved.</Typography>}{!currentShipment && <Chip className="planner-new-shipment-chip" size="small" color="primary" label="New Shipment"/>}</Paper>
      <Stack spacing={1.5}><FormControl size="small" fullWidth><InputLabel>Carrier *</InputLabel><Select label="Carrier *" value={carrierId} onChange={e => { setCarrierId(Number(e.target.value)); invalidate(); }}><MenuItem value="" disabled>Select carrier</MenuItem>{currentShipment && !carriers.some(item => item.id === currentShipment.carrier_id) && <MenuItem value={currentShipment.carrier_id}>{currentShipment.carrier}</MenuItem>}{carriers.map(item => <MenuItem key={item.id} value={item.id} disabled={!item.is_active && item.id !== currentShipment?.carrier_id}>{item.name}{!item.is_active ? ' · Inactive' : ''}</MenuItem>)}</Select></FormControl>
        {ratesSupported && <Box sx={{ minWidth: 0 }}>
          <ShippingAccountSelect accounts={accounts} loading={accountsLoading} value={accountProfileId} onChange={value => { invalidate(); updateDraft({ accountProfileId: value }); }} missingProfile={currentShipment?.shipping_account_profile_id ? { id: currentShipment.shipping_account_profile_id, label: currentShipment.shipping_account_label || 'Saved pricing account', account_number_masked: currentShipment.shipping_account_number_masked } : null}/>
          <Box sx={{ display: 'flex', justifyContent: 'flex-start', mt: .5 }}>
            <AccountPostageProducts profileId={accountProfileId} onUseMerchantLocation={useAccountLocation} open={accountProductsOpen} onOpenChange={setAccountProductsOpen}/>
          </Box>
        </Box>}
        {ratesSupported && accountsError && <Alert severity="error">Unable to load pricing account profiles: {accountsError}</Alert>}
        {!carriers.some(item => item.is_active) && <Alert severity="info">No active carriers. Maintain carriers first.</Alert>}
        <Paper className="planner-lines-panel" variant="outlined" sx={{ p: 1.25 }}><Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'baseline', mb: .5 }}><Typography variant="subtitle2" fontWeight={700}>Select Order Lines *</Typography><Typography variant="caption" color="text.secondary">{lineIds.length} selected</Typography></Stack><FormGroup className="planner-order-lines">{lines.map(line => { const disabled = alreadyAllocated(line); const checked = lineIds.includes(line.id); const grams = Number(line.product_weight_g || 0) * Number(line.quantity); const assignedShipment = disabled ? order.shipments.find((s: AnyRecord) => s.order_line_ids?.includes(line.id)) : null; return <FormControlLabel key={line.id} className="planner-order-line" disabled={disabled} control={<Checkbox size="small" checked={checked} onChange={() => toggleLine(line)} slotProps={{ input: { 'aria-label': `Select ${line.sku}` } }}/>} label={<Box className="planner-order-line-copy"><Box sx={{ minWidth: 0 }}><Typography variant="body2" fontWeight={600}>{line.product_name}</Typography><Typography variant="caption" color="text.secondary">{line.sku} · Qty {line.quantity} · {line.product_weight_g ?? '—'} g each</Typography></Box><Box className="planner-order-line-meta">{disabled ? <Chip size="small" variant="outlined" label={`Shipment ${assignedShipment?.id ?? ''}`}/> : checked ? <Typography variant="caption" fontWeight={650}>{grams} g</Typography> : <Typography variant="caption" color="text.secondary">Available</Typography>}</Box></Box>}/>; })}</FormGroup><Typography variant="caption" color="text.secondary" display="block" sx={{ mt: .75 }}>Order lines describe parcel contents and calculate product weight. Australia Post postage products are selected from the rates returned for this account, route and parcel.</Typography></Paper>
        <Box className="shipping-location-grid" sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: { xs: 2, sm: 2.5 } }}><LocationFields title="Ship From" value={origin} onChange={(k,v) => updateLocation('origin',k,v)}/><LocationFields title="Ship To" value={destination} onChange={(k,v) => updateLocation('destination',k,v)}/></Box>
        <Paper variant="outlined" sx={{ p: 1.25 }}><Typography variant="subtitle2" fontWeight={700} mb={1}>Package Information</Typography><Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', md: 'minmax(0, 1.35fr) repeat(3, minmax(0, 1fr))' }, gap: 1 }}>{(['weight','length','width','height'] as const).map((key, index) => <TextField key={key} size="small" type="number" label={['Gross Weight kg','Length cm','Width cm','Height cm'][index]} slotProps={{ inputLabel: { shrink: true }, htmlInput: { min: .001, step: .001 } }} value={pkg[key]} onChange={e => updatePackage(key,e.target.value)}/>)}</Box></Paper>
        {carrier?.code === 'TNT' && <Alert severity="info">TNT rate service is not implemented. You can save this Shipment plan without a quote.</Alert>}
        {carrier && carrier.code !== 'TNT' && !ratesSupported && <Alert severity="info">No rate adapter is configured for {carrier.name}. You can save this Shipment plan without a quote.</Alert>}
        {error && <ShippingRateError message={error} code={errorCode} onViewAccountDetails={accountProfileId ? () => setAccountProductsOpen(true) : undefined} />}{message && <Alert severity="info">{message}</Alert>}{busy && <CircularProgress size={22}/>}
        {rates.length > 0 && <Paper className="planner-rates-panel" variant="outlined" sx={{ p: 1.25 }}><Typography variant="subtitle2" fontWeight={700} mb={.75}>Available Shipping Services</Typography><Stack spacing={.5}>{rates.map(rate => <Paper component="label" key={rate.quote_id} className={`planner-rate-option${selectedRate === rate.quote_id ? ' is-selected' : ''}`} variant="outlined"><Radio size="small" checked={selectedRate === rate.quote_id} onChange={() => setSelectedRate(rate.quote_id)} slotProps={{ input: { 'aria-label': `Select ${rate.service_name}` } }}/><Box flex={1}><Typography variant="body2" fontWeight={650}>{rate.service_name}</Typography><Typography variant="caption" color="text.secondary">Product {rate.product_id || '—'} · Base {money(rate.shipping_cost)} · Fuel {money(rate.fuel_surcharge)} · GST {money(rate.gst)}</Typography></Box><Typography fontWeight={700}>{money(rate.total_cost)}</Typography></Paper>)}</Stack></Paper>}
      </Stack></Box></DialogContent>
    <DialogActions className="planner-dialog-actions" sx={{ justifyContent: 'space-between', px: 2, py: 1.2 }}><Button disabled={busy || !carrierId || !lineIds.length || order.status !== 'draft'} onClick={() => savePlan()}>{busy ? 'Saving…' : 'Save Shipment Only'}</Button><Stack className="planner-action-buttons" direction="row" spacing={1}><Tooltip title={carrier?.code === 'TNT' ? 'TNT rate service is not implemented.' : !ratesSupported ? 'No rate adapter is configured for this carrier.' : !selectedRate ? 'Get rates and select a service before applying the shipping fee.' : ''}><span><Button variant="contained" disabled={busy || !selectedRate} onClick={() => savePlan(selectedRate)}>{busy ? 'Applying…' : 'Apply Shipping Fee'}</Button></span></Tooltip><Button disabled={busy || !ratesSupported || !carrierId || !pricingAccountAvailable || !lineIds.length} onClick={requestRates}>{busy ? 'Getting Rates…' : rates.length ? 'Recalculate' : 'Get Rates'}</Button><Button onClick={handleClose}>Close</Button></Stack></DialogActions>
  </Dialog>{confirmDialog}</>;
}
