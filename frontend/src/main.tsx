import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Link, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import * as Mui from '@mui/material';
import { Add, Refresh, EditOutlined, DeleteOutlined, OpenInNew, MoreVert } from '@mui/icons-material';
import { ApiError, api } from './shared/api';
import { calculateOrderLineAmounts, formatDate, formatDateTime, isValidMoneyAmount, isValidOrderLineGstRate, money } from './shared/format';
import type { Carrier, Order } from './shared/types';
import { OrderStatusBar } from './features/orders/components/OrderStatusBar';
import { OrderSummary } from './features/orders/components/OrderSummary';
import { TableState } from './shared/components/TableState';
import { useConfirm } from './shared/hooks/useConfirm';
import { OrderLinesTable } from './features/orders/components/OrderLinesTable';
import { AccountProductsPage } from './features/api-testing/AccountProductsPage';
import { ApiTestingPageShell } from './features/api-testing/ApiTestingPageShell';
import { ShippingAccountSelect } from './features/shipping/components/ShippingAccountSelect';
import { AccountPostageProducts, type AccountMerchantLocation } from './features/shipping/components/AccountPostageProducts';
import { useShippingAccounts } from './features/shipping/hooks/useShippingAccounts';
import { AppSidebar } from './shared/components/AppSidebar';
import './style.css';

