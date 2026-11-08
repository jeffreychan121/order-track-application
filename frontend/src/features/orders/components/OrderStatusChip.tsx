import { statusLabels } from '../constants';
import { Chip } from '../../../shared/mui';

// 订单和物流状态统一使用语义颜色，避免不同页面各自定义颜色造成含义混乱。
/** 以统一文案和颜色展示订单或物流状态。 */
export function StatusChip({ status }: { status: string }) {
  const color = status === 'completed' ? 'success' : status === 'in_transit' ? 'info' : status === 'confirmed' ? 'primary' : 'default';
  return <Chip size="small" label={statusLabels[status] || status} color={color} variant={status === 'draft' ? 'outlined' : 'filled'}/>;
}
