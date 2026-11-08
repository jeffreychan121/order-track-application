import { useEffect, useState } from 'react';
import { Add, DeleteOutlined } from '@mui/icons-material';
import { api } from '../../../shared/api';
import type { AnyRecord, Carrier } from '../../../shared/types';
import { PageHeading } from '../../../shared/components/PageHeading';
import { TableState } from '../../../shared/components/TableState';
import { useConfirm } from '../../../shared/hooks/useConfirm';
import { Alert, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, FormControl, InputLabel, MenuItem, Paper, Select, Stack, Tooltip, Table, TableBody, TableCell, TableHead, TableRow, TextField } from '../../../shared/mui';

/** 承运商主数据页；删除与停用分开处理以保护已保存的 Shipment 历史。 */
export function CarriersPage() {
  const { confirm, confirmDialog } = useConfirm();
  const [rows, setRows] = useState<Carrier[]>([]); const [search, setSearch] = useState(''); const [activeFilter, setActiveFilter] = useState('all'); const [busy, setBusy] = useState(true); const [error, setError] = useState(''); const [addOpen, setAddOpen] = useState(false); const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<number | null>(null); const [draft, setDraft] = useState<AnyRecord>({}); const [newCarrier, setNewCarrier] = useState({ code: '', name: '', description: '' });
  // 列表始终以服务端返回为准，修改成功后重新加载 used 与 active 状态。
  const load = () => { setBusy(true); api('/api/carriers').then(setRows).catch(err => setError(err.message)).finally(() => setBusy(false)); };
  useEffect(load, []);
  // 代码已被历史 Shipment 引用时只允许修改名称等信息，代码编辑控件会隐藏。
  const saveEdit = async (id: number) => { setSaving(true); setError(''); try { await api(`/api/carriers/${id}`, { method: 'PATCH', body: JSON.stringify(draft) }); setEditing(null); load(); } catch (err: any) { setError(err.message); } finally { setSaving(false); } };
  // 新增承运商默认没有已接入的 API 适配器，只进入主数据列表。
  const add = async () => { setSaving(true); setError(''); try { await api('/api/carriers', { method: 'POST', body: JSON.stringify(newCarrier) }); setAddOpen(false); setNewCarrier({ code: '', name: '', description: '' }); load(); } catch (err: any) { setError(err.message); } finally { setSaving(false); } };
  // 已使用承运商禁止删除；此判断与服务端限制并存以便快速反馈。
  const remove = async (row: AnyRecord) => {
    if (row.used) { setError('This carrier is linked to existing shipments and cannot be deleted. Deactivate it to prevent new use.'); return; }
    if (!await confirm({ title: 'Delete carrier?', message: `Delete ${row.name}?`, confirmText: 'Delete', confirmColor: 'error' })) return;
    setError('');
    try { await api(`/api/carriers/${row.id}`, { method: 'DELETE' }); await load(); }
    catch (err: any) { setError(err.message); }
  };
  // 停用可以阻止新 Shipment 选用承运商，同时保留历史记录显示名称。
  const deactivate = async (row: AnyRecord) => {
    if (!await confirm({ title: 'Deactivate carrier?', message: `${row.name} is used by saved shipments. Deactivating it prevents selecting it for new shipments while preserving its historical shipment records.`, confirmText: 'Deactivate' })) return;
    setError('');
    try { await api(`/api/carriers/${row.id}`, { method: 'PATCH', body: JSON.stringify({ is_active: false }) }); await load(); }
    catch (err: any) { setError(err.message); }
  };
  const filtered = rows.filter(row => (activeFilter === 'all' || row.is_active === (activeFilter === 'active')) && `${row.name} ${row.code}`.toLowerCase().includes(search.toLowerCase())).sort((a,b) => a.name.localeCompare(b.name));
  return <><PageHeading title="Carriers" subtitle="Maintain the carriers available for new shipment plans."/>{error && <Alert severity="error" sx={{ mb: 1.5 }}>{error}</Alert>}<Paper className="carriers-toolbar" variant="outlined" sx={{ p: 1.5, mb: 1.5 }}><Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ alignItems: { sm: 'center' } }}><TextField size="small" fullWidth placeholder="Search carriers" value={search} onChange={e => setSearch(e.target.value)}/><FormControl size="small" sx={{ minWidth: 155 }}><InputLabel>Status</InputLabel><Select label="Status" value={activeFilter} onChange={e => setActiveFilter(e.target.value)}><MenuItem value="all">All carriers</MenuItem><MenuItem value="active">Active</MenuItem><MenuItem value="inactive">Inactive</MenuItem></Select></FormControl><Button sx={{ flexShrink: 0 }} variant="contained" startIcon={<Add/>} onClick={() => setAddOpen(true)}>Add Carrier</Button></Stack></Paper><TableState loading={busy} empty={!filtered.length} emptyText="No carriers found."><Table sx={{ minWidth: 720 }}><TableHead><TableRow>{['Carrier Name','Code','Description','Status','Actions'].map(value => <TableCell key={value}>{value}</TableCell>)}</TableRow></TableHead><TableBody>{filtered.map(row => <TableRow key={row.id}>
    <TableCell>{editing === row.id ? <TextField size="small" slotProps={{ htmlInput: { 'aria-label': `Carrier name ${row.code}` } }} value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })}/> : row.name}</TableCell>
    <TableCell>{editing === row.id && !row.used ? <TextField size="small" slotProps={{ htmlInput: { 'aria-label': `Carrier code ${row.code}` } }} value={draft.code} onChange={e => setDraft({ ...draft, code: e.target.value })}/> : row.code}</TableCell>
    <TableCell>{editing === row.id ? <TextField size="small" slotProps={{ htmlInput: { 'aria-label': `Carrier description ${row.code}` } }} value={draft.description} onChange={e => setDraft({ ...draft, description: e.target.value })}/> : row.description || '—'}</TableCell>
    <TableCell>{editing === row.id ? <Select size="small" value={draft.is_active ? 'active' : 'inactive'} onChange={e => setDraft({ ...draft, is_active: e.target.value === 'active' })}><MenuItem value="active">Active</MenuItem><MenuItem value="inactive">Inactive</MenuItem></Select> : <Chip size="small" label={row.is_active ? 'Active' : 'Inactive'} color={row.is_active ? 'success' : 'default'}/>}</TableCell>
    <TableCell>{editing === row.id ? <Stack direction="row"><Button size="small" disabled={saving} onClick={() => saveEdit(row.id)}>Save</Button><Button size="small" onClick={() => setEditing(null)}>Cancel</Button></Stack> : <Stack direction="row" spacing={0.5}><Button size="small" onClick={() => { setEditing(row.id); setDraft({ name: row.name, code: row.code, description: row.description, is_active: row.is_active }); }}>Edit</Button>{row.used && row.is_active && <Button size="small" onClick={() => void deactivate(row)}>Deactivate</Button>}{row.used ? <Tooltip title="This carrier is linked to existing shipments and cannot be deleted."><span><Button size="small" color="error" disabled startIcon={<DeleteOutlined/>}>Delete</Button></span></Tooltip> : <Button size="small" color="error" startIcon={<DeleteOutlined/>} onClick={() => void remove(row)}>Delete</Button>}</Stack>}</TableCell>
  </TableRow>)}</TableBody></Table></TableState>
  <Dialog open={addOpen} onClose={() => !saving && setAddOpen(false)} fullWidth maxWidth="sm"><DialogTitle>Add Carrier</DialogTitle><DialogContent><Stack spacing={1.5} sx={{ pt: 1 }}><TextField required label="Carrier Code" value={newCarrier.code} onChange={e => setNewCarrier({ ...newCarrier, code: e.target.value.toUpperCase() })}/><TextField required label="Carrier Name" value={newCarrier.name} onChange={e => setNewCarrier({ ...newCarrier, name: e.target.value })}/><TextField label="Description" value={newCarrier.description} onChange={e => setNewCarrier({ ...newCarrier, description: e.target.value })}/></Stack></DialogContent><DialogActions><Button onClick={() => setAddOpen(false)}>Cancel</Button><Button variant="contained" disabled={saving || !newCarrier.code.trim() || !newCarrier.name.trim()} onClick={add}>{saving ? 'Saving…' : 'Save Carrier'}</Button></DialogActions></Dialog>{confirmDialog}</>;
}
