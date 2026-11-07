import { useCallback, useEffect, useState } from 'react';
import {
  Alert, Box, Button, Chip, CircularProgress, Paper, Stack, Table, TableBody,
  TableCell, TableHead, TableRow, Typography,
} from '@mui/material';
import { api } from '../../shared/api';
import { formatDate } from '../../shared/format';
import { TableState } from '../../shared/components/TableState';
import { ApiTestingPageShell } from './ApiTestingPageShell';
import { ShippingAccountSelect } from '../shipping/components/ShippingAccountSelect';
import { useShippingAccounts } from '../shipping/hooks/useShippingAccounts';

interface AccountLocation {
  type: string | null;
  suburb: string | null;
  state: string | null;
  postcode: string | null;
}

interface AccountProduct {
  type: string | null;
  group: string | null;
  product_id: string | null;
  contract: {
    valid_from: string | null;
    valid_to: string | null;
    expired: boolean | null;
    volumetric_pricing: boolean | null;
    max_item_count: number | null;
    cubing_factor: number | null;
  };
  authority_to_leave: boolean | null;
  signature_on_delivery: boolean | null;
  dangerous_goods_allowed: boolean | null;
  feature_names: string[];
}

interface AccountProductsResponse {
  account: {
    id: string;
    label: string;
    account_number_masked: string;
    environment: string;
    valid_from: string | null;
    valid_to: string | null;
    expired: boolean | null;
    lodgement_postcode: string | null;
    credit_blocked: boolean | null;
    locations: AccountLocation[];
  };
  products: AccountProduct[];
}

function booleanLabel(value: boolean | null, trueLabel = 'Yes', falseLabel = 'No') {
  return value === null ? '—' : value ? trueLabel : falseLabel;
}

function accountStatus(account: AccountProductsResponse['account']) {
  if (account.credit_blocked === true) return { label: 'Credit blocked', color: 'warning' as const };
  if (account.expired === true) return { label: 'Expired', color: 'default' as const };
  if (account.expired === false) return { label: 'Active', color: 'success' as const };
  return { label: 'Status unavailable', color: 'default' as const };
}

