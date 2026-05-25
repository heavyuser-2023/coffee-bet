import { useState, useEffect } from 'react'
import './App.css'
import { SetupScreen } from './components/SetupScreen'
import { RaceScreen } from './components/RaceScreen'
import { ResultScreen } from './components/ResultScreen'
import type { GameMode, Player, GameState, TrajectoryFrame } from './types'
import { useAuthActions } from '@convex-dev/auth/react'
import { Capacitor } from '@capacitor/core'
import { Browser } from '@capacitor/browser'
import { useQuery } from 'convex/react'
import { api } from '../convex/_generated/api'

// PWA 설치 프롬프트 이벤트를 위한 타입 확장
interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{
    outcome: 'accepted' | 'dismissed';
    platform: string;
  }>;
  prompt(): Promise<void>;
}

import { UserMenu } from './components/UserMenu'

function App() {
  const { signIn } = useAuthActions();
  const [gameState, setGameState] = useState<GameState>('setup');
  const [players, setPlayers] = useState<Player[]>(() => {
    const pending = localStorage.getItem('coffeebet_pending_save');
    if (pending) {
      try {
        const parsed = JSON.parse(pending);
        if (parsed.players && Array.isArray(parsed.players)) {
          return parsed.players;
        }
      } catch (e) {
        console.error("임시 데이터 파싱 에러:", e);
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
        console.error("마지막 참가자 파싱 에러:", e);
      }
    }
    return [
      { id: '1', name: '참가자 1' },
      { id: '2', name: '참가자 2' }
    ];
  });
  const [totalAmount, setTotalAmount] = useState<number>(() => {
    const pending = localStorage.getItem('coffeebet_pending_save');
    if (pending) {
      try {
        const parsed = JSON.parse(pending);
        if (typeof parsed.totalAmount === 'number') {
          return parsed.totalAmount;
        }
      } catch (e) {
        console.error("임시 데이터 파싱 에러:", e);
      }
    }
    return 10000;
  });
  const [gameMode, setGameMode] = useState<GameMode>(() => {
    const pending = localStorage.getItem('coffeebet_pending_save');
    if (pending) {
      try {
        const parsed = JSON.parse(pending);
        if (parsed.gameMode === 'all-in' || parsed.gameMode === 'random') {
          return parsed.gameMode;
        }
      } catch (e) {
        console.error("임시 데이터 파싱 에러:", e);
      }
    }
    return 'all-in';
  });
  const [amountsPool, setAmountsPool] = useState<number[]>([]);
  const [raceResults, setRaceResults] = useState<string[]>([]); // array of player ids in order of finish
  const [trajectory, setTrajectory] = useState<TrajectoryFrame[]>([]); // 레이스 궤적 기록 저장

  // 기기 식별자 관리
  const [deviceId] = useState<string>(() => {
    let id = localStorage.getItem('coffeebet_device_id');
    if (!id) {
      id = 'dev_' + Math.random().toString(36).substring(2, 11) + '_' + Date.now().toString(36);
      localStorage.setItem('coffeebet_device_id', id);
    }
    return id;
  });

  // 리플레이용 상태 관리
  const [replayId, setReplayId] = useState<string | null>(null);
  const replayData = useQuery(api.replays.getReplay, replayId ? { id: replayId } : 'skip');

  // URL에서 리플레이 파라미터 감지
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const repId = params.get('replay');
    if (repId) {
      setReplayId(repId);
      setGameState('replay');
    }
  }, []);

  // 참가자 목록을 로컬에 영속화 (다음 실행 시 자동 복원)
  useEffect(() => {
    try {
      localStorage.setItem('coffeebet_last_participants', JSON.stringify(players));
    } catch (e) {
      console.error("마지막 참가자 저장 에러:", e);
    }
  }, [players]);

  // 리플레이 데이터 로드 감시
  useEffect(() => {
    if (replayId && replayData !== undefined) {
      if (replayData === null) {
        alert("유효하지 않은 리플레이 링크입니다.");
        // 파라미터 제거 및 화면 셋업 복원
        window.history.replaceState({}, document.title, window.location.pathname);
        setReplayId(null);
        setGameState('setup');
      }
    }
  }, [replayData, replayId]);

  const handleSignIn = async () => {
    try {
      const isNative = Capacitor.isNativePlatform();
      const redirectTo = isNative
        ? "com.heavyuser73.coffeebet://callback"
        : window.location.origin + window.location.pathname;

      if (isNative) {
        Object.defineProperty(navigator, 'product', {
          value: 'ReactNative',
          configurable: true,
        });
      }

      let result: any;
      try {
        result = await signIn("google", { redirectTo });
      } finally {
        if (isNative) {
          Object.defineProperty(navigator, 'product', {
            value: 'Gecko',
            configurable: true,
          });
        }
      }

      if (isNative && result?.redirect) {
        const url = typeof result.redirect === 'string'
          ? result.redirect
          : result.redirect.toString();
        await Browser.open({ url, presentationStyle: 'popover' });
      }
    } catch (err) {
      console.error("로그인 에러:", err);
    }
  };

  const handleStartRace = (amounts: number[]) => {
    setAmountsPool(amounts);
    setGameState('race');
  }

  const handleRaceFinish = (results: string[], capturedTrajectory?: TrajectoryFrame[]) => {
    setRaceResults(results);
    if (capturedTrajectory) {
      setTrajectory(capturedTrajectory);
    }
    setGameState('result');
  }

  const handleRestart = () => {
    setGameState('setup');
    setAmountsPool([]);
    setRaceResults([]);
    setTrajectory([]);
  }

  const handleExitReplay = () => {
    window.history.replaceState({}, document.title, window.location.pathname);
    setReplayId(null);
    setGameState('setup');
  }

  const handleSelectReplay = (id: string) => {
    setReplayId(id);
    setGameState('replay');
    const shareUrl = `${window.location.origin}${window.location.pathname}?replay=${id}`;
    window.history.replaceState({}, document.title, shareUrl);
  }

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
    
    deferredPrompt.prompt();
    
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      console.log('사용자가 앱 설치를 동의했습니다.');
    } else {
      console.log('사용자가 앱 설치를 취소했습니다.');
    }
    
    setDeferredPrompt(null);
  };

  const isReplayLoading = replayId && replayData === undefined;

  return (
    <div className="app-container">
      {/* 설치 유도 버튼 */}
      {deferredPrompt && gameState === 'setup' && (
        <button 
          onClick={handleInstallClick} 
          className="pwa-install-button"
        >
          📱 앱 설치하기
        </button>
      )}

      {/* 상단 로그인/로그아웃 메뉴 */}
      {gameState !== 'replay' && (
        <div className="top-menu-bar" style={{ marginTop: 'env(safe-area-inset-top)', marginBottom: '16px' }}>
          <UserMenu onSignIn={handleSignIn} />
        </div>
      )}

      {/* 로딩 표시 */}
      {isReplayLoading && (
        <div className="loading-container" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '80vh', gap: '20px' }}>
          <div className="spinner" style={{ width: '50px', height: '50px', border: '5px solid rgba(255,255,255,0.1)', borderTopColor: '#f59e0b', borderRadius: '50%', animation: 'spin 1s linear infinite' }}></div>
          <p style={{ color: '#94a3b8', fontSize: '1.1rem' }}>리플레이를 불러오는 중입니다...</p>
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
          deviceId={deviceId}
          onSelectReplay={handleSelectReplay}
        />
      )}
      
      {!isReplayLoading && gameState === 'race' && (
        <RaceScreen 
          players={players}
          amountsPool={amountsPool}
          onFinish={handleRaceFinish}
        />
      )}

      {!isReplayLoading && gameState === 'result' && (
        <ResultScreen 
          players={players}
          amountsPool={amountsPool}
          raceResults={raceResults}
          gameMode={gameMode}
          onRestart={handleRestart}
          trajectory={trajectory}
          deviceId={deviceId}
        />
      )}

      {!isReplayLoading && gameState === 'replay' && replayData && (
        <RaceScreen 
          players={replayData.players}
          amountsPool={replayData.amountsPool}
          onFinish={() => {}}
          isReplay={true}
          replayTrajectory={JSON.parse(replayData.trajectory)}
          raceResults={replayData.raceResults}
          onExitReplay={handleExitReplay}
        />
      )}
    </div>
  )
}

export default App;
