import { useEffect, useId, useRef, type PointerEvent, type ReactNode } from 'react';
import { X } from 'lucide-react';
import './Modal.css';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  size?: 'sm' | 'md' | 'lg';
  closedby?: 'any' | 'closerequest' | 'none';
  footer?: ReactNode;
  children: ReactNode;
}

const supportsNativeClosedBy = (): boolean =>
  typeof HTMLDialogElement !== 'undefined' && 'closedBy' in HTMLDialogElement.prototype;

const isOutsideBoundingRect = (el: HTMLElement, clientX: number, clientY: number): boolean => {
  const rect = el.getBoundingClientRect();
  return (
    clientX < rect.left ||
    clientX > rect.right ||
    clientY < rect.top ||
    clientY > rect.bottom
  );
};

/**
 * Firefox/Safari 등 allow-discrete / @starting-style 닫힘 전환 미지원 환경에서도
 * 닫힘 애니메이션이 완료된 뒤 top-layer에서 제거되도록 대기하는 헬퍼.
 */
function closeTopLayer(element: HTMLDialogElement): void {
  if (!element.open || element.hasAttribute('data-closing')) return;

  element.setAttribute('data-closing', '');
  const animations = typeof element.getAnimations === 'function' ? element.getAnimations() : [];

  if (animations.length === 0) {
    element.close();
    element.removeAttribute('data-closing');
    return;
  }

  Promise.allSettled(animations.map((anim) => anim.finished)).then(() => {
    if (element.hasAttribute('data-closing')) {
      if (element.open) {
        element.close();
      }
      element.removeAttribute('data-closing');
    }
  });
}

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  size = 'md',
  closedby = 'any',
  footer,
  children,
}: ModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const startedOutsideRef = useRef(false);
  const openRef = useRef(open);
  const titleId = useId();
  const subtitleId = useId();

  useEffect(() => {
    openRef.current = open;
  }, [open]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open) {
      dialog.removeAttribute('data-closing');
      if (!dialog.open) {
        dialog.showModal();
      }
    } else if (dialog.open) {
      closeTopLayer(dialog);
    }
  }, [open]);

  const handleCancel = (e: React.SyntheticEvent<HTMLDialogElement>) => {
    e.preventDefault();
    if (closedby === 'none') return;
    onClose();
  };

  const handleNativeClose = () => {
    const dialog = dialogRef.current;
    if (dialog) {
      dialog.removeAttribute('data-closing');
    }
    if (openRef.current) {
      onClose();
    }
  };

  // closedby 속성 미지원 브라우저(Safari 등)용 라이트 디스미스 폴백
  const handlePointerDown = (e: PointerEvent<HTMLDialogElement>) => {
    if (closedby !== 'any' || supportsNativeClosedBy()) {
      startedOutsideRef.current = false;
      return;
    }
    const dialog = dialogRef.current;
    if (!dialog || e.target !== dialog) {
      startedOutsideRef.current = false;
      return;
    }
    startedOutsideRef.current = isOutsideBoundingRect(dialog, e.clientX, e.clientY);
  };

  const handlePointerUp = (e: PointerEvent<HTMLDialogElement>) => {
    if (!startedOutsideRef.current) return;
    startedOutsideRef.current = false;

    if (closedby !== 'any' || supportsNativeClosedBy()) return;
    const dialog = dialogRef.current;
    if (!dialog || e.target !== dialog) return;

    if (isOutsideBoundingRect(dialog, e.clientX, e.clientY)) {
      onClose();
    }
  };

  const handlePointerCancel = () => {
    startedOutsideRef.current = false;
  };

  const closedByProps = { closedby } as Record<string, string>;

  return (
    <dialog
      ref={dialogRef}
      {...closedByProps}
      className={`ui-modal ui-modal--${size}`}
      aria-labelledby={titleId}
      aria-describedby={subtitle ? subtitleId : undefined}
      onCancel={handleCancel}
      onClose={handleNativeClose}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
    >
      <div className="ui-modal-surface">
        <header className="ui-modal-header">
          <div className="ui-modal-titles">
            <h2 id={titleId} className="ui-modal-title">
              {title}
            </h2>
            {subtitle && (
              <p id={subtitleId} className="ui-modal-subtitle">
                {subtitle}
              </p>
            )}
          </div>
          {closedby !== 'none' && (
            <button
              type="button"
              className="ui-icon-btn ui-modal-close"
              onClick={onClose}
              aria-label="닫기"
            >
              <X size={18} aria-hidden="true" />
            </button>
          )}
        </header>

        <div className="ui-modal-body">{children}</div>

        {footer && <footer className="ui-modal-footer">{footer}</footer>}
      </div>
    </dialog>
  );
}