type AnyRecord = Record<string, any>;
// MUI 9 移除了部分旧 System 属性的类型定义；这里仅兼容既有页面标记，布局样式仍通过 sx 编写。
const Alert: any = Mui.Alert; const AppBar: any = Mui.AppBar; const Autocomplete: any = Mui.Autocomplete;
const Box: any = Mui.Box; const Button: any = Mui.Button; const Chip: any = Mui.Chip;
const CircularProgress: any = Mui.CircularProgress; const CssBaseline: any = Mui.CssBaseline;
const Dialog: any = Mui.Dialog; const DialogActions: any = Mui.DialogActions; const DialogContent: any = Mui.DialogContent;
const DialogTitle: any = Mui.DialogTitle; const Divider: any = Mui.Divider; const Drawer: any = Mui.Drawer;
const FormControl: any = Mui.FormControl; const IconButton: any = Mui.IconButton; const InputLabel: any = Mui.InputLabel;
const Checkbox: any = Mui.Checkbox; const FormControlLabel: any = Mui.FormControlLabel; const FormGroup: any = Mui.FormGroup;
const MenuItem: any = Mui.MenuItem; const Paper: any = Mui.Paper; const Radio: any = Mui.Radio; const Select: any = Mui.Select; const Stack: any = Mui.Stack;
const Menu: any = Mui.Menu;
const Snackbar: any = Mui.Snackbar;
const List: any = Mui.List; const ListItemButton: any = Mui.ListItemButton; const ListItemText: any = Mui.ListItemText; const Tooltip: any = Mui.Tooltip;
const Tab: any = Mui.Tab; const Tabs: any = Mui.Tabs; const Table: any = Mui.Table; const TableBody: any = Mui.TableBody;
const TableCell: any = Mui.TableCell; const TableContainer: any = Mui.TableContainer; const TableHead: any = Mui.TableHead;
const TableRow: any = Mui.TableRow; const TextField: any = Mui.TextField; const ThemeProvider: any = Mui.ThemeProvider;
const Toolbar: any = Mui.Toolbar; const Typography: any = Mui.Typography; const createTheme = Mui.createTheme;
const theme = createTheme({
  palette: { primary: { main: '#65527f', dark: '#514064' }, secondary: { main: '#648a80' }, background: { default: '#f3f2f5', paper: '#fff' }, success: { main: '#648a80' } },
  shape: { borderRadius: 4 },
  typography: { fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif', fontSize: 14, body1: { fontSize: 14, lineHeight: 1.5 }, body2: { fontSize: 13, lineHeight: 1.45 }, h4: { fontSize: 22, fontWeight: 700, lineHeight: 1.3 }, h6: { fontSize: 16, fontWeight: 650, lineHeight: 1.4 }, button: { fontSize: 13, textTransform: 'none', fontWeight: 600 } },
  components: { MuiButton: { styleOverrides: { root: { minHeight: 31, padding: '4px 10px', borderRadius: 4, boxShadow: 'none' } } }, MuiPaper: { styleOverrides: { outlined: { borderColor: '#dedee2' } } }, MuiTableCell: { styleOverrides: { root: { padding: '9px 12px', fontSize: 14, borderColor: '#e6e4e9' }, head: { padding: '10px 12px', fontSize: 13, fontWeight: 650, color: '#777780', background: '#f7f7f8' } } } },
});
const statusLabels: Record<string, string> = { draft: 'Draft', confirmed: 'Confirmed', in_transit: 'In Transit', completed: 'Completed' };
const statusSequence = ['draft', 'confirmed', 'in_transit', 'completed'];
// Australia Post 报价账号登记的商户发货地址是 Richmond；始发地需与账号登记地点一致。
const defaultShippingOrigin = () => ({ type: 'MERCHANT_LOCATION', lines: [] as string[], suburb: 'RICHMOND', postcode: '3121', state: 'VIC', country: 'AU' });
const defaultShippingDestination = () => ({ type: 'STANDARD_ADDRESS', lines: [] as string[], suburb: 'Sydney', postcode: '2000', state: 'NSW', country: 'AU' });
const defaultOrderShippingAddress = () => ({ street: '', address_line2: '', suburb: 'Sydney', state: 'NSW', postcode: '2000', country: 'Australia' });
function App() {
  return <ThemeProvider theme={theme}><CssBaseline/><BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><AppLayout/></BrowserRouter></ThemeProvider>;
}

function AppLayout() {
  const location = useLocation();
  return <div className="erp-app">
    <AppSidebar/>
    <main className="workspace">
      <Routes>
        <Route path="/" element={<OrdersPage key={location.pathname}/>}/>
        <Route path="/orders" element={<OrdersPage key={location.pathname}/>}/>
        <Route path="/orders/new" element={<OrderForm key="new" productsKey={0}/>}/>
        <Route path="/orders/:id" element={<OrderForm key={location.pathname} productsKey={0}/>}/>
        <Route path="/products" element={<ProductsPage key={location.pathname}/>}/>
        <Route path="/tracking" element={<TrackingPage key={location.pathname}/>}/>
        <Route path="/shipping-rates" element={<ShippingRatesPage key={location.pathname}/>}/>
        <Route path="/api-testing/accounts" element={<AccountProductsPage key={location.pathname}/>}/>
        <Route path="/carriers" element={<CarriersPage key={location.pathname}/>}/>
        <Route path="*" element={<OrdersPage key={location.pathname}/>}/>
      </Routes>
    </main>
  </div>;
}

function PageHeading({ title, subtitle, action }: { title: string; subtitle?: string; action?: React.ReactNode }) {
  return <div className="page-heading"><div><span className="page-eyebrow">ORDER MANAGEMENT</span><h1>{title}</h1>{subtitle && <p>{subtitle}</p>}</div>{action}</div>;
}

function OrdersPage() {
  const [orders, setOrders] = useState<Order[]>([]); const [busy, setBusy] = useState(true); const [error, setError] = useState('');
  const [query, setQuery] = useState(''); const [status, setStatus] = useState('all'); const [sortBy, setSortBy] = useState('date'); const navigate = useNavigate();
  useEffect(() => { let alive = true; setBusy(true); api<Order[]>('/api/orders').then(value => { if (alive) setOrders(value); }).catch(err => { if (alive) setError(err.message); }).finally(() => { if (alive) setBusy(false); }); return () => { alive = false; }; }, []);
  const filtered = useMemo(() => orders.filter(order => (status === 'all' || order.status === status) && `${order.order_id} ${order.customer.name} ${order.company_name}`.toLowerCase().includes(query.toLowerCase())).sort((a,b) => sortBy === 'total' ? Number(b.summary.total)-Number(a.summary.total) : String(b.order_date).localeCompare(String(a.order_date))), [orders, query, status, sortBy]);
  return <>
    <PageHeading title="Orders" subtitle="Manage customer orders and fulfilment."/>
    {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
    <Paper variant="outlined" className="orders-filter-panel" sx={{ p: 1.7, mb: 1.8 }}><Box className="orders-list-toolbar">
      <TextField size="small" fullWidth placeholder="Search order, customer or company" value={query} onChange={event => setQuery(event.target.value)}/>
      <FormControl size="small" sx={{ minWidth: 155 }}><InputLabel>Sort By</InputLabel><Select label="Sort By" value={sortBy} onChange={event => setSortBy(event.target.value)}><MenuItem value="date">Order Date</MenuItem><MenuItem value="total">Total Amount</MenuItem></Select></FormControl>
      <FormControl size="small" sx={{ minWidth: 160 }}><InputLabel>Status</InputLabel><Select label="Status" value={status} onChange={event => setStatus(event.target.value)}><MenuItem value="all">All statuses</MenuItem>{statusSequence.map(value => <MenuItem key={value} value={value}>{statusLabels[value]}</MenuItem>)}</Select></FormControl>
      <Button className="orders-create-button" variant="contained" startIcon={<Add/>} onClick={() => navigate('/orders/new')}>Create</Button>
    </Box></Paper>
    <TableState loading={busy} empty={!filtered.length} emptyText="No orders found."><Table sx={{ minWidth: 1140 }}><TableHead><TableRow>{['Order Number','Customer','Company','Order Date','Status','SKU Lines','Shipments','Subtotal','GST','Shipping Fee','Total',''].map(label => <TableCell key={label} sx={{ whiteSpace: 'nowrap' }}>{label}</TableCell>)}</TableRow></TableHead><TableBody>{filtered.map(order => <TableRow hover key={order.id} sx={{ cursor: 'pointer' }} onClick={() => navigate(`/orders/${encodeURIComponent(order.order_id)}`)}>
      <TableCell><Typography fontWeight={700} color="primary">{order.order_id}</Typography></TableCell><TableCell>{order.customer.name}</TableCell><TableCell>{order.company_name}</TableCell><TableCell>{formatDate(order.order_date)}</TableCell><TableCell><StatusChip status={order.status}/></TableCell><TableCell>{order.line_items.length}</TableCell><TableCell>{order.shipments.length}</TableCell><TableCell align="right">{money(order.summary.subtotal_ex_gst)}</TableCell><TableCell align="right">{money(order.summary.gst_amount)}</TableCell><TableCell align="right">{money(order.summary.shipment_fee)}</TableCell><TableCell align="right"><b>{money(order.summary.total)}</b></TableCell><TableCell><IconButton size="small" aria-label="Open order"><OpenInNew fontSize="small"/></IconButton></TableCell>
    </TableRow>)}</TableBody></Table></TableState>
  </>;
}

// 订单和物流状态统一使用语义颜色，避免不同页面各自定义颜色造成含义混乱。
function StatusChip({ status }: { status: string }) {
  const color = status === 'completed' ? 'success' : status === 'in_transit' ? 'info' : status === 'confirmed' ? 'primary' : 'default';
  return <Chip size="small" label={statusLabels[status] || status} color={color} variant={status === 'draft' ? 'outlined' : 'filled'}/>;
}

function TrackingStatusChip({ status, hasError }: { status: string; hasError: boolean }) {
  const normalized = status.toLowerCase().replace(/[ _-]+/g, ' ').trim();
  const isDelivered = normalized.includes('deliver');
  const isNotQueried = normalized === 'not queried';
  const color = hasError || normalized.includes('unavailable') || normalized.includes('exception')
    ? 'warning'
    : isDelivered
      ? 'success'
      : isNotQueried
        ? 'info'
      : normalized.includes('transit') || normalized.includes('onboard')
        ? 'info'
        : 'default';
  // 追踪方可能返回不同文案；保留原始状态文本，只统一其视觉语义。
  const label = isDelivered ? 'Delivered' : isNotQueried ? 'Not queried' : normalized === 'unavailable' ? 'Unavailable' : status;
  return <Chip size="small" variant={isDelivered || isNotQueried ? 'filled' : 'outlined'} color={color} label={label}/>;
}

// 区分承运商事件时间、查询失败和尚未查询，避免把缺少事件时间误报成未查询。
function trackingEventTimeLabel(tracking?: AnyRecord) {
  if (!tracking || tracking.overall_status === 'not_queried') return 'Not queried';
  if (tracking.last_updated) return formatDateTime(tracking.last_updated);
  if (tracking.tracking_error || ['unavailable', 'not_implemented'].includes(tracking.overall_status)) return 'Unavailable';
  return 'No event timestamp';
}

type ProductDraft = { sku: string; name: string; description: string; rrp_incl_gst: string; weight_g: string; length_mm: string; width_mm: string; height_mm: string };
const emptyProductDraft = (): ProductDraft => ({ sku: '', name: '', description: '', rrp_incl_gst: '', weight_g: '', length_mm: '', width_mm: '', height_mm: '' });

function ProductsPage() {
  const { confirm, confirmDialog } = useConfirm();
  const [products, setProducts] = useState<AnyRecord[]>([]);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingSku, setEditingSku] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<ProductDraft>(emptyProductDraft);

  const load = async () => {
    setBusy(true);
    setError('');
    try { setProducts(await api('/api/products')); }
    catch (loadError: any) { setError(loadError.message); }
    finally { setBusy(false); }
  };
  useEffect(() => { void load(); }, []);

  const startCreate = () => { setError(''); setEditingSku(null); setDraft(emptyProductDraft()); setEditorOpen(true); };
  const startEdit = (product: AnyRecord) => {
    setError('');
    setEditingSku(product.sku);
    setDraft({ sku: product.sku, name: product.name, description: product.description || '',
      rrp_incl_gst: String(product.rrp_incl_gst), weight_g: product.weight?.value || '',
      length_mm: product.dimensions?.length?.value || '', width_mm: product.dimensions?.width?.value || '',
      height_mm: product.dimensions?.height?.value || '' });
    setEditorOpen(true);
  };
  const save = async () => {
    setSaving(true);
    setError('');
    const payload = { ...draft, weight_g: draft.weight_g || null, length_mm: draft.length_mm || null,
      width_mm: draft.width_mm || null, height_mm: draft.height_mm || null };
    try {
      const path = editingSku ? `/api/products/${encodeURIComponent(editingSku)}` : '/api/products';
      await api(path, { method: editingSku ? 'PATCH' : 'POST', body: JSON.stringify(payload) });
      setEditorOpen(false);
      await load();
    } catch (saveError: any) { setError(saveError.message); }
    finally { setSaving(false); }
  };
  const remove = async (product: AnyRecord) => {
    if (!await confirm({ title: 'Delete product?', message: `Delete ${product.sku} · ${product.name}? Deletion will be blocked if an existing order references this product, preserving order history.`, confirmText: 'Delete', confirmColor: 'error' })) return;
    setError('');
    try {
      await api(`/api/products/${encodeURIComponent(product.sku)}`, { method: 'DELETE' });
      await load();
    } catch (deleteError: any) {
      setError(deleteError.status === 409
        ? `Cannot delete ${product.sku}: it is referenced by existing order lines. Historical order data remains unchanged.`
        : deleteError.message);
    }
  };
  const filtered = products.filter(product => `${product.sku} ${product.name} ${product.description}`.toLowerCase().includes(search.toLowerCase()));
  const dimensionFields: Array<[keyof ProductDraft, string]> = [['weight_g', 'Weight (g)'], ['length_mm', 'Length (mm)'], ['width_mm', 'Width (mm)'], ['height_mm', 'Height (mm)']];

  return <>
    <PageHeading title="Products" subtitle="Manage the product catalogue, pricing, and dimensions."/>
    <Stack className="products-toolbar" direction={{ xs: 'column-reverse', sm: 'row' }} spacing={1.5} sx={{ justifyContent: 'flex-end', alignItems: { sm: 'center' }, mb: 1.5 }}>
      <TextField size="small" fullWidth placeholder="Search by SKU or product name" value={search} onChange={event => setSearch(event.target.value)}/>
      <Button sx={{ flexShrink: 0 }} variant="contained" startIcon={<Add/>} onClick={startCreate}>Add Product</Button>
    </Stack>
    {error && !editorOpen && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
    <TableState loading={busy} empty={!filtered.length} emptyText="No products found.">
      <Table sx={{ minWidth: 900 }}>
        <TableHead><TableRow>{['SKU', 'Product', 'Description', 'RRP (Inc GST)', 'Weight', 'Dimensions', 'Actions'].map(label => <TableCell key={label}>{label}</TableCell>)}</TableRow></TableHead>
        <TableBody>{filtered.map(product => <TableRow key={product.sku}>
          <TableCell><b>{product.sku}</b></TableCell>
          <TableCell>{product.name}</TableCell>
          <TableCell sx={{ maxWidth: 360 }}>{product.description || '—'}</TableCell>
          <TableCell>{money(product.rrp_incl_gst)}</TableCell>
          <TableCell>{product.weight ? `${product.weight.value} ${product.weight.unit}` : '—'}</TableCell>
          <TableCell>{product.dimensions?.length?.value ? `${product.dimensions.length.value} × ${product.dimensions.width?.value} × ${product.dimensions.height?.value} mm` : '—'}</TableCell>
          <TableCell><Stack direction="row" spacing={0.5}>
            <Button size="small" startIcon={<EditOutlined/>} onClick={() => startEdit(product)}>Edit</Button>
            <Button size="small" color="error" startIcon={<DeleteOutlined/>} onClick={() => void remove(product)}>Delete</Button>
          </Stack></TableCell>
        </TableRow>)}</TableBody>
      </Table>
    </TableState>
    <Dialog open={editorOpen} onClose={() => !saving && setEditorOpen(false)} fullWidth maxWidth="sm">
      <DialogTitle>{editingSku ? 'Edit Product' : 'Add Product'}</DialogTitle>
      <DialogContent>{editorOpen && error && <Alert severity="error" sx={{ mb: 1.5 }}>{error}</Alert>}<Stack spacing={1.5} sx={{ pt: 1 }}>
        <TextField required label="SKU" disabled={Boolean(editingSku)} helperText={editingSku ? 'SKU cannot be changed after creation.' : undefined} value={draft.sku} onChange={event => setDraft({ ...draft, sku: event.target.value.toUpperCase() })}/>
        <TextField required label="Product Name" value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })}/>
        <TextField label="Description" multiline minRows={2} value={draft.description} onChange={event => setDraft({ ...draft, description: event.target.value })}/>
        <TextField required type="number" label="RRP (AUD, incl. GST)" slotProps={{ htmlInput: { min: .01, step: .01 } }} value={draft.rrp_incl_gst} onChange={event => setDraft({ ...draft, rrp_incl_gst: event.target.value })}/>
        <Box className="product-dimensions-form">{dimensionFields.map(([key, label]) => <TextField key={key} type="number" label={label} slotProps={{ htmlInput: { min: 1, step: 1 } }} value={draft[key]} onChange={event => setDraft({ ...draft, [key]: event.target.value })}/>)}</Box>
      </Stack></DialogContent>
      <DialogActions><Button disabled={saving} onClick={() => setEditorOpen(false)}>Cancel</Button><Button variant="contained" disabled={saving || !draft.sku.trim() || !draft.name.trim() || Number(draft.rrp_incl_gst) <= 0} onClick={() => void save()}>{saving ? 'Saving…' : 'Save Product'}</Button></DialogActions>
    </Dialog>
    {confirmDialog}
  </>;
}

