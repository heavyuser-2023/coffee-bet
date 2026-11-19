import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuthActions } from '@convex-dev/auth/react';
import { Capacitor } from '@capacitor/core';
import { Browser } from '@capacitor/browser';
import { useQuery } from 'convex/react';
import { api } from '../convex/_generated/api';
import type { GameMode, GameState, Player, TrajectoryFrame } from './types';
import { rollRandomAmounts } from './game/amounts';
import { AppHeader } from './components/AppHeader';
import { ReplayListModal } from './components/ReplayListModal';
import { SetupScreen } from './components/SetupScreen';
import { RaceScreen } from './components/RaceScreen';
import { ReplayScreen } from './components/ReplayScreen';
import { ResultScreen } from './components/ResultScreen';
import { StatsModal } from './components/StatsModal';
import { Toast, type ToastTone } from './components/ui/Toast';
import './App.css';

// PWA 설치 프롬프트 이벤트를 위한 타입 확장
interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{
    outcome: 'accepted' | 'dismissed';
    platform: string;
  }>;
  prompt(): Promise<void>;
}

const DEFAULT_PLAYERS: Player[] = [
  { id: '1', name: '참가자 1' },
  { id: '2', name: '참가자 2' },
];

function getInitialReplayId(): string | null {
  const params = new URLSearchParams(window.location.search);
  return params.get('replay');
}

function getInitialPlayers(): Player[] {
  const pending = localStorage.getItem('coffeebet_pending_save');
  if (pending) {
    try {
      const parsed = JSON.parse(pending);
      if (parsed.players && Array.isArray(parsed.players)) {
        return parsed.players;
      }
    } catch (e) {
      console.error('임시 데이터 파싱 에러:', e);
    }
  }
  const lastParticipants = localStorage.getItem('coffeebet_last_participants');
  if (lastParticipants) {
    try {
      const parsed = JSON.parse(lastParticipants);
      if (
        Array.isArray(parsed) &&
        parsed.length > 0 &&
        parsed.every((p) => p && typeof p.id === 'string' && typeof p.name === 'string')
      ) {
        return parsed;
      }
    } catch (e) {
      console.error('마지막 참가자 파싱 에러:', e);
    }
  }
  return DEFAULT_PLAYERS;
}

function getInitialTotalAmount(): number {
  const pending = localStorage.getItem('coffeebet_pending_save');
  if (pending) {
    try {
      const parsed = JSON.parse(pending);
      if (typeof parsed.totalAmount === 'number') {
        return parsed.totalAmount;
      }
    } catch (e) {
      console.error('임시 데이터 파싱 에러:', e);
    }
  }
  return 10000;
}

function getInitialGameMode(): GameMode {
  const pending = localStorage.getItem('coffeebet_pending_save');
  if (pending) {
    try {
      const parsed = JSON.parse(pending);
      if (parsed.gameMode === 'all-in' || parsed.gameMode === 'random') {
        return parsed.gameMode;
      }
    } catch (e) {
      console.error('임시 데이터 파싱 에러:', e);
    }
  }
  return 'all-in';
}

function getOrCreateDeviceId(): string {
  let id = localStorage.getItem('coffeebet_device_id');
  if (!id) {
    id = 'dev_' + Math.random().toString(36).substring(2, 11) + '_' + Date.now().toString(36);
    localStorage.setItem('coffeebet_device_id', id);
  }
  return id;
}

