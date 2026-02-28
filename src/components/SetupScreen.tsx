import { useState, useEffect } from 'react';
import type { Player, GameMode } from '../types';
import './SetupScreen.css';
import { Users, Plus, X, Shuffle, DollarSign, Play } from 'lucide-react';

interface Props {
  players: Player[];
  setPlayers: (players: Player[]) => void;
  totalAmount: number;
  setTotalAmount: (amount: number) => void;
  gameMode: GameMode;
  setGameMode: (mode: GameMode) => void;
  onStart: (amounts: number[]) => void;
}

export function SetupScreen({
  players,
  setPlayers,
  totalAmount,
  setTotalAmount,
  gameMode,
  setGameMode,
  onStart
}: Props) {
  const [randomAmountsPool, setRandomAmountsPool] = useState<number[]>([]);
  const [isCalculating, setIsCalculating] = useState(false);

  // 랜덤 금액 분배 로직 (순위별 금액 풀 생성)
  const calculateRandomAmounts = () => {
    setIsCalculating(true);
    
    setTimeout(() => {
      let weights = players.map(() => Math.random() + 0.1); 
      let weightSum = weights.reduce((a, b) => a + b, 0);
      
      let currentSum = 0;
      const amounts: number[] = [];
      
      for (let i = 0; i < players.length - 1; i++) {
        let rawAmount = (weights[i] / weightSum) * totalAmount;
        let amount = Math.round(rawAmount / 100) * 100;
        amounts.push(amount);
        currentSum += amount;
      }
      
      let lastAmount = totalAmount - currentSum;
      if (lastAmount < 0) {
        return calculateRandomAmounts(); 
      }
      amounts.push(lastAmount);
      
      // 내림차순(가장 많은 금액을 꼴찌나 1등이 낼 수 있게 자유롭게 정렬, 혹은 게임 재미를 위해 섞거나 내림차순 정렬)
      amounts.sort((a, b) => b - a);
      
      setRandomAmountsPool(amounts);
      setIsCalculating(false);
    }, 400); 
  };

  useEffect(() => {
    if (gameMode === 'random') {
      calculateRandomAmounts();
    } else {
      setRandomAmountsPool([]);
    }
  }, [gameMode, players.length, totalAmount]); 

  const handleAddPlayer = () => {
    if (players.length >= 20) return;
    const newId = Date.now().toString();
    setPlayers([...players, { id: newId, name: `참가자 ${players.length + 1}` }]);
  };

  const handleRemovePlayer = (id: string) => {
    if (players.length <= 2) return;
    setPlayers(players.filter(p => p.id !== id));
  };

  const updatePlayerName = (id: string, name: string) => {
    setPlayers(players.map(p => p.id === id ? { ...p, name } : p));
  };

  const handleStart = () => {
    if (totalAmount <= 0) {
      alert("금액을 입력해주세요.");
      return;
    }
    
    let finalAmounts: number[] = [];
    if (gameMode === 'all-in') {
      // 몰빵의 경우: 1명만 전체 금액을 내게 하거나 (게임상 꼴찌), 배열을 만들면
      // 마지막 순위 배열 슬롯에 totalAmount를 넣음 (1등: 0, 2등: 0 ... 꼴등: totalAmount)
      finalAmounts = players.map((_, i) => (i === players.length - 1 ? totalAmount : 0));
    } else {
      // 랜덤일 경우 그대로 전달 (내림차순 되어있음: 1등, 2등... 순위에 매핑할 수 있음)
      finalAmounts = randomAmountsPool;
      // 재미를 위해 배열을 랜덤하게 섞어서 슬롯에 할당할수도 있음. 
      // 이 앱에서는 내림차순으로 주고 레이스 도착 순서(혹은 슬롯)에 따라 결과 매핑
    }
    
    onStart(finalAmounts);
  };

  return (
    <div className="setup-container">
      <div className="header">
        <h1>Coffee Bet</h1>
        <p>오늘의 커피, 누가 쏠까?</p>
      </div>

      <div className="glass-panel setup-panel">
        <div className="section">
          <h2>
            <DollarSign className="icon" /> 총 금액 설정
          </h2>
          <div className="input-group">
            <input 
              type="number" 
              value={totalAmount || ''}
              onChange={(e) => setTotalAmount(parseInt(e.target.value) || 0)}
              placeholder="예: 15000"
              min="0"
              step="100"
            />
            <span className="currency">원</span>
          </div>
        </div>

        <div className="section">
          <div className="section-header">
            <h2>
              <Users className="icon" /> 참가자 ({players.length}/20)
            </h2>
            {players.length < 20 && (
              <button className="btn-icon btn-add" onClick={handleAddPlayer}>
                <Plus size={18} />
              </button>
            )}
          </div>
          
          <div className="player-list">
            {players.map((p, index) => (
              <div key={p.id} className="player-item fadeIn">
                <div className="player-number">{index + 1}</div>
                <input 
                  type="text" 
                  value={p.name}
                  onChange={(e) => updatePlayerName(p.id, e.target.value)}
                  placeholder="이름"
                />
                {players.length > 2 && (
                  <button className="btn-icon btn-remove" onClick={() => handleRemovePlayer(p.id)}>
                    <X size={16} />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="section">
          <h2>게임 모드</h2>
          <div className="mode-toggle">
            <button 
              className={`mode-btn ${gameMode === 'all-in' ? 'active' : ''}`}
              onClick={() => setGameMode('all-in')}
            >
              🔥 한 명 몰빵
            </button>
            <button 
              className={`mode-btn ${gameMode === 'random' ? 'active' : ''}`}
              onClick={() => setGameMode('random')}
            >
              🎲 랜덤 분배
            </button>
          </div>
        </div>

        {gameMode === 'random' && (
          <div className="random-preview-section fadeIn">
            <div className="preview-header">
              <h3>예상 당첨 금액 풀</h3>
              <button 
                className={`btn-refresh ${isCalculating ? 'spinning' : ''}`} 
                onClick={calculateRandomAmounts}
              >
                <Shuffle size={14} /> 재분배
              </button>
            </div>
            <div className={`preview-list ${isCalculating ? 'calculating' : ''}`}>
              <p style={{fontSize: '0.85rem', color: '#94a3b8', marginBottom: '8px'}}>마블 레이스 결과에 따라 아래 금액 중 하나에 당첨됩니다.</p>
              {randomAmountsPool.map((amt, idx) => (
                <div key={idx} className="preview-item">
                  <span className="name">{idx + 1}위 금액</span>
                  <span className="amount">
                    {amt.toLocaleString()}원
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

      </div>

      <button className="btn-primary start-btn" onClick={handleStart}>
        <Play size={20} className="icon-mr" /> 레이스 시작
      </button>
    </div>
  );
}