function CarriersPage() {
  const { confirm, confirmDialog } = useConfirm();
  const [rows, setRows] = useState<Carrier[]>([]); const [search, setSearch] = useState(''); const [activeFilter, setActiveFilter] = useState('all'); const [busy, setBusy] = useState(true); const [error, setError] = useState(''); const [addOpen, setAddOpen] = useState(false); const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<number | null>(null); const [draft, setDraft] = useState<AnyRecord>({}); const [newCarrier, setNewCarrier] = useState({ code: '', name: '', description: '' });
  const load = () => { setBusy(true); api('/api/carriers').then(setRows).catch(err => setError(err.message)).finally(() => setBusy(false)); };
  useEffect(load, []);
  const saveEdit = async (id: number) => { setSaving(true); setError(''); try { await api(`/api/carriers/${id}`, { method: 'PATCH', body: JSON.stringify(draft) }); setEditing(null); load(); } catch (err: any) { setError(err.message); } finally { setSaving(false); } };
  const add = async () => { setSaving(true); setError(''); try { await api('/api/carriers', { method: 'POST', body: JSON.stringify(newCarrier) }); setAddOpen(false); setNewCarrier({ code: '', name: '', description: '' }); load(); } catch (err: any) { setError(err.message); } finally { setSaving(false); } };
  const remove = async (row: AnyRecord) => {
    if (row.used) { setError('This carrier is linked to existing shipments and cannot be deleted. Deactivate it to prevent new use.'); return; }
    if (!await confirm({ title: 'Delete carrier?', message: `Delete ${row.name}?`, confirmText: 'Delete', confirmColor: 'error' })) return;
    setError('');
    try { await api(`/api/carriers/${row.id}`, { method: 'DELETE' }); await load(); }
    catch (err: any) { setError(err.message); }
  };
  const deactivate = async (row: AnyRecord) => {
    if (!await confirm({ title: 'Deactivate carrier?', message: `${row.name} is used by saved shipments. Deactivating it prevents selecting it for new shipments while preserving its historical shipment records.`, confirmText: 'Deactivate' })) return;
    setError('');
    try { await api(`/api/carriers/${row.id}`, { method: 'PATCH', body: JSON.stringify({ is_active: false }) }); await load(); }
    catch (err: any) { setError(err.message); }
  };
  const filtered = rows.filter(row => (activeFilter === 'all' || row.is_active === (activeFilter === 'active')) && `${row.name} ${row.code}`.toLowerCase().includes(search.toLowerCase())).sort((a,b) => a.name.localeCompare(b.name));
  return <><PageHeading title="Carriers" subtitle="Maintain the carriers available for new shipment plans."/>{error && <Alert severity="error" sx={{ mb: 1.5 }}>{error}</Alert>}<Paper className="carriers-toolbar" variant="outlined" sx={{ p: 1.5, mb: 1.5 }}><Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ alignItems: { sm: 'center' } }}><TextField size="small" fullWidth placeholder="Search carriers" value={search} onChange={e => setSearch(e.target.value)}/><FormControl size="small" sx={{ minWidth: 155 }}><InputLabel>Status</InputLabel><Select label="Status" value={activeFilter} onChange={e => setActiveFilter(e.target.value)}><MenuItem value="all">All carriers</MenuItem><MenuItem value="active">Active</MenuItem><MenuItem value="inactive">Inactive</MenuItem></Select></FormControl><Button sx={{ flexShrink: 0 }} variant="contained" startIcon={<Add/>} onClick={() => setAddOpen(true)}>Add Carrier</Button></Stack></Paper><TableState loading={busy} empty={!filtered.length} emptyText="No carriers found."><Table sx={{ minWidth: 720 }}><TableHead><TableRow>{['Carrier Name','Code','Description','Status','Actions'].map(value => <TableCell key={value}>{value}</TableCell>)}</TableRow></TableHead><TableBody>{filtered.map(row => <TableRow key={row.id}>
    <TableCell>{editing === row.id ? <TextField size="small" slotProps={{ htmlInput: { 'aria-label': `Carrier name ${row.code}` } }} value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })}/> : row.name}</TableCell>
    <TableCell>{editing === row.id && !row.used ? <TextField size="small" slotProps={{ htmlInput: { 'aria-label': `Carrier code ${row.code}` } }} value={draft.code} onChange={e => setDraft({ ...draft, code: e.target.value })}/> : row.code}</TableCell>
    <TableCell>{editing === row.id ? <TextField size="small" slotProps={{ htmlInput: { 'aria-label': `Carrier description ${row.code}` } }} value={draft.description} onChange={e => setDraft({ ...draft, description: e.target.value })}/> : row.description || '—'}</TableCell>
    <TableCell>{editing === row.id ? <Select size="small" value={draft.is_active ? 'active' : 'inactive'} onChange={e => setDraft({ ...draft, is_active: e.target.value === 'active' })}><MenuItem value="active">Active</MenuItem><MenuItem value="inactive">Inactive</MenuItem></Select> : <Chip size="small" label={row.is_active ? 'Active' : 'Inactive'} color={row.is_active ? 'success' : 'default'}/>}</TableCell>
    <TableCell>{editing === row.id ? <Stack direction="row"><Button size="small" disabled={saving} onClick={() => saveEdit(row.id)}>Save</Button><Button size="small" onClick={() => setEditing(null)}>Cancel</Button></Stack> : <Stack direction="row" spacing={0.5}><Button size="small" onClick={() => { setEditing(row.id); setDraft({ name: row.name, code: row.code, description: row.description, is_active: row.is_active }); }}>Edit</Button>{row.used && row.is_active && <Button size="small" onClick={() => void deactivate(row)}>Deactivate</Button>}{row.used ? <Tooltip title="This carrier is linked to existing shipments and cannot be deleted."><span><Button size="small" color="error" disabled startIcon={<DeleteOutlined/>}>Delete</Button></span></Tooltip> : <Button size="small" color="error" startIcon={<DeleteOutlined/>} onClick={() => void remove(row)}>Delete</Button>}</Stack>}</TableCell>
  </TableRow>)}</TableBody></Table></TableState>
  <Dialog open={addOpen} onClose={() => !saving && setAddOpen(false)} fullWidth maxWidth="sm"><DialogTitle>Add Carrier</DialogTitle><DialogContent><Stack spacing={1.5} sx={{ pt: 1 }}><TextField required label="Carrier Code" value={newCarrier.code} onChange={e => setNewCarrier({ ...newCarrier, code: e.target.value.toUpperCase() })}/><TextField required label="Carrier Name" value={newCarrier.name} onChange={e => setNewCarrier({ ...newCarrier, name: e.target.value })}/><TextField label="Description" value={newCarrier.description} onChange={e => setNewCarrier({ ...newCarrier, description: e.target.value })}/></Stack></DialogContent><DialogActions><Button onClick={() => setAddOpen(false)}>Cancel</Button><Button variant="contained" disabled={saving || !newCarrier.code.trim() || !newCarrier.name.trim()} onClick={add}>{saving ? 'Saving…' : 'Save Carrier'}</Button></DialogActions></Dialog>{confirmDialog}</>;
}

