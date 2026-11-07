import { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Alert, AppBar, Box, Button, CircularProgress, CssBaseline, Dialog, DialogActions,
  DialogContent, DialogTitle, FormControl, InputLabel, MenuItem, Paper, Radio,
  Select, Stack, Tab, Tabs, TextField,
  ThemeProvider, Tooltip, Typography, createTheme,
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import productPlaceholderImage from './assets/m1.png';
import './style.css';

const theme = createTheme({
  palette: {
    mode: 'light',
    primary: { main: '#65527f', dark: '#514064' },
    secondary: { main: '#648a80' },
    background: { default: '#f3f2f5', paper: '#ffffff' },
    success: { main: '#648a80' },
  },
  shape: { borderRadius: 6 },
  typography: {
    fontFamily: 'Inter, "Segoe UI", Arial, sans-serif',
    fontSize: 14,
    body1: { fontSize: 14, lineHeight: 1.5 },
    body2: { fontSize: 13, lineHeight: 1.5 },
    h1: { fontSize: 24, fontWeight: 700, lineHeight: 1.3 },
    h2: { fontSize: 22, fontWeight: 700, lineHeight: 1.35 },
    h3: { fontSize: 18, fontWeight: 650, lineHeight: 1.4 },
    button: { fontSize: 14, fontWeight: 600, textTransform: 'none', lineHeight: 1.4 },
  },
  components: {
    MuiButton: { styleOverrides: { root: { minHeight: 36, padding: '6px 12px', borderRadius: 6, boxShadow: 'none' }, startIcon: { marginRight: 5 } } },
    MuiInputBase: { styleOverrides: { root: { fontFamily: 'inherit', fontSize: 14, lineHeight: 1.4 } } },
    MuiOutlinedInput: { styleOverrides: { root: { minHeight: 38, borderRadius: 6 }, input: { padding: '8px 11px', font: 'inherit' } } },
    MuiInputLabel: { styleOverrides: { root: { fontFamily: 'inherit', fontSize: 13, transform: 'translate(12px, 10px) scale(1)' }, shrink: { transform: 'translate(12px, -7px) scale(.9)' } } },
    MuiFormHelperText: { styleOverrides: { root: { margin: '3px 0 0', fontSize: 12, lineHeight: 1.3 } } },
    MuiSelect: { styleOverrides: { select: { fontFamily: 'inherit', fontSize: 14, paddingTop: 8, paddingBottom: 8 } } },
    MuiTab: { styleOverrides: { root: { minHeight: 46, padding: '9px 16px', fontSize: 14, fontWeight: 600 } } },
    MuiPaper: { styleOverrides: { outlined: { borderColor: '#dedce3' } } },
  },
});

const NOTEBOOK_TABS = [
  { id: 'lines', label: 'Order Lines' },
  { id: 'shipments', label: 'Shipments' },
];

function formatDate(isoDate) {
  if (!isoDate) return '—';
  const [year, month, day] = isoDate.split('-');
  return `${day}/${month}/${year}`;
}

function formatDateTime(value) {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat('en-AU', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Australia/Melbourne',
  }).format(parsed);
}

function money(amount) {
  return amount == null || !Number.isFinite(Number(amount)) ? '—' : `A$${Number(amount).toFixed(2)}`;
}

function CustomerFields({ order }) {
  return (
    <section className="field-group" aria-labelledby="customer-fields-heading">
      <h3 id="customer-fields-heading">Customer Information</h3>
      <dl className="field-list">
        <div className="field-item">
          <dt>Customer</dt>
          <dd>{order.customer.name}</dd>
        </div>
        <div className="field-item">
          <dt>Company</dt>
          <dd>{order.company_name}</dd>
        </div>
        <div className="field-item">
          <dt>Email</dt>
          <dd><a href={`mailto:${order.customer.email}`}>{order.customer.email}</a></dd>
        </div>
        <div className="field-item">
          <dt>Phone</dt>
          <dd>{order.customer.phone}</dd>
        </div>
      </dl>
    </section>
  );
}

function OrderFields({ order }) {
  const address = order.shipping_address;
  const summary = order.summary;
  return (
    <section className="field-group" aria-labelledby="order-fields-heading">
      <h3 id="order-fields-heading">Shipping / Order Information</h3>
      <dl className="field-list">
        <div className="field-item">
          <dt>Order Date</dt>
          <dd>{formatDate(order.order_date)}</dd>
        </div>
        <div className="field-item field-item-address">
          <dt>Delivery Address</dt>
          <dd>
            {address.street}, {address.suburb} {address.state} {address.postcode}, {address.country}
          </dd>
        </div>
        <div className="field-item">
          <dt>Currency</dt>
          <dd>{summary.currency}</dd>
        </div>
      </dl>
    </section>
  );
}

