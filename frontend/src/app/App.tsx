import { lazy, Suspense } from 'react';
import { BrowserRouter, Route, Routes, useLocation } from 'react-router-dom';
import { CircularProgress, CssBaseline, ThemeProvider, theme } from '../shared/mui';
import { AppSidebar } from '../shared/components/AppSidebar';

const AccountProductsPage = lazy(() => import('../features/api-testing/AccountProductsPage').then(module => ({ default: module.AccountProductsPage })));
const CarriersPage = lazy(() => import('../features/carriers/pages/CarriersPage').then(module => ({ default: module.CarriersPage })));
const OrderForm = lazy(() => import('../features/orders/pages/OrderDetailPage').then(module => ({ default: module.OrderForm })));
const OrdersPage = lazy(() => import('../features/orders/pages/OrdersPage').then(module => ({ default: module.OrdersPage })));
const ProductsPage = lazy(() => import('../features/products/pages/ProductsPage').then(module => ({ default: module.ProductsPage })));
const ShippingRatesPage = lazy(() => import('../features/shipping/pages/ShippingRatesPage').then(module => ({ default: module.ShippingRatesPage })));
const TrackingPage = lazy(() => import('../features/tracking/pages/TrackingPage').then(module => ({ default: module.TrackingPage })));

/** 应用根组件：提供全局主题、路由上下文和基础样式重置。 */
export function App() {
  return <ThemeProvider theme={theme}><CssBaseline/><BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><AppLayout/></BrowserRouter></ThemeProvider>;
}

/** 按 URL 选择业务页面；页面采用懒加载，切换时由 Suspense 显示加载状态。 */
function AppLayout() {
  const location = useLocation();
  return <div className="erp-app">
    <AppSidebar/>
    <main className="workspace">
      <Suspense fallback={<div className="page-loading" role="status"><CircularProgress size={22}/><span>Loading page…</span></div>}>
        <Routes>
          <Route path="/" element={<OrdersPage key={location.pathname}/>}/>
          <Route path="/orders" element={<OrdersPage key={location.pathname}/>}/>
          <Route path="/orders/new" element={<OrderForm key="new" productsKey={0}/>}/>
          <Route path="/orders/:id" element={<OrderForm key={location.pathname} productsKey={0}/>}/>
          <Route path="/products" element={<ProductsPage key={location.pathname}/>}/>
          <Route path="/tracking" element={<TrackingPage key={location.pathname}/>}/>
          <Route path="/shipping-rates" element={<ShippingRatesPage key={location.pathname}/>}/>
          <Route path="/api-testing/accounts" element={<AccountProductsPage key={location.pathname}/>}/>
          <Route path="/carriers" element={<CarriersPage key={location.pathname}/>}/>
          <Route path="*" element={<OrdersPage key={location.pathname}/>}/>
        </Routes>
      </Suspense>
    </main>
  </div>;
}