type LineInput = { sku: string; quantity: number | string; tracking_group: string; rrp_incl_gst?: string; gst_rate_percent?: string };
type ShipmentInput = { id?: number; tracking_group: string; carrier: string; carrier_id?: number; shipping_account_profile_id?: string | null; tracking_number: string };
function OrderForm({ productsKey }: { productsKey: number }) {
  const { id } = useParams(); const isNew = !id; const navigate = useNavigate();
  const { confirm, confirmDialog } = useConfirm();
  const [products, setProducts] = useState<AnyRecord[]>([]); const [carriers, setCarriers] = useState<AnyRecord[]>([]); const [saved, setSaved] = useState<AnyRecord | null>(null); const [form, setForm] = useState<AnyRecord | null>(null);
  const [editing, setEditing] = useState(isNew); const [loading, setLoading] = useState(!isNew); const [saving, setSaving] = useState(false); const [error, setError] = useState(''); const [success, setSuccess] = useState(''); const [tab, setTab] = useState(0); const [quoteShipment, setQuoteShipment] = useState<AnyRecord | null>(null); const [trackingMap, setTrackingMap] = useState<Record<string, AnyRecord>>({}); const [trackingDrawer, setTrackingDrawer] = useState<AnyRecord | null>(null); const [trackingDrawerShipment, setTrackingDrawerShipment] = useState<AnyRecord | null>(null); const [trackingBusy, setTrackingBusy] = useState<string | null>(null); const [trackingLoading, setTrackingLoading] = useState(false);
  const trackingLoadSignatureRef = useRef<Record<string, string>>({}); const activeTrackingOrderRef = useRef<string | null>(null);
  const [shipmentMenu, setShipmentMenu] = useState<{ anchor: HTMLElement; shipment: AnyRecord } | null>(null);
  const [notice, setNotice] = useState('');
  const [productDialog, setProductDialog] = useState(false); const [productChoice, setProductChoice] = useState<AnyRecord | null>(null); const [productQty, setProductQty] = useState(1); const [productRrp, setProductRrp] = useState('');
  const loadProducts = () => api('/api/products').then(setProducts).catch(err => setError(err.message));
  const setField = (name: string, value: unknown) => setForm((previous: AnyRecord | null) => previous ? { ...previous, [name]: value } : previous);
  const setCustomer = (name: string, value: unknown) => setForm((previous: AnyRecord | null) => previous ? { ...previous, customer: { ...previous.customer, [name]: value } } : previous);
  const setAddress = (name: string, value: unknown) => setForm((previous: AnyRecord | null) => previous ? { ...previous, shipping_address: { ...previous.shipping_address, [name]: value } } : previous);
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
    // UI 预览与后端都按含税行总额计算，舍入后的单价仅作展示。
    const amounts = calculateOrderLineAmounts(rrp, qty, gstRate);
    return { line, product, rrp, gstRate, grossTotal: amounts.grossLineCents / 100, unit: amounts.unitExGstCents / 100,
      subtotal: amounts.subtotalExGstCents / 100, gst: amounts.gstCents / 100 };
  });
  const hasUnsavedChanges = Boolean(editing && form && (isNew
    ? form.company_name || form.customer.name || form.customer.phone || form.customer.email || form.line_items.length || form.shipping_address.street
    : saved && JSON.stringify(form) !== JSON.stringify(hydrate(saved))));
  useEffect(() => {
    if (!hasUnsavedChanges) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [hasUnsavedChanges]);
  const previewSubtotal = calculatedLines.reduce((sum, line) => sum + line.subtotal, 0);
  const previewGst = calculatedLines.reduce((sum, line) => sum + line.gst, 0);
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
  const validate = () => {
    if (!form.customer.name.trim() || !form.company_name.trim() || !form.customer.phone.trim() || !form.customer.email.trim()) return 'Customer name, company, phone and email are required.';
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
  const save = async () => { const message = validate(); if (message) { setError(message); return; } setSaving(true); setError(''); setSuccess('');
    const body = { order_date: form.order_date, company_name: form.company_name.trim(), customer: { name: form.customer.name.trim(), phone: form.customer.phone.trim(), email: form.customer.email.trim() }, shipping_address: { ...form.shipping_address, street: form.shipping_address.street.trim(), address_line2: form.shipping_address.address_line2 || null, suburb: form.shipping_address.suburb.trim() }, line_items: lines.map(line => ({ sku: line.sku, quantity: Number(line.quantity), tracking_group: line.tracking_group || null, rrp_incl_gst: line.rrp_incl_gst, gst_rate_percent: line.gst_rate_percent ?? '10.00' })), shipments: shipments.map(shipment => ({ tracking_group: shipment.tracking_group, carrier: shipment.carrier, carrier_id: shipment.carrier_id, shipping_account_profile_id: shipment.shipping_account_profile_id, tracking_number: shipment.tracking_number.trim() || null })) };
    try { const result = isNew ? await api('/api/orders', { method: 'POST', body: JSON.stringify(body) }) : await api(`/api/orders/${encodeURIComponent(id!)}`, { method: 'PATCH', body: JSON.stringify(body) }); setSaved(result); setForm(hydrate(result)); setEditing(false); setSuccess('Saved to the database.'); if (isNew) navigate(`/orders/${encodeURIComponent(result.order_id)}`, { replace: true }); }
    catch (err: any) { setError(err.message); } finally { setSaving(false); }
  };
  const cancel = () => { setError(''); setSuccess(''); if (isNew) navigate('/orders'); else if (saved) { setForm(hydrate(saved)); setEditing(false); } };
  const changeStatus = async (target: string) => { if (!id) return; setSaving(true); setError(''); try { const result = await api(`/api/orders/${encodeURIComponent(id)}/status`, { method: 'PATCH', body: JSON.stringify({ status: target }) }); setSaved(result); setForm(hydrate(result)); setEditing(false); setSuccess(`Status updated to ${statusLabels[target]}.`); } catch (err: any) { setError(err.message); } finally { setSaving(false); } };
  const saveConfirmedTracking = async (shipmentId: number, trackingNumber: string) => { setSaving(true); setError(''); try { const result = await api(`/api/shipments/${shipmentId}`, { method: 'PATCH', body: JSON.stringify({ tracking_number: trackingNumber }) }); setSaved(result); setForm(hydrate(result)); setSuccess('Tracking number saved.'); } catch (err: any) { setError(err.message); } finally { setSaving(false); } };
  const refreshShipmentTracking = async (shipment: AnyRecord) => { if (!shipment.tracking_number?.trim()) { setError(''); setNotice('Enter a tracking number before querying this shipment.'); return; } setTrackingBusy(shipment.tracking_number); try { const result = await api('/api/orders/tracking', { method: 'POST', body: JSON.stringify({ carrier: shipment.carrier, tracking_number: shipment.tracking_number.trim() }) }); setTrackingMap(previous => ({ ...previous, [shipment.tracking_number]: result })); return result; } catch (err: any) { const result = { carrier: shipment.carrier, tracking_number: shipment.tracking_number, overall_status: 'unavailable', tracking_error: err.message, tracking_error_code: 'REQUEST_FAILED', consignment_events: [], articles: [] }; setTrackingMap(previous => ({ ...previous, [shipment.tracking_number]: result })); return result; } finally { setTrackingBusy(null); } };
  const viewShipmentTracking = (shipment: AnyRecord) => { setTrackingDrawerShipment(shipment); const cached = trackingMap[shipment.tracking_number]; setTrackingDrawer(cached || { carrier: shipment.carrier, tracking_number: shipment.tracking_number, overall_status: 'not_queried', consignment_events: [], articles: [] }); };
  const addShipment = () => { const available = carriers.find(carrier => carrier.is_active); if (!available) { setError('No active carriers. Please maintain carriers first.'); return; } setForm((previous: AnyRecord) => { const n = previous.shipments.length + 1; return { ...previous, shipments: [...previous.shipments, { tracking_group: `Shipment ${n}`, carrier: available.name, carrier_id: available.id, tracking_number: '' }] }; }); };
  const removeShipment = (index: number) => setForm((previous: AnyRecord) => { const removed = previous.shipments[index].tracking_group; const next = previous.shipments.filter((_: any, i: number) => i !== index); return { ...previous, shipments: next, line_items: previous.line_items.map((line: LineInput) => line.tracking_group === removed ? { ...line, tracking_group: '' } : line) }; });
  const deleteSavedShipment = async (shipment: AnyRecord) => { if (!await confirm({ title: 'Delete Shipment?', message: `Delete ${shipment.tracking_group}? Its saved fee and tracking association will also be removed.`, confirmText: 'Delete', confirmColor: 'error' })) return; setSaving(true); setError(''); try { await api<void>(`/api/shipments/${shipment.id}`, { method: 'DELETE' }); const updated = await api(`/api/orders/${encodeURIComponent(id!)}`); setSaved(updated); setForm(hydrate(updated)); setEditing(false); setSuccess('Shipment deleted.'); } catch (err: any) { setError(err.message); } finally { setSaving(false); } };
  if (loading || !form) return <Box sx={{ p: 8, textAlign: 'center' }}><CircularProgress/></Box>;
  const canEdit = !saved || saved.status === 'draft';
  const visibleEdit = Boolean(saved) && !editing && canEdit;
  const currentStatus = saved?.status || 'draft';
  const nextStatus = saved && !editing ? statusSequence[statusSequence.indexOf(currentStatus) + 1] : undefined;
  return <>
    <PageHeading title={saved ? 'Order Details' : 'New Order'} subtitle={saved ? 'Review customer information, order lines, and shipment details.' : 'Create an order with customer, product, and shipping information.'}/>
    <Stack className="order-form-toolbar" direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 0 }}>
      <Stack className="order-toolbar-actions" direction="row" spacing={.7} sx={{ alignItems: 'center' }}>
        {editing ? <><Button variant="contained" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button><Button onClick={cancel} disabled={saving}>Cancel</Button></> : visibleEdit ? <Button variant="outlined" startIcon={<EditOutlined/>} onClick={() => setEditing(true)}>Edit</Button> : null}
        {nextStatus && <Button className="status-action status-action-next" variant="contained" disabled={saving} onClick={() => changeStatus(nextStatus)}>{`Mark ${statusLabels[nextStatus]}`}</Button>}
        {(saved?.status === 'confirmed' || saved?.status === 'in_transit') && !editing && <Button className="status-action status-revert-action" disabled={saving} onClick={async () => { if (await confirm({ title: 'Return order to Draft?', message: 'This will move the order back to Draft so its order and shipping details can be edited.', confirmText: 'Revert to Draft' })) await changeStatus('draft'); }}>Revert to Draft</Button>}
      </Stack>
      <Box className="order-toolbar-status"><OrderStatusBar status={currentStatus}/></Box>
    </Stack>
    {error && <Alert severity="error" sx={{ mb: 1.5 }}>{error}</Alert>}{success && <Alert severity="success" sx={{ mb: 1.5 }} onClose={() => setSuccess('')}>{success}</Alert>}
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
        <FieldGrid disabled={!editing} fields={[
          { label: 'Order Date', value: form.order_date, type: 'date', onChange: (v: string) => setField('order_date', v), required: true },
          { label: 'Currency', value: 'AUD', disabled: true },
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
        <div className="list-toolbar"><div><h3>Order Lines</h3><span>{lines.length} product lines</span></div>{editing && <Button startIcon={<Add/>} onClick={() => { setProductChoice(null); setProductRrp(''); setProductQty(1); setProductDialog(true); }}>Add Product</Button>}</div>
        <OrderLinesTable
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
    {quoteShipment && saved && <ShippingQuoteDialog key={`${saved.order_id}-${quoteShipment.id || 'new'}`} order={saved} shipment={quoteShipment.isNew ? null : quoteShipment} onClose={() => setQuoteShipment(null)} onApplied={order => { setSaved(order); setForm(hydrate(order)); setSuccess('Shipping plan saved.'); }}/ >}
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

function FieldGrid({ fields, disabled }: { fields: { label: string; value: string; onChange?: (v: string) => void; type?: string; required?: boolean; disabled?: boolean }[]; disabled: boolean }) {
  return <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: { xs: 1, md: 1.25 } }}>{fields.map(field => {
    const readOnly = disabled || field.disabled;
    if (readOnly) return <Box className="read-only-field" key={field.label}>
      <Typography className="read-only-field-label">{field.label}</Typography>
      <Typography className="read-only-field-value">{field.type === 'date' ? formatDate(field.value) : field.value || '—'}</Typography>
    </Box>;
    return <TextField key={field.label} size="small" label={field.label} type={field.type || 'text'} value={field.value ?? ''} onChange={field.onChange ? e => field.onChange!(e.target.value) : undefined} required={field.required} fullWidth slotProps={field.type === 'date' ? { inputLabel: { shrink: true } } : undefined}/>;
  })}</Box>;
}

