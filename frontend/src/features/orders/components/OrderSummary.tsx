import { Button } from '@mui/material';
import { Calculate } from '@mui/icons-material';
import { money } from '../../../shared/format';
import type { Order } from '../../../shared/types';

interface OrderSummaryProps {
  saved: Order | null;
  editing: boolean;
  subtotal: number;
  gst: number;
  onCalculate: () => void;
  canCalculate: boolean;
}

/** 编辑时展示实时计算金额；只读时显示服务端保存的汇总值。 */
export function OrderSummary({ saved, editing, subtotal, gst, onCalculate, canCalculate }: OrderSummaryProps) {
  const values = !editing && saved ? saved.summary : { subtotal_ex_gst: subtotal, gst_amount: gst, shipment_fee: 0, total: subtotal + gst };
  return <section className="amount-summary"><dl className="summary-lines">
    <div><dt>Subtotal (Ex GST)</dt><dd>{money(values.subtotal_ex_gst)}</dd></div>
    <div><dt>GST</dt><dd>{money(values.gst_amount)}</dd></div>
    <div><dt><span>Shipping Fee</span>{canCalculate && <Button size="small" startIcon={<Calculate/>} onClick={onCalculate}>Calculate</Button>}</dt><dd>{money(values.shipment_fee)}</dd></div>
  </dl><div className="summary-total"><span>Total (AUD)</span><strong>{money(values.total)}</strong></div></section>;
}
