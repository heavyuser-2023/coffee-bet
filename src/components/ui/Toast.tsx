import { useEffect, useRef } from 'react';
import { AlertCircle, CheckCircle2, Info } from 'lucide-react';
import './Toast.css';

export type ToastTone = 'default' | 'success' | 'error';

export interface ToastProps {
  message: string | null;
  tone?: ToastTone;
}

const supportsPopover = (): boolean =>
  typeof HTMLElement !== 'undefined' && 'showPopover' in HTMLElement.prototype;

export function Toast({ message, tone = 'default' }: ToastProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Popover Top-Layer 지원 시 열린 <dialog> 위에서도 토스트가 가려지지 않도록 표시
  useEffect(() => {
    const el = containerRef.current as (HTMLDivElement & {
      showPopover?: () => void;
      hidePopover?: () => void;
    }) | null;
    if (!el || !supportsPopover()) return;

    if (message) {
      try {
        el.showPopover?.();
      } catch {
        // 이미 top-layer에 열려 있는 상태 등은 무시
      }
    } else {
      try {
        el.hidePopover?.();
      } catch {
        // 이미 닫혀 있는 경우 무시
      }
    }
  }, [message]);

  const popoverAttr = supportsPopover() ? { popover: 'manual' as const } : {};

  return (
    <div
      ref={containerRef}
      {...popoverAttr}
      className={`ui-toast-host ${message ? 'is-visible' : ''}`}
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      {message && (
        <div className={`ui-toast ui-toast--${tone}`}>
          <span className="ui-toast-icon" aria-hidden="true">
            {tone === 'success' ? (
              <CheckCircle2 size={17} />
            ) : tone === 'error' ? (
              <AlertCircle size={17} />
            ) : (
              <Info size={17} />
            )}
          </span>
          <span className="ui-toast-text">{message}</span>
        </div>
      )}
    </div>
  );
}
