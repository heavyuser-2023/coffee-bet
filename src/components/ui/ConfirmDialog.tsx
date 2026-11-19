import { useEffect, useRef } from 'react';
import { Modal } from './Modal';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'primary';
  isLoading?: boolean;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = '확인',
  cancelLabel = '취소',
  variant = 'primary',
  isLoading = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const cancelBtnRef = useRef<HTMLButtonElement>(null);

  // 이미 마운트된 dialog가 재오픈될 때도 danger 변형이면 취소 버튼으로 초기 포커스 보장
  useEffect(() => {
    if (!open || variant !== 'danger') return;
    const rafId = window.requestAnimationFrame(() => {
      cancelBtnRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(rafId);
  }, [open, variant]);

  const handleClose = () => {
    if (!isLoading) {
      onCancel();
    }
  };

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={title}
      size="sm"
      closedby={isLoading ? 'none' : 'any'}
      footer={
        <>
          <button
            ref={cancelBtnRef}
            type="button"
            className="ui-btn ui-btn-secondary"
            onClick={handleClose}
            disabled={isLoading}
            autoFocus={variant === 'danger'}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className={variant === 'danger' ? 'ui-btn ui-btn-danger' : 'ui-btn ui-btn-primary'}
            onClick={() => void onConfirm()}
            disabled={isLoading}
          >
            {isLoading ? '처리 중...' : confirmLabel}
          </button>
        </>
      }
    >
      <p className="ui-confirm-desc">{description}</p>
    </Modal>
  );
}
