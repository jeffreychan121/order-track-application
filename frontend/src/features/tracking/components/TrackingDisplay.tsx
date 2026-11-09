import { Refresh } from '@mui/icons-material';
import { formatDateTime } from '../../../shared/format';
import type { AnyRecord } from '../../../shared/types';
import { Alert, Box, Button, Chip, CircularProgress, Paper, Stack, Typography } from '../../../shared/mui';

/** 将承运商原始状态映射为统一颜色语义，同时保留有辨识度的状态文案。 */
export function TrackingStatusChip({ status, hasError }: { status: string; hasError: boolean }) {
  const normalized = status.toLowerCase().replace(/[ _-]+/g, ' ').trim();
  const isDelivered = normalized.includes('deliver');
  const isNotQueried = normalized === 'not queried';
  const isNotImplemented = normalized === 'not implemented';
  const color = hasError || isNotImplemented || normalized.includes('unavailable') || normalized.includes('exception')
    ? 'warning'
    : isDelivered
      ? 'success'
      : isNotQueried
        ? 'info'
      : normalized.includes('transit') || normalized.includes('onboard') || normalized.includes('querying')
        ? 'info'
        : 'default';
  // 追踪方可能返回不同文案；保留原始状态文本，只统一其视觉语义。
  const label = isDelivered ? 'Delivered' : isNotQueried ? 'Not queried' : isNotImplemented ? 'Not implemented' : normalized === 'unavailable' ? 'Unavailable' : status;
  return <Chip size="small" variant={isDelivered || isNotQueried ? 'filled' : 'outlined'} color={color} label={label}/>;
}

// 区分承运商事件时间、查询失败和尚未查询，避免把缺少事件时间误报成未查询。
export function trackingEventTimeLabel(tracking?: AnyRecord) {
  if (!tracking || tracking.overall_status === 'not_queried') return 'Not queried';
  if (tracking.last_updated) return formatDateTime(tracking.last_updated);
  if (tracking.tracking_error || ['unavailable', 'not_implemented'].includes(tracking.overall_status)) return 'Unavailable';
  return 'No event timestamp';
}

