import { useState } from 'react';
import { useConvexAuth, useMutation } from 'convex/react';
import { useAuthActions } from '@convex-dev/auth/react';
import { LogIn, LogOut, User, Trash2 } from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { Browser } from '@capacitor/browser';
import { api } from '../../convex/_generated/api';
import './UserMenu.css';

export function UserMenu() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const { signIn, signOut } = useAuthActions();
  const deleteAccount = useMutation(api.users.deleteAccount);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  if (isLoading) {
    return <div className="user-menu-invisible">Loading...</div>;
  }

  const handleSignIn = async () => {
    try {
      const result = await signIn("google", { redirectTo: "/" });
      if (result && typeof result === 'object') {
        const res = result as any;
        if (res.redirect) {
          const url = typeof res.redirect === 'string'
            ? res.redirect
            : res.redirect.toString();

          // 네이티브 앱에서는 인앱 브라우저 사용 (Apple 심사 Guideline 4 준수)
          if (Capacitor.isNativePlatform()) {
            await Browser.open({ url, presentationStyle: 'popover' });
          } else {
            window.location.href = url;
          }
        }
      }
    } catch (err) {
      console.error("로그인 에러:", err);
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
    } catch (err) {
      console.error("계정 삭제 에러:", err);
      alert("계정 삭제 중 오류가 발생했습니다. 다시 시도해 주세요.");
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="user-menu-container">
      {isAuthenticated ? (
        <div className="user-info-group">
          <div className="user-badge">
            <User size={14} className="icon-mr-sm" /> 로그인됨
          </div>
          <button
            className="btn-icon-small btn-delete-account"
            onClick={() => setShowDeleteConfirm(true)}
            title="계정 삭제"
          >
            <Trash2 size={14} />
          </button>
          <button className="btn-icon-small btn-logout" onClick={() => signOut()} title="로그아웃">
            <LogOut size={16} />
          </button>
        </div>
      ) : (
        <button className="btn-login-small" onClick={handleSignIn}>
          <LogIn size={16} className="icon-mr" /> 로그인
        </button>
      )}

      {/* 계정 삭제 확인 모달 */}
      {showDeleteConfirm && (
        <div className="delete-modal-overlay" onClick={() => !isDeleting && setShowDeleteConfirm(false)}>
          <div className="delete-modal" onClick={(e) => e.stopPropagation()}>
            <h3>⚠️ 계정 삭제</h3>
            <p>정말 계정을 삭제하시겠습니까?<br />모든 데이터가 영구적으로 삭제되며 복구할 수 없습니다.</p>
            <div className="delete-modal-buttons">
              <button
                className="btn-cancel"
                onClick={() => setShowDeleteConfirm(false)}
                disabled={isDeleting}
              >
                취소
              </button>
              <button
                className="btn-confirm-delete"
                onClick={handleDeleteAccount}
                disabled={isDeleting}
              >
                {isDeleting ? '삭제 중...' : '계정 삭제'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
