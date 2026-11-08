import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Add, EditOutlined, MoreVert } from '@mui/icons-material';
import { api } from '../../../shared/api';
import { calculateOrderGstCents, calculateOrderLineAmounts, formatDate, formatDateTime, isValidMoneyAmount, isValidOrderLineGstRate, money } from '../../../shared/format';
import type { AnyRecord, Carrier, Order } from '../../../shared/types';
import { PageHeading } from '../../../shared/components/PageHeading';
import { OrderLinesTable } from '../components/OrderLinesTable';
import { OrderStatusBar } from '../components/OrderStatusBar';
import { OrderSummary } from '../components/OrderSummary';
import { useConfirm } from '../../../shared/hooks/useConfirm';
import { ShippingQuoteDialog } from '../../shipping/components/ShippingQuoteDialog';
import { TrackingResult, TrackingStatusChip, trackingEventTimeLabel } from '../../tracking/components/TrackingDisplay';
import { defaultOrderShippingAddress, statusLabels, statusSequence } from '../constants';
import { Alert, Autocomplete, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Divider, Drawer, FormControl, IconButton, InputLabel, Checkbox, FormControlLabel, MenuItem, Paper, Select, Stack, Menu, Snackbar, Tooltip, Tab, Tabs, TextField, Typography } from '../../../shared/mui';

