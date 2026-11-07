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
  onChange: (index: number, changes: Partial<Pick<OrderLineTableRow, 'quantity' | 'rrp' | 'gst_rate_percent'>>) => void;
  onRemove: (index: number) => void;
}

// 顺序与下方每一行的单元格保持一致；金额列展示后端确认的整数分计算结果。
const columns = [
  { label: 'Product', align: 'left' as const, width: '22%' },
  { label: 'Assigned Tracking', align: 'left' as const, width: '12%' },
  { label: 'Quantity', align: 'center' as const, width: '7%' },
  { label: 'RRP (GST Included)', align: 'right' as const, width: '11%' },
  { label: 'GST Rate (%)', align: 'right' as const, width: '8%' },
  { label: 'Unit Price (Ex GST)', align: 'right' as const, width: '11%' },
  { label: 'Line Subtotal (Ex GST)', align: 'right' as const, width: '13%' },
  { label: 'Line Total (GST Included)', align: 'right' as const, width: '10%' },
  { label: '', align: 'center' as const, width: '6%' },
];

export function OrderLinesTable({ rows, editing, onChange, onRemove }: OrderLinesTableProps) {
  return <TableContainer className="table-scroll"><Table className="order-lines-table" sx={{ minWidth: 1280 }}>
    <colgroup>{columns.map(column => <col key={column.label || 'actions'} style={{ width: column.width }}/>)}</colgroup>
    <TableHead><TableRow>{columns.map(column => <TableCell key={column.label || 'actions'} align={column.align}>{column.label}</TableCell>)}</TableRow></TableHead>
    <TableBody>{rows.map((row, index) => <TableRow key={row.sku}>
      <TableCell><Stack direction="row" spacing={1.2} sx={{ alignItems: 'center' }}><Box component="img" src={productPlaceholderImage} alt="" sx={{ width: 48, height: 48, objectFit: 'cover', borderRadius: 1, bgcolor: '#f0f1f4' }}/><Box sx={{ minWidth: 0 }}><Typography fontWeight={650}>{row.product_name || row.sku}</Typography><Typography variant="body2" color="text.secondary">{row.sku}</Typography><Typography variant="caption" color="text.secondary" sx={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', maxWidth: 400 }}>{row.description}</Typography></Box></Stack></TableCell>
      <TableCell sx={{ overflowWrap: 'anywhere' }}>{row.assigned_tracking_number || '-'}</TableCell>
      <TableCell align="center">{editing ? <TextField type="number" size="small" value={row.quantity} slotProps={{ htmlInput: { min: 1, step: 1, 'aria-label': `Quantity for ${row.sku}` } }} onChange={e => onChange(index, { quantity: e.target.value })} sx={{ width: 86 }}/> : row.quantity}</TableCell>
      <TableCell align="right">{editing ? <TextField className="line-rrp-input" type="number" size="small" value={row.rrp} slotProps={{ htmlInput: { min: 0.01, step: 0.01, 'aria-label': `RRP including GST for ${row.sku}` } }} onChange={e => onChange(index, { rrp: e.target.value })} sx={{ width: 112 }}/> : money(row.rrp)}</TableCell>
      <TableCell align="right">{editing ? <TextField type="number" size="small" value={row.gst_rate_percent} slotProps={{ htmlInput: { min: 0, max: 100, step: 0.01, 'aria-label': `GST rate percent for ${row.sku}` } }} onChange={e => onChange(index, { gst_rate_percent: e.target.value })} sx={{ width: 86 }}/> : `${Number(row.gst_rate_percent).toFixed(2)}%`}</TableCell>
      <TableCell align="right">{money(row.unit)}</TableCell>
      <TableCell align="right"><b>{money(row.subtotal)}</b></TableCell>
      <TableCell align="right"><b>{money(row.gross_total)}</b></TableCell>
      <TableCell align="center">{editing && <Button color="error" onClick={() => onRemove(index)} aria-label={`Remove ${row.sku}`}>Remove</Button>}</TableCell>
    </TableRow>)}</TableBody>
  </Table></TableContainer>;
}