function TrackingPage() {
  const location = useLocation();
  const [carriers, setCarriers] = useState<AnyRecord[]>([]); const [carrier, setCarrier] = useState(''); const [trackingNumber, setTrackingNumber] = useState(''); const [result, setResult] = useState<AnyRecord | null>(null); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  useEffect(() => { api('/api/carriers?active_only=true').then((items: AnyRecord[]) => { setCarriers(items); setCarrier(current => current || items.find(item => item.is_active)?.name || ''); }).catch(err => setError(err.message)); }, []);
  const tntSelected = carrier.toLowerCase().includes('tnt');
  const query = async (number = trackingNumber, selectedCarrier = carrier) => { if (selectedCarrier.toLowerCase().includes('tnt')) { setError('TNT tracking is not implemented.'); return; } setBusy(true); setError(''); setResult(null); try { const value = await api('/api/orders/tracking', { method: 'POST', body: JSON.stringify({ carrier: selectedCarrier, tracking_number: number.trim() }) }); setResult(value); } catch (err: any) { setError(err.message); } finally { setBusy(false); } };
  useEffect(() => { const state = location.state as AnyRecord | null; if (state?.tracking_number) { setCarrier(state.carrier); setTrackingNumber(state.tracking_number); query(state.tracking_number, state.carrier); } }, [location.state]);
  return <ApiTestingPageShell title="Tracking" description="Look up a carrier tracking number and review the latest shipment events.">
    <Paper variant="outlined" sx={{ p: { xs: 1.8, md: 2.5 } }}><Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} sx={{ alignItems: 'stretch' }}><FormControl size="small" sx={{ minWidth: 230 }}><InputLabel>Carrier</InputLabel><Select label="Carrier" value={carrier} onChange={e => { setCarrier(e.target.value); setResult(null); setError(''); }}>{carriers.map(item => <MenuItem key={item.id} value={item.name}>{item.name}</MenuItem>)}</Select></FormControl><TextField size="small" label="Tracking Number" value={trackingNumber} onChange={e => { setTrackingNumber(e.target.value); setResult(null); setError(''); }} fullWidth onKeyDown={e => e.key === 'Enter' && trackingNumber.trim() && !tntSelected && query()}/><Button variant="contained" disabled={busy || !carrier || !trackingNumber.trim() || tntSelected} onClick={() => query()}>{busy ? 'Tracking…' : 'Track'}</Button></Stack>{tntSelected && <Alert severity="info" sx={{ mt: 2 }}>TNT tracking is not implemented.</Alert>}{busy && <Box sx={{ textAlign: 'center', p: 3 }}><CircularProgress size={26}/></Box>}{error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}{result && <TrackingResult data={result} onRefresh={() => query()}/>}</Paper>
  </ApiTestingPageShell>;
}

