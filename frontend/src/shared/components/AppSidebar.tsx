import { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  Box, Collapse, Divider, Drawer, IconButton, List, ListItemButton,
  ListItemIcon, ListItemText, Tooltip, Typography, useMediaQuery, useTheme,
} from '@mui/material';
import {
  AccountBalance, Calculate, ChevronLeft, ChevronRight, ExpandLess, ExpandMore, Inventory2, LocalShipping,
  LocationOn, Menu as MenuIcon, ReceiptLong, Science,
} from '@mui/icons-material';

const EXPANDED_WIDTH = 224;
const COLLAPSED_WIDTH = 64;
const SIDEBAR_STORAGE_KEY = 'aeris-sidebar-expanded';

type NavigationItem = {
  label: string;
  path: string;
  icon: typeof ReceiptLong;
};

const primaryItems: NavigationItem[] = [
  { label: 'Orders', path: '/orders', icon: ReceiptLong },
  { label: 'Products', path: '/products', icon: Inventory2 },
  { label: 'Carriers', path: '/carriers', icon: LocalShipping },
];

const apiItems: NavigationItem[] = [
  { label: 'Tracking', path: '/tracking', icon: LocationOn },
  { label: 'Shipping Rates', path: '/shipping-rates', icon: Calculate },
  { label: 'Account Products', path: '/api-testing/accounts', icon: AccountBalance },
];

/** 读取侧栏展开偏好；存储不可用时采用默认展开状态。 */
function readExpandedPreference(): boolean {
  try {
    return window.localStorage.getItem(SIDEBAR_STORAGE_KEY) !== 'false';
  } catch {
    // 隐私浏览或存储策略禁止 localStorage 时，仍以默认展开状态正常运行。
    return true;
  }
}