type LineInput = { sku: string; quantity: number | string; tracking_group: string; rrp_incl_gst?: string; gst_rate_percent?: string };
type ShipmentInput = { id?: number; tracking_group: string; carrier: string; carrier_id?: number; shipping_account_profile_id?: string | null; tracking_number: string };
/** 订单详情与新建共用此表单；saved 表示服务端快照，form 表示当前编辑草稿。 */
export function OrderForm({ productsKey }: { productsKey: number }) {
  const { id } = useParams(); const isNew = !id; const navigate = useNavigate();
  const { confirm, confirmDialog } = useConfirm();
  const [products, setProducts] = useState<AnyRecord[]>([]); const [carriers, setCarriers] = useState<AnyRecord[]>([]); const [saved, setSaved] = useState<AnyRecord | null>(null); const [form, setForm] = useState<AnyRecord | null>(null);
  const [editing, setEditing] = useState(isNew); const [loading, setLoading] = useState(!isNew); const [saving, setSaving] = useState(false); const [error, setError] = useState(''); const [tab, setTab] = useState(0); const [quoteShipment, setQuoteShipment] = useState<AnyRecord | null>(null); const [trackingMap, setTrackingMap] = useState<Record<string, AnyRecord>>({}); const [trackingDrawer, setTrackingDrawer] = useState<AnyRecord | null>(null); const [trackingDrawerShipment, setTrackingDrawerShipment] = useState<AnyRecord | null>(null); const [trackingBusy, setTrackingBusy] = useState<string | null>(null); const [trackingLoading, setTrackingLoading] = useState(false);
  const trackingLoadSignatureRef = useRef<Record<string, string>>({}); const activeTrackingOrderRef = useRef<string | null>(null);
  const [shipmentMenu, setShipmentMenu] = useState<{ anchor: HTMLElement; shipment: AnyRecord } | null>(null);
  const [columnsMenuAnchor, setColumnsMenuAnchor] = useState<HTMLElement | null>(null); const [showAssignedTracking, setShowAssignedTracking] = useState(false);
  const [notice, setNotice] = useState('');
  const [productDialog, setProductDialog] = useState(false); const [productChoice, setProductChoice] = useState<AnyRecord | null>(null); const [productQty, setProductQty] = useState(1); const [productRrp, setProductRrp] = useState('');
  // 订单行名称、描述与重量从商品目录补齐；请求失败时保留页面并显示错误。
  const loadProducts = () => api('/api/products').then(setProducts).catch(err => setError(err.message));
  const setField = (name: string, value: unknown) => setForm((previous: AnyRecord | null) => previous ? { ...previous, [name]: value } : previous);
  const setCustomer = (name: string, value: unknown) => setForm((previous: AnyRecord | null) => previous ? { ...previous, customer: { ...previous.customer, [name]: value } } : previous);
  const setAddress = (name: string, value: unknown) => setForm((previous: AnyRecord | null) => previous ? { ...previous, shipping_address: { ...previous.shipping_address, [name]: value } } : previous);
  // 把只读 API 响应转换为表单草稿形状；空运单和分组统一转为空字符串供输入框使用。
  const hydrate = (order: AnyRecord) => ({ order_date: order.order_date, company_name: order.company_name, status: order.status,
    customer: { ...order.customer }, shipping_address: { ...order.shipping_address, address_line2: order.address_line2 || '' },
    line_items: order.line_items.map((line: AnyRecord) => ({ sku: line.sku, quantity: line.quantity, tracking_group: line.tracking_group || '', rrp_incl_gst: line.rrp_incl_gst, gst_rate_percent: line.gst_rate_percent ?? '10.00' })),
    shipments: order.shipments.map((shipment: AnyRecord) => ({ tracking_group: shipment.tracking_group, carrier: shipment.carrier, carrier_id: shipment.carrier_id, shipping_account_profile_id: shipment.shipping_account_profile_id, tracking_number: shipment.tracking_number || '', id: shipment.id })) });
  useEffect(() => { loadProducts(); }, [productsKey]);
  useEffect(() => { api('/api/carriers').then(setCarriers).catch(err => setError(err.message)); }, [productsKey]);
  useEffect(() => {
    if (!id) { const empty = { order_date: new Date().toISOString().slice(0, 10), company_name: '', status: 'draft', customer: { name: '', phone: '', email: '' }, shipping_address: defaultOrderShippingAddress(), line_items: [], shipments: [] }; setForm(empty); setSaved(null); setEditing(true); setLoading(false); return; }
    let alive = true; setLoading(true); api(`/api/orders/${encodeURIComponent(id)}`).then(order => { if (!alive) return; setSaved(order); setForm(hydrate(order)); setEditing(false); }).catch(err => setError(err.message)).finally(() => alive && setLoading(false)); return () => { alive = false; };
  }, [id]);
  // 只在运单集合变化时更新签名，切换标签页时复用已有结果避免重复查询。
  const trackingSnapshotKey = JSON.stringify((saved?.shipments || [])
    .filter((shipment: AnyRecord) => shipment.tracking_number?.trim())
    .map((shipment: AnyRecord) => `${shipment.carrier}|${shipment.tracking_number.trim()}`).sort());
  useEffect(() => { activeTrackingOrderRef.current = saved?.order_id ?? null; setTrackingLoading(false); }, [saved?.order_id]);
  useEffect(() => {
    if (!saved || tab !== 1 || !trackingSnapshotKey || trackingSnapshotKey === '[]') return;
    const orderNo = saved.order_id as string;
    if (trackingLoadSignatureRef.current[orderNo] === trackingSnapshotKey) return;

    // 浏览同一订单的其他页签时复用已加载结果；新运单号才进行一次非强制刷新查询。
    trackingLoadSignatureRef.current[orderNo] = trackingSnapshotKey;
    setTrackingLoading(true);
    api(`/api/orders/${encodeURIComponent(orderNo)}/tracking?refresh=false`).then((items: AnyRecord[]) => {
      if (activeTrackingOrderRef.current !== orderNo || trackingLoadSignatureRef.current[orderNo] !== trackingSnapshotKey) return;
      setTrackingMap(previous => ({ ...previous, ...Object.fromEntries(items.map(item => [item.tracking_number, item])) }));
      setTrackingDrawer(previous => previous
        ? items.find(item => item.tracking_number === previous.tracking_number) || previous
        : previous);
    }).catch(() => {
      if (trackingLoadSignatureRef.current[orderNo] === trackingSnapshotKey) {
        delete trackingLoadSignatureRef.current[orderNo];
        if (activeTrackingOrderRef.current === orderNo) setTrackingLoading(false);
      }
      /* Tracking 查询失败不阻断 Shipment；用户仍可从抽屉显式重试。 */
    }).finally(() => {
      if (activeTrackingOrderRef.current === orderNo && trackingLoadSignatureRef.current[orderNo] === trackingSnapshotKey) setTrackingLoading(false);
    });
  }, [saved?.order_id, tab, trackingSnapshotKey]);
  const productMap = useMemo(() => new Map(products.map(product => [product.sku, product])), [products]);
  const lines: LineInput[] = form?.line_items || []; const shipments: ShipmentInput[] = form?.shipments || [];
  const selectedExistingLine = productChoice ? lines.find(line => line.sku === productChoice.sku) : undefined;
  const calculatedLines = lines.map(line => {
    const product = productMap.get(line.sku);
    const qty = Math.max(0, Number(line.quantity) || 0);
    const rrp = line.rrp_incl_gst ?? product?.rrp_incl_gst ?? '0';
    const gstRate = line.gst_rate_percent ?? '10.00';
    // 行级未税小计从含税总额反算；订单 GST 随后按订单未税小计及税率分组计算。
    const amounts = calculateOrderLineAmounts(rrp, qty, gstRate);
    return { line, product, rrp, gstRate, grossTotal: amounts.grossLineCents / 100, unit: amounts.unitExGstCents / 100,
      subtotal: amounts.subtotalExGstCents / 100, subtotalCents: amounts.subtotalExGstCents };
  });
  // 报价只能基于已保存订单计算；草稿改变后先保存，避免把过期报价应用到新输入。
  const hasUnsavedChanges = Boolean(editing && form && (isNew
    ? form.company_name || form.customer.name || form.customer.phone || form.customer.email || form.line_items.length || form.shipping_address.street
    : saved && JSON.stringify(form) !== JSON.stringify(hydrate(saved))));
  useEffect(() => {
    if (!hasUnsavedChanges) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [hasUnsavedChanges]);
  const previewSubtotalCents = calculatedLines.reduce((sum, line) => sum + line.subtotalCents, 0);
  const previewSubtotal = previewSubtotalCents / 100;
  const previewGst = calculateOrderGstCents(calculatedLines.map(line => ({
    subtotalExGstCents: line.subtotalCents,
    gstRatePercent: line.gstRate,
  }))) / 100;
  const updateLine = (index: number, changes: Partial<LineInput>) => setForm((previous: AnyRecord) => ({ ...previous, line_items: previous.line_items.map((line: LineInput, i: number) => i === index ? { ...line, ...changes } : line) }));
  const updateShipment = (index: number, changes: Partial<ShipmentInput>) => setForm((previous: AnyRecord) => ({ ...previous, shipments: previous.shipments.map((shipment: ShipmentInput, i: number) => i === index ? { ...shipment, ...changes } : shipment) }));
  // 新行未分配 Shipment；同 SKU 合并数量时保留当前行价格，用户明确修改 RRP 后才覆盖。
  const addProduct = () => {
    if (!productChoice || !Number.isFinite(Number(productRrp)) || Number(productRrp) <= 0) return;
    const existing = lines.findIndex(line => line.sku === productChoice.sku);
    if (existing >= 0) updateLine(existing, { quantity: Number(lines[existing].quantity) + productQty, rrp_incl_gst: productRrp });
    else setForm((previous: AnyRecord) => ({ ...previous, line_items: [...previous.line_items, { sku: productChoice.sku, quantity: productQty, tracking_group: '', rrp_incl_gst: productRrp, gst_rate_percent: '10.00' }] }));
    setProductDialog(false); setProductChoice(null); setProductRrp(''); setProductQty(1);
  };
  // 前端尽早反馈必填项和重复运单；后端仍会再次执行权威校验。
  const validate = () => {
    if (!form.customer.name.trim() || !form.company_name.trim() || !form.customer.phone.trim() || !form.customer.email.trim()) return 'Customer name, company, phone and email are required.';
    const phoneDigits = form.customer.phone.replace(/\D/g, '').length;
    if (phoneDigits < 7 || phoneDigits > 15) return 'Phone number must contain 7 to 15 digits.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.customer.email)) return 'Enter a valid email address.';
    if (!/^\d{4}$/.test(form.shipping_address.postcode)) return 'Postcode must contain four digits.';
    if (!form.shipping_address.street.trim() || !form.shipping_address.suburb.trim() || !form.shipping_address.state.trim()) return 'Complete the shipping address.';
    if (!lines.length) return 'Add at least one order line.';
    if (lines.some(line => !Number.isInteger(Number(line.quantity)) || Number(line.quantity) <= 0)) return 'Every quantity must be a positive integer.';
    if (calculatedLines.some(({ rrp }) => !isValidMoneyAmount(rrp))) return 'Every RRP must be a positive amount with no more than two decimal places.';
    if (lines.some(line => !isValidOrderLineGstRate(line.gst_rate_percent ?? '10.00'))) return 'GST rates must be between 0 and 100 with no more than two decimal places.';
    const invalid = shipments.find(s => !s.carrier_id || !carriers.some(carrier => carrier.id === s.carrier_id)); if (invalid) return 'Select a carrier maintained in Carrier Management for each shipment.';
    const duplicate = shipments.filter(s => s.tracking_number.trim()).map(s => `${s.carrier.toLowerCase()}|${s.tracking_number.trim()}`); if (new Set(duplicate).size !== duplicate.length) return 'Carrier and tracking number must be unique within this order.';
    return '';
  };
  // 新建走 POST、编辑走 PATCH；保存后用服务端响应重建基准状态和表单草稿。
  const save = async () => { const message = validate(); if (message) { setError(message); return; } setSaving(true); setError('');
    const body = { order_date: form.order_date, company_name: form.company_name.trim(), customer: { name: form.customer.name.trim(), phone: form.customer.phone.trim(), email: form.customer.email.trim() }, shipping_address: { ...form.shipping_address, street: form.shipping_address.street.trim(), address_line2: form.shipping_address.address_line2 || null, suburb: form.shipping_address.suburb.trim() }, line_items: lines.map(line => ({ sku: line.sku, quantity: Number(line.quantity), tracking_group: line.tracking_group || null, rrp_incl_gst: line.rrp_incl_gst, gst_rate_percent: line.gst_rate_percent ?? '10.00' })), shipments: shipments.map(shipment => ({ tracking_group: shipment.tracking_group, carrier: shipment.carrier, carrier_id: shipment.carrier_id, shipping_account_profile_id: shipment.shipping_account_profile_id, tracking_number: shipment.tracking_number.trim() || null })) };
    try { const result = isNew ? await api('/api/orders', { method: 'POST', body: JSON.stringify(body) }) : await api(`/api/orders/${encodeURIComponent(id!)}`, { method: 'PATCH', body: JSON.stringify(body) }); setSaved(result); setForm(hydrate(result)); setEditing(false); if (isNew) navigate(`/orders/${encodeURIComponent(result.order_id)}`, { replace: true }); }
    catch (err: any) { setError(err.message); } finally { setSaving(false); }
  };
  // 编辑取消时放弃本地草稿；新建取消则返回列表，不创建空订单。
  const cancel = () => { setError(''); if (isNew) navigate('/orders'); else if (saved) { setForm(hydrate(saved)); setEditing(false); } };
  // 状态规则以服务端为准；更新成功后同步详情和表单，避免本地状态漂移。
  const changeStatus = async (target: string) => { if (!id) return; setSaving(true); setError(''); try { const result = await api(`/api/orders/${encodeURIComponent(id)}/status`, { method: 'PATCH', body: JSON.stringify({ status: target }) }); setSaved(result); setForm(hydrate(result)); setEditing(false); } catch (err: any) { setError(err.message); } finally { setSaving(false); } };
  // 确认状态仅允许独立保存运单号，这是业务状态机中的受限编辑例外。
  const saveConfirmedTracking = async (shipmentId: number, trackingNumber: string) => { setSaving(true); setError(''); try { const result = await api(`/api/shipments/${shipmentId}`, { method: 'PATCH', body: JSON.stringify({ tracking_number: trackingNumber }) }); setSaved(result); setForm(hydrate(result)); } catch (err: any) { setError(err.message); } finally { setSaving(false); } };
  // 空运单不发请求；网络失败被转换成可显示的 unavailable 结果，不中断 Shipment 页面。
  const refreshShipmentTracking = async (shipment: AnyRecord) => { if (!shipment.tracking_number?.trim()) { setError(''); setNotice('Enter a tracking number before querying this shipment.'); return; } setTrackingBusy(shipment.tracking_number); try { const result = await api('/api/orders/tracking', { method: 'POST', body: JSON.stringify({ carrier: shipment.carrier, tracking_number: shipment.tracking_number.trim() }) }); setTrackingMap(previous => ({ ...previous, [shipment.tracking_number]: result })); return result; } catch (err: any) { const result = { carrier: shipment.carrier, tracking_number: shipment.tracking_number, overall_status: 'unavailable', tracking_error: err.message, tracking_error_code: 'REQUEST_FAILED', consignment_events: [], articles: [] }; setTrackingMap(previous => ({ ...previous, [shipment.tracking_number]: result })); return result; } finally { setTrackingBusy(null); } };
  // 打开详情抽屉时先展示本地缓存；用户可在抽屉中明确触发刷新。
  const viewShipmentTracking = (shipment: AnyRecord) => { setTrackingDrawerShipment(shipment); const cached = trackingMap[shipment.tracking_number]; setTrackingDrawer(cached || { carrier: shipment.carrier, tracking_number: shipment.tracking_number, overall_status: 'not_queried', consignment_events: [], articles: [] }); };
  // 新 Shipment 默认使用一个启用承运商，不自动认领任何订单行。
  const addShipment = () => { const available = carriers.find(carrier => carrier.is_active); if (!available) { setError('No active carriers. Please maintain carriers first.'); return; } setForm((previous: AnyRecord) => { const n = previous.shipments.length + 1; return { ...previous, shipments: [...previous.shipments, { tracking_group: `Shipment ${n}`, carrier: available.name, carrier_id: available.id, tracking_number: '' }] }; }); };
  // 删除 Shipment 时同步清除订单行上的分组引用，防止草稿提交悬空关联。
  const removeShipment = (index: number) => setForm((previous: AnyRecord) => { const removed = previous.shipments[index].tracking_group; const next = previous.shipments.filter((_: any, i: number) => i !== index); return { ...previous, shipments: next, line_items: previous.line_items.map((line: LineInput) => line.tracking_group === removed ? { ...line, tracking_group: '' } : line) }; });
  // 服务端删除后重新读取订单，使用已持久化状态覆盖本地草稿。
  const deleteSavedShipment = async (shipment: AnyRecord) => { if (!await confirm({ title: 'Delete Shipment?', message: `Delete ${shipment.tracking_group}? Its saved fee and tracking association will also be removed.`, confirmText: 'Delete', confirmColor: 'error' })) return; setSaving(true); setError(''); try { await api<void>(`/api/shipments/${shipment.id}`, { method: 'DELETE' }); const updated = await api(`/api/orders/${encodeURIComponent(id!)}`); setSaved(updated); setForm(hydrate(updated)); setEditing(false); } catch (err: any) { setError(err.message); } finally { setSaving(false); } };
  if (loading || !form) return <Box sx={{ p: 8, textAlign: 'center' }}><CircularProgress/></Box>;
  const canEdit = !saved || saved.status === 'draft';
  const visibleEdit = Boolean(saved) && !editing && canEdit;
  const currentStatus = saved?.status || 'draft';
  const nextStatus = saved && !editing ? statusSequence[statusSequence.indexOf(currentStatus) + 1] : undefined;
  return <>
    <PageHeading title={saved ? 'Order Details' : 'New Order'} subtitle={saved ? 'Review customer information, order lines, and shipment details.' : 'Create an order with customer, product, and shipping information.'}/>
    <Paper component="section" className="order-form-toolbar" variant="outlined" aria-label="Order actions and status">
      <Stack className="order-form-toolbar-layout" direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
      <Stack className="order-toolbar-actions" direction="row" spacing={.7} sx={{ alignItems: 'center' }}>
        {editing ? <><Button className="status-action status-action-primary" variant="contained" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button><Button className="status-action status-action-secondary" variant="outlined" onClick={cancel} disabled={saving}>Cancel</Button></> : visibleEdit ? <Button className="status-action status-action-primary" variant="contained" startIcon={<EditOutlined/>} onClick={() => setEditing(true)}>Edit</Button> : null}
        {nextStatus && <Button className={`status-action ${visibleEdit ? 'status-action-secondary' : 'status-action-primary'}`} variant={visibleEdit ? 'outlined' : 'contained'} disabled={saving} onClick={() => changeStatus(nextStatus)}>{`Mark ${statusLabels[nextStatus]}`}</Button>}
        {(saved?.status === 'confirmed' || saved?.status === 'in_transit') && !editing && <Button className="status-action status-action-secondary" variant="outlined" disabled={saving} onClick={async () => { if (await confirm({ title: 'Return order to Draft?', message: 'This will move the order back to Draft so its order and shipping details can be edited.', confirmText: 'Revert to Draft' })) await changeStatus('draft'); }}>Revert to Draft</Button>}
      </Stack>
      <Box className="order-toolbar-status"><OrderStatusBar status={currentStatus}/></Box>
      </Stack>
    </Paper>
    {error && <Alert severity="error" sx={{ mb: 1.5 }}>{error}</Alert>}
    <Paper className="order-sheet" variant="outlined" sx={{ mb: 1.8, overflow: 'hidden' }}>
      <Box className="order-record-heading"><Typography variant="h4">{saved?.order_id || 'New Order'}</Typography></Box>
      <Box className="field-groups order-field-groups" sx={{ p: { xs: 1.8, md: 2.5 } }}>
        <section className="field-group">
        <h3>Customer Information</h3>
        <FieldGrid disabled={!editing} fields={[
          { label: 'Customer Name', value: form.customer.name, onChange: (v: string) => setCustomer('name', v), required: true },
          { label: 'Company', value: form.company_name, onChange: (v: string) => setField('company_name', v), required: true },
          { label: 'Phone', value: form.customer.phone, onChange: (v: string) => setCustomer('phone', v), required: true },
          { label: 'Email', value: form.customer.email, onChange: (v: string) => setCustomer('email', v), required: true },
        ]}/>
        </section>
        <section className="field-group">
        <h3>Shipping / Order Information</h3>
        <Box className="order-meta-grid">
          <Box className="order-meta-field">
            {editing ? <TextField size="small" label="Order Date" type="date" value={form.order_date} onChange={e => setField('order_date', e.target.value)} required fullWidth slotProps={{ inputLabel: { shrink: true } }}/> : <Box className="read-only-field"><Typography className="read-only-field-label">Order Date</Typography><Typography className="read-only-field-value">{formatDate(form.order_date)}</Typography></Box>}
          </Box>
          <Box className="read-only-field"><Typography className="read-only-field-label">Currency</Typography><Typography className="read-only-field-value">AUD</Typography></Box>
          <Box className="read-only-field"><Typography className="read-only-field-label">Order Status</Typography><Typography className="read-only-field-value">{statusLabels[currentStatus]}</Typography></Box>
        </Box>
        <FieldGrid className="order-address-grid" disabled={!editing} fields={[
          { label: 'Address Line 1', value: form.shipping_address.street, onChange: (v: string) => setAddress('street', v), required: true },
          { label: 'Address Line 2', value: form.shipping_address.address_line2, onChange: (v: string) => setAddress('address_line2', v) },
          { label: 'Suburb', value: form.shipping_address.suburb, onChange: (v: string) => setAddress('suburb', v), required: true },
          { label: 'State', value: form.shipping_address.state, onChange: (v: string) => setAddress('state', v), required: true },
          { label: 'Postcode', value: form.shipping_address.postcode, onChange: (v: string) => setAddress('postcode', v), required: true },
          { label: 'Country', value: form.shipping_address.country, onChange: (v: string) => setAddress('country', v), required: true },
        ]}/>
        </section>
      </Box>
      <Divider/><Tabs className="order-tabs" value={tab} onChange={(_, value) => setTab(value)} aria-label="Order sections"><Tab label="Order Lines"/><Tab label="Shipments"/></Tabs><Divider/>
      {tab === 0 && <Box>
        <div className="list-toolbar"><div><h3>Order Lines</h3><span>{lines.length} product lines</span></div><Stack direction="row" spacing={.75} sx={{ flexShrink: 0 }}>
          <Button size="small" aria-controls="order-lines-columns-menu" aria-expanded={Boolean(columnsMenuAnchor)} aria-haspopup="true" onClick={event => setColumnsMenuAnchor(event.currentTarget)}>Columns</Button>
          {editing && <Button startIcon={<Add/>} onClick={() => { setProductChoice(null); setProductRrp(''); setProductQty(1); setProductDialog(true); }}>Add Product</Button>}
        </Stack><Menu id="order-lines-columns-menu" anchorEl={columnsMenuAnchor} open={Boolean(columnsMenuAnchor)} onClose={() => setColumnsMenuAnchor(null)}>
          <Box sx={{ px: 1.5, py: .5 }}><FormControlLabel control={<Checkbox size="small" checked={showAssignedTracking} onChange={event => setShowAssignedTracking(event.target.checked)}/>} label="Assigned Tracking"/></Box>
        </Menu></div>
        <OrderLinesTable
          showAssignedTracking={showAssignedTracking}
          rows={calculatedLines.map(({ line, product, rrp, gstRate, grossTotal, unit, subtotal }) => ({
            ...line,
            product_name: product?.name,
            description: product?.description,
            rrp,
            gst_rate_percent: gstRate,
            gross_total: grossTotal,
            unit,
            subtotal,
            assigned_tracking_number: shipments.find(shipment => shipment.tracking_group === line.tracking_group)?.tracking_number?.trim() || '',
          }))}
          editing={editing}
          onChange={(index, changes) => updateLine(index, {
            ...(changes.quantity !== undefined ? { quantity: changes.quantity } : {}),
            ...(changes.rrp !== undefined ? { rrp_incl_gst: changes.rrp } : {}),
            ...(changes.gst_rate_percent !== undefined ? { gst_rate_percent: changes.gst_rate_percent } : {}),
          })}
          onRemove={index => setForm((previous: AnyRecord) => ({ ...previous, line_items: previous.line_items.filter((_: any, i: number) => i !== index) }))}
        />
        <OrderSummary saved={saved as Order | null} editing={editing} subtotal={previewSubtotal} gst={previewGst} onCalculate={() => setQuoteShipment({ isNew: true })} canCalculate={Boolean(saved) && saved?.status === 'draft' && !hasUnsavedChanges}/>
      </Box>}
      {tab === 1 && <Box className="shipments-tab-panel" sx={{ p: { xs: 1.5, md: 2.3 } }}>
        <div className="list-toolbar shipment-list-toolbar"><div><h3>Shipments</h3><span>{shipments.length} shipment records</span></div>{saved?.status === 'draft' && <Button startIcon={<Add/>} disabled={hasUnsavedChanges} onClick={() => setQuoteShipment({ isNew: true })}>Add Shipment</Button>}</div>
        {!shipments.length ? <Typography color="text.secondary" p={3}>No shipments recorded.</Typography> : <Box className="shipments-grid">{shipments.map((shipment, index) => {
          const persisted = saved?.shipments?.find((s: AnyRecord) => s.tracking_group === shipment.tracking_group);
          const assignedLines = lines.filter(line => line.tracking_group === shipment.tracking_group);
          const tracking = trackingMap[shipment.tracking_number];
          return <Paper className="shipment-card" key={shipment.tracking_group} variant="outlined">
            <Box className="shipment-card-heading">
              <Box className="shipment-card-title"><Typography variant="subtitle2" fontWeight={700}>Shipment #{persisted?.id ?? index + 1}</Typography><Typography variant="caption" color="text.secondary">{shipment.carrier}</Typography></Box>
              {persisted && <Box className="shipment-card-status">
                <TrackingStatusChip status={tracking?.overall_status_raw || tracking?.overall_status || 'Not queried'} hasError={Boolean(tracking?.tracking_error)}/>
                {tracking?.last_updated && <Typography component="time" dateTime={tracking.last_updated} className="shipment-updated-at" variant="caption" color="text.secondary">Last updated {formatDateTime(tracking.last_updated)}</Typography>}
              </Box>}
              {editing ? <Button className="shipment-card-remove" color="error" size="small" onClick={() => removeShipment(index)}>Remove</Button> : persisted && <IconButton aria-label={`More actions for Shipment ${persisted.id}`} size="small" onClick={event => setShipmentMenu({ anchor: event.currentTarget, shipment: persisted })}><MoreVert fontSize="small"/></IconButton>}
            </Box>
            {editing && <Box className="shipment-fields">
              <FormControl size="small"><InputLabel>Carrier</InputLabel><Select label="Carrier" value={shipment.carrier_id ?? ''} onChange={e => { const selectedCarrier = carriers.find(carrier => carrier.id === Number(e.target.value)); if (selectedCarrier) updateShipment(index, { carrier: selectedCarrier.name, carrier_id: selectedCarrier.id }); }}>{carriers.filter(carrier => carrier.is_active || carrier.id === shipment.carrier_id).map(carrier => <MenuItem key={carrier.id} value={carrier.id} disabled={!carrier.is_active && carrier.id !== shipment.carrier_id}>{carrier.name}{!carrier.is_active ? ' (Inactive)' : ''}</MenuItem>)}</Select></FormControl>
              <TextField size="small" label="Tracking Number" value={shipment.tracking_number} onChange={e => updateShipment(index, { tracking_number: e.target.value })} fullWidth/>
              {saved?.status === 'confirmed' && persisted && <Button className="shipment-save-tracking" disabled={saving || !shipment.tracking_number.trim() || shipment.tracking_number === (persisted.tracking_number || '')} onClick={() => saveConfirmedTracking(persisted.id, shipment.tracking_number)}>{saving ? 'Saving…' : 'Save Tracking'}</Button>}
            </Box>}
            <Box className="shipment-card-info">
              {!editing && persisted && <Box className="shipment-tracking-meta">
                {saved?.status === 'confirmed' ? <TextField size="small" label="Tracking Number" value={shipment.tracking_number} onChange={e => updateShipment(index, { tracking_number: e.target.value })} fullWidth/> : <Box className="shipment-meta-item"><Typography className="shipment-meta-label">Tracking Number</Typography><Typography className="shipment-meta-value" title={shipment.tracking_number || ''}>{shipment.tracking_number || 'Not assigned'}</Typography></Box>}
                <Box className="shipment-meta-item"><Typography className="shipment-meta-label">Latest Carrier Event</Typography><Typography className="shipment-meta-value">{trackingEventTimeLabel(tracking)}</Typography></Box>
              </Box>}
              {!editing && saved?.status === 'confirmed' && persisted && <Button className="shipment-save-tracking" disabled={saving || !shipment.tracking_number.trim() || shipment.tracking_number === (persisted.tracking_number || '')} onClick={() => saveConfirmedTracking(persisted.id, shipment.tracking_number)}>{saving ? 'Saving…' : 'Save Tracking'}</Button>}
              <Box><Typography className="shipment-products-heading">PRODUCTS · {assignedLines.length} ORDER {assignedLines.length === 1 ? 'LINE' : 'LINES'}</Typography><Box className="shipment-products-list">
                {assignedLines.slice(0, 3).map(line => <Chip key={line.sku} size="small" variant="outlined" label={`${line.sku} × ${line.quantity}`}/>)}
                {assignedLines.length > 3 && <Tooltip title={assignedLines.slice(3).map(line => `${line.sku} × ${line.quantity}`).join(', ')}><Chip size="small" variant="outlined" label={`+${assignedLines.length - 3} more`}/></Tooltip>}
                {!assignedLines.length && <Typography variant="body2" color="text.secondary">No order lines assigned</Typography>}
              </Box></Box>
            </Box>
            {persisted && <Box className="shipment-card-footer">
              <Box className="shipment-fee-summary"><Typography variant="body2" color="text.secondary">Shipping Fee</Typography><Typography variant="body2" fontWeight={700}>{persisted.shipping_quote_status === 'quoted' ? money(persisted.shipping_fee) : 'Not quoted'}</Typography></Box>
              <Box className="shipment-card-actions"><Button size="small" onClick={() => viewShipmentTracking(persisted)}>View Details</Button><Button size="small" variant="contained" disabled={saved?.status !== 'draft'} title={saved?.status !== 'draft' ? 'Return this order to Draft before applying shipping fees.' : undefined} onClick={() => setQuoteShipment(persisted)}>Calculate Shipping</Button></Box>
            </Box>}
          </Paper>;
        })}</Box>}
      </Box>}
    </Paper>
    <Menu anchorEl={shipmentMenu?.anchor || null} open={Boolean(shipmentMenu)} onClose={() => setShipmentMenu(null)}>
      <MenuItem onClick={() => { setShipmentMenu(null); setTab(1); setEditing(true); }} disabled={!canEdit}>Edit Shipment</MenuItem>
      <MenuItem onClick={() => { const target = shipmentMenu?.shipment; setShipmentMenu(null); if (target) void refreshShipmentTracking(target); }} disabled={trackingBusy === shipmentMenu?.shipment.tracking_number}>Refresh Tracking</MenuItem>
      <MenuItem onClick={() => { const target = shipmentMenu?.shipment; setShipmentMenu(null); if (target) void deleteSavedShipment(target); }} disabled={saving || saved?.status !== 'draft'} sx={{ color: 'error.main' }}>Delete</MenuItem>
    </Menu>
    <Dialog open={productDialog} onClose={() => setProductDialog(false)} fullWidth maxWidth="sm">
      <DialogTitle>Add Product</DialogTitle>
      <DialogContent>
        <Stack spacing={1.5} sx={{ pt: 1 }}>
          <Autocomplete options={products} value={productChoice} getOptionLabel={product => `${product.sku} · ${product.name}`}
            onChange={(_, value) => {
              setProductChoice(value);
              const existingLine = value ? lines.find(line => line.sku === value.sku) : undefined;
              setProductRrp(value ? existingLine?.rrp_incl_gst ?? value.rrp_incl_gst ?? '' : '');
            }}
            renderInput={params => <TextField {...params} label="Search SKU or product"/>}/>
          <TextField fullWidth required type="number" label="RRP (GST Included)" value={productRrp}
            disabled={!productChoice} helperText={selectedExistingLine ? 'This SKU is already on the order. Its current RRP is prefilled; change it here to override.' : 'Defaults to the product catalogue price. You can override it for this order line.'}
            slotProps={{ htmlInput: { min: 0.01, step: 0.01, 'aria-label': 'RRP (GST Included)' } }}
            onChange={event => setProductRrp(event.target.value)}/>
          <TextField fullWidth type="number" label="Quantity" value={productQty}
            slotProps={{ htmlInput: { min: 1, step: 1 } }} onChange={event => setProductQty(Number(event.target.value))}/>
        </Stack>
      </DialogContent>
      <DialogActions><Button onClick={() => setProductDialog(false)}>Cancel</Button><Button variant="contained" disabled={!productChoice || !Number.isInteger(productQty) || productQty < 1 || !Number.isFinite(Number(productRrp)) || Number(productRrp) <= 0} onClick={addProduct}>Add</Button></DialogActions>
    </Dialog>
    {quoteShipment && saved && <ShippingQuoteDialog key={`${saved.order_id}-${quoteShipment.id || 'new'}`} order={saved} shipment={quoteShipment.isNew ? null : quoteShipment} onClose={() => setQuoteShipment(null)} onApplied={order => { setSaved(order); setForm(hydrate(order)); }}/ >}
    <Drawer anchor="right" open={Boolean(trackingDrawer)} onClose={() => { setTrackingDrawer(null); setTrackingDrawerShipment(null); }} slotProps={{ paper: { className: 'tracking-drawer-paper', sx: { width: { xs: '100%', sm: 540 }, p: 0 } } }}>
      <Stack className="tracking-drawer-header" direction="row" sx={{ alignItems: 'center' }}><Box><Typography variant="h6">Shipment Details</Typography>{trackingDrawerShipment && <Typography variant="body2" color="text.secondary">Shipment #{trackingDrawerShipment.id} · {trackingDrawerShipment.carrier}</Typography>}</Box><Button className="tracking-close-button" onClick={() => { setTrackingDrawer(null); setTrackingDrawerShipment(null); }}>Close</Button></Stack>
      <Box className="tracking-drawer-content">{trackingDrawerShipment && <Paper className="shipment-drawer-summary" variant="outlined">
        <Box className="shipment-drawer-metadata">
          <Box><Typography className="shipment-drawer-label">Tracking Number</Typography><Typography variant="body1" className="shipment-drawer-tracking-number">{trackingDrawerShipment.tracking_number || 'Not assigned'}</Typography></Box>
          <Box className="shipment-drawer-fee"><Typography className="shipment-drawer-label">Shipping Fee</Typography><Typography variant="h6" className="shipment-drawer-fee-value">{trackingDrawerShipment.shipping_quote_status === 'quoted' ? money(trackingDrawerShipment.shipping_fee) : 'Not quoted'}</Typography></Box>
        </Box>
        <Box className="shipment-drawer-lines"><Typography className="shipment-drawer-label">Order Lines</Typography><Stack direction="row" flexWrap="wrap" gap={.6}>{(saved?.line_items || []).filter((line: AnyRecord) => line.tracking_group === trackingDrawerShipment.tracking_group).map((line: AnyRecord) => <Chip key={line.id || line.sku} size="small" variant="outlined" label={`${line.sku} × ${line.quantity}`}/>)}</Stack></Box>
      </Paper>}{trackingDrawer && <TrackingResult data={trackingDrawer} drawerMode loading={trackingLoading && trackingDrawer.overall_status === 'not_queried'} refreshing={trackingBusy === trackingDrawerShipment?.tracking_number} onRefresh={async () => { if (trackingDrawerShipment) { const result = await refreshShipmentTracking(trackingDrawerShipment); if (result) setTrackingDrawer(result); } }}/>}</Box>
    </Drawer>
    <Snackbar open={Boolean(notice)} autoHideDuration={4500} anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }} onClose={() => setNotice('')}><Alert severity="warning" variant="filled" onClose={() => setNotice('')}>{notice}</Alert></Snackbar>
    {confirmDialog}
  </>;
}

/** 同一字段配置根据编辑态渲染输入框或只读值，并共享响应式双列布局。 */
function FieldGrid({ fields, disabled, className }: { fields: { label: string; value: string; onChange?: (v: string) => void; type?: string; required?: boolean; disabled?: boolean }[]; disabled: boolean; className?: string }) {
  return <Box className={className} sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: { xs: 1, md: 1.25 } }}>{fields.map(field => {
    const readOnly = disabled || field.disabled;
    if (readOnly) return <Box className="read-only-field" key={field.label}>
      <Typography className="read-only-field-label">{field.label}</Typography>
      <Typography className="read-only-field-value">{field.type === 'date' ? formatDate(field.value) : field.value || '—'}</Typography>
    </Box>;
    return <TextField key={field.label} size="small" label={field.label} type={field.type || 'text'} value={field.value ?? ''} onChange={field.onChange ? e => field.onChange!(e.target.value) : undefined} required={field.required} fullWidth slotProps={field.type === 'date' ? { inputLabel: { shrink: true } } : undefined}/>;
  })}</Box>;
}
