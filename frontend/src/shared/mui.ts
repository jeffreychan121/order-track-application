import * as Mui from '@mui/material';

export const Alert: any = Mui.Alert; export const AppBar: any = Mui.AppBar; export const Autocomplete: any = Mui.Autocomplete;
export const Box: any = Mui.Box; export const Button: any = Mui.Button; export const Chip: any = Mui.Chip;
export const CircularProgress: any = Mui.CircularProgress; export const CssBaseline: any = Mui.CssBaseline;
export const Dialog: any = Mui.Dialog; export const DialogActions: any = Mui.DialogActions; export const DialogContent: any = Mui.DialogContent;
export const DialogTitle: any = Mui.DialogTitle; export const Divider: any = Mui.Divider; export const Drawer: any = Mui.Drawer;
export const FormControl: any = Mui.FormControl; export const IconButton: any = Mui.IconButton; export const InputLabel: any = Mui.InputLabel;
export const Checkbox: any = Mui.Checkbox; export const FormControlLabel: any = Mui.FormControlLabel; export const FormGroup: any = Mui.FormGroup;
export const MenuItem: any = Mui.MenuItem; export const Paper: any = Mui.Paper; export const Radio: any = Mui.Radio; export const Select: any = Mui.Select; export const Stack: any = Mui.Stack;
export const Menu: any = Mui.Menu;
export const Snackbar: any = Mui.Snackbar;
export const List: any = Mui.List; export const ListItemButton: any = Mui.ListItemButton; export const ListItemText: any = Mui.ListItemText; export const Tooltip: any = Mui.Tooltip;
export const Tab: any = Mui.Tab; export const Tabs: any = Mui.Tabs; export const Table: any = Mui.Table; export const TableBody: any = Mui.TableBody;
export const TableCell: any = Mui.TableCell; export const TableContainer: any = Mui.TableContainer; export const TableHead: any = Mui.TableHead;
export const TableRow: any = Mui.TableRow; export const TextField: any = Mui.TextField; export const ThemeProvider: any = Mui.ThemeProvider;
export const Toolbar: any = Mui.Toolbar; export const Typography: any = Mui.Typography; const createTheme = Mui.createTheme;
export const theme = createTheme({
  palette: { primary: { main: '#65527f', dark: '#514064' }, secondary: { main: '#648a80' }, background: { default: '#f3f2f5', paper: '#fff' }, success: { main: '#648a80' } },
  shape: { borderRadius: 4 },
  typography: { fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif', fontSize: 14, body1: { fontSize: 14, lineHeight: 1.5 }, body2: { fontSize: 13, lineHeight: 1.45 }, h4: { fontSize: 22, fontWeight: 700, lineHeight: 1.3 }, h6: { fontSize: 16, fontWeight: 650, lineHeight: 1.4 }, button: { fontSize: 13, textTransform: 'none', fontWeight: 600 } },
  components: { MuiButton: { styleOverrides: { root: { minHeight: 31, padding: '4px 10px', borderRadius: 4, boxShadow: 'none' } } }, MuiPaper: { styleOverrides: { outlined: { borderColor: '#dedee2' } } }, MuiTableCell: { styleOverrides: { root: { padding: '9px 12px', fontSize: 14, borderColor: '#e6e4e9' }, head: { padding: '10px 12px', fontSize: 13, fontWeight: 650, color: '#777780', background: '#f7f7f8' } } } },
});
