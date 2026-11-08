import type { AnyRecord } from '../../../shared/types';
import { Alert, Box, Button, Paper, Stack, TextField, Typography } from '../../../shared/mui';

/** 显示承运商错误及针对常见报价错误码的排查建议。 */
export function ShippingRateError({ message, code, onViewAccountDetails }: { message: string; code: string; onViewAccountDetails?: () => void }) {
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

/** 复用起运和目的地表单字段；邮编输入限制为澳洲四位数字长度。 */
export function LocationFields({ title, value, onChange, disabled = false }: { title: string; value: AnyRecord; onChange: (key: string, value: string) => void; disabled?: boolean }) {
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