function TrackingResult({ data, onRefresh, drawerMode = false, loading = false, refreshing = false }: { data: AnyRecord; onRefresh?: () => void; drawerMode?: boolean; loading?: boolean; refreshing?: boolean }) {
  const status = data.overall_status_raw || data.overall_status || 'Status unavailable';
  return <Box className={`tracking-result${drawerMode ? ' tracking-result-drawer' : ''}`}>
    {drawerMode ? <Stack className="tracking-result-heading tracking-result-heading-drawer" direction="row" spacing={1} sx={{ justifyContent: 'space-between', alignItems: 'center' }}><Box><Typography className="tracking-result-label" variant="caption">Tracking Status</Typography>{loading ? <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}><CircularProgress size={15}/><Typography variant="body2">Loading tracking details…</Typography></Stack> : <TrackingStatusChip status={status} hasError={Boolean(data.tracking_error)}/>}</Box>{onRefresh && <Button size="small" variant="outlined" startIcon={refreshing ? <CircularProgress size={14}/> : <Refresh/>} disabled={loading || refreshing} onClick={onRefresh}>{refreshing ? 'Refreshing…' : 'Refresh Tracking'}</Button>}</Stack>
      : <Stack className="tracking-result-heading" direction="row" spacing={1} sx={{ justifyContent: 'space-between', alignItems: 'center' }}><Box><Typography variant="subtitle1" fontWeight={700}>Consignment</Typography><Typography variant="body2" color="text.secondary">{status}</Typography></Box>{onRefresh && <Button size="small" variant="outlined" startIcon={<Refresh/>} onClick={onRefresh}>Refresh</Button>}</Stack>}
    {data.tracking_error && <Alert severity="warning" sx={{ mt: 1.5 }}>{data.tracking_error_code}: {data.tracking_error}</Alert>}
    <Box className="tracking-summary-grid"><Box className="tracking-stat"><Typography variant="caption">Articles</Typography><strong>{data.total_articles ?? '—'}</strong></Box><Box className="tracking-stat"><Typography variant="caption">Delivered</Typography><strong>{data.delivered_articles ?? '—'}</strong></Box><Box className="tracking-stat tracking-stat-updated"><Typography variant="caption">Latest Carrier Event</Typography><strong>{data.last_updated ? (drawerMode ? formatDateTime(data.last_updated) : data.last_updated) : '—'}</strong></Box></Box>
    <Paper className="tracking-event-section" variant="outlined"><Typography variant="subtitle2" fontWeight={700}>Consignment Events</Typography><Events events={data.consignment_events || []} formatDates={drawerMode} emptyText={drawerMode && (data.articles || []).length ? 'No consignment-level events. See article tracking below.' : undefined}/></Paper>
    {drawerMode && (data.articles || []).length > 0 && <Typography className="tracking-articles-title" variant="subtitle1">Article Tracking · {data.articles.length}</Typography>}
    {(data.articles || []).map((article: AnyRecord, index: number) => <Paper className="tracking-article-card" key={article.article_id || index} variant="outlined"><Stack className="tracking-article-heading" direction="row" spacing={1} sx={{ justifyContent: 'space-between', alignItems: 'flex-start' }}><Box><Typography variant="subtitle2" fontWeight={700}>Article {article.article_id || index + 1}</Typography><Typography variant="caption" color="text.secondary">{article.product_type || 'Product type unavailable'}</Typography></Box>{drawerMode ? <TrackingStatusChip status={article.raw_status || article.status || 'Status unavailable'} hasError={Boolean(data.tracking_error)}/> : <Chip size="small" variant="outlined" label={article.raw_status || article.status || 'Status unavailable'}/>}</Stack><Events events={article.events || []} formatDates={drawerMode}/></Paper>)}
  </Box>;
}
function Events({ events, emptyText = 'No tracking events were returned.', formatDates = false }: { events: AnyRecord[]; emptyText?: string; formatDates?: boolean }) { return events.length ? <ol className="tracking-timeline">{events.map((event, index) => <li className="tracking-timeline-event" key={`${event.date}-${index}`}><span className="tracking-timeline-marker"/><Box><Typography variant="body2" fontWeight={650}>{event.description || 'Event description unavailable'}</Typography><Typography variant="caption" color="text.secondary" component="time" dateTime={event.date || undefined}>{event.date ? (formatDates ? formatDateTime(event.date) : event.date) : 'Time not provided'}</Typography>{event.location && <Typography variant="caption" color="text.secondary" display="block">{event.location}</Typography>}</Box></li>)}</ol> : <Typography className="tracking-empty-events" variant="body2" color="text.secondary">{emptyText}</Typography>; }

