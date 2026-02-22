import { useState, useEffect } from 'react'
import './App.css'
import { SetupScreen } from './components/SetupScreen'
import { RaceScreen } from './components/RaceScreen'
import { ResultScreen } from './components/ResultScreen'
import type { GameMode, Player, GameState } from './types'

// PWA 설치 프롬프트 이벤트를 위한 타입 확장
interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{
    outcome: 'accepted' | 'dismissed';
    platform: string;
  }>;
  prompt(): Promise<void>;
}

function App() {
  const [gameState, setGameState] = useState<GameState>('setup');
  const [players, setPlayers] = useState<Player[]>([
    { id: '1', name: '참가자 1' },
    { id: '2', name: '참가자 2' }
  ]);
  const [totalAmount, setTotalAmount] = useState<number>(10000);
  const [gameMode, setGameMode] = useState<GameMode>('all-in');
  const [amountsPool, setAmountsPool] = useState<number[]>([]);
  const [raceResults, setRaceResults] = useState<string[]>([]); // array of player ids in order of finish

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
  const [isIOS, setIsIOS] = useState(false);
  const [showIOSPrompt, setShowIOSPrompt] = useState(false);

  useEffect(() => {
    // iOS 기기 판별 로직
    const checkIsIOS = () => {
      const userAgent = window.navigator.userAgent.toLowerCase();
      return /iphone|ipad|ipod/.test(userAgent);
    };

    if (checkIsIOS()) {
      setIsIOS(true);
      
      // 이미 설치된 PWA(Standalone 모드)에서는 알림을 띄우지 않음
      const isStandalone = window.matchMedia('(display-mode: standalone)').matches || ('standalone' in window.navigator && (window.navigator as any).standalone === true);
      if (!isStandalone) {
         setShowIOSPrompt(true);
      }
    }

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
      {/* iOS 사파리용 대체 설치 안내 */}
      {showIOSPrompt && gameState === 'setup' && (
        <div className="ios-install-prompt">
          <p>내기하실 때마다 편하게 쓰시려면?</p>
          <p>1. 하단의 <strong>공유 [↑] 버튼</strong> 탭<br/>
             2. <strong>'홈 화면에 추가'</strong> 선택 📱</p>
          <button className="ios-close-btn" onClick={() => setShowIOSPrompt(false)}>✕</button>
        </div>
      )}

      {/* 안드로이드/크롬 PC용 기본 PWA 설치 유도 버튼 */}
      {deferredPrompt && !isIOS && gameState === 'setup' && (
        <button 
          onClick={handleInstallClick} 
          className="pwa-install-button"
        >
          📱 앱 설치하기
        </button>
      )}

      {gameState === 'setup' && (
        <SetupScreen 
          players={players} 
          setPlayers={setPlayers}
          totalAmount={totalAmount}
          setTotalAmount={setTotalAmount}
          gameMode={gameMode}
          setGameMode={setGameMode}
          onStart={handleStartRace}
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
          onRestart={handleRestart}
        />
      )}
    </div>
  )
}

export default App
