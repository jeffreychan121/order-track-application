import { useCallback, useRef, useState } from 'react';
import { ConfirmDialog, type ConfirmOptions } from '../components/ConfirmDialog';

export function useConfirm() {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const resolveRef = useRef<((confirmed: boolean) => void) | null>(null);

  const confirm = useCallback((nextOptions: ConfirmOptions) => new Promise<boolean>(resolve => {
    resolveRef.current?.(false);
    resolveRef.current = resolve;
    setOptions(nextOptions);
  }), []);

  const finish = useCallback((confirmed: boolean) => {
    resolveRef.current?.(confirmed);
    resolveRef.current = null;
    setOptions(null);
  }, []);

  const dialog = options && <ConfirmDialog
    open
    {...options}
    onConfirm={() => finish(true)}
    onCancel={() => finish(false)}
  />;

  return { confirm, confirmDialog: dialog };
}
