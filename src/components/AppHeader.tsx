import type { ReactNode } from 'react';
import { ArrowLeft, BarChart3, Coffee, Download, History } from 'lucide-react';
import type { GameState } from '../types';
import { UserMenu } from './UserMenu';
import type { ToastTone } from './ui/Toast';
import './AppHeader.css';

export interface AppHeaderProps {
  gameState: GameState;
  onSignIn: () => Promise<void>;
  onOpenReplays: () => void;
  onOpenStats: () => void;
  onBack?: () => void;
  onNotify: (msg: string, tone?: ToastTone) => void;
  canInstallPwa?: boolean;
  onInstallPwa?: () => void;
  titleOverride?: string;
  rightSlot?: ReactNode;
}

export function AppHeader({
  gameState,
  onSignIn,
  onOpenReplays,
  onOpenStats,
  onBack,
  onNotify,
  canInstallPwa = false,
  onInstallPwa,
  titleOverride,
  rightSlot,
}: AppHeaderProps) {
  if (gameState === 'setup') {
    return (
      <header className="app-header app-header--setup">
        <div className="app-brand">
          <span className="app-brand-icon" aria-hidden="true">
            <Coffee size={17} strokeWidth={2.4} />
          </span>
          <span className="app-brand-name">Coffee Bet</span>
        </div>

        <div className="app-header-actions">
          <button
            type="button"
            className="ui-icon-btn app-header-icon-btn"
            onClick={onOpenStats}
            aria-label="당첨 통계"
            title="당첨 통계"
          >
            <BarChart3 size={18} aria-hidden="true" />
          </button>

          <button
            type="button"
            className="ui-icon-btn app-header-icon-btn"
            onClick={onOpenReplays}
            aria-label="리플레이 목록"
            title="리플레이 목록"
          >
            <History size={18} aria-hidden="true" />
          </button>

          {canInstallPwa && onInstallPwa && (
            <button
              type="button"
              className="app-install-btn"
              onClick={onInstallPwa}
              aria-label="앱 설치"
              title="앱 설치"
            >
              <Download size={16} aria-hidden="true" />
              <span className="app-install-label">앱 설치</span>
            </button>
          )}

          <UserMenu onSignIn={onSignIn} onNotify={onNotify} />
          {rightSlot}
        </div>
      </header>
    );
  }

  if (gameState === 'result') {
    return (
      <header className="app-header app-header--split">
        <div className="app-header-left">
          {onBack && (
            <button
              type="button"
              className="app-header-text-btn"
              onClick={onBack}
            >
              <ArrowLeft size={17} aria-hidden="true" />
              <span>설정</span>
            </button>
          )}
        </div>

        <h1 className="app-header-center-title">
          {titleOverride ?? '최종 결과'}
        </h1>

        <div className="app-header-right">
          <button
            type="button"
            className="app-header-stat-btn"
            onClick={onOpenStats}
            aria-label="당첨 통계"
            title="당첨 통계"
          >
            <BarChart3 size={17} aria-hidden="true" />
            <span className="app-header-stat-label">당첨 통계</span>
          </button>
          {rightSlot}
        </div>
      </header>
    );
  }

  return (
    <header className="app-header app-header--split">
      <div className="app-header-left">
        {onBack && (
          <button
            type="button"
            className="app-header-text-btn"
            onClick={onBack}
          >
            <ArrowLeft size={17} aria-hidden="true" />
            <span>뒤로</span>
          </button>
        )}
      </div>

      <h1 className="app-header-center-title">
        {titleOverride ?? (gameState === 'race' ? '마블 레이스' : '리플레이')}
      </h1>

      <div className="app-header-right">{rightSlot}</div>
    </header>
  );
}
