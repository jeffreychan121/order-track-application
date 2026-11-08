import type { OrderStatus } from '../../../shared/types';

const STATUS_LABELS: Record<OrderStatus, string> = {
  draft: 'Draft', confirmed: 'Confirmed', in_transit: 'In Transit', completed: 'Completed',
};
const STATUS_SEQUENCE: OrderStatus[] = ['draft', 'confirmed', 'in_transit', 'completed'];

interface OrderStatusBarProps {
  status: OrderStatus;
}

/** 按订单状态顺序标记已完成、当前和未到达的流程节点。 */
export function OrderStatusBar({ status }: OrderStatusBarProps) {
  const current = STATUS_SEQUENCE.indexOf(status);
  return <div className="statusbar-wrap" aria-label={`Order status: ${STATUS_LABELS[status]}`}>
    <ol className="statusbar">{STATUS_SEQUENCE.map((value, index) => {
      const state = index < current ? 'complete' : index === current ? 'current' : 'upcoming';
      return <li className={`status-step is-${state}`} key={value}>
        <span className="status-step-marker" aria-hidden="true">{state === 'complete' ? '✓' : index + 1}</span>
        <span className="status-step-label">{STATUS_LABELS[value]}</span>
      </li>;
    })}</ol>
  </div>;
}