function ShippingRatesPage() {
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

function ShippingRateError({ message, code, onViewAccountDetails }: { message: string; code: string; onViewAccountDetails?: () => void }) {
  const guidance: Record<string, string> = {
    '66004': 'No postage product on this account can price the submitted lane and parcel. Keep the order lines selected; they describe parcel contents and weight, not Australia Post postage products. Check the account location, destination, gross weight, outer dimensions and contract eligibility. If the lines are physically separate parcels or the combined parcel exceeds service limits, create separate Shipments and quote them independently. If each separate parcel still has no rates, the account contract or route eligibility needs review.',
    '41007': 'The origin postcode does not match this account’s contract lodgement postcode. Compare it with the account location details above and use the registered account location if appropriate.',
    '42012': 'The requested postage product is not available on this account for the destination. Get Rates without narrowing to a product to see other eligible services, or check the account contract and destination lane.',
    '42002': 'This service has no price for the submitted route or parcel details. Review the account, destination and package information, then request rates again.',
    '43003': 'The parcel weight is not supported for the available contract services. Check the combined gross weight or split the goods into separate Shipments if they will travel as separate parcels.',
    '43004': 'The parcel dimensions or cubic weight are not supported for the available contract services. Check the outer dimensions or split the goods into separate Shipments if needed.',
    '42006': 'The parcel width exceeds the supported limit. Check the outer dimensions or use separate Shipments for separate parcels.',
    '42007': 'The parcel height exceeds the supported limit. Check the outer dimensions or use separate Shipments for separate parcels.',
    '42008': 'The parcel length exceeds the supported limit. Check the outer dimensions or use separate Shipments for separate parcels.',
    '42009': 'The parcel volume exceeds the supported limit. Check the outer dimensions or use separate Shipments for separate parcels.',
    '42010': 'The parcel weight exceeds the supported limit. Check the gross weight or use separate Shipments for separate parcels.',
    '42011': 'At least two parcel dimensions must meet the carrier’s minimum size. Review the outer dimensions and request rates again.',
  };
  const detail = guidance[code];
  const canReviewAccount = code === '41007' || code === '66004';
  return <Alert severity="error" sx={{ mb: 1.5 }} action={canReviewAccount && onViewAccountDetails ? <Button color="inherit" size="small" onClick={onViewAccountDetails}>{code === '41007' ? 'View account location' : 'Review account products'}</Button> : undefined}>
    {message}{detail && <Typography variant="body2" sx={{ mt: .75 }}>{detail}</Typography>}
  </Alert>;
}

function ShippingQuoteDialog({ order, shipment, onClose, onApplied }: { order: AnyRecord; shipment: AnyRecord | null; onClose: () => void; onApplied: (order: AnyRecord) => void }) {
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
      origin: item?.origin || defaultShippingOrigin(), destination: item?.destination || defaultShippingDestination(),
      pkg: { weight: savedPackage ? String(savedPackage.weight_gross_g / 1000) : netWeight ? (netWeight / 1000).toFixed(3) : '',
        length: savedPackage ? String(savedPackage.length_mm / 10) : '', width: savedPackage ? String(savedPackage.width_mm / 10) : '', height: savedPackage ? String(savedPackage.height_mm / 10) : '' } };
  };
  const [carriers, setCarriers] = useState<AnyRecord[]>([]); const [currentShipment, setCurrentShipment] = useState<AnyRecord | null>(shipment);
  const [drafts, setDrafts] = useState<Record<string, PlannerDraft>>(() => ({ [String(shipment?.id ?? 'new')]: makeDraft(shipment) }));
  const draftKey = String(currentShipment?.id ?? 'new'); const draft = drafts[draftKey] || makeDraft(currentShipment);
  const { carrierId, accountProfileId, lineIds, origin, destination, pkg } = draft;
  const [formDirty, setFormDirty] = useState(false);
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
  const alreadyAllocated = (line: AnyRecord) => (order.shipments || []).some((other: AnyRecord) => other.id !== currentShipment?.id && other.order_line_ids?.includes(line.id));
  const selectedLines = lines.filter(line => lineIds.includes(line.id));
  const netWeightG = selectedLines.reduce((sum, line) => sum + Number(line.product_weight_g || 0) * Number(line.quantity), 0);
  // 输入条件变化后旧报价不再匹配当前地址/包裹，必须立即清除避免误应用。
  const invalidate = () => { setRates([]); setSelectedRate(''); setMessage(''); setError(''); setErrorCode(''); };
  const toggleLine = (line: AnyRecord) => { invalidate(); const next = lineIds.includes(line.id) ? lineIds.filter(id => id !== line.id) : [...lineIds, line.id]; const grams = lines.filter(item => next.includes(item.id)).reduce((sum, item) => sum + Number(item.product_weight_g || 0) * Number(item.quantity), 0); updateDraft({ lineIds: next, pkg: { ...pkg, weight: grams ? (grams / 1000).toFixed(3) : '' } }); };
  const updateLocation = (which: 'origin' | 'destination', key: string, value: string) => { invalidate(); if (which === 'origin') setOrigin((old: AnyRecord) => ({ ...old, [key]: value })); else setDestination((old: AnyRecord) => ({ ...old, [key]: value })); };
  const useAccountLocation = (location: AccountMerchantLocation) => { invalidate(); setOrigin((old: AnyRecord) => ({ ...old, type: 'MERCHANT_LOCATION', suburb: location.suburb || '', state: location.state || '', postcode: location.postcode || '', country: 'AU' })); };
  const updatePackage = (key: string, value: string) => { invalidate(); setPkg(old => ({ ...old, [key]: value })); };
  const packages = Object.values(pkg).every(value => Number(value) > 0) ? [{ weight_kg: pkg.weight, length_cm: pkg.length, width_cm: pkg.width, height_cm: pkg.height }] : [];
  const addressValid = (value: AnyRecord) => Boolean(value.suburb?.trim() && /^[A-Z]{2,3}$/.test(value.state || '') && /^\d{4}$/.test(value.postcode || ''));
  const requestRates = async () => { invalidate(); setError(''); if (!carrier) { setError('Select an active carrier.'); return; } if (carrier.code === 'TNT') { setError('TNT rate service is not implemented.'); return; } if (!ratesSupported) { setError(`No Australia Post rate adapter is configured for ${carrier.name}.`); return; } if (!pricingAccountAvailable) { setError('Select a configured pricing account.'); return; } if (!lineIds.length) { setError('Select at least one unassigned order line.'); return; } if (!addressValid(origin) || !addressValid(destination)) { setError('Enter valid Australian origin and destination suburbs, states and postcodes.'); return; } if (!packages.length) { setError('Enter package gross weight and all outer dimensions.'); return; } if (Number(pkg.weight) * 1000 < netWeightG) { setError('Package gross weight cannot be less than selected product net weight.'); return; }
    setBusy(true); try { const result = await api(`/api/shipping/orders/${encodeURIComponent(order.order_id)}/quotes/preview`, { method: 'POST', body: JSON.stringify({ carrier_id: carrier.id, shipping_account_profile_id: accountProfileId, order_line_ids: lineIds, ...(currentShipment?.id ? { shipment_id: currentShipment.id, tracking_number: currentShipment.tracking_number } : {}), origin, destination, packages }) }); setRates(result.rates || []); if (!result.rates?.length) setMessage('No eligible services were returned. Your selected order lines and package details are unchanged.'); }
    catch (err: any) { setError(err.message); setErrorCode(err instanceof ApiError ? err.code || '' : ''); } finally { setBusy(false); } };
  const savePlan = async (quoteId?: string) => { setBusy(true); setError(''); setErrorCode(''); try { const saved = quoteId ? await api(`/api/shipping/orders/${encodeURIComponent(order.order_id)}/quotes/apply`, { method: 'POST', body: JSON.stringify({ quote_id: quoteId }) }) : await api(`/api/shipping/orders/${encodeURIComponent(order.order_id)}/shipments/save`, { method: 'POST', body: JSON.stringify({ carrier_id: carrier?.id, shipping_account_profile_id: pricingAccountAvailable ? accountProfileId : undefined, order_line_ids: lineIds, ...(currentShipment?.id ? { shipment_id: currentShipment.id, tracking_number: currentShipment.tracking_number } : {}), origin, destination, packages }) });
      onApplied(saved); const assigned = saved.shipments.find((item: AnyRecord) => item.id === currentShipment?.id) || saved.shipments.find((item: AnyRecord) => lineIds.every(id => item.order_line_ids?.includes(id)) && item.order_line_ids?.length === lineIds.length); if (assigned) { setCurrentShipment(assigned); setDrafts(previous => ({ ...previous, [String(assigned.id)]: makeDraft(assigned) })); } setFormDirty(false); invalidate(); setMessage(quoteId ? 'Selected shipping rate applied and saved.' : 'Shipment plan saved.');
    } catch (err: any) { setError(err.message); setErrorCode(err instanceof ApiError ? err.code || '' : ''); } finally { setBusy(false); } };
  const addAnother = () => { setDrafts(previous => ({ ...previous, new: { ...makeDraft(null, carriers.find(item => item.is_active)?.id || ''), accountProfileId: defaultAccountId } })); setCurrentShipment(null); setFormDirty(false); invalidate(); setMessage('New shipment plan.'); };
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
        {error && <ShippingRateError message={error} code={errorCode} onViewAccountDetails={accountProfileId ? () => setAccountProductsOpen(true) : undefined} />}{message && <Alert severity="success">{message}</Alert>}{busy && <CircularProgress size={22}/>}
        {rates.length > 0 && <Paper className="planner-rates-panel" variant="outlined" sx={{ p: 1.25 }}><Typography variant="subtitle2" fontWeight={700} mb={.75}>Available Shipping Services</Typography><Stack spacing={.5}>{rates.map(rate => <Paper component="label" key={rate.quote_id} className={`planner-rate-option${selectedRate === rate.quote_id ? ' is-selected' : ''}`} variant="outlined"><Radio size="small" checked={selectedRate === rate.quote_id} onChange={() => setSelectedRate(rate.quote_id)} slotProps={{ input: { 'aria-label': `Select ${rate.service_name}` } }}/><Box flex={1}><Typography variant="body2" fontWeight={650}>{rate.service_name}</Typography><Typography variant="caption" color="text.secondary">Product {rate.product_id || '—'} · Base {money(rate.shipping_cost)} · Fuel {money(rate.fuel_surcharge)} · GST {money(rate.gst)}</Typography></Box><Typography fontWeight={700}>{money(rate.total_cost)}</Typography></Paper>)}</Stack></Paper>}
      </Stack></Box></DialogContent>
    <DialogActions className="planner-dialog-actions" sx={{ justifyContent: 'space-between', px: 2, py: 1.2 }}><Button disabled={busy || !carrierId || !lineIds.length || order.status !== 'draft'} onClick={() => savePlan()}>{busy ? 'Saving…' : 'Save Shipment Only'}</Button><Stack direction="row" spacing={1}><Tooltip title={carrier?.code === 'TNT' ? 'TNT rate service is not implemented.' : !ratesSupported ? 'No rate adapter is configured for this carrier.' : !selectedRate ? 'Get rates and select a service before applying the shipping fee.' : ''}><span><Button variant="contained" disabled={busy || !selectedRate} onClick={() => savePlan(selectedRate)}>{busy ? 'Applying…' : 'Apply Shipping Fee'}</Button></span></Tooltip><Button disabled={busy || !ratesSupported || !carrierId || !pricingAccountAvailable || !lineIds.length} onClick={requestRates}>{busy ? 'Getting Rates…' : rates.length ? 'Recalculate' : 'Get Rates'}</Button><Button onClick={handleClose}>Close</Button></Stack></DialogActions>
  </Dialog>{confirmDialog}</>;
}