/** 全局导航：支持桌面折叠、API Testing 分组和窄屏临时抽屉。 */
export function AppSidebar() {
  const location = useLocation();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const [expanded, setExpanded] = useState(readExpandedPreference);
  const [apiOpen, setApiOpen] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);
  const apiRouteActive = apiItems.some(item => location.pathname.startsWith(item.path));
  const width = expanded ? EXPANDED_WIDTH : COLLAPSED_WIDTH;

  useEffect(() => {
    // 直接刷新或粘贴二级路由时展开父组，确保当前页面始终可见且高亮。
    if (apiRouteActive) setApiOpen(true);
  }, [apiRouteActive]);

  /** 切换侧栏宽度，并尽力持久化偏好；存储异常不影响当前导航。 */
  const toggleExpanded = () => {
    setExpanded(current => {
      const next = !current;
      try {
        window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(next));
      } catch {
        // 偏好保存失败不影响当前会话中的展开/收起操作。
      }
      return next;
    });
  };

  /** 用户在折叠栏中打开 API Testing 时，先展开侧栏以显示子项。 */
  const expandSidebar = () => {
    setExpanded(true);
    try {
      window.localStorage.setItem(SIDEBAR_STORAGE_KEY, 'true');
    } catch {
      // 无法持久化时仍在当前页面展开导航。
    }
  };

  const isSelected = (path: string) => path === '/orders'
    ? location.pathname === path || location.pathname.startsWith('/orders/')
    : location.pathname === path || location.pathname.startsWith(`${path}/`);

  /** 按桌面折叠态或移动抽屉状态渲染统一导航链接。 */
  const renderLink = (item: NavigationItem, nested = false, compact = false) => {
    const labelsVisible = expanded || compact;
    const Icon = item.icon;
    const selected = isSelected(item.path);
    const button = <ListItemButton
      component={NavLink}
      to={item.path}
      selected={selected}
      onClick={() => setMobileOpen(false)}
      className={`sidebar-link${nested ? ' sidebar-link-nested' : ''}`}
      sx={{
        minHeight: 42,
      justifyContent: labelsVisible ? 'initial' : 'center',
      px: labelsVisible ? 1.4 : 1,
        mx: 0.75,
        mb: 0.5,
        borderRadius: 1,
        color: 'text.secondary',
        '& .MuiListItemIcon-root': { minWidth: labelsVisible ? 38 : 0, color: 'inherit' },
        '&.Mui-selected': { color: 'primary.main', bgcolor: 'primary.main', backgroundColor: 'rgba(101, 82, 127, 0.09)' },
        '&.Mui-selected:hover': { backgroundColor: 'rgba(101, 82, 127, 0.14)' },
      }}
      aria-current={selected ? 'page' : undefined}
    >
      <ListItemIcon><Icon fontSize="small"/></ListItemIcon>
      {labelsVisible && <ListItemText primary={<Typography sx={{ fontSize: 13, fontWeight: selected ? 650 : 500 }}>{item.label}</Typography>}/>}
    </ListItemButton>;

    return labelsVisible ? button : <Tooltip key={item.path} title={item.label} placement="right">{button}</Tooltip>;
  };

  /** 桌面和移动抽屉复用同一导航内容，避免两套菜单行为不一致。 */
  const sidebarContent = (compact: boolean) => {
    const labelsVisible = expanded || compact;
    return <Box className="sidebar-content" sx={{ width: compact ? EXPANDED_WIDTH : width }}>
    <Box className="sidebar-brand" sx={{ display: 'flex', alignItems: 'center', gap: 1, minHeight: 72, px: compact ? 1.5 : expanded ? 1.5 : 0.5 }}>
      {(compact || expanded) ? <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography className="sidebar-brand-name" noWrap>Aeris Health</Typography>
        <Typography className="sidebar-brand-subtitle" noWrap>Order Management</Typography>
      </Box> : <Typography className="sidebar-brand-mark" aria-label="Aeris Health">AH</Typography>}
      {compact
        ? <IconButton aria-label="Close navigation" onClick={() => setMobileOpen(false)} size="small"><MenuIcon fontSize="small"/></IconButton>
        : <Tooltip title={expanded ? 'Collapse sidebar' : 'Expand sidebar'} placement="right">
            <IconButton aria-label={expanded ? 'Collapse sidebar' : 'Expand sidebar'} onClick={toggleExpanded} size="small">
              {expanded ? <ChevronLeft fontSize="small"/> : <ChevronRight fontSize="small"/>}
            </IconButton>
          </Tooltip>}
    </Box>
    <Divider/>
    <List className="sidebar-navigation" disablePadding sx={{ pt: 1.25 }}>
      {primaryItems.map(item => <Box key={item.path}>{renderLink(item, false, compact)}</Box>)}
      <Divider sx={{ my: 1.25, mx: 1.5 }}/>
      <Tooltip title={!expanded && !compact ? 'API Testing' : ''} placement="right">
        <ListItemButton
          className="sidebar-link sidebar-group-toggle"
          selected={apiRouteActive}
          onClick={() => {
            if (!expanded && !compact) {
              expandSidebar();
              setApiOpen(true);
            } else {
              setApiOpen(open => !open);
            }
          }}
          aria-label="API Testing"
          aria-expanded={apiOpen}
          sx={{
            minHeight: 42, mx: 0.75, mb: 0.5, borderRadius: 1,
            justifyContent: expanded ? 'initial' : 'center', px: expanded ? 1.4 : 1,
            color: apiRouteActive ? 'primary.main' : 'text.secondary',
            '& .MuiListItemIcon-root': { minWidth: expanded ? 38 : 0, color: 'inherit' },
            '&.Mui-selected': { bgcolor: 'rgba(101, 82, 127, 0.07)' },
          }}
        >
          <ListItemIcon><Science fontSize="small"/></ListItemIcon>
          {labelsVisible && <><ListItemText primary={<Typography sx={{ fontSize: 13, fontWeight: apiRouteActive ? 650 : 500 }}>API Testing</Typography>}/>{apiOpen ? <ExpandLess fontSize="small"/> : <ExpandMore fontSize="small"/>}</>}
        </ListItemButton>
      </Tooltip>
      <Collapse in={apiOpen && labelsVisible} timeout="auto" unmountOnExit>
        <List disablePadding>{apiItems.map(item => <Box key={item.path}>{renderLink(item, true, compact)}</Box>)}</List>
      </Collapse>
    </List>
  </Box>;
  };

  return <>
    {isMobile ? <>
      <Box className="mobile-sidebar-bar">
        <IconButton aria-label="Open navigation" onClick={() => setMobileOpen(true)}><MenuIcon/></IconButton>
        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>Aeris Health</Typography>
      </Box>
      <Drawer
        variant="temporary"
        open={mobileOpen}
        onClose={() => setMobileOpen(false)}
        ModalProps={{ keepMounted: true }}
        sx={{ '& .MuiDrawer-paper': { width: EXPANDED_WIDTH, boxSizing: 'border-box', bgcolor: 'background.paper' } }}
      >{sidebarContent(true)}</Drawer>
    </> : <Drawer
      variant="permanent"
      open
      className={`app-sidebar${expanded ? ' is-expanded' : ' is-collapsed'}`}
      sx={{
        width, flexShrink: 0,
        '& .MuiDrawer-paper': { position: 'relative', width, boxSizing: 'border-box', overflowX: 'hidden', bgcolor: 'background.paper', transition: theme.transitions.create('width', { duration: theme.transitions.duration.shorter }) },
      }}
    >{sidebarContent(false)}</Drawer>}
  </>;
}