function StatusBar({ status }) {
  let stages;
  let activeIndex;

  if (status === 'In Transit') {
    stages = ['Confirmed', 'In Transit', 'Delivered'];
    activeIndex = 1;
  } else if (status === 'Completed') {
    stages = ['Confirmed', 'In Transit', 'Completed'];
    activeIndex = 2;
  } else {
    // Keep unknown statuses visible without inferring intermediate milestones.
    stages = [status || 'Unknown'];
    activeIndex = 0;
  }

  return (
    <div className="statusbar-wrap" aria-label={`Order status: ${status}`}>
      <ol className="statusbar">
        {stages.map((stage, index) => {
          const stageState = stages.length === 1
            ? 'current'
            : index < activeIndex ? 'complete' : index === activeIndex ? 'current' : 'upcoming';
          return (
            <li className={`status-step is-${stageState}`} key={`${stage}-${index}`}>
              <span className="status-step-marker" aria-hidden="true">
                {stageState === 'complete' ? '✓' : index + 1}
              </span>
              <span className="status-step-label">{stage}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function ProductPlaceholder({ sku }) {
  return (
    <img className="product-placeholder" src={productPlaceholderImage} alt={`${sku} product image`} />
  );
}

function OrderLineDescription({ item }) {
  return (
    <div className="line-product">
      <ProductPlaceholder sku={item.sku} />
      <div className="line-product-copy">
        <strong className="line-product-name" title={item.product_name}>{item.product_name}</strong>
        <span className="line-product-sku">{item.sku}</span>
        {item.description && item.description !== '.' && (
          <Tooltip title={item.description} placement="top-start">
            <span className="line-product-description">{item.description}</span>
          </Tooltip>
        )}
      </div>
    </div>
  );
}

function OrderLines({ items, onUpdate }) {
  const update = (index, field, rawValue) => onUpdate(index, field, rawValue === '' ? '' : Number(rawValue));
  const quantityField = (item, index) => (
    <TextField type="number" size="small" value={item.quantity} onChange={(event) => update(index, 'quantity', event.target.value)} inputProps={{ min: 1, step: 1, 'aria-label': `Quantity for ${item.sku}` }} error={!Number.isInteger(Number(item.quantity)) || Number(item.quantity) < 1} helperText={Number(item.quantity) < 1 || !Number.isInteger(Number(item.quantity)) ? 'Enter a positive whole number' : ''} sx={{ width: 116 }} />
  );
  const rrpField = (item, index) => (
    <TextField type="number" size="small" value={item.rrp_incl_gst} onChange={(event) => update(index, 'rrp_incl_gst', event.target.value)} inputProps={{ min: 0.01, step: 0.01, 'aria-label': `RRP including GST for ${item.sku}` }} error={!Number.isFinite(Number(item.rrp_incl_gst)) || Number(item.rrp_incl_gst) <= 0} helperText={Number(item.rrp_incl_gst) <= 0 ? 'Enter an amount above zero' : ''} sx={{ width: 132 }} />
  );
  return (
    <div className="tab-panel" role="tabpanel" id="panel-lines" aria-labelledby="tab-lines">
      <div className="table-scroll">
        <table className="order-lines-table">
          <thead>
            <tr>
              <th scope="col" className="product-column">Product</th>
              <th scope="col" className="number-column">Quantity</th>
              <th scope="col" className="number-column">RRP <span>(GST Included)</span></th>
              <th scope="col" className="number-column">Unit Price <span>(Ex GST)</span></th>
              <th scope="col" className="number-column">Line Subtotal <span>(Ex GST)</span></th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, index) => (
              <tr key={`${item.sku}-${item.tracking_group}-${index}`}>
                <td className="product-column"><OrderLineDescription item={item} /></td>
                <td className="number-column">{quantityField(item, index)}</td>
                <td className="number-column">{rrpField(item, index)}</td>
                <td className="number-column">{money(item.ex_gst_unit_price)}</td>
                <td className="number-column subtotal-cell">{money(item.line_subtotal_ex_gst)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mobile-order-lines">
        {items.map((item, index) => (
          <article className="mobile-line" key={`${item.sku}-${item.tracking_group}-${index}`}>
            <OrderLineDescription item={item} />
            <dl className="mobile-line-values">
              <div><dt>Quantity</dt><dd>{quantityField(item, index)}</dd></div>
              <div><dt>RRP incl. GST</dt><dd>{rrpField(item, index)}</dd></div>
              <div><dt>Unit Price ex GST</dt><dd>{money(item.ex_gst_unit_price)}</dd></div>
              <div className="mobile-subtotal"><dt>Line Subtotal ex GST</dt><dd>{money(item.line_subtotal_ex_gst)}</dd></div>
            </dl>
          </article>
        ))}
      </div>
    </div>
  );
}

function trackingStatusLabel(status) {
  const labels = {
    delivered: 'Delivered',
    partially_delivered: 'Partially Delivered',
    in_transit: 'In Transit',
    pending: 'Pending',
    unknown: 'Unknown',
    querying: 'Querying',
    not_queried: 'Not queried',
    not_implemented: 'Not implemented',
    unavailable: 'API unavailable',
  };
  return labels[status] ?? status ?? 'Not provided';
}

function TrackingTimeline({ title, events }) {
  return (
    <section className="tracking-timeline" aria-label={title}>
      <h5>{title}</h5>
      {events.length ? (
        <ol>
          {events.map((event, index) => (
            <li className={index === 0 ? 'is-latest' : ''} key={`${event.date}-${event.description}-${event.location ?? ''}`}>
              <span className="timeline-marker" aria-hidden="true" />
              <time dateTime={event.date}>{formatDateTime(event.date)}</time>
              <strong>{event.description || 'Event details not provided by carrier'}</strong>
              {event.location && <span className="timeline-location">{event.location}</span>}
            </li>
          ))}
        </ol>
      ) : <p className="timeline-empty">No event details were provided by the carrier.</p>}
    </section>
  );
}

function ShipmentList({ order, trackingRecords, trackingLoading, trackingError, onRefresh, trackingNumbers, onTrackingNumberChange, onQueryTracking, queryingShipment }) {
  const shipments = order.shipments ?? [];
  const recordsByShipment = new Map(
    (trackingRecords ?? []).map((record) => [
      `${record.tracking_group}-${record.tracking_number}`,
      record,
    ]),
  );

  if (shipments.length === 0) {
    return <div className="empty-state">No shipment records are available for this order.</div>;
  }

  return (
    <div className="tab-panel shipments-panel" role="tabpanel" id="panel-shipments" aria-labelledby="tab-shipments">
      <div className="list-toolbar">
        <div>
          <h3>Shipments</h3>
          <span>{shipments.length} shipment records</span>
        </div>
        <Button variant="outlined" startIcon={<RefreshIcon />} onClick={onRefresh} disabled={trackingLoading}>
          {trackingLoading ? 'Querying…' : 'Refresh all tracking'}
        </Button>
      </div>
      <div className="shipment-table-wrap">
        {shipments.map((shipment) => {
          const currentTrackingNumber = trackingNumbers?.[shipment.tracking_group] ?? shipment.tracking_number;
          const result = recordsByShipment.get(`${shipment.tracking_group}-${currentTrackingNumber}`);
          const isAustraliaPost = /australia post|startrack/i.test(shipment.carrier);
          const status = result?.overall_status
            ?? (trackingError && isAustraliaPost ? 'unavailable'
              : trackingLoading && isAustraliaPost ? 'querying'
                : isAustraliaPost ? 'not_queried' : 'not_implemented');
          const statusLabel = result?.overall_status_raw || trackingStatusLabel(status);
          const updatedAt = result?.last_updated;
          const resultError = result?.tracking_error ?? (status === 'unavailable' ? trackingError : null);

          return (
            <Paper component="article" variant="outlined" elevation={0} className="shipment-record" key={`${shipment.tracking_group}-${shipment.tracking_number}`}>
              <div className="shipment-record-heading">
                <div>
                  <h4>{shipment.carrier}</h4>
                </div>
                {Number(shipment.shipping_fee) > 0 && <Typography className="shipment-shipping-fee" variant="body2">Shipping fee: {money(shipment.shipping_fee)}</Typography>}
              </div>
              <Stack className="shipment-fields" direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ sm: 'flex-start' }}>
                <TextField label="Tracking Number" size="small" value={currentTrackingNumber} onChange={(event) => onTrackingNumberChange(shipment.tracking_group, event.target.value)} fullWidth inputProps={{ 'aria-label': `Tracking Number for ${shipment.tracking_group}` }} />
                <Button variant="contained" onClick={() => onQueryTracking(shipment, currentTrackingNumber)} disabled={!String(currentTrackingNumber).trim() || queryingShipment === shipment.tracking_group} sx={{ flexShrink: 0, minWidth: 120 }}>
                  {queryingShipment === shipment.tracking_group ? <CircularProgress size={18} color="inherit" /> : 'Track number'}
                </Button>
              </Stack>
              {(status === 'not_queried' || status === 'querying' || status === 'not_implemented' || status === 'unavailable') && (
                <p className="shipment-note">
                  {status === 'unavailable'
                    ? `${result?.tracking_error_code ? `[${result.tracking_error_code}] ` : ''}${resultError || 'The tracking service is unavailable.'} No live status is being shown.`
                    : status === 'not_implemented'
                      ? (resultError || 'Tracking is not implemented for this carrier. No live status is being shown.')
                      : status === 'querying'
                        ? 'Querying the carrier API. No live status is shown until a response arrives.'
                        : 'Tracking has not been queried yet. No live status is being shown.'}
                </p>
              )}
              {result && status !== 'unavailable' && status !== 'not_implemented' && (
                <div className="shipment-details">
                  <div className="tracking-summary">
                    <div><span>Overall Status</span><strong>{statusLabel}</strong></div>
                    <div><span>Total Articles</span><strong>{result.total_articles ?? 'Not provided'}</strong></div>
                    <div><span>Delivered Articles</span><strong>{result.delivered_articles ?? 'Not provided'}</strong></div>
                    <div><span>Last Updated</span><strong>{updatedAt ? formatDateTime(updatedAt) : 'Not provided'}</strong></div>
                  </div>
                  {result.test_data_time_mismatch && (
                    <p className="tracking-test-warning">
                      Carrier event dates predate this order. This is historical test data and does not confirm fulfillment of this order.
                    </p>
                  )}
                  <TrackingTimeline title="Consignment Events" events={result.consignment_events ?? []} />
                  {(result.articles ?? []).map((article, index) => (
                    <section className="article-tracking" key={`${article.article_id ?? 'article'}-${index}`}>
                      <header>
                        <div>
                          <h5>Article {article.article_id || `#${index + 1}`}</h5>
                          {article.product_type && <span>{article.product_type}</span>}
                        </div>
                        <span className="tracking-state">{article.raw_status || trackingStatusLabel(article.status)}</span>
                      </header>
                      <TrackingTimeline title="Article Events" events={article.events ?? []} />
                    </section>
                  ))}
                  {result.articles?.length === 0 && (
                    <p className="shipment-note">The carrier response did not include any Article records.</p>
                  )}
                </div>
              )}
            </Paper>
          );
        })}
      </div>
    </div>
  );
}

function OrderNotebook({
  order,
  items,
  summary,
  activeTab,
  onTabChange,
  trackingRecords,
  trackingLoading,
  trackingError,
  onRefreshTracking,
  onLineUpdate,
  trackingNumbers,
  onTrackingNumberChange,
  onQueryTracking,
  queryingShipment,
  onCalculateShipping,
}) {
  return (
    <section className="notebook" aria-label="Order information tabs">
      <div className="notebook-tabs">
        <Tabs value={activeTab} onChange={(_, value) => onTabChange(value)} aria-label="Order sections">
          {NOTEBOOK_TABS.map((tab) => <Tab key={tab.id} id={`tab-${tab.id}`} value={tab.id} label={tab.label} aria-controls={`panel-${tab.id}`} />)}
        </Tabs>
      </div>
      {activeTab === 'lines' && <OrderLines items={items} onUpdate={onLineUpdate} />}
      {activeTab === 'shipments' && (
        <ShipmentList
          order={order}
          trackingRecords={trackingRecords}
          trackingLoading={trackingLoading}
          trackingError={trackingError}
          onRefresh={onRefreshTracking}
          trackingNumbers={trackingNumbers}
          onTrackingNumberChange={onTrackingNumberChange}
          onQueryTracking={onQueryTracking}
          queryingShipment={queryingShipment}
        />
      )}
      {activeTab === 'lines' && <OrderSummary summary={summary} onCalculateShipping={onCalculateShipping} />}
    </section>
  );
}

function OrderSummary({ summary, onCalculateShipping }) {
  return (
    <section className="amount-summary" aria-label="Order totals">
      <dl className="summary-lines">
        <div><dt>Subtotal (Ex GST)</dt><dd>{money(summary.subtotal_ex_gst)}</dd></div>
        <div><dt>GST (10%)</dt><dd>{money(summary.gst_amount)}</dd></div>
        <div><dt>Shipping Fee <Button size="small" variant="outlined" onClick={onCalculateShipping}>{Number(summary.shipment_fee) > 0 ? 'Recalculate' : 'Calculate'}</Button></dt><dd>{money(summary.shipment_fee)}</dd></div>
      </dl>
      <div className="summary-total"><span>Total (AUD)</span><strong>{money(summary.total)}</strong></div>
    </section>
  );
}

function LoadingState() {
  return <Box className="state-panel" role="status"><CircularProgress size={22} sx={{ mr: 1, verticalAlign: 'middle' }} />Loading orders…</Box>;
}

function ShippingQuoteDialog({ open, onClose, order, onApplied }) {
  const [group, setGroup] = useState('');
  const [weight, setWeight] = useState('');
  const [length, setLength] = useState('');
  const [width, setWidth] = useState('');
  const [height, setHeight] = useState('');
  const [rates, setRates] = useState([]);
  const [selectedRate, setSelectedRate] = useState('');
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState('');
  const [origin, setOrigin] = useState(null);
  const [originError, setOriginError] = useState('');
  const [originLoading, setOriginLoading] = useState(false);
  const quoteRequestVersion = useRef(0);
  const quoteInvalidation = useRef(Promise.resolve());
  const shipment = order?.shipments?.find((item) => item.tracking_group === group);
  const supportsAustraliaPostQuote = shipment && /australia\s*post|startrack/i.test(shipment.carrier);
  const groupedLines = order?.line_items?.filter((item) => item.tracking_group === group) ?? [];
  const productWeight = groupedLines.reduce((sum, item) => sum + Number(item.weight_grams ?? 0) * Number(item.quantity), 0) / 1000;
  const address = order?.shipping_address;

  useEffect(() => {
    if (!open || !order) return;
    const initialGroup = order.shipments?.[0]?.tracking_group ?? '';
    quoteRequestVersion.current += 1;
    setGroup(initialGroup);
    const lines = order.line_items?.filter((item) => item.tracking_group === initialGroup) ?? [];
    const grams = lines.reduce((sum, item) => sum + Number(item.weight_grams ?? 0) * Number(item.quantity), 0);
    setWeight(grams ? (grams / 1000).toFixed(3) : '');
    setLength(''); setWidth(''); setHeight(''); setRates([]); setSelectedRate(''); setError('');
    setLoading(false);
    setOrigin(null); setOriginError(''); setOriginLoading(true);
    fetch('/api/shipping/account-origin')
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.detail?.message || data.detail || `Unable to load the account lodgement address (HTTP ${response.status})`);
        setOrigin(data);
      })
      .catch((requestError) => setOriginError(requestError instanceof Error ? requestError.message : 'Unable to load the account lodgement address.'))
      .finally(() => setOriginLoading(false));
  }, [open, order?.order_id]);

  const invalidateServerQuotes = (trackingGroup) => {
    if (!order?.order_id || !trackingGroup) return;
    return fetch(`/api/orders/${encodeURIComponent(order.order_id)}/shipments/${encodeURIComponent(trackingGroup)}/shipping-rates`, { method: 'DELETE' }).catch(() => {});
  };

  const handleClose = () => {
    quoteRequestVersion.current += 1;
    setLoading(false);
    if (group) quoteInvalidation.current = quoteInvalidation.current.catch(() => {}).then(() => invalidateServerQuotes(group));
    onClose();
  };

  const changeGroup = (value) => {
    quoteRequestVersion.current += 1;
    quoteInvalidation.current = quoteInvalidation.current.catch(() => {}).then(() => Promise.all([group, value].filter(Boolean).map(invalidateServerQuotes)));
    setGroup(value);
    const lines = order?.line_items?.filter((item) => item.tracking_group === value) ?? [];
    const grams = lines.reduce((sum, item) => sum + Number(item.weight_grams ?? 0) * Number(item.quantity), 0);
    setWeight(grams ? (grams / 1000).toFixed(3) : '');
    setLength(''); setWidth(''); setHeight('');
    setRates([]); setSelectedRate(''); setError('');
  };
  const invalidate = (setter) => (event) => {
    quoteRequestVersion.current += 1;
    quoteInvalidation.current = quoteInvalidation.current.catch(() => {}).then(() => invalidateServerQuotes(group));
    setter(event.target.value); setRates([]); setSelectedRate(''); setError(''); setLoading(false);
  };
  const validPackage = [weight, length, width, height].every((value) => value !== '' && Number.isFinite(Number(value)) && Number(value) > 0);
  const getRates = async () => {
    const requestVersion = ++quoteRequestVersion.current;
    setLoading(true); setError(''); setRates([]); setSelectedRate('');
    try {
      await quoteInvalidation.current.catch(() => {});
      if (requestVersion !== quoteRequestVersion.current) return;
      const response = await fetch(`/api/orders/${encodeURIComponent(order.order_id)}/shipments/${encodeURIComponent(group)}/shipping-rates`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packages: [{ weight_kg: weight, length_cm: length, width_cm: width, height_cm: height }] }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.detail?.message || data.detail || `Australia Post quote failed (HTTP ${response.status})`);
      if (requestVersion !== quoteRequestVersion.current) return;
      setOrigin(data.origin ?? origin);
      setRates(data.rates ?? []);
      if (!data.rates?.length) setError('Australia Post returned no available services for these package details.');
    } catch (requestError) {
      if (requestVersion === quoteRequestVersion.current) setError(requestError instanceof Error ? requestError.message : 'Unable to retrieve shipping rates.');
    } finally { if (requestVersion === quoteRequestVersion.current) setLoading(false); }
  };
  const applyRate = async () => {
    const rate = rates.find((item) => item.quote_id === selectedRate);
    if (!rate) return;
    setApplying(true); setError('');
    try {
      const response = await fetch(`/api/orders/${encodeURIComponent(order.order_id)}/shipments/${encodeURIComponent(group)}/shipping-fee`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rate),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.detail?.message || data.detail || `Unable to apply shipping fee (HTTP ${response.status})`);
      onApplied(data); handleClose();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to apply this shipping rate.');
    } finally { setApplying(false); }
  };

  return <Dialog open={open} onClose={handleClose} fullWidth maxWidth="md" className="shipping-quote-dialog">
    <DialogTitle>Calculate Shipping</DialogTitle>
    <DialogContent dividers>
      {!order || !shipment ? <Alert severity="info">No shipment is available for quoting.</Alert> : <Stack spacing={2.5}>
        <Typography variant="body2">Order {order.order_id} · {shipment.carrier}</Typography>
        <Box className="quote-address-grid">
          <Paper variant="outlined" sx={{ p: 2 }}><Typography variant="subtitle2">Ship From</Typography><Typography>{originLoading ? 'Loading account address…' : origin ? `${origin.suburb}, ${origin.state} ${origin.postcode}` : 'Account address unavailable'}</Typography><Typography variant="caption" color="text.secondary">Registered Australia Post lodgement location</Typography></Paper>
          <Paper variant="outlined" sx={{ p: 2 }}><Typography variant="subtitle2">Ship To</Typography><Typography>{address.suburb}, {address.state} {address.postcode}</Typography><Typography variant="caption" color="text.secondary">Order delivery address</Typography></Paper>
        </Box>
        {originError && <Alert severity="warning">{originError}</Alert>}
        {shipment && !supportsAustraliaPostQuote && <Alert severity="info">Live rate quotes are not implemented for {shipment.carrier}. This Shipment will not be sent to Australia Post.</Alert>}
        {order.shipments.length > 1 && <FormControl size="small"><InputLabel id="quote-shipment-label">Shipment</InputLabel><Select labelId="quote-shipment-label" label="Shipment" value={group} onChange={(event) => changeGroup(event.target.value)}>{order.shipments.map((item) => <MenuItem key={item.tracking_group} value={item.tracking_group}>{item.tracking_group} · {item.carrier}</MenuItem>)}</Select></FormControl>}
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Box className="quote-package-heading">
            <Typography variant="h6" sx={{ fontSize: 18, fontWeight: 650 }}>Package Information</Typography>
            <Typography className="quote-product-weight" variant="body2"><span>Catalog product weight (before packaging)</span><strong>{productWeight ? `${productWeight.toFixed(3)} kg` : 'Unavailable'}</strong></Typography>
          </Box>
          <Typography variant="body2" color="text.secondary" mb={2}>Weight is calculated from the products assigned to this shipment. Adjust it to include packaging, then confirm the outer package dimensions.</Typography>
          <Box className="quote-package-grid">
            <TextField label="Parcel Weight (kg)" type="number" size="small" value={weight} onChange={invalidate(setWeight)} inputProps={{ min: 0.001, step: 0.001 }} />
            <TextField label="Length (cm)" type="number" size="small" value={length} onChange={invalidate(setLength)} inputProps={{ min: 0.1, step: 0.1 }} />
            <TextField label="Width (cm)" type="number" size="small" value={width} onChange={invalidate(setWidth)} inputProps={{ min: 0.1, step: 0.1 }} />
            <TextField label="Height (cm)" type="number" size="small" value={height} onChange={invalidate(setHeight)} inputProps={{ min: 0.1, step: 0.1 }} />
          </Box>
          <Typography variant="caption" color="text.secondary" display="block" mt={1.5}>Products in this shipment: {groupedLines.map((item) => `${item.sku} × ${item.quantity}`).join(', ') || 'No assigned products'}. One parcel is quoted for this shipment.</Typography>
        </Paper>
        {error && <Alert severity="error">{error}</Alert>}
        {rates.length > 0 && <Paper variant="outlined" sx={{ p: 2 }}><Typography variant="h6" mb={1}>Available Shipping Services</Typography><Stack divider={<Box sx={{ borderBottom: '1px solid #eee' }} />}>
          {rates.map((rate) => <Stack key={rate.quote_id} direction="row" alignItems="center" spacing={1.5} py={1}>
            <Radio checked={selectedRate === rate.quote_id} onChange={() => setSelectedRate(rate.quote_id)} value={rate.quote_id} inputProps={{ 'aria-label': rate.service_name }} />
            <Box sx={{ flex: 1 }}><Typography fontWeight={650}>{rate.service_name}</Typography><Typography variant="caption" color="text.secondary">Product {rate.product_id} · Fuel surcharge {money(rate.fuel_surcharge)} · GST {money(rate.total_gst)}</Typography></Box>
            <Typography fontWeight={700}>{money(rate.total_cost)}</Typography>
          </Stack>)}
        </Stack></Paper>}
      </Stack>}
    </DialogContent>
    <DialogActions sx={{ p: 2 }}><Button onClick={handleClose}>Cancel</Button><Button variant="outlined" onClick={getRates} disabled={!supportsAustraliaPostQuote || !validPackage || loading}>{loading ? <CircularProgress size={18} /> : rates.length ? 'Get Rates Again' : 'Get Rates'}</Button><Button variant="contained" onClick={applyRate} disabled={!supportsAustraliaPostQuote || !selectedRate || applying}>{applying ? 'Applying…' : 'Apply Shipping Fee'}</Button></DialogActions>
  </Dialog>;
}

