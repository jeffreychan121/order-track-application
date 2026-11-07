import type { ReactNode } from 'react';
import { Box } from '@mui/material';

interface ApiTestingPageShellProps {
  title: string;
  description: string;
  children: ReactNode;
}

/** 统一 API 测试页面的标题与说明；查询条件放在标题下方的页面内容中。 */
export function ApiTestingPageShell({ title, description, children }: ApiTestingPageShellProps) {
  return <>
    <div className="page-heading api-testing-page-heading">
      <div>
        <span className="page-eyebrow">API TESTING</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
    </div>
    <Box className="api-testing-page-content">{children}</Box>
  </>;
}
