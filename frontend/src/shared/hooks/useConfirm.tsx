import { useCallback, useRef, useState } from 'react';
import { ConfirmDialog, type ConfirmOptions } from '../components/ConfirmDialog';

/** 将 Promise 风格的 confirm 调用桥接到共享 MUI 对话框，避免原生弹窗。 */
export function useConfirm() {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const resolveRef = useRef<((confirmed: boolean) => void) | null>(null);

  const confirm = useCallback((nextOptions: ConfirmOptions) => new Promise<boolean>(resolve => {
    // 连续触发确认时，先以取消结果收束旧 Promise，防止调用方一直等待。
    resolveRef.current?.(false);
    resolveRef.current = resolve;
    setOptions(nextOptions);
  }), []);

  const finish = useCallback((confirmed: boolean) => {
    // 先完成等待中的调用，再清空对话框状态。
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