function App() {
  const [orders, setOrders] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [activeTab, setActiveTab] = useState('lines');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [trackingByOrder, setTrackingByOrder] = useState({});
  const [trackingLoadingByOrder, setTrackingLoadingByOrder] = useState({});
  const [trackingErrorByOrder, setTrackingErrorByOrder] = useState({});
  const [lineEditsByOrder, setLineEditsByOrder] = useState({});
  const [trackingNumbersByOrder, setTrackingNumbersByOrder] = useState({});
  const [queryingShipmentByOrder, setQueryingShipmentByOrder] = useState({});
  const [shippingDialogOpen, setShippingDialogOpen] = useState(false);
  const trackingAttempts = useRef(new Set());

  const loadOrders = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/orders');
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.detail || `Server returned HTTP ${response.status}`);
      }
      const data = await response.json();
      setOrders(data);
      setSelectedId((current) => data.some((order) => order.order_id === current)
        ? current
        : data[0]?.order_id ?? '');
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load orders.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadOrders();
  }, [loadOrders]);

  const activeOrder = orders.find((order) => order.order_id === selectedId);

  const displayItems = activeOrder?.line_items.map((item, index) => {
    const edit = lineEditsByOrder[activeOrder.order_id]?.[index] ?? {};
    const rrp = edit.rrp_incl_gst ?? Number(item.rrp_incl_gst);
    const quantity = edit.quantity ?? item.quantity;
    const valid = Number.isFinite(Number(rrp)) && Number(rrp) > 0
      && Number.isInteger(Number(quantity)) && Number(quantity) > 0;
    const unit = valid ? Math.round((Number(rrp) / 1.1 + Number.EPSILON) * 100) / 100 : null;
    const subtotal = valid ? Math.round((unit * Number(quantity) + Number.EPSILON) * 100) / 100 : null;
    return { ...item, rrp_incl_gst: rrp, quantity, ex_gst_unit_price: unit, line_subtotal_ex_gst: subtotal };
  }) ?? [];
  const hasInvalidLine = displayItems.some((item) => item.ex_gst_unit_price == null);
  const displaySummary = activeOrder && {
    ...activeOrder.summary,
    subtotal_ex_gst: hasInvalidLine ? null : displayItems.reduce((sum, item) => sum + Number(item.line_subtotal_ex_gst), 0).toFixed(2),
    gst_amount: hasInvalidLine ? null : (displayItems.reduce((sum, item) => sum + Number(item.line_subtotal_ex_gst), 0) * 0.1).toFixed(2),
    total: hasInvalidLine ? null : (displayItems.reduce((sum, item) => sum + Number(item.line_subtotal_ex_gst), 0) * 1.1 + Number(activeOrder.summary.shipment_fee)).toFixed(2),
  };

  const loadTracking = useCallback(async (orderId, force = false) => {
    if (!force && trackingAttempts.current.has(orderId)) return;
    trackingAttempts.current.add(orderId);
    if (force) {
      setTrackingByOrder((current) => {
        const next = { ...current };
        delete next[orderId];
        return next;
      });
    }
    setTrackingLoadingByOrder((current) => ({ ...current, [orderId]: true }));
    setTrackingErrorByOrder((current) => ({ ...current, [orderId]: '' }));
    try {
      const refreshQuery = force ? '?refresh=true' : '';
      const response = await fetch(`/api/orders/${encodeURIComponent(orderId)}/tracking${refreshQuery}`);
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.detail || `Server returned HTTP ${response.status}`);
      }
      const data = await response.json();
      setTrackingByOrder((current) => ({ ...current, [orderId]: data }));
    } catch (trackingLoadError) {
      setTrackingErrorByOrder((current) => ({
        ...current,
        [orderId]: trackingLoadError instanceof Error
          ? trackingLoadError.message
          : 'Unable to query shipment tracking.',
      }));
    } finally {
      setTrackingLoadingByOrder((current) => ({ ...current, [orderId]: false }));
    }
  }, []);

  const queryTrackingNumber = useCallback(async (order, shipment, trackingNumber) => {
    const trimmedNumber = String(trackingNumber ?? '').trim();
    if (!trimmedNumber) return;
    const key = shipment.tracking_group;
    setQueryingShipmentByOrder((current) => ({ ...current, [`${order.order_id}:${key}`]: true }));
    try {
      const response = await fetch('/api/orders/tracking-query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ carrier: shipment.carrier, tracking_number: trimmedNumber, tracking_group: key, order_date: order.order_date }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.detail || `Server returned HTTP ${response.status}`);
      setTrackingByOrder((current) => ({
        ...current,
        [order.order_id]: [
          ...(current[order.order_id] ?? []).filter((record) => record.tracking_group !== key),
          payload,
        ],
      }));
    } catch (queryError) {
      setTrackingErrorByOrder((current) => ({ ...current, [order.order_id]: queryError instanceof Error ? queryError.message : 'Unable to query this tracking number.' }));
    } finally {
      setQueryingShipmentByOrder((current) => ({ ...current, [`${order.order_id}:${key}`]: false }));
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'shipments' && activeOrder) {
      loadTracking(activeOrder.order_id);
    }
  }, [activeTab, activeOrder?.order_id, loadTracking]);

  return (
    <ThemeProvider theme={theme}>
    <CssBaseline />
    <Box className="erp-app">
      <AppBar position="static" elevation={0} color="inherit" component="header" className="topbar">
        <Box component="nav" className="breadcrumbs" aria-label="Breadcrumb">
          <span>Orders</span>
          <span className="breadcrumb-divider">/</span>
          <span className="breadcrumb-current">{activeOrder?.order_id ?? 'Order details'}</span>
        </Box>
        <div className="topbar-actions">
          <FormControl size="small" className="order-picker">
          <InputLabel id="order-select-label">Order</InputLabel>
          <Select
            labelId="order-select-label"
            id="order-select"
            label="Order"
            value={selectedId}
            onChange={(event) => setSelectedId(event.target.value)}
            disabled={orders.length === 0}
          >
            {orders.map((order) => (
              <MenuItem key={order.order_id} value={order.order_id}>
                {order.order_id} · {order.company_name}
              </MenuItem>
            ))}
          </Select>
          </FormControl>
          <Button type="button" className="refresh-button" variant="outlined" startIcon={<RefreshIcon />} onClick={loadOrders} disabled={loading}>
            {loading ? 'Loading…' : 'Refresh'}
          </Button>
        </div>
      </AppBar>

      <Box component="main" className="workspace" id="orders">
        {loading && orders.length === 0 && <LoadingState />}

        {!loading && error && (
          <Alert severity="error" action={<Button color="inherit" size="small" onClick={loadOrders}>Retry</Button>}>Unable to load order data: {error}</Alert>
        )}

        {!loading && !error && orders.length === 0 && (
          <div className="state-panel">No orders are available.</div>
        )}

        {activeOrder && (
          <>
            <StatusBar status={activeOrder.status} />
            <Paper component="article" variant="outlined" elevation={0} className="order-sheet" aria-labelledby="order-number-heading">
              <Box component="header" className="sheet-header">
                <Typography component="h2" variant="h2" id="order-number-heading">{activeOrder.order_id}</Typography>
              </Box>
              <div className="field-groups">
                <CustomerFields order={activeOrder} />
                <OrderFields order={activeOrder} />
              </div>
              <OrderNotebook
                order={activeOrder}
                activeTab={activeTab}
                onTabChange={setActiveTab}
                trackingRecords={trackingByOrder[activeOrder.order_id]}
                trackingLoading={Boolean(trackingLoadingByOrder[activeOrder.order_id])}
                trackingError={trackingErrorByOrder[activeOrder.order_id]}
                onRefreshTracking={() => loadTracking(activeOrder.order_id, true)}
                items={displayItems}
                summary={displaySummary}
                onLineUpdate={(index, field, value) => setLineEditsByOrder((current) => ({
                  ...current,
                  [activeOrder.order_id]: {
                    ...(current[activeOrder.order_id] ?? {}),
                    [index]: { ...(current[activeOrder.order_id]?.[index] ?? {}), [field]: value },
                  },
                }))}
                trackingNumbers={trackingNumbersByOrder[activeOrder.order_id]}
                onTrackingNumberChange={(group, value) => setTrackingNumbersByOrder((current) => ({
                  ...current,
                  [activeOrder.order_id]: { ...(current[activeOrder.order_id] ?? {}), [group]: value },
                }))}
                onQueryTracking={(shipment, trackingNumber) => queryTrackingNumber(activeOrder, shipment, trackingNumber)}
                queryingShipment={Object.entries(queryingShipmentByOrder).find(([key, value]) => value && key.startsWith(`${activeOrder.order_id}:`))?.[0]?.split(':').slice(1).join(':')}
                onCalculateShipping={() => setShippingDialogOpen(true)}
              />
            </Paper>
          </>
        )}
      </Box>
      <ShippingQuoteDialog
        open={shippingDialogOpen}
        onClose={() => setShippingDialogOpen(false)}
        order={activeOrder}
        onApplied={(updatedOrder) => {
          setOrders((current) => current.map((item) => item.order_id === updatedOrder.order_id ? updatedOrder : item));
        }}
      />
    </Box>
    </ThemeProvider>
  );
}

window.addEventListener('error', (event) => {
  const root = document.getElementById('root');
  if (root && !root.hasChildNodes()) root.textContent = `Application error: ${event.message}`;
});
createRoot(document.getElementById('root')).render(<App />);
