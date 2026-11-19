import { useState, useEffect } from 'react';
import { useConvexAuth, useMutation } from 'convex/react';
import { useAuthActions } from '@convex-dev/auth/react';
import { LogIn, LogOut, User, Trash2, ShieldCheck } from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { Browser } from '@capacitor/browser';
import { App as CapApp } from '@capacitor/app';
import { api } from '../../convex/_generated/api';
import { Modal } from './ui/Modal';
import { ConfirmDialog } from './ui/ConfirmDialog';
import type { ToastTone } from './ui/Toast';
import './UserMenu.css';

interface UserMenuProps {
  onSignIn: () => Promise<void>;
  onNotify: (msg: string, tone?: ToastTone) => void;
}

type CodeSignInFn = (provider: string | undefined, params: { code: string }) => Promise<unknown>;

export function UserMenu({ onSignIn, onNotify }: UserMenuProps) {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const { signIn, signOut } = useAuthActions();
  const deleteAccount = useMutation(api.users.deleteAccount);

  const [isAccountModalOpen, setIsAccountModalOpen] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // Capacitor 네이티브 앱에서 OAuth 콜백 URL 수신 처리
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    const listener = CapApp.addListener('appUrlOpen', async ({ url }) => {
      try {
        const parsedUrl = new URL(url);
        const code = parsedUrl.searchParams.get('code');
        if (code) {
          await Browser.close();
          await (signIn as unknown as CodeSignInFn)(undefined, { code });
        }
      } catch (err) {
        console.error('OAuth 콜백 처리 에러:', err);
      }
    });

    return () => {
      void listener.then((l) => l.remove());
    };
  }, [signIn]);

  if (isLoading) {
    return <div className="user-menu-skeleton" aria-hidden="true" />;
  }

  const handleSignInClick = async () => {
    setIsSigningIn(true);
    try {
      await onSignIn();
    } finally {
      setIsSigningIn(false);
    }
  };

  const handleSignOut = async () => {
    setIsSigningOut(true);
    try {
      await signOut();
      setIsAccountModalOpen(false);
      onNotify('로그아웃되었습니다.', 'default');
    } catch (err) {
      console.error('로그아웃 에러:', err);
      onNotify('로그아웃 중 오류가 발생했습니다.', 'error');
    } finally {
      setIsSigningOut(false);
    }
  };

  const handleDeleteAccount = async () => {
    setIsDeleting(true);
    try {
      await deleteAccount();
      // 계정 삭제 성공 → 클라이언트 토큰 정리 (세션이 이미 삭제되어 실패할 수 있으므로 무시)
      try {
        await signOut();
      } catch {
        // 서버 세션이 이미 삭제되었으므로 signOut 실패는 정상
      }
      setShowDeleteConfirm(false);
      setIsAccountModalOpen(false);
      onNotify('계정이 영구적으로 삭제되었습니다.', 'success');
    } catch (err) {
      console.error('계정 삭제 에러:', err);
      onNotify('계정 삭제 중 오류가 발생했습니다. 다시 시도해 주세요.', 'error');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="user-menu-container">
      {isAuthenticated ? (
        <button
          type="button"
          className="user-menu-pill user-menu-account"
          onClick={() => setIsAccountModalOpen(true)}
          aria-label="내 계정 메뉴 열기"
        >
          <span className="user-menu-status-dot" aria-hidden="true" />
          <User size={15} aria-hidden="true" />
          <span>내 계정</span>
        </button>
      ) : (
        <button
          type="button"
          className="user-menu-pill user-menu-login"
          onClick={handleSignInClick}
          disabled={isSigningIn}
        >
          <LogIn size={15} aria-hidden="true" />
          <span>{isSigningIn ? '연결 중...' : '로그인'}</span>
        </button>
      )}

      {/* 계정 메뉴 모달 */}
      <Modal
        open={isAccountModalOpen}
        onClose={() => setIsAccountModalOpen(false)}
        title="내 계정"
        size="sm"
      >
        <div className="account-modal-content">
          <div className="account-status-card">
            <div className="account-status-badge">
              <ShieldCheck size={16} aria-hidden="true" />
              <span>Google 계정 연결됨</span>
            </div>
            <p className="account-status-desc">
              저장한 참가자 그룹, 당첨 통계 및 리플레이가 계정에 안전하게 동기화됩니다.
            </p>
          </div>

          <div className="account-modal-actions">
            <button
              type="button"
              className="ui-btn ui-btn-secondary"
              onClick={handleSignOut}
              disabled={isSigningOut}
            >
              <LogOut size={16} aria-hidden="true" />
              <span>{isSigningOut ? '로그아웃 중...' : '로그아웃'}</span>
            </button>

            <button
              type="button"
              className="ui-btn ui-btn-danger-soft"
              onClick={() => {
                setIsAccountModalOpen(false);
                setShowDeleteConfirm(true);
              }}
            >
              <Trash2 size={16} aria-hidden="true" />
              <span>계정 삭제</span>
            </button>
          </div>
        </div>
      </Modal>

      {/* 계정 삭제 확인 다이얼로그 */}
      <ConfirmDialog
        open={showDeleteConfirm}
        title="계정을 삭제할까요?"
        description={
          '정말 계정을 삭제하시겠습니까?\n저장된 참가자 그룹과 게임 기록 등 모든 데이터가 영구적으로 삭제되며 복구할 수 없습니다.'
        }
        confirmLabel="계정 삭제"
        cancelLabel="취소"
        variant="danger"
        isLoading={isDeleting}
        onConfirm={handleDeleteAccount}
        onCancel={() => {
          if (!isDeleting) setShowDeleteConfirm(false);
        }}
      />
    </div>
  );
}
