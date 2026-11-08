import { useEffect, useRef, useState } from 'react';
import {
  Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent,
  DialogTitle, IconButton, Paper, Stack, Table, TableBody, TableCell, TableHead,
  TableRow, Tooltip, Typography,
} from '@mui/material';
import { Close, Inventory2Outlined, Refresh } from '@mui/icons-material';
import { api } from '../../../shared/api';

export interface AccountMerchantLocation {
  type: string | null;
  suburb: string | null;
  state: string | null;
  postcode: string | null;
}

interface AccountPostageProduct {
  type: string | null;
  group: string | null;
  product_id: string | null;
  contract: { expired: boolean | null; valid_to: string | null };
}

interface AccountProductsResponse {
  account: {
    id: string;
    label: string;
    account_number_masked: string;
    environment: string;
    lodgement_postcode: string | null;
    credit_blocked: boolean | null;
    locations: AccountMerchantLocation[];
  };
  products: AccountPostageProduct[];
}

interface AccountPostageProductsProps {
  profileId: string;
  onUseMerchantLocation?: (location: AccountMerchantLocation) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** 按需加载合同产品和揽收地点，避免目录内容撑长 Shipping Planner 表单。 */
export function AccountPostageProducts({ profileId, onUseMerchantLocation, open, onOpenChange }: AccountPostageProductsProps) {
  const [data, setData] = useState<AccountProductsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const loadedRequest = useRef('');

  useEffect(() => {
    if (!open || !profileId) return;
    const requestKey = `${profileId}:${refreshKey}`;
    // 弹窗重复打开时复用已取数据；切换账号或点刷新才重新请求。
    if (loadedRequest.current === requestKey) return;

    // 清理函数使账号快速切换后的旧响应不覆盖当前账号信息。
    let active = true;
    setLoading(true);
    setError('');
    setData(null);
    api<AccountProductsResponse>(`/api/shipping/accounts/${encodeURIComponent(profileId)}/products${refreshKey ? '?refresh=true' : ''}`)
      .then(result => {
        if (!active) return;
        loadedRequest.current = requestKey;
        setData(result);
      })
      .catch(reason => {
        if (active) setError(reason instanceof Error ? reason.message : 'Unable to load account postage products.');
      })
      .finally(() => { if (active) setLoading(false); });

    return () => { active = false; };
  }, [open, profileId, refreshKey]);

  const merchantLocation = data?.account.locations.find(location => location.type === 'MERCHANT_LOCATION')
    ?? data?.account.locations[0]
    ?? null;

  return <>
    <Button
      className="account-postage-products-trigger"
      variant="outlined"
      size="small"
      startIcon={<Inventory2Outlined/>}
      onClick={() => onOpenChange(true)}
      disabled={!profileId}
      sx={{ height: 40, whiteSpace: 'nowrap' }}
    >
      View contract products
      {data && <Chip className="account-postage-products-count" size="small" variant="outlined" label={data.products.length}/>}
    </Button>

    <Dialog open={open} onClose={() => onOpenChange(false)} fullWidth maxWidth="md" aria-labelledby="account-products-dialog-title">
      <DialogTitle id="account-products-dialog-title" sx={{ pr: 7 }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
          <Box>
            <Typography variant="h6">Account contract products</Typography>
            <Typography variant="body2" color="text.secondary">Products available to the selected pricing account</Typography>
          </Box>
          <Tooltip title="Close">
            <IconButton aria-label="Close account products" onClick={() => onOpenChange(false)}><Close/></IconButton>
          </Tooltip>
        </Stack>
      </DialogTitle>
      <DialogContent dividers sx={{ minHeight: 220, maxHeight: '65vh' }}>
        {loading && <Stack direction="row" spacing={1} sx={{ alignItems: 'center', py: 2 }}><CircularProgress size={20}/><Typography variant="body2">Loading account products…</Typography></Stack>}
        {error && <Alert severity="warning" sx={{ mb: 1.5 }} action={<Button size="small" color="inherit" onClick={() => setRefreshKey(value => value + 1)}>Retry</Button>}>{error}</Alert>}
        {data && <>
          <Paper variant="outlined" sx={{ p: 1.5, mb: 1.5 }}>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between' }}>
              <Box>
                <Typography variant="subtitle2">{data.account.label} · {data.account.environment}</Typography>
                <Typography variant="body2" color="text.secondary">Account {data.account.account_number_masked}</Typography>
              </Box>
              {merchantLocation && onUseMerchantLocation && <Button size="small" variant="outlined" onClick={() => { onUseMerchantLocation(merchantLocation); onOpenChange(false); }}>Use account location</Button>}
            </Stack>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
              Merchant location {merchantLocation ? `${merchantLocation.suburb || '—'}, ${merchantLocation.state || '—'} ${merchantLocation.postcode || ''}` : 'not returned'}
              {' · '}Lodgement postcode {data.account.lodgement_postcode || 'not returned'}
            </Typography>
          </Paper>
          {data.account.credit_blocked && <Alert severity="warning" sx={{ mb: 1.5 }}>Australia Post reports that this account is credit blocked.</Alert>}
          <Table size="small" sx={{ minWidth: 560 }}>
            <TableHead><TableRow><TableCell>Product</TableCell><TableCell>Product ID</TableCell><TableCell>Group</TableCell><TableCell>Contract</TableCell></TableRow></TableHead>
            <TableBody>{data.products.map((product, index) => {
              const expired = product.contract.expired;
              const label = expired === true ? 'Expired' : expired === false ? 'Active' : 'Unknown';
              const color = expired === true ? 'default' : expired === false ? 'success' : 'warning';
              return <TableRow key={`${product.product_id || product.type || 'postage-product'}-${index}`}>
                <TableCell><Typography variant="body2" sx={{ fontWeight: 650 }}>{product.type || 'Postage product'}</Typography></TableCell>
                <TableCell>{product.product_id || '—'}</TableCell>
                <TableCell>{product.group || '—'}</TableCell>
                <TableCell><Chip size="small" color={color} variant={color === 'default' ? 'outlined' : 'filled'} label={label}/></TableCell>
              </TableRow>;
            })}</TableBody>
          </Table>
          {!data.products.length && <Alert severity="info">No postage products were returned for this account.</Alert>}
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5 }}>
            Contract products do not guarantee a rate for every route or parcel. Get Rates checks eligibility using the current shipment details.
          </Typography>
        </>}
        {!loading && !error && !data && <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>Select a configured pricing account to view its products.</Typography>}
      </DialogContent>
      <DialogActions>
        <Button startIcon={loading ? <CircularProgress size={14}/> : <Refresh/>} disabled={loading || !profileId} onClick={() => setRefreshKey(value => value + 1)}>Refresh</Button>
        <Button onClick={() => onOpenChange(false)}>Close</Button>
      </DialogActions>
    </Dialog>
  </>;
}