function App() {
  const { signIn } = useAuthActions();

  const [replayId, setReplayId] = useState<string | null>(getInitialReplayId);
  const [gameState, setGameState] = useState<GameState>(() =>
    getInitialReplayId() ? 'replay' : 'setup',
  );
  const [players, setPlayers] = useState<Player[]>(getInitialPlayers);
  const [totalAmount, setTotalAmount] = useState<number>(getInitialTotalAmount);
  const [gameMode, setGameMode] = useState<GameMode>(getInitialGameMode);

  const [amountsPool, setAmountsPool] = useState<number[]>([]);
  const [raceResults, setRaceResults] = useState<string[]>([]);
  const [trajectory, setTrajectory] = useState<TrajectoryFrame[]>([]);
  const [videoBlob, setVideoBlob] = useState<Blob | null>(null);
  const [deviceId] = useState<string>(getOrCreateDeviceId);

  const [isReplayModalOpen, setIsReplayModalOpen] = useState(false);
  const [isStatsModalOpen, setIsStatsModalOpen] = useState(false);

  const [toast, setToast] = useState<{ message: string | null; tone: ToastTone }>({
    message: null,
    tone: 'default',
  });
  const toastTimerRef = useRef<number | null>(null);

  const notify = useCallback((message: string, tone: ToastTone = 'default') => {
    setToast({ message, tone });
    if (toastTimerRef.current !== null) {
      window.clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = window.setTimeout(() => {
      setToast((prev) => ({ ...prev, message: null }));
      toastTimerRef.current = null;
    }, 3600);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current !== null) {
        window.clearTimeout(toastTimerRef.current);
      }
    };
  }, []);

  const replayData = useQuery(api.replays.getReplay, replayId ? { id: replayId } : 'skip');

  const parsedReplayTrajectory = useMemo<TrajectoryFrame[] | null>(() => {
    if (!replayData?.trajectory) return null;
    try {
      const parsed = JSON.parse(replayData.trajectory);
      return Array.isArray(parsed) ? (parsed as TrajectoryFrame[]) : null;
    } catch (e) {
      console.error('리플레이 궤적 파싱 에러:', e);
      return null;
    }
  }, [replayData]);

  // 참가자 목록을 로컬에 영속화 (다음 실행 시 자동 복원)
  useEffect(() => {
    try {
      localStorage.setItem('coffeebet_last_participants', JSON.stringify(players));
    } catch (e) {
      console.error('마지막 참가자 저장 에러:', e);
    }
  }, [players]);

  // 유효하지 않은 리플레이 링크 감지 시 정리 및 안내
  useEffect(() => {
    if (replayId && replayData === null) {
      window.history.replaceState({}, document.title, window.location.pathname);
      const timerId = window.setTimeout(() => {
        notify('유효하지 않은 리플레이 링크입니다.', 'error');
        setReplayId(null);
        setGameState('setup');
      }, 0);
      return () => window.clearTimeout(timerId);
    }
  }, [replayData, replayId, notify]);

  const handleSignIn = async () => {
    try {
      const isNative = Capacitor.isNativePlatform();
      const redirectTo = isNative
        ? 'com.heavyuser73.coffeebet://callback'
        : window.location.origin + window.location.pathname;

      if (isNative) {
        Object.defineProperty(navigator, 'product', {
          value: 'ReactNative',
          configurable: true,
        });
      }

      let result: { signingIn: boolean; redirect?: URL } | undefined;
      try {
        result = await signIn('google', { redirectTo });
      } finally {
        if (isNative) {
          Object.defineProperty(navigator, 'product', {
            value: 'Gecko',
            configurable: true,
          });
        }
      }

      if (isNative && result?.redirect) {
        const url =
          typeof result.redirect === 'string'
            ? result.redirect
            : result.redirect.toString();
        await Browser.open({ url, presentationStyle: 'popover' });
      }
    } catch (err) {
      console.error('로그인 에러:', err);
      notify('로그인 진행 중 오류가 발생했습니다.', 'error');
    }
  };

  const handleStartRace = (amounts: number[]) => {
    setAmountsPool(amounts);
    setRaceResults([]);
    setTrajectory([]);
    setVideoBlob(null);
    setGameState('race');
  };

  const handleRaceFinish = (
    results: string[],
    capturedTrajectory?: TrajectoryFrame[],
    capturedVideo?: Blob,
  ) => {
    setRaceResults(results);
    if (capturedTrajectory) {
      setTrajectory(capturedTrajectory);
    }
    setVideoBlob(capturedVideo ?? null);
    setGameState('result');
  };

  const handleRestart = () => {
    setGameState('setup');
    setAmountsPool([]);
    setRaceResults([]);
    setTrajectory([]);
    setVideoBlob(null);
  };

  const handleQuickRematch = () => {
    const nextAmounts =
      gameMode === 'all-in'
        ? players.map(() => 0)
        : rollRandomAmounts(players.length, totalAmount, amountsPool);
    setAmountsPool(nextAmounts);
    setRaceResults([]);
    setTrajectory([]);
    setVideoBlob(null);
    setGameState('race');
  };

  const handleExitReplay = () => {
    window.history.replaceState({}, document.title, window.location.pathname);
    setReplayId(null);
    setGameState('setup');
  };

  const handleSelectReplay = (id: string) => {
    setReplayId(id);
    setGameState('replay');
    const shareUrl = `${window.location.origin}${window.location.pathname}?replay=${id}`;
    window.history.replaceState({}, document.title, shareUrl);
  };

  // PWA 설치 상태 관리
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    window.addEventListener('beforeinstallprompt', handler);
    return () => {
      window.removeEventListener('beforeinstallprompt', handler);
    };
  }, []);

  const handleInstallClick = async () => {
    if (!deferredPrompt) return;

    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      notify('앱 설치가 시작되었습니다.', 'success');
    }
    setDeferredPrompt(null);
  };

  const isReplayLoading = Boolean(replayId && replayData === undefined);

  return (
    <div className="app-container">
      {!isReplayLoading && (gameState === 'setup' || gameState === 'result') && (
        <AppHeader
          gameState={gameState}
          onSignIn={handleSignIn}
          onOpenReplays={() => setIsReplayModalOpen(true)}
          onOpenStats={() => setIsStatsModalOpen(true)}
          onBack={gameState === 'result' ? handleRestart : undefined}
          onNotify={notify}
          canInstallPwa={Boolean(deferredPrompt)}
          onInstallPwa={handleInstallClick}
        />
      )}

      {isReplayLoading && (
        <div className="app-loading-state">
          <div className="app-spinner" aria-hidden="true" />
          <p className="app-loading-text">리플레이를 불러오는 중입니다...</p>
        </div>
      )}

      {!isReplayLoading && gameState === 'setup' && (
        <SetupScreen
          players={players}
          setPlayers={setPlayers}
          totalAmount={totalAmount}
          setTotalAmount={setTotalAmount}
          gameMode={gameMode}
          setGameMode={setGameMode}
          onStart={handleStartRace}
          onSignIn={handleSignIn}
          onNotify={notify}
        />
      )}

      {!isReplayLoading && gameState === 'race' && (
        <RaceScreen
          players={players}
          amountsPool={amountsPool}
          gameMode={gameMode}
          onFinish={handleRaceFinish}
          onExitRace={handleRestart}
        />
      )}

      {!isReplayLoading && gameState === 'result' && (
        <ResultScreen
          players={players}
          amountsPool={amountsPool}
          raceResults={raceResults}
          gameMode={gameMode}
          onRestart={handleRestart}
          onQuickRematch={handleQuickRematch}
          onOpenStats={() => setIsStatsModalOpen(true)}
          onSignIn={handleSignIn}
          onNotify={notify}
          trajectory={trajectory}
          videoBlob={videoBlob}
          deviceId={deviceId}
        />
      )}

      {/* 리플레이 재생: 녹화 영상이 있으면 영상을 그대로 재생(100% 동일), 없으면 궤적 기반 폴백 */}
      {!isReplayLoading && gameState === 'replay' && replayData && (
        replayData.videoUrl ? (
          <ReplayScreen
            players={replayData.players}
            videoUrl={replayData.videoUrl}
            replayId={replayId ?? undefined}
            amountsPool={replayData.amountsPool}
            raceResults={replayData.raceResults}
            trajectory={replayData.trajectory ?? undefined}
            onExitReplay={handleExitReplay}
            onNotify={notify}
          />
        ) : parsedReplayTrajectory ? (
          <RaceScreen
            players={replayData.players}
            amountsPool={replayData.amountsPool}
            gameMode={replayData.gameMode === 'random' ? 'random' : 'all-in'}
            onFinish={() => {}}
            isReplay={true}
            replayTrajectory={parsedReplayTrajectory}
            raceResults={replayData.raceResults}
            onExitReplay={handleExitReplay}
          />
        ) : null
      )}

      <ReplayListModal
        open={isReplayModalOpen}
        deviceId={deviceId}
        onClose={() => setIsReplayModalOpen(false)}
        onSelectReplay={handleSelectReplay}
      />

      <StatsModal
        open={isStatsModalOpen}
        deviceId={deviceId}
        onClose={() => setIsStatsModalOpen(false)}
        onNotify={notify}
      />

      <Toast message={toast.message} tone={toast.tone} />
    </div>
  );
}

export default App;