function QuoteCalculator({ defaultOrigin, defaultDestination, defaultPackage, orderNo, shipmentId, order, shipment, onApplied, carrierSelector, carrier = '', carrierId, carrierCode = '', integrationType = '' }: { defaultOrigin: AnyRecord; defaultDestination: AnyRecord; defaultPackage: AnyRecord; orderNo?: string; shipmentId?: number; order?: AnyRecord; shipment?: AnyRecord; onApplied?: (order: AnyRecord) => void; carrierSelector?: React.ReactNode; carrier?: string; carrierId?: number; carrierCode?: string; integrationType?: string }) {
  const { accounts, loading: accountsLoading, error: accountsError, defaultAccountId } = useShippingAccounts();
  const [accountProfileId, setAccountProfileId] = useState(shipment?.shipping_account_profile_id || '');
  const [origin, setOrigin] = useState(defaultOrigin); const [destination, setDestination] = useState(defaultDestination); const [pkg, setPkg] = useState(defaultPackage);
  const [rates, setRates] = useState<AnyRecord[]>([]); const [selected, setSelected] = useState(''); const [loading, setLoading] = useState(false); const [saving, setSaving] = useState(false); const [error, setError] = useState(''); const [errorCode, setErrorCode] = useState(''); const [message, setMessage] = useState(''); const [accountProductsOpen, setAccountProductsOpen] = useState(false);
  const resetQuote = () => { setRates([]); setSelected(''); setError(''); setErrorCode(''); setMessage(''); };
  const pricingAccountAvailable = accounts.some(item => item.id === accountProfileId && item.enabled && item.pricing_enabled && item.configured);
  useEffect(() => { if (!accountProfileId && defaultAccountId) setAccountProfileId(defaultAccountId); }, [accountProfileId, defaultAccountId]);
  const changeLocation = (which: 'origin' | 'destination', key: string, value: string) => { resetQuote(); if (which === 'origin') setOrigin((prev: AnyRecord) => ({ ...prev, [key]: value })); else setDestination((prev: AnyRecord) => ({ ...prev, [key]: value })); };
  const useAccountLocation = (location: AccountMerchantLocation) => { resetQuote(); setOrigin((previous: AnyRecord) => ({ ...previous, type: 'MERCHANT_LOCATION', suburb: location.suburb || '', state: location.state || '', postcode: location.postcode || '', country: 'AU' })); };
  const changePackage = (key: string, value: string) => { resetQuote(); setPkg((prev: AnyRecord) => ({ ...prev, [key]: value })); };
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
    <Stack direction="row" sx={{ justifyContent: 'flex-end', mb: 1.5 }}><Button variant="contained" onClick={requestRates} disabled={loading || carrierCode === 'TNT' || (integrationType === 'AUSTRALIA_POST' && !pricingAccountAvailable)}>{loading ? 'Getting Rates…' : 'Get Rates'}</Button></Stack>
    {error && <ShippingRateError message={error} code={errorCode} onViewAccountDetails={accountProfileId ? () => setAccountProductsOpen(true) : undefined} />}{message && <Alert severity="info" sx={{ mb: 1.5 }}>{message}</Alert>}{loading && <Box sx={{ textAlign: 'center', py: 2 }}><CircularProgress size={25}/></Box>}
    {rates.length > 0 && <><Typography variant="h6" mb={.25}>Available Shipping Services</Typography><Typography variant="body2" color="text.secondary" mb={1}>These services were returned as eligible for the selected account, route and package. Select one to review its price{shipmentId ? ' and apply it to this Shipment.' : '.'}</Typography><Stack spacing={1}>{rates.map((rate: AnyRecord) => <Paper component="label" key={rate.quote_id} variant="outlined" sx={{ p: 1.5, cursor: 'pointer', borderColor: selected === rate.quote_id ? 'primary.main' : undefined, bgcolor: selected === rate.quote_id ? 'action.selected' : undefined }}><Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}><Radio size="small" checked={selected === rate.quote_id} onChange={() => setSelected(rate.quote_id)} slotProps={{ input: { 'aria-label': `Select ${rate.service_name}` } }}/><Box sx={{ flex: 1, minWidth: 0 }}><Typography fontWeight={700}>{rate.service_name}</Typography><Typography variant="body2" color="text.secondary">Australia Post Product ID: {rate.product_id || 'Not returned'}</Typography></Box><Box sx={{ textAlign: 'right', flexShrink: 0 }}><Typography variant="caption" color="text.secondary" display="block">Shipping {money(rate.shipping_cost)}</Typography><Typography variant="caption" color="text.secondary" display="block">Fuel {money(rate.fuel_surcharge)} · GST {money(rate.gst)}</Typography><Typography fontWeight={700}>Total {money(rate.total_cost)}</Typography></Box></Stack></Paper>)}</Stack>
      {shipmentId && <Stack direction="row" sx={{ justifyContent: 'flex-end', mt: 1.5 }}><Button variant="contained" onClick={applyRate} disabled={!selected || saving}>{saving ? 'Applying…' : 'Apply Shipping Fee'}</Button></Stack>}
    </>}
  </Box>;
}
function LocationFields({ title, value, onChange, disabled = false }: { title: string; value: AnyRecord; onChange: (key: string, value: string) => void; disabled?: boolean }) {
  const prefix = title.toLowerCase().replace(/\W+/g, '-');
  const field = (label: string, key: string, inputProps?: Record<string, unknown>) => {
    const id = `${prefix}-${key}`;
    return <Box sx={{ minWidth: 0 }}>
      <Typography component="label" htmlFor={id} variant="caption" color="text.secondary" sx={{ display: 'block', mb: .5, ml: .25, fontWeight: 550 }}>{label}</Typography>
      <TextField id={id} size="small" fullWidth value={value[key]} slotProps={{ htmlInput: inputProps }} onChange={e => onChange(key, e.target.value)} disabled={disabled}/>
    </Box>;
  };
  return <Paper variant="outlined" sx={{ p: 2, minWidth: 0, overflow: 'visible' }}>
    <Typography fontWeight={700} mb={1}>{title}</Typography>
    <Stack spacing={1.25} sx={{ minWidth: 0 }}>
      {field('Suburb', 'suburb')}
      <Box sx={{ display: 'grid', gridTemplateColumns: 'minmax(82px, .8fr) minmax(0, 1.2fr)', gap: 1.25, minWidth: 0 }}>
        {field('State', 'state')}
        {field('Postcode', 'postcode', { maxLength: 4 })}
      </Box>
    </Stack>
  </Paper>;
}

createRoot(document.getElementById('root')!).render(<App/>);
