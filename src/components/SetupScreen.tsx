import { useState, useEffect } from 'react';
import type { Player, GameMode } from '../types';
import './SetupScreen.css';
import { Users, Plus, X, Shuffle, DollarSign, Play, DownloadCloud, Save } from 'lucide-react';
import { useQuery, useMutation, useConvexAuth } from 'convex/react';

import { api } from '../../convex/_generated/api';

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
  const { isAuthenticated } = useConvexAuth();
  // 로그인된 경우 저장된 그룹 목록을 가져옴
  const savedGroups = useQuery(api.participants.getGroups, isAuthenticated ? undefined : "skip");
  const saveGroup = useMutation(api.participants.saveGroup);
  const deleteGroup = useMutation(api.participants.deleteGroup);

  const [randomAmountsPool, setRandomAmountsPool] = useState<number[]>([]);
  const [isCalculating, setIsCalculating] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSaveModalOpen, setIsSaveModalOpen] = useState(false);
  const [saveTitle, setSaveTitle] = useState("");
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage(null);
    }, 4000); // 4초간 노출 (사용자 요청 반영: 더 오래 유지)
  };

  const handleDeleteGroup = async (id: any, title: string) => {
    if (window.confirm(`'${title}' 그룹을 삭제하시겠습니까?`)) {
      try {
        await deleteGroup({ id });
        showToast(`'${title}' (이)가 삭제되었습니다.`);
      } catch (e) {
        console.error(e);
        showToast("삭제 중 오류가 발생했습니다.");
      }
    }
  };

  const openLoadModal = () => {
    if (!isAuthenticated) {
      showToast("로그인을 하시면 저장된 참가자 그룹을 불러올 수 있습니다.");
      return;
    }
    setIsModalOpen(true);
  };

  const openSaveModal = () => {
    if (!isAuthenticated) {
      showToast("참가자를 저장하려면 상단의 로그인 버튼을 눌러주세요.");
      return;
    }
    if (players.length === 0) {
      showToast("저장할 참가자가 없습니다.");
      return;
    }
    setIsSaveModalOpen(true);
  };

  const handleSaveGroup = async () => {
    if (!saveTitle.trim()) {
      showToast("그룹 이름을 입력해주세요.");
      return;
    }
    
    try {
      await saveGroup({
        title: saveTitle.trim(),
        players: players,
      });
      showToast(`'${saveTitle}' (이)가 저장되었습니다.`);
      setSaveTitle("");
      setIsSaveModalOpen(false);
    } catch (e) {
      console.error(e);
      showToast("저장 중 오류가 발생했습니다.");
    }
  };

  const handleLoadGroup = (group: any) => {
    setPlayers(group.players);
    setIsModalOpen(false);
  };

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
          <h2>게임 모드</h2>
          <div className="mode-toggle" style={{ marginBottom: '20px' }}>
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

          <div className="section-header" style={{ marginBottom: '12px' }}>
            <h2>
              <DollarSign className="icon" /> 
              {gameMode === 'random' ? '총 금액 설정' : '결제 금액'}
            </h2>
          </div>
          
          {gameMode === 'random' ? (
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
          ) : (
            <div className="all-in-amount-display" style={{ 
              padding: '16px', 
              background: 'rgba(255, 255, 255, 0.05)', 
              borderRadius: '12px',
              textAlign: 'center',
              border: '1px solid rgba(239, 68, 68, 0.2)',
              color: '#fca5a5',
              fontWeight: '700',
              fontSize: '1.2rem'
            }}>
              꼴찌가 전액 결제! 😱
            </div>
          )}
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

      <div className="load-group-section" style={{ display: 'flex', gap: '12px' }}>
        <button className="btn-secondary load-group-btn" onClick={openLoadModal} style={{ flex: 1 }}>
          <DownloadCloud size={20} className="icon-mr" /> 불러오기
        </button>
        <button className="btn-secondary load-group-btn" onClick={openSaveModal} style={{ flex: 1 }}>
          <Save size={20} className="icon-mr" /> 저장하기
        </button>
      </div>

      <button className="btn-primary start-btn" onClick={handleStart}>
        <Play size={20} className="icon-mr" /> 레이스 시작
      </button>

      {/* 커스텀 토스트 알림 */}
      {toastMessage && (
        <div className="toast-notification fadeIn">
          {toastMessage}
        </div>
      )}

      {isModalOpen && (
        <div className="modal-overlay">
          <div className="modal-content glass-panel">
            <h3>저장된 참가자 불러오기</h3>
            {!savedGroups ? (
              <p>불러오는 중...</p>
            ) : savedGroups.length === 0 ? (
              <p>저장된 참가자 그룹이 없습니다.</p>
            ) : (
              <div className="group-list" style={{ maxHeight: '200px', overflowY: 'auto', marginBottom: '16px' }}>
                {savedGroups.map((group) => (
                  <div key={group._id} style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                    <button 
                      className="btn-outline group-item" 
                      style={{ flex: 1, textAlign: 'left', padding: '12px' }}
                      onClick={() => handleLoadGroup(group)}
                    >
                      <strong>{group.title}</strong>
                      <span style={{ fontSize: '0.8rem', color: '#9ca3af', marginLeft: '8px' }}>
                        ({group.players.length}명)
                      </span>
                    </button>
                    <button 
                      className="btn-outline" 
                      style={{ padding: '0 16px', background: 'rgba(239, 68, 68, 0.1)', borderColor: 'rgba(239, 68, 68, 0.2)', color: '#ef4444' }}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteGroup(group._id, group.title);
                      }}
                      title="그룹 삭제"
                    >
                      <X size={18} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="modal-actions" style={{ justifyContent: 'center' }}>
              <button className="btn-close" onClick={() => setIsModalOpen(false)}>닫기</button>
            </div>
          </div>
        </div>
      )}

      {/* 저장 전용 모달 */}
      {isSaveModalOpen && (
        <div className="modal-overlay">
          <div className="modal-content glass-panel">
            <h3>참가자 현재 목록 저장하기</h3>
            <p style={{ fontSize: '0.9rem', color: '#94a3b8', marginBottom: '16px' }}>
              현재 구성된 참가자 {players.length}명을 나만의 그룹으로 저장합니다. (동일 이름 시 덮어쓰기)
            </p>
            <input 
              type="text" 
              className="modal-input"
              placeholder="예: 우리 팀 결제팟"
              value={saveTitle}
              onChange={(e) => setSaveTitle(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSaveGroup()}
              autoFocus
            />
            <div className="modal-actions" style={{ display: 'flex', gap: '12px', marginTop: '20px' }}>
              <button className="btn-close" onClick={() => setIsSaveModalOpen(false)} style={{ flex: 1, background: 'rgba(255,255,255,0.1)', border: 'none' }}>취소</button>
              <button className="btn-close" onClick={handleSaveGroup} style={{ flex: 1 }}>저장 확인</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
