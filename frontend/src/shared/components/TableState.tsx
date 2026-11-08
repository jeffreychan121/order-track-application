import type { ReactNode } from 'react';
import { Box, CircularProgress, Paper, TableContainer, Typography } from '@mui/material';

interface TableStateProps {
  children: ReactNode;
  loading: boolean;
  empty: boolean;
  emptyText: string;
}

/** 统一表格的加载、空数据和内容状态，避免各页状态切换样式不一致。 */
export function TableState({ children, loading, empty, emptyText }: TableStateProps) {
  return <Paper variant="outlined" sx={{ overflow: 'hidden' }} aria-busy={loading}>
    {loading ? <Box sx={{ p: 6, textAlign: 'center' }} role="status" aria-label="Loading table"><CircularProgress size={28}/></Box>
      : empty ? <Box sx={{ p: 5, textAlign: 'center' }}><Typography color="text.secondary">{emptyText}</Typography></Box>
        : <TableContainer sx={{ overflowX: 'auto' }}>{children}</TableContainer>}
  </Paper>;
}