export function AccountProductsPage() {
  const { accounts, loading: accountsLoading, error: accountsError, defaultAccountId } = useShippingAccounts();
  const [profileId, setProfileId] = useState('');
  const [data, setData] = useState<AccountProductsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // 账号选择只更新表单状态，查询由用户显式触发，避免切换账号时自动请求。
  const loadAccount = useCallback(async () => {
    if (!profileId) return;
    setLoading(true);
    setError('');
    try {
      setData(await api<AccountProductsResponse>(`/api/shipping/accounts/${encodeURIComponent(profileId)}/products`));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to load account products.');
    } finally {
      setLoading(false);
    }
  }, [profileId]);

  useEffect(() => {
    if (!profileId && defaultAccountId) setProfileId(defaultAccountId);
  }, [defaultAccountId, profileId]);

  const location = data?.account.locations.find(item => item.type === 'MERCHANT_LOCATION') ?? data?.account.locations[0];
  const status = data ? accountStatus(data.account) : null;

  return <ApiTestingPageShell
    title="Account Products"
    description="Inspect contract products and account eligibility returned by Australia Post."
  >
    <Paper className="api-test-query-panel" variant="outlined" sx={{ p: { xs: 1.5, sm: 2 }, mb: 2 }}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ alignItems: 'flex-start', flexWrap: { sm: 'wrap' } }}>
        <Box sx={{ width: { xs: '100%', sm: 520 }, maxWidth: '100%', flexShrink: 1 }}>
          <ShippingAccountSelect accounts={accounts} value={profileId} loading={accountsLoading} disabled={loading} onChange={value => { setData(null); setError(''); setProfileId(value); }}/>
        </Box>
        <Button
          variant="contained"
          size="small"
          disabled={loading || accountsLoading || !profileId}
          onClick={() => void loadAccount()}
          startIcon={loading ? <CircularProgress size={15} color="inherit"/> : undefined}
          sx={{ flexShrink: 0, height: 40, mt: { sm: 1 } }}
        >
          {loading ? 'Querying…' : 'Query Products'}
        </Button>
      </Stack>
    </Paper>

    {accountsError && <Alert severity="error" sx={{ mb: 2 }}>{accountsError}</Alert>}
    {!accountsLoading && !accountsError && !accounts.some(account => account.enabled && account.pricing_enabled && account.configured) && <Alert severity="info" sx={{ mb: 2 }}>No pricing account is configured. Add an account profile and its server-side credentials to enable this page.</Alert>}
    {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

    {data && <Stack spacing={2}>
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between' }}>
          <Box>
            <Typography variant="subtitle2" color="text.secondary">{data.account.label}</Typography>
            <Typography variant="h6" sx={{ mt: 0.25 }}>{data.account.account_number_masked} · {data.account.environment}</Typography>
          </Box>
          {status && <Chip size="small" color={status.color} label={status.label} variant={status.color === 'default' ? 'outlined' : 'filled'}/>}
        </Stack>
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, minmax(0, 1fr))' }, gap: 2, mt: 2 }}>
          <Box><Typography variant="caption" color="text.secondary">Merchant location</Typography><Typography>{location ? `${location.suburb || '—'}, ${location.state || '—'} ${location.postcode || ''}` : 'Not returned'}</Typography></Box>
          <Box><Typography variant="caption" color="text.secondary">Lodgement postcode</Typography><Typography>{data.account.lodgement_postcode || '—'}</Typography></Box>
          <Box><Typography variant="caption" color="text.secondary">Account validity</Typography><Typography>{data.account.valid_from || data.account.valid_to ? `${formatDate(data.account.valid_from)} – ${formatDate(data.account.valid_to)}` : '—'}</Typography></Box>
        </Box>
      </Paper>

      <Box className="list-toolbar">
        <div><h3>Postage Products</h3><span>{data.products.length} products returned by the account</span></div>
      </Box>
      <TableState loading={loading && !data} empty={!data.products.length} emptyText="No postage products were returned for the configured pricing account.">
        <Table sx={{ minWidth: 1040 }}>
          <TableHead><TableRow>
            <TableCell>Product</TableCell><TableCell>Product ID</TableCell><TableCell>Group</TableCell>
            <TableCell>Status</TableCell><TableCell>Contract Validity</TableCell><TableCell>Volumetric Pricing</TableCell>
            <TableCell align="right">Max Items</TableCell><TableCell>Capabilities</TableCell>
          </TableRow></TableHead>
          <TableBody>{data.products.map((product, index) => {
            const expired = product.contract.expired;
            const productStatus = expired === true ? 'Expired' : expired === false ? 'Active' : 'Unknown';
            const productColor = expired === true ? 'default' : expired === false ? 'success' : 'warning';
            const capabilities = [
              product.authority_to_leave === true ? 'Authority to leave' : null,
              product.signature_on_delivery === true ? 'Signature' : null,
              product.dangerous_goods_allowed === true ? 'Dangerous goods' : null,
              ...product.feature_names,
            ].filter((value): value is string => Boolean(value));
            return <TableRow key={`${product.product_id || product.type || 'product'}-${index}`}>
              <TableCell><Typography sx={{ fontWeight: 650 }}>{product.type || 'Postage product'}</Typography></TableCell>
              <TableCell>{product.product_id || '—'}</TableCell>
              <TableCell>{product.group || '—'}</TableCell>
              <TableCell><Chip size="small" label={productStatus} color={productColor} variant={productColor === 'default' ? 'outlined' : 'filled'}/></TableCell>
              <TableCell sx={{ whiteSpace: 'nowrap' }}>{product.contract.valid_from || product.contract.valid_to ? `${formatDate(product.contract.valid_from)} – ${formatDate(product.contract.valid_to)}` : '—'}</TableCell>
              <TableCell>{booleanLabel(product.contract.volumetric_pricing)}</TableCell>
              <TableCell align="right">{product.contract.max_item_count ?? '—'}</TableCell>
              <TableCell>{capabilities.length ? capabilities.join(', ') : '—'}</TableCell>
            </TableRow>;
          })}</TableBody>
        </Table>
      </TableState>
      <Typography variant="caption" color="text.secondary">
        Account products are not guaranteed to price for every route or parcel. Get Rates checks eligibility for the submitted shipment details.
      </Typography>
    </Stack>}
  </ApiTestingPageShell>;
}
