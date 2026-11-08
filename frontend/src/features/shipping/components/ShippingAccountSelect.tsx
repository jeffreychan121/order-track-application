import {
  Chip, FormControl, FormHelperText, InputLabel, MenuItem, Select, Stack, Typography,
} from '@mui/material';
import type { ShippingAccountProfile } from '../../../shared/types';

interface ShippingAccountSelectProps {
  accounts: ShippingAccountProfile[];
  value: string;
  loading?: boolean;
  disabled?: boolean;
  onChange: (profileId: string) => void;
  missingProfile?: { id: string; label: string; account_number_masked?: string | null } | null;
}

/** 选择可用于报价的账号档案；前端只接收脱敏信息，凭据留在服务端。 */
export function ShippingAccountSelect({
  accounts, value, loading = false, disabled = false, onChange, missingProfile = null,
}: ShippingAccountSelectProps) {
  // 浏览器只拿到脱敏档案；未配置凭据的档案不参与报价选择。
  const selectable = accounts.filter(account => account.enabled && account.pricing_enabled && account.configured);
  const hasSelection = selectable.some(account => account.id === value) || missingProfile?.id === value;

  return <FormControl size="small" fullWidth disabled={loading || disabled || selectable.length === 0}>
    <InputLabel id="shipping-account-profile-label">Pricing Account *</InputLabel>
    <Select
      labelId="shipping-account-profile-label"
      label="Pricing Account *"
      value={hasSelection ? value : ''}
      renderValue={selected => {
        const selectedId = String(selected);
        const account = selectable.find(item => item.id === selectedId);
        if (account) return <Stack direction="row" spacing={1} sx={{ alignItems: 'center', minWidth: 0, overflow: 'hidden' }}>
          <Typography variant="body2" noWrap>{account.label}</Typography>
          <Typography variant="caption" color="text.secondary" noWrap>{account.account_number_masked}</Typography>
          {account.default_for_pricing && <Chip size="small" color="primary" variant="outlined" label="Default"/>}
        </Stack>;
        if (missingProfile?.id === selectedId) return `${missingProfile.label} · ${missingProfile.account_number_masked || 'Unavailable'}`;
        return 'Select pricing account';
      }}
      onChange={event => onChange(String(event.target.value))}
    >
      {!selectable.length && <MenuItem value="" disabled>No configured pricing accounts</MenuItem>}
      {missingProfile && !selectable.some(account => account.id === missingProfile.id) && <MenuItem value={missingProfile.id} disabled>
        {missingProfile.label} · {missingProfile.account_number_masked || 'Account no longer configured'}
      </MenuItem>}
      {selectable.map(account => <MenuItem key={account.id} value={account.id}>
        <Stack direction="row" spacing={2} sx={{ alignItems: 'center', justifyContent: 'space-between', width: '100%', minWidth: 0 }}>
          <Stack spacing={0} sx={{ minWidth: 0 }}>
            <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>{account.label}</Typography>
            <Typography variant="caption" color="text.secondary">{account.account_number_masked} · {account.environment === 'production' ? 'Production' : 'Test'}</Typography>
          </Stack>
          {account.default_for_pricing && <Chip size="small" color="primary" variant="outlined" label="Default"/>}
        </Stack>
      </MenuItem>)}
    </Select>
    <FormHelperText>{loading ? 'Loading account profiles…' : selectable.length ? 'The account controls the eligible rates. Credentials stay on the server.' : 'Configure a pricing account on the server to request rates.'}</FormHelperText>
  </FormControl>;
}