/** 展示运单摘要、异常、事件时间线和逐件追踪结果，可嵌入详情抽屉。 */
export function TrackingResult({ data, onRefresh, drawerMode = false, loading = false, refreshing = false }: { data: AnyRecord; onRefresh?: () => void; drawerMode?: boolean; loading?: boolean; refreshing?: boolean }) {
  const status = data.overall_status_raw || data.overall_status || 'Status unavailable';
  const hasNoEvents = !(data.consignment_events || []).length && !(data.articles || []).some((article: AnyRecord) => (article.events || []).length);
  const emptyText = hasNoEvents && data.overall_status === 'not_queried'
    ? 'Tracking has not been queried for this shipment yet.'
    : hasNoEvents && data.tracking_error && !data.tracking_last_successful_at
      ? 'No tracking events are available because the latest request did not succeed.'
      : hasNoEvents && data.overall_status === 'unknown'
        ? 'The carrier returned a valid response, but no tracking events are available yet.'
        : drawerMode && (data.articles || []).length
          ? 'No consignment-level events. See article tracking below.'
          : undefined;
  return <Box className={`tracking-result${drawerMode ? ' tracking-result-drawer' : ''}`}>
    {drawerMode ? <Stack className="tracking-result-heading tracking-result-heading-drawer" direction="row" spacing={1} sx={{ justifyContent: 'space-between', alignItems: 'center' }}><Box><Typography className="tracking-result-label" variant="caption">Tracking Status</Typography>{loading ? <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}><CircularProgress size={15}/><Typography variant="body2">Loading tracking details…</Typography></Stack> : <TrackingStatusChip status={status} hasError={Boolean(data.tracking_error)}/>}</Box>{onRefresh && <Button size="small" variant="outlined" startIcon={refreshing ? <CircularProgress size={14}/> : <Refresh/>} disabled={loading || refreshing} onClick={onRefresh}>{refreshing ? 'Refreshing…' : 'Refresh Tracking'}</Button>}</Stack>
      : <Stack className="tracking-result-heading" direction="row" spacing={1} sx={{ justifyContent: 'space-between', alignItems: 'center' }}><Box><Typography variant="subtitle1" fontWeight={700}>Consignment</Typography><Typography variant="body2" color="text.secondary">{status}</Typography></Box>{onRefresh && <Button size="small" variant="outlined" startIcon={<Refresh/>} onClick={onRefresh}>Refresh</Button>}</Stack>}
    {data.tracking_error && <Alert severity="warning" sx={{ mt: 1.5 }}>
      {data.tracking_stale && data.tracking_last_successful_at
        ? <>The latest refresh failed. Showing the last successful tracking data from {formatDateTime(data.tracking_last_successful_at)}. </>
        : <>Tracking data could not be refreshed. </>}
      {data.tracking_error_code}: {data.tracking_error}
      {data.tracking_last_attempt_at && <> Last attempted {formatDateTime(data.tracking_last_attempt_at)}.</>}
    </Alert>}
    <Box className="tracking-summary-grid"><Box className="tracking-stat"><Typography variant="caption">Articles</Typography><strong>{data.total_articles ?? '—'}</strong></Box><Box className="tracking-stat"><Typography variant="caption">Delivered</Typography><strong>{data.delivered_articles ?? '—'}</strong></Box><Box className="tracking-stat tracking-stat-updated"><Typography variant="caption">Latest Carrier Event</Typography><strong>{data.last_updated ? (drawerMode ? formatDateTime(data.last_updated) : data.last_updated) : '—'}</strong></Box><Box className="tracking-stat tracking-stat-updated"><Typography variant="caption">Last Successful Check</Typography><strong>{data.tracking_last_successful_at ? formatDateTime(data.tracking_last_successful_at) : 'Not available'}</strong></Box></Box>
    <Paper className="tracking-event-section" variant="outlined"><Typography variant="subtitle2" fontWeight={700}>Consignment Events</Typography><Events events={data.consignment_events || []} formatDates={drawerMode} emptyText={emptyText}/></Paper>
    {drawerMode && (data.articles || []).length > 0 && <Typography className="tracking-articles-title" variant="subtitle1">Article Tracking · {data.articles.length}</Typography>}
    {(data.articles || []).map((article: AnyRecord, index: number) => <Paper className="tracking-article-card" key={article.article_id || index} variant="outlined"><Stack className="tracking-article-heading" direction="row" spacing={1} sx={{ justifyContent: 'space-between', alignItems: 'flex-start' }}><Box><Typography variant="subtitle2" fontWeight={700}>Article {article.article_id || index + 1}</Typography><Typography variant="caption" color="text.secondary">{article.product_type || 'Product type unavailable'}</Typography></Box>{drawerMode ? <TrackingStatusChip status={article.raw_status || article.status || 'Status unavailable'} hasError={Boolean(data.tracking_error)}/> : <Chip size="small" variant="outlined" label={article.raw_status || article.status || 'Status unavailable'}/>}</Stack><Events events={article.events || []} formatDates={drawerMode}/></Paper>)}
  </Box>;
}
/** 展示追踪事件时间线；由调用方决定时区格式和空状态文案。 */
export function Events({ events, emptyText = 'No tracking events were returned.', formatDates = false }: { events: AnyRecord[]; emptyText?: string; formatDates?: boolean }) { return events.length ? <ol className="tracking-timeline">{events.map((event, index) => <li className="tracking-timeline-event" key={`${event.date}-${index}`}><span className="tracking-timeline-marker"/><Box><Typography variant="body2" fontWeight={650}>{event.description || 'Event description unavailable'}</Typography><Typography variant="caption" color="text.secondary" component="time" dateTime={event.date || undefined}>{event.date ? (formatDates ? formatDateTime(event.date) : event.date) : 'Time not provided'}</Typography>{event.location && <Typography variant="caption" color="text.secondary" display="block">{event.location}</Typography>}</Box></li>)}</ol> : <Typography className="tracking-empty-events" variant="body2" color="text.secondary">{emptyText}</Typography>; }
