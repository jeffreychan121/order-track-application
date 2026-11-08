import * as Mui from '@mui/material';
import productPlaceholderImage from '../../../assets/m1.png';
import { money } from '../../../shared/format';

const Box: any = Mui.Box; const Button: any = Mui.Button; const Stack: any = Mui.Stack; const Table: any = Mui.Table;
const TableBody: any = Mui.TableBody; const TableCell: any = Mui.TableCell; const TableContainer: any = Mui.TableContainer;
const TableHead: any = Mui.TableHead; const TableRow: any = Mui.TableRow; const TextField: any = Mui.TextField;
const Typography: any = Mui.Typography;

export interface OrderLineTableRow {
  sku: string;
  quantity: number | string;
  tracking_group: string;
  product_name?: string;
  description?: string;
  rrp: string;
  gst_rate_percent: string;
  gross_total: number;
  unit: number;
  subtotal: number;
  assigned_tracking_number: string;
}

interface OrderLinesTableProps {
  rows: OrderLineTableRow[];
  editing: boolean;
  showAssignedTracking: boolean;
  onChange: (index: number, changes: Partial<Pick<OrderLineTableRow, 'quantity' | 'rrp' | 'gst_rate_percent'>>) => void;
  onRemove: (index: number) => void;
}

// 顺序与下方每一行的单元格保持一致；金额列展示后端确认的整数分计算结果。
const columns = [
  { key: 'product', label: 'Product', align: 'left' as const, width: 15 },
  { key: 'sku', label: 'SKU Code', align: 'left' as const, width: 8 },
  { key: 'description', label: 'Description', align: 'left' as const, width: 15 },
  { key: 'assignedTracking', label: 'Assigned Tracking', align: 'left' as const, width: 10 },
  { key: 'quantity', label: 'Quantity', align: 'center' as const, width: 8 },
  { key: 'rrp', label: 'RRP (GST Included)', align: 'right' as const, width: 9 },
  { key: 'gst', label: 'GST Rate (%)', align: 'right' as const, width: 6 },
  { key: 'unit', label: 'Unit Price (Ex GST)', align: 'right' as const, width: 8 },
  { key: 'subtotal', label: 'Line Subtotal (Ex GST)', align: 'right' as const, width: 9 },
  { key: 'total', label: 'Line Total (GST Included)', align: 'right' as const, width: 8 },
  { key: 'actions', label: '', align: 'center' as const, width: 4 },
];

