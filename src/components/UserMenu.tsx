import { useConvexAuth } from 'convex/react';
import { useAuthActions } from '@convex-dev/auth/react';
import { LogIn, LogOut, User } from 'lucide-react';
import './UserMenu.css';

export function UserMenu() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const { signIn, signOut } = useAuthActions();

  if (isLoading) {
    return <div className="user-menu-invisible">Loading...</div>;
  }

  return (
    <div className="user-menu-container">
      {isAuthenticated ? (
        <div className="user-info-group">
          <div className="user-badge">
            <User size={14} className="icon-mr-sm" /> 로그인됨
          </div>
          <button className="btn-icon-small btn-logout" onClick={() => signOut()} title="로그아웃">
            <LogOut size={16} />
          </button>
        </div>
      ) : (
        <button className="btn-login-small" onClick={async () => {
          try {
            const result = await signIn("google", { redirectTo: "/" });
            if (result && typeof result === 'object') {
              const res = result as any;
              if (res.redirect) {
                const url = typeof res.redirect === 'string' 
                  ? res.redirect 
                  : res.redirect.toString();
                window.location.href = url;
              }
            }
          } catch (err) {
            console.error("로그인 에러:", err);
          }
        }}>
          <LogIn size={16} className="icon-mr" /> 로그인
        </button>
      )}
    </div>
  );
}
