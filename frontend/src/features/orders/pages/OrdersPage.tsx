import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Add, OpenInNew } from '@mui/icons-material';
import { api } from '../../../shared/api';
import { formatDate, money } from '../../../shared/format';
import type { Order } from '../../../shared/types';
import { PageHeading } from '../../../shared/components/PageHeading';
import { TableState } from '../../../shared/components/TableState';
import { StatusChip } from '../components/OrderStatusChip';
import { statusLabels, statusSequence } from '../constants';
import { Alert, Box, Button, FormControl, IconButton, InputLabel, MenuItem, Paper, Select, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography } from '../../../shared/mui';

/** 订单列表页：提供搜索、状态筛选和排序，点击记录进入独立详情页。 */
export function OrdersPage() {
  const [orders, setOrders] = useState<Order[]>([]); const [busy, setBusy] = useState(true); const [error, setError] = useState('');
  const [query, setQuery] = useState(''); const [status, setStatus] = useState('all'); const [sortBy, setSortBy] = useState('date'); const navigate = useNavigate();
  // 页面卸载后不再写回 state，避免快速切换路由时产生无效更新。
  useEffect(() => { let alive = true; setBusy(true); api<Order[]>('/api/orders').then(value => { if (alive) setOrders(value); }).catch(err => { if (alive) setError(err.message); }).finally(() => { if (alive) setBusy(false); }); return () => { alive = false; }; }, []);
  // 搜索、状态筛选和排序只作用于列表视图，不会修改服务器数据。
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
