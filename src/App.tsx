import { useState, useEffect } from 'react'
import './App.css'
import { SetupScreen } from './components/SetupScreen'
import { RaceScreen } from './components/RaceScreen'
import { ResultScreen } from './components/ResultScreen'
import type { GameMode, Player, GameState } from './types'
import { useAuthActions } from '@convex-dev/auth/react'
import { Capacitor } from '@capacitor/core'
import { Browser } from '@capacitor/browser'

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
    // 순위별 금액 배열 (내림차순 정렬 혹은 섞인 순서 등 상황에 맞게)
    // SetupScreen에서 이미 정해서 넘겨줌
    setAmountsPool(amounts);
    setGameState('race');
  }

  const handleRaceFinish = (results: string[]) => {
    setRaceResults(results);
    setGameState('result');
  }

  const handleRestart = () => {
    setGameState('setup');
    setAmountsPool([]);
    setRaceResults([]);
  }

  // PWA 설치 상태 관리
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    const handler = (e: Event) => {
      // Chrome에서 기본 설치 팝업이 바로 뜨는 것을 방지
      e.preventDefault();
      // 이벤트를 보관하여 나중에 버튼 클릭 시 사용
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    window.addEventListener('beforeinstallprompt', handler);

    return () => {
      window.removeEventListener('beforeinstallprompt', handler);
    };
  }, []);

  const handleInstallClick = async () => {
    if (!deferredPrompt) return;
    
    // 설치 프롬프트 띄우기
    deferredPrompt.prompt();
    
    // 사용자의 반응 응답(설치/취소) 대기
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      console.log('사용자가 앱 설치를 동의했습니다.');
    } else {
      console.log('사용자가 앱 설치를 취소했습니다.');
    }
    
    // 한 번 처리 후에는 다시 쓸 수 없으므로 초기화
    setDeferredPrompt(null);
  };

  return (
    <div className="app-container">
      {/* 설치 유도 버튼 (설치 가능한 상태일 때만 메인화면에 표시) */}
      {deferredPrompt && gameState === 'setup' && (
        <button 
          onClick={handleInstallClick} 
          className="pwa-install-button"
        >
          📱 앱 설치하기
        </button>
      )}

      {/* 상단 로그인/로그아웃 메뉴 */}
      <div className="top-menu-bar" style={{ marginTop: 'env(safe-area-inset-top)', marginBottom: '16px' }}>
        <UserMenu onSignIn={handleSignIn} />
      </div>

      {gameState === 'setup' && (
        <SetupScreen 
          players={players} 
          setPlayers={setPlayers}
          totalAmount={totalAmount}
          setTotalAmount={setTotalAmount}
          gameMode={gameMode}
          setGameMode={setGameMode}
          onStart={handleStartRace}
          onSignIn={handleSignIn}
        />
      )}
      
      {gameState === 'race' && (
        <RaceScreen 
          players={players}
          amountsPool={amountsPool}
          onFinish={handleRaceFinish}
        />
      )}

      {gameState === 'result' && (
        <ResultScreen 
          players={players}
          amountsPool={amountsPool}
          raceResults={raceResults}
          gameMode={gameMode}
          onRestart={handleRestart}
        />
      )}
    </div>
  )
}

export default App