/** 展示可编辑订单行；窄屏使用卡片布局，追踪号列由用户选择是否显示。 */
export function OrderLinesTable({ rows, editing, showAssignedTracking, onChange, onRemove }: OrderLinesTableProps) {
  const visibleColumns = columns.filter(column => column.key !== 'assignedTracking' || showAssignedTracking);
  const totalWidth = visibleColumns.reduce((total, column) => total + column.width, 0);
  return <>
  <TableContainer className="table-scroll"><Table className={`order-lines-table${showAssignedTracking ? ' is-tracking-visible' : ''}`}>
    <colgroup>{visibleColumns.map(column => <col key={column.key} style={{ width: `${column.width / totalWidth * 100}%` }}/>)}</colgroup>
    <TableHead><TableRow>{visibleColumns.map(column => <TableCell key={column.key} align={column.align}>{column.label}</TableCell>)}</TableRow></TableHead>
    <TableBody>{rows.map((row, index) => <TableRow key={row.sku}>
      <TableCell><Stack direction="row" spacing={1.2} sx={{ alignItems: 'center', minWidth: 0 }}><Box component="img" src={productPlaceholderImage} alt="" sx={{ flex: '0 0 48px', width: 48, height: 48, objectFit: 'cover', borderRadius: 1, bgcolor: '#f0f1f4' }}/><Typography fontWeight={650} sx={{ minWidth: 0, overflowWrap: 'anywhere' }}>{row.product_name || '—'}</Typography></Stack></TableCell>
      <TableCell sx={{ fontWeight: 650, letterSpacing: '.02em', overflowWrap: 'anywhere' }}>{row.sku}</TableCell>
      <TableCell sx={{ overflowWrap: 'anywhere' }}><Typography variant="body2" color="text.secondary" sx={{ display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{row.description || '—'}</Typography></TableCell>
      {showAssignedTracking && <TableCell sx={{ overflowWrap: 'anywhere' }}>{row.assigned_tracking_number || '-'}</TableCell>}
      <TableCell align="center">{editing ? <TextField type="number" size="small" value={row.quantity} slotProps={{ htmlInput: { min: 1, step: 1, 'aria-label': `Quantity for ${row.sku}` } }} onChange={e => onChange(index, { quantity: e.target.value })} sx={{ width: 86 }}/> : row.quantity}</TableCell>
      <TableCell align="right">{editing ? <TextField className="line-rrp-input" type="number" size="small" value={row.rrp} slotProps={{ htmlInput: { min: 0.01, step: 0.01, 'aria-label': `RRP including GST for ${row.sku}` } }} onChange={e => onChange(index, { rrp: e.target.value })} sx={{ width: 112 }}/> : money(row.rrp)}</TableCell>
      <TableCell align="right">{editing ? <TextField type="number" size="small" value={row.gst_rate_percent} slotProps={{ htmlInput: { min: 0, max: 100, step: 0.01, 'aria-label': `GST rate percent for ${row.sku}` } }} onChange={e => onChange(index, { gst_rate_percent: e.target.value })} sx={{ width: 86 }}/> : `${Number(row.gst_rate_percent).toFixed(2)}%`}</TableCell>
      <TableCell align="right">{money(row.unit)}</TableCell>
      <TableCell align="right"><b>{money(row.subtotal)}</b></TableCell>
      <TableCell align="right"><b>{money(row.gross_total)}</b></TableCell>
      <TableCell align="center">{editing && <Button color="error" onClick={() => onRemove(index)} aria-label={`Remove ${row.sku}`}>Remove</Button>}</TableCell>
    </TableRow>)}</TableBody>
  </Table></TableContainer>
  <Box className="mobile-order-lines">{rows.map((row, index) => <Box className="mobile-line" component="article" key={row.sku}>
    <Box className="line-product">
      <Box component="img" className="product-placeholder" src={productPlaceholderImage} alt=""/>
      <Box className="line-product-copy">
        <Typography className="line-product-name" variant="body2">{row.product_name || '—'}</Typography>
        <Typography className="line-product-sku">{row.sku}</Typography>
        {row.description && <Typography className="line-product-description" variant="body2">{row.description}</Typography>}
      </Box>
    </Box>
    <dl className="mobile-line-values">
      <div><dt>Quantity</dt><dd>{editing ? <TextField className="mobile-line-input" type="number" size="small" value={row.quantity} slotProps={{ htmlInput: { min: 1, step: 1, 'aria-label': `Quantity for ${row.sku}` } }} onChange={event => onChange(index, { quantity: event.target.value })}/> : row.quantity}</dd></div>
      <div><dt>RRP (GST Included)</dt><dd>{editing ? <TextField className="mobile-line-input" type="number" size="small" value={row.rrp} slotProps={{ htmlInput: { min: .01, step: .01, 'aria-label': `RRP including GST for ${row.sku}` } }} onChange={event => onChange(index, { rrp: event.target.value })}/> : money(row.rrp)}</dd></div>
      <div><dt>GST Rate (%)</dt><dd>{editing ? <TextField className="mobile-line-input" type="number" size="small" value={row.gst_rate_percent} slotProps={{ htmlInput: { min: 0, max: 100, step: .01, 'aria-label': `GST rate percent for ${row.sku}` } }} onChange={event => onChange(index, { gst_rate_percent: event.target.value })}/> : `${Number(row.gst_rate_percent).toFixed(2)}%`}</dd></div>
      <div><dt>Unit Price (Ex GST)</dt><dd>{money(row.unit)}</dd></div>
      <div className="mobile-subtotal"><dt>Line Subtotal (Ex GST)</dt><dd>{money(row.subtotal)}</dd></div>
      <div className="mobile-subtotal"><dt>Line Total (GST Included)</dt><dd>{money(row.gross_total)}</dd></div>
      {showAssignedTracking && <div><dt>Assigned Tracking</dt><dd>{row.assigned_tracking_number || '—'}</dd></div>}
    </dl>
    {editing && <Button className="mobile-line-remove" color="error" onClick={() => onRemove(index)} aria-label={`Remove ${row.sku}`}>Remove product</Button>}
  </Box>)}</Box>
  </>;
}
