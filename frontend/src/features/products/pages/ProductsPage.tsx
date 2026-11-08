import { useEffect, useState } from 'react';
import { Add, DeleteOutlined, EditOutlined } from '@mui/icons-material';
import { api } from '../../../shared/api';
import { money } from '../../../shared/format';
import type { AnyRecord } from '../../../shared/types';
import { PageHeading } from '../../../shared/components/PageHeading';
import { TableState } from '../../../shared/components/TableState';
import { useConfirm } from '../../../shared/hooks/useConfirm';
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, Table, TableBody, TableCell, TableHead, TableRow, TextField } from '../../../shared/mui';

type ProductDraft = { sku: string; name: string; description: string; rrp_incl_gst: string; weight_g: string; length_mm: string; width_mm: string; height_mm: string };
/** 新建对话框的空白字段值；编辑前会由商品记录覆盖。 */
const emptyProductDraft = (): ProductDraft => ({ sku: '', name: '', description: '', rrp_incl_gst: '', weight_g: '', length_mm: '', width_mm: '', height_mm: '' });

/** 商品目录维护页：金额、重量和尺寸由服务端校验并持久化。 */
export function ProductsPage() {
  const { confirm, confirmDialog } = useConfirm();
  const [products, setProducts] = useState<AnyRecord[]>([]);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingSku, setEditingSku] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<ProductDraft>(emptyProductDraft);

  // 保存或删除后重读服务端数据，避免只更新本地列表造成显示与数据库不一致。
  const load = async () => {
    setBusy(true);
    setError('');
    try { setProducts(await api('/api/products')); }
    catch (loadError: any) { setError(loadError.message); }
    finally { setBusy(false); }
  };
  useEffect(() => { void load(); }, []);

  // 清除上次编辑残留，再以空表单进入新增流程。
  const startCreate = () => { setError(''); setEditingSku(null); setDraft(emptyProductDraft()); setEditorOpen(true); };
  // 把 API 的测量对象展开成输入框使用的字符串，SKU 在编辑时保持不可变。
  const startEdit = (product: AnyRecord) => {
    setError('');
    setEditingSku(product.sku);
    setDraft({ sku: product.sku, name: product.name, description: product.description || '',
      rrp_incl_gst: String(product.rrp_incl_gst), weight_g: product.weight?.value || '',
      length_mm: product.dimensions?.length?.value || '', width_mm: product.dimensions?.width?.value || '',
      height_mm: product.dimensions?.height?.value || '' });
    setEditorOpen(true);
  };
  // API 使用不同写入路径区分新增和修改；成功后关闭对话框并刷新目录。
  const save = async () => {
    setSaving(true);
    setError('');
    const payload = { ...draft, weight_g: draft.weight_g || null, length_mm: draft.length_mm || null,
      width_mm: draft.width_mm || null, height_mm: draft.height_mm || null };
    try {
      const path = editingSku ? `/api/products/${encodeURIComponent(editingSku)}` : '/api/products';
      await api(path, { method: editingSku ? 'PATCH' : 'POST', body: JSON.stringify(payload) });
      setEditorOpen(false);
      await load();
    } catch (saveError: any) { setError(saveError.message); }
    finally { setSaving(false); }
  };
  // 删除可能被历史订单引用的商品会被服务端拒绝，以保留历史订单可读性。
  const remove = async (product: AnyRecord) => {
    if (!await confirm({ title: 'Delete product?', message: `Delete ${product.sku} · ${product.name}? Deletion will be blocked if an existing order references this product, preserving order history.`, confirmText: 'Delete', confirmColor: 'error' })) return;
    setError('');
    try {
      await api(`/api/products/${encodeURIComponent(product.sku)}`, { method: 'DELETE' });
      await load();
    } catch (deleteError: any) {
      setError(deleteError.status === 409
        ? `Cannot delete ${product.sku}: it is referenced by existing order lines. Historical order data remains unchanged.`
        : deleteError.message);
    }
  };
  const filtered = products.filter(product => `${product.sku} ${product.name} ${product.description}`.toLowerCase().includes(search.toLowerCase()));
  const dimensionFields: Array<[keyof ProductDraft, string]> = [['weight_g', 'Weight (g)'], ['length_mm', 'Length (mm)'], ['width_mm', 'Width (mm)'], ['height_mm', 'Height (mm)']];

  return <>
    <PageHeading title="Products" subtitle="Manage the product catalogue, pricing, and dimensions."/>
    <Stack className="products-toolbar" direction={{ xs: 'column-reverse', sm: 'row' }} spacing={1.5} sx={{ justifyContent: 'flex-end', alignItems: { sm: 'center' }, mb: 1.5 }}>
      <TextField size="small" fullWidth placeholder="Search by SKU or product name" value={search} onChange={event => setSearch(event.target.value)}/>
      <Button sx={{ flexShrink: 0 }} variant="contained" startIcon={<Add/>} onClick={startCreate}>Add Product</Button>
    </Stack>
    {error && !editorOpen && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
    <TableState loading={busy} empty={!filtered.length} emptyText="No products found.">
      <Table sx={{ minWidth: 900 }}>
        <TableHead><TableRow>{['SKU', 'Product', 'Description', 'RRP (Inc GST)', 'Weight', 'Dimensions', 'Actions'].map(label => <TableCell key={label}>{label}</TableCell>)}</TableRow></TableHead>
        <TableBody>{filtered.map(product => <TableRow key={product.sku}>
          <TableCell><b>{product.sku}</b></TableCell>
          <TableCell>{product.name}</TableCell>
          <TableCell sx={{ maxWidth: 360 }}>{product.description || '—'}</TableCell>
          <TableCell>{money(product.rrp_incl_gst)}</TableCell>
          <TableCell>{product.weight ? `${product.weight.value} ${product.weight.unit}` : '—'}</TableCell>
          <TableCell>{product.dimensions?.length?.value ? `${product.dimensions.length.value} × ${product.dimensions.width?.value} × ${product.dimensions.height?.value} mm` : '—'}</TableCell>
          <TableCell><Stack direction="row" spacing={0.5}>
            <Button size="small" startIcon={<EditOutlined/>} onClick={() => startEdit(product)}>Edit</Button>
            <Button size="small" color="error" startIcon={<DeleteOutlined/>} onClick={() => void remove(product)}>Delete</Button>
          </Stack></TableCell>
        </TableRow>)}</TableBody>
      </Table>
    </TableState>
    <Dialog open={editorOpen} onClose={() => !saving && setEditorOpen(false)} fullWidth maxWidth="sm">
      <DialogTitle>{editingSku ? 'Edit Product' : 'Add Product'}</DialogTitle>
      <DialogContent>{editorOpen && error && <Alert severity="error" sx={{ mb: 1.5 }}>{error}</Alert>}<Stack spacing={1.5} sx={{ pt: 1 }}>
        <TextField required label="SKU" disabled={Boolean(editingSku)} helperText={editingSku ? 'SKU cannot be changed after creation.' : undefined} value={draft.sku} onChange={event => setDraft({ ...draft, sku: event.target.value.toUpperCase() })}/>
        <TextField required label="Product Name" value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })}/>
        <TextField label="Description" multiline minRows={2} value={draft.description} onChange={event => setDraft({ ...draft, description: event.target.value })}/>
        <TextField required type="number" label="RRP (AUD, incl. GST)" slotProps={{ htmlInput: { min: .01, step: .01 } }} value={draft.rrp_incl_gst} onChange={event => setDraft({ ...draft, rrp_incl_gst: event.target.value })}/>
        <Box className="product-dimensions-form">{dimensionFields.map(([key, label]) => <TextField key={key} type="number" label={label} slotProps={{ htmlInput: { min: 1, step: 1 } }} value={draft[key]} onChange={event => setDraft({ ...draft, [key]: event.target.value })}/>)}</Box>
      </Stack></DialogContent>
      <DialogActions><Button disabled={saving} onClick={() => setEditorOpen(false)}>Cancel</Button><Button variant="contained" disabled={saving || !draft.sku.trim() || !draft.name.trim() || Number(draft.rrp_incl_gst) <= 0} onClick={() => void save()}>{saving ? 'Saving…' : 'Save Product'}</Button></DialogActions>
    </Dialog>
    {confirmDialog}
  </>;
}
