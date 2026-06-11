import { useState, useEffect, useRef } from 'react';
import type { Player, GameMode } from '../types';
import './SetupScreen.css';
import { Users, Plus, X, Shuffle, DollarSign, Play, DownloadCloud, Save, GripVertical, History } from 'lucide-react';
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
  onSignIn: () => Promise<void>;
  deviceId: string;
  onSelectReplay: (id: string) => void;
}

export function SetupScreen({
  players,
  setPlayers,
  totalAmount,
  setTotalAmount,
  gameMode,
  setGameMode,
  onStart,
  onSignIn,
  deviceId,
  onSelectReplay
}: Props) {
  const { isAuthenticated, isLoading } = useConvexAuth();
  // 로그인된 경우 저장된 그룹 목록을 가져옴
  const savedGroups = useQuery(api.participants.getGroups, isAuthenticated ? undefined : "skip");
  // 최근 리플레이 목록을 가져옴
  const savedReplays = useQuery(api.replays.getReplays, { deviceId });
  const saveGroup = useMutation(api.participants.saveGroup);
  const deleteGroup = useMutation(api.participants.deleteGroup);

  const [randomAmountsPool, setRandomAmountsPool] = useState<number[]>([]);
  const [isCalculating, setIsCalculating] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSaveModalOpen, setIsSaveModalOpen] = useState(false);
  const [isReplayModalOpen, setIsReplayModalOpen] = useState(false);
  const [saveTitle, setSaveTitle] = useState("");
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // 연속 호출 시 이전 타이머가 새 토스트를 조기에 지우지 않도록 추적
  const toastTimerRef = useRef<number | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = window.setTimeout(() => {
      setToastMessage(null);
      toastTimerRef.current = null;
    }, 4000); // 4초간 노출 (사용자 요청 반영: 더 오래 유지)
  };

  const handleDeleteGroup = async (id: any, title: string) => {
    if (window.confirm(`'${title}' 그룹을 삭제하시겠습니까?`)) {
      try {
        await deleteGroup({ id });
        showToast(`'${title}' 그룹을 삭제했습니다.`);
      } catch (e) {
        console.error(e);
        showToast("삭제 중 오류가 발생했습니다.");
      }
    }
  };

  const openLoadModal = async () => {
    if (!isAuthenticated) {
      try {
        localStorage.setItem('coffeebet_pending_load', 'true');
        showToast("로그인이 필요합니다. 로그인하면 불러오기 창이 자동으로 열립니다.");
        await onSignIn();
      } catch (e) {
        console.error(e);
        showToast("로그인 진행 중 오류가 발생했습니다.");
      }
      return;
    }
    setIsModalOpen(true);
  };

  const openSaveModal = () => {
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
    
    if (!isAuthenticated) {
      try {
        const pendingData = {
          players,
          totalAmount,
          gameMode,
          title: saveTitle.trim()
        };
        localStorage.setItem('coffeebet_pending_save', JSON.stringify(pendingData));
        showToast("로그인이 필요합니다. 로그인하면 그룹이 자동으로 저장됩니다.");
        setIsSaveModalOpen(false);
        setSaveTitle("");
        await onSignIn();
      } catch (e) {
        console.error(e);
        showToast("로그인 진행 중 오류가 발생했습니다.");
      }
      return;
    }

    try {
      await saveGroup({
        title: saveTitle.trim(),
        players: players,
      });
      showToast(`'${saveTitle.trim()}' 그룹을 저장했습니다.`);
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

  // 가중치 기반으로 총액을 100원 단위로 나눈 금액 풀 1회 생성.
  // 남은 금액을 넘지 않게 클램핑하므로 마지막 몫이 음수가 되는 일이 없다 (재시도 불필요).
  const rollAmounts = (): number[] => {
    const weights = players.map(() => Math.random() + 0.1);
    const weightSum = weights.reduce((a, b) => a + b, 0);

    const amounts: number[] = [];
    let remaining = totalAmount;
    for (let i = 0; i < players.length - 1; i++) {
      const rawAmount = (weights[i] / weightSum) * totalAmount;
      const amount = Math.min(Math.round(rawAmount / 100) * 100, remaining);
      amounts.push(amount);
      remaining -= amount;
    }
    amounts.push(remaining);

    // 내림차순(가장 많은 금액을 꼴찌나 1등이 낼 수 있게 자유롭게 정렬, 혹은 게임 재미를 위해 섞거나 내림차순 정렬)
    amounts.sort((a, b) => b - a);
    return amounts;
  };

  // 랜덤 금액 분배 로직 (순위별 금액 풀 생성)
  // isManual: 재분배 버튼을 직접 누른 경우 (금액 미입력 안내 토스트는 이때만 노출)
  const calculateRandomAmounts = (isManual = false) => {
    if (totalAmount <= 0) {
      setRandomAmountsPool(players.map(() => 0));
      if (isManual) {
        showToast("총 금액을 먼저 입력해주세요.");
      }
      return;
    }

    setIsCalculating(true);

    setTimeout(() => {
      setRandomAmountsPool(prev => {
        // 직전 풀과 동일한 결과가 나오면 다시 굴려서 버튼을 누른 효과가 눈에 보이게 함
        let amounts = rollAmounts();
        for (let attempt = 0; attempt < 9 && amounts.join() === prev.join(); attempt++) {
          amounts = rollAmounts();
        }
        return amounts;
      });
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

  // 로그인 성공 후 로컬 스토리지에 있는 백업 데이터를 자동 저장 처리 및 불러오기 연계
  useEffect(() => {
    if (isAuthenticated && !isLoading) {
      // 1. 저장하기 보류 확인
      const pendingSave = localStorage.getItem('coffeebet_pending_save');
      if (pendingSave) {
        try {
          const parsed = JSON.parse(pendingSave);
          if (parsed.title) {
            const doPendingSave = async () => {
              try {
                await saveGroup({
                  title: parsed.title,
                  players: parsed.players
                });
                showToast(`'${parsed.title}' 그룹을 로그인 계정에 저장했습니다.`);
              } catch (e) {
                console.error("자동 저장 에러:", e);
                showToast("로그인 후 자동 저장에 실패했습니다.");
              } finally {
                localStorage.removeItem('coffeebet_pending_save');
              }
            };
            doPendingSave();
          }
        } catch (e) {
          console.error("임시 저장 파싱 에러:", e);
          localStorage.removeItem('coffeebet_pending_save');
        }
      }

      // 2. 불러오기 보류 확인
      const pendingLoad = localStorage.getItem('coffeebet_pending_load');
      if (pendingLoad === 'true') {
        setIsModalOpen(true);
        localStorage.removeItem('coffeebet_pending_load');
      }
    }
  }, [isAuthenticated, isLoading, saveGroup]);

  // 드래그앤드롭 상태
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  // 터치 이동 중 상태 업데이트보다 touchmove가 먼저 발생할 수 있어 ref로 현재 위치 추적
  const draggedIndexRef = useRef<number | null>(null);

  const movePlayer = (from: number, to: number) => {
    if (from === to) return;
    const next = [...players];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    setPlayers(next);
    draggedIndexRef.current = to;
    setDraggedIndex(to);
  };

  const handleDragStart = (e: React.DragEvent, index: number) => {
    draggedIndexRef.current = index;
    setDraggedIndex(index);
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
    }
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === index) return;
    movePlayer(draggedIndex, index);
  };

  const handleDragEnd = () => {
    draggedIndexRef.current = null;
    setDraggedIndex(null);
  };

  // 모바일: HTML5 DnD는 터치를 지원하지 않으므로 터치 이벤트로 처리
  const handleTouchStart = (index: number) => {
    draggedIndexRef.current = index;
    setDraggedIndex(index);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    const from = draggedIndexRef.current;
    if (from === null) return;
    const touch = e.touches[0];
    const target = document
      .elementFromPoint(touch.clientX, touch.clientY)
      ?.closest('.player-item') as HTMLElement | null;
    if (!target || target.dataset.index === undefined) return;
    const to = Number(target.dataset.index);
    if (Number.isNaN(to)) return;
    movePlayer(from, to);
  };

  const handleTouchEnd = () => {
    draggedIndexRef.current = null;
    setDraggedIndex(null);
  };

  // 새로 추가된 참가자 입력으로 포커스 이동 (이름을 바로 입력할 수 있게)
  const lastAddedIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!lastAddedIdRef.current) return;
    const input = document.querySelector<HTMLInputElement>(
      `.player-item[data-player-id="${lastAddedIdRef.current}"] input`
    );
    lastAddedIdRef.current = null;
    if (input) {
      input.focus();
      input.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [players]);

  const handleAddPlayer = () => {
    if (players.length >= 20) return;
    const newId = Date.now().toString();
    lastAddedIdRef.current = newId;
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
    if (gameMode === 'random') {
      if (totalAmount <= 0) {
        showToast("총 금액을 먼저 입력해주세요.");
        return;
      }
      if (isCalculating || randomAmountsPool.length !== players.length) {
        showToast("금액을 분배하는 중입니다. 잠시 후 다시 시도해주세요.");
        return;
      }
    }

    // 비어 있는 이름은 기본 이름으로 보정하여 레이스/결과 화면에서 빈 라벨이 생기지 않게 함
    if (players.some(p => !p.name.trim())) {
      setPlayers(players.map((p, i) => ({ ...p, name: p.name.trim() || `참가자 ${i + 1}` })));
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
                inputMode="numeric"
                value={totalAmount || ''}
                onChange={(e) => setTotalAmount(Math.max(0, parseInt(e.target.value) || 0))}
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
              <button className="btn-icon btn-add" onClick={handleAddPlayer} aria-label="참가자 추가" title="참가자 추가">
                <Plus size={18} />
              </button>
            )}
          </div>
          
          <div className="player-list">
            {players.map((p, index) => (
              <div 
                key={p.id} 
                className={`player-item fadeIn ${draggedIndex === index ? 'dragging' : ''}`}
                draggable
                data-index={index}
                data-player-id={p.id}
                onDragStart={(e) => handleDragStart(e, index)}
                onDragOver={(e) => handleDragOver(e, index)}
                onDragEnd={handleDragEnd}
              >
                <div
                  className="drag-handle"
                  style={{ display: 'flex', alignItems: 'center', color: '#64748b', cursor: 'grab', paddingRight: '4px', transition: 'color 0.2s', touchAction: 'none' }}
                  onTouchStart={() => handleTouchStart(index)}
                  onTouchMove={handleTouchMove}
                  onTouchEnd={handleTouchEnd}
                  onTouchCancel={handleTouchEnd}
                >
                  <GripVertical size={18} />
                </div>
                <div className="player-number">{index + 1}</div>
                <input
                  type="text"
                  value={p.name}
                  onChange={(e) => updatePlayerName(p.id, e.target.value)}
                  onFocus={(e) => e.target.select()}
                  placeholder="이름"
                />
                {players.length > 2 && (
                  <button className="btn-icon btn-remove" onClick={() => handleRemovePlayer(p.id)} aria-label={`${p.name || '참가자'} 삭제`} title="삭제">
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
              <h3>순위별 결제 금액</h3>
              <button
                className={`btn-refresh ${isCalculating ? 'spinning' : ''}`}
                onClick={() => calculateRandomAmounts(true)}
              >
                <Shuffle size={14} /> 재분배
              </button>
            </div>
            <div className={`preview-list ${isCalculating ? 'calculating' : ''}`}>
              <p style={{fontSize: '0.85rem', color: '#94a3b8', marginBottom: '8px'}}>마블 레이스 순위에 따라 아래 금액을 각자 결제하게 됩니다.</p>
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

      <div className="load-group-section" style={{ display: 'flex', gap: '12px', marginBottom: '12px' }}>
        <button className="btn-secondary load-group-btn" onClick={openLoadModal} style={{ flex: 1 }}>
          <DownloadCloud size={20} className="icon-mr" /> 불러오기
        </button>
        <button className="btn-secondary load-group-btn" onClick={openSaveModal} style={{ flex: 1 }}>
          <Save size={20} className="icon-mr" /> 저장하기
        </button>
      </div>

      <button className="btn-secondary replay-list-btn" onClick={() => setIsReplayModalOpen(true)} style={{ width: '100%', marginBottom: '24px' }}>
        <History size={20} className="icon-mr" /> 이전 리플레이 보기
      </button>

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
        <div className="modal-overlay" onClick={() => setIsModalOpen(false)}>
          <div className="modal-content glass-panel" onClick={(e) => e.stopPropagation()}>
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
        <div className="modal-overlay" onClick={() => setIsSaveModalOpen(false)}>
          <div className="modal-content glass-panel" onClick={(e) => e.stopPropagation()}>
            <h3>현재 참가자 목록 저장하기</h3>
            <p style={{ fontSize: '0.9rem', color: '#94a3b8', marginBottom: '16px' }}>
              현재 참가자 {players.length}명을 나만의 그룹으로 저장합니다. (같은 이름이 있으면 덮어씁니다)
            </p>
            <input
              type="text"
              className="modal-input"
              placeholder="예: 우리 팀 커피 모임"
              value={saveTitle}
              onChange={(e) => setSaveTitle(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSaveGroup()}
              autoFocus
            />

            {/* 기존 저장된 목록 불러오기/덮어쓰기 연계 */}
            <div className="modal-saved-groups-section" style={{ marginTop: '20px', borderTop: '1px solid rgba(255, 255, 255, 0.1)', paddingTop: '16px', textAlign: 'left' }}>
              <h4 style={{ fontSize: '0.95rem', fontWeight: '600', marginBottom: '10px', color: '#e2e8f0' }}>저장된 그룹 목록 (선택하면 이름이 입력됩니다)</h4>
              {!isAuthenticated ? (
                <p style={{ fontSize: '0.85rem', color: '#94a3b8' }}>
                  로그인하면 저장해 둔 그룹을 확인하고 불러오거나 덮어쓸 수 있습니다.
                </p>
              ) : !savedGroups ? (
                <p style={{ fontSize: '0.85rem', color: '#94a3b8' }}>불러오는 중...</p>
              ) : savedGroups.length === 0 ? (
                <p style={{ fontSize: '0.85rem', color: '#94a3b8' }}>저장된 그룹이 없습니다.</p>
              ) : (
                <div className="modal-group-list" style={{ maxHeight: '150px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {savedGroups.map((group) => (
                    <div 
                      key={group._id} 
                      className="modal-group-item" 
                      onClick={() => setSaveTitle(group.title)}
                      style={{ 
                        display: 'flex', 
                        justifyContent: 'space-between', 
                        alignItems: 'center', 
                        padding: '8px 12px', 
                        background: 'rgba(255, 255, 255, 0.03)', 
                        border: '1px solid rgba(255, 255, 255, 0.08)',
                        borderRadius: '8px',
                        cursor: 'pointer',
                        transition: 'background 0.2s'
                      }}
                    >
                      <div style={{ flex: 1 }}>
                        <span style={{ fontWeight: '500', fontSize: '0.9rem', color: '#f1f5f9' }}>{group.title}</span>
                        <span style={{ fontSize: '0.75rem', color: '#94a3b8', marginLeft: '6px' }}>({group.players.length}명)</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="modal-actions" style={{ display: 'flex', gap: '12px', marginTop: '20px' }}>
              <button className="btn-close" onClick={() => setIsSaveModalOpen(false)} style={{ flex: 1, background: 'rgba(255,255,255,0.1)', border: 'none' }}>취소</button>
              <button className="btn-close" onClick={handleSaveGroup} style={{ flex: 1 }}>저장하기</button>
            </div>
          </div>
        </div>
      )}

      {/* 리플레이 목록 모달 */}
      {isReplayModalOpen && (
        <div className="modal-overlay" onClick={() => setIsReplayModalOpen(false)}>
          <div className="modal-content glass-panel" onClick={(e) => e.stopPropagation()}>
            <h3>최근 게임 리플레이</h3>
            <p style={{ fontSize: '0.9rem', color: '#94a3b8', marginBottom: '16px' }}>
              최근 진행한 게임의 리플레이 기록입니다. (최대 20개 보관)
            </p>
            {!savedReplays ? (
              <p>불러오는 중...</p>
            ) : savedReplays.length === 0 ? (
              <p style={{ color: '#94a3b8', margin: '20px 0' }}>기록된 리플레이가 없습니다.</p>
            ) : (
              <div className="replay-group-list" style={{ maxHeight: '250px', overflowY: 'auto', marginBottom: '16px', display: 'flex', flexDirection: 'column', gap: '10px', textAlign: 'left' }}>
                {savedReplays.map((replay) => {
                  const dateStr = new Date(replay.createdAt).toLocaleString('ko-KR', {
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                  });
                  const modeText = replay.gameMode === 'all-in' ? '한 명 몰빵' : '랜덤 분배';
                  const playerNames = replay.players.map((p: any) => p.name).join(', ');
                  
                  return (
                    <div 
                      key={replay._id}
                      className="replay-item-card"
                      onClick={() => onSelectReplay(replay._id)}
                    >
                      <div className="replay-card-header">
                        <span className="replay-date">{dateStr}</span>
                        <span className={`replay-badge ${replay.gameMode}`}>
                          {modeText}
                        </span>
                      </div>
                      <div className="replay-players">
                        {playerNames}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            <div className="modal-actions" style={{ justifyContent: 'center' }}>
              <button className="btn-close" onClick={() => setIsReplayModalOpen(false)}>닫기</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
