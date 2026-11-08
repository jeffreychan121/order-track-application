import type { ReactNode } from 'react';

/** 统一业务页标题层级；页面操作可选放在标题右侧。 */
export function PageHeading({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return <div className="page-heading"><div><span className="page-eyebrow">ORDER MANAGEMENT</span><h1>{title}</h1>{subtitle && <p>{subtitle}</p>}</div>{action}</div>;
}
