import { useState, useEffect, useRef, useCallback } from 'react';
import type { Player, GameMode } from '../types';
import type { ToastTone } from './ui/Toast';
import { Modal } from './ui/Modal';
import { ConfirmDialog } from './ui/ConfirmDialog';
import { PLAYER_COLORS } from '../constants';
import { rollRandomAmounts } from '../game/amounts';
import './SetupScreen.css';
import {
  Users,
  Plus,
  X,
  Shuffle,
  Play,
  DownloadCloud,
  Save,
  GripVertical,
  Flame,
  Coffee,
  Trash2,
  SlidersHorizontal,
} from 'lucide-react';
import { useQuery, useMutation, useConvexAuth } from 'convex/react';
import { api } from '../../convex/_generated/api';
import type { Doc, Id } from '../../convex/_generated/dataModel';

interface Props {
  players: Player[];
  setPlayers: (players: Player[]) => void;
  totalAmount: number;
  setTotalAmount: (amount: number) => void;
  gameMode: GameMode;
  setGameMode: (mode: GameMode) => void;
  onStart: (amounts: number[]) => void;
  onSignIn: () => Promise<void>;
  onNotify: (msg: string, tone?: ToastTone) => void;
}

interface QuickChip {
  label: string;
  ariaLabel: string;
  mode: 'add' | 'set';
  value: number;
}

const QUICK_AMOUNT_CHIPS: QuickChip[] = [
  { label: '+5천', ariaLabel: '총 금액에 5,000원 더하기', mode: 'add', value: 5000 },
  { label: '+1만', ariaLabel: '총 금액에 10,000원 더하기', mode: 'add', value: 10000 },
  { label: '1만', ariaLabel: '총 금액을 10,000원으로 설정', mode: 'set', value: 10000 },
  { label: '2만', ariaLabel: '총 금액을 20,000원으로 설정', mode: 'set', value: 20000 },
  { label: '3만', ariaLabel: '총 금액을 30,000원으로 설정', mode: 'set', value: 30000 },
];

export function SetupScreen({
  players,
  setPlayers,
  totalAmount,
  setTotalAmount,
  gameMode,
  setGameMode,
  onStart,
  onSignIn,
  onNotify,
}: Props) {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const savedGroups = useQuery(api.participants.getGroups, isAuthenticated ? undefined : 'skip');
  const saveGroup = useMutation(api.participants.saveGroup);
  const deleteGroup = useMutation(api.participants.deleteGroup);

  const [randomAmountsPool, setRandomAmountsPool] = useState<number[]>(() =>
    gameMode === 'random' ? rollRandomAmounts(players.length, totalAmount) : [],
  );
  const [isCalculating, setIsCalculating] = useState(false);

  const [isLoadModalOpen, setIsLoadModalOpen] = useState(false);
  const [isSaveModalOpen, setIsSaveModalOpen] = useState(false);
  const [saveTitle, setSaveTitle] = useState('');
  const [isSavingGroup, setIsSavingGroup] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{
    id: Id<'participantGroups'>;
    title: string;
  } | null>(null);
  const [isDeletingGroup, setIsDeletingGroup] = useState(false);

  const calcTimerRef = useRef<number | null>(null);
  const playerInputRefs = useRef<Map<string, HTMLInputElement>>(new Map());
  const lastAddedIdRef = useRef<string | null>(null);

  // 언마운트 시 대기 중인 분배 타이머 정리
  useEffect(() => {
    return () => {
      if (calcTimerRef.current !== null) {
        window.clearTimeout(calcTimerRef.current);
      }
    };
  }, []);

  // 랜덤 금액 분배 로직 (순위별 금액 풀 생성)
  // isManual: 재분배 버튼을 직접 누른 경우 (금액 미입력 안내 토스트 노출 및 셔플 연출)
  const calculateRandomAmounts = useCallback(
    (isManual = false) => {
      if (calcTimerRef.current !== null) {
        window.clearTimeout(calcTimerRef.current);
        calcTimerRef.current = null;
      }

      if (totalAmount <= 0) {
        setRandomAmountsPool(Array.from({ length: players.length }, () => 0));
        setIsCalculating(false);
        if (isManual) {
          onNotify('총 금액을 먼저 입력해주세요.', 'error');
        }
        return;
      }

      setIsCalculating(true);
      const count = players.length;
      const amount = totalAmount;

      calcTimerRef.current = window.setTimeout(() => {
        setRandomAmountsPool((prev) => rollRandomAmounts(count, amount, prev));
        setIsCalculating(false);
        calcTimerRef.current = null;
      }, isManual ? 360 : 120);
    },
    [players.length, totalAmount, onNotify],
  );

  useEffect(() => {
    if (gameMode === 'random') {
      calculateRandomAmounts(false);
    } else {
      if (calcTimerRef.current !== null) {
        window.clearTimeout(calcTimerRef.current);
        calcTimerRef.current = null;
      }
      setIsCalculating(false);
      setRandomAmountsPool([]);
    }
  }, [gameMode, calculateRandomAmounts]);

  // 로그인 성공 후 로컬 스토리지에 있는 백업 데이터를 자동 저장 처리 및 불러오기 연계
  useEffect(() => {
    if (!isAuthenticated || isLoading) return;

    const pendingSave = localStorage.getItem('coffeebet_pending_save');
    if (pendingSave) {
      try {
        const parsed = JSON.parse(pendingSave) as {
          title?: unknown;
          players?: unknown;
        };
        if (typeof parsed.title === 'string' && parsed.title.trim() && Array.isArray(parsed.players)) {
          const title = parsed.title.trim();
          const pendingPlayers = parsed.players as Player[];
          const doPendingSave = async () => {
            try {
              await saveGroup({
                title,
                players: pendingPlayers,
              });
              onNotify(`'${title}' 그룹을 로그인 계정에 저장했습니다.`, 'success');
            } catch (e) {
              console.error('자동 저장 에러:', e);
              onNotify('로그인 후 자동 저장에 실패했습니다.', 'error');
            } finally {
              localStorage.removeItem('coffeebet_pending_save');
            }
          };
          void doPendingSave();
        } else {
          localStorage.removeItem('coffeebet_pending_save');
        }
      } catch (e) {
        console.error('임시 저장 파싱 에러:', e);
        localStorage.removeItem('coffeebet_pending_save');
      }
    }

    const pendingLoad = localStorage.getItem('coffeebet_pending_load');
    if (pendingLoad === 'true') {
      setIsLoadModalOpen(true);
      localStorage.removeItem('coffeebet_pending_load');
    }
  }, [isAuthenticated, isLoading, saveGroup, onNotify]);

  // 새로 추가된 참가자 입력으로 포커스 이동
  useEffect(() => {
    if (!lastAddedIdRef.current) return;
    const targetId = lastAddedIdRef.current;
    lastAddedIdRef.current = null;
    const input = playerInputRefs.current.get(targetId);
    if (input) {
      input.focus();
      input.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [players]);

  const openLoadModal = async () => {
    if (!isAuthenticated) {
      try {
        localStorage.setItem('coffeebet_pending_load', 'true');
        onNotify('로그인이 필요합니다. 로그인하면 불러오기 창이 자동으로 열립니다.');
        await onSignIn();
      } catch (e) {
        console.error(e);
        onNotify('로그인 진행 중 오류가 발생했습니다.', 'error');
      }
      return;
    }
    setIsLoadModalOpen(true);
  };

  const openSaveModal = () => {
    if (players.length === 0) {
      onNotify('저장할 참가자가 없습니다.', 'error');
      return;
    }
    setIsSaveModalOpen(true);
  };

  const handleSaveGroup = async () => {
    const trimmedTitle = saveTitle.trim();
    if (!trimmedTitle) {
      onNotify('그룹 이름을 입력해주세요.', 'error');
      return;
    }

    if (!isAuthenticated) {
      try {
        const pendingData = {
          players,
          totalAmount,
          gameMode,
          title: trimmedTitle,
        };
        localStorage.setItem('coffeebet_pending_save', JSON.stringify(pendingData));
        onNotify('로그인이 필요합니다. 로그인하면 그룹이 자동으로 저장됩니다.');
        setIsSaveModalOpen(false);
        setSaveTitle('');
        await onSignIn();
      } catch (e) {
        console.error(e);
        onNotify('로그인 진행 중 오류가 발생했습니다.', 'error');
      }
      return;
    }

    setIsSavingGroup(true);
    try {
      await saveGroup({
        title: trimmedTitle,
        players,
      });
      onNotify(`'${trimmedTitle}' 그룹을 저장했습니다.`, 'success');
      setSaveTitle('');
      setIsSaveModalOpen(false);
    } catch (e) {
      console.error(e);
      onNotify('저장 중 오류가 발생했습니다.', 'error');
    } finally {
      setIsSavingGroup(false);
    }
  };

  const handleLoadGroup = (group: Doc<'participantGroups'>) => {
    setPlayers(group.players.map((p) => ({ id: p.id, name: p.name })));
    setIsLoadModalOpen(false);
    onNotify(`'${group.title}' 그룹(${group.players.length}명)을 불러왔습니다.`, 'success');
  };

  const handleConfirmDeleteGroup = async () => {
    if (!deleteTarget) return;
    setIsDeletingGroup(true);
    try {
      await deleteGroup({ id: deleteTarget.id });
      onNotify(`'${deleteTarget.title}' 그룹을 삭제했습니다.`, 'success');
      setDeleteTarget(null);
    } catch (e) {
      console.error(e);
      onNotify('삭제 중 오류가 발생했습니다.', 'error');
    } finally {
      setIsDeletingGroup(false);
    }
  };

  // 드래그앤드롭 상태 (터치 이동 중 상태 반영 전 touchmove가 먼저 발생할 수 있어 ref 병행)
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
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

  // 모바일: HTML5 DnD가 터치를 지원하지 않으므로 터치 이벤트로 순서 변경 처리
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

  const handleAddPlayer = () => {
    if (players.length >= 20) return;
    const newId = Date.now().toString();
    lastAddedIdRef.current = newId;
    setPlayers([...players, { id: newId, name: `참가자 ${players.length + 1}` }]);
  };

  const handleRemovePlayer = (id: string) => {
    if (players.length <= 2) return;
    setPlayers(players.filter((p) => p.id !== id));
  };

  const updatePlayerName = (id: string, name: string) => {
    setPlayers(players.map((p) => (p.id === id ? { ...p, name } : p)));
  };

  const handlePlayerKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, index: number) => {
    if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
    e.preventDefault();
    if (index < players.length - 1) {
      const nextPlayer = players[index + 1];
      const nextInput = playerInputRefs.current.get(nextPlayer.id);
      if (nextInput) {
        nextInput.focus();
        nextInput.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    } else if (players.length < 20) {
      handleAddPlayer();
    } else {
      e.currentTarget.blur();
    }
  };

  const handleQuickChipClick = (chip: QuickChip) => {
    if (chip.mode === 'add') {
      setTotalAmount(Math.max(0, totalAmount) + chip.value);
    } else {
      setTotalAmount(chip.value);
    }
  };

  const handleStart = () => {
    if (gameMode === 'random') {
      if (totalAmount <= 0) {
        onNotify('총 금액을 먼저 입력해주세요.', 'error');
        return;
      }
      if (isCalculating || randomAmountsPool.length !== players.length) {
        onNotify('금액을 분배하는 중입니다. 잠시 후 다시 시도해주세요.');
        return;
      }
    }

    // 비어 있는 이름은 기본 이름으로 보정해 레이스/결과 화면에서 빈 라벨이 생기지 않게 함
    if (players.some((p) => !p.name.trim())) {
      setPlayers(players.map((p, i) => ({ ...p, name: p.name.trim() || `참가자 ${i + 1}` })));
    }

    const finalAmounts =
      gameMode === 'all-in' ? players.map(() => 0) : randomAmountsPool;

    onStart(finalAmounts);
  };

  const ctaSummaryText =
    gameMode === 'all-in'
      ? `${players.length}명 참가 · 한 명 몰빵`
      : `${players.length}명 참가 · 총 ${totalAmount.toLocaleString()}원`;

  return (
    <div className="setup-container">
      <section className="setup-hero" aria-label="게임 설정 안내">
        <p className="setup-hero-text">
          참가자와 내기 방식을 고르고 마블 레이스를 시작하세요
        </p>
      </section>

      <div className="setup-stack">
        {/* 게임 모드 카드 */}
        <section className="ui-card setup-card" aria-labelledby="setup-mode-heading">
          <div className="setup-card-header">
            <h2 id="setup-mode-heading" className="setup-section-title">
              <SlidersHorizontal size={17} className="setup-title-icon" aria-hidden="true" />
              <span>내기 방식</span>
            </h2>
          </div>

          <div className="mode-segmented" role="group" aria-label="내기 방식 선택">
            <button
              type="button"
              className={`mode-segment-btn ${gameMode === 'all-in' ? 'is-active' : ''}`}
              onClick={() => setGameMode('all-in')}
              aria-pressed={gameMode === 'all-in'}
            >
              <Flame size={16} aria-hidden="true" />
              <span>한 명 몰빵</span>
            </button>
            <button
              type="button"
              className={`mode-segment-btn ${gameMode === 'random' ? 'is-active' : ''}`}
              onClick={() => setGameMode('random')}
              aria-pressed={gameMode === 'random'}
            >
              <Shuffle size={16} aria-hidden="true" />
              <span>랜덤 분배</span>
            </button>
          </div>

          {gameMode === 'all-in' ? (
            <div className="rule-banner">
              <Coffee size={16} className="rule-banner-icon" aria-hidden="true" />
              <span>먼저 도착하면 통과 · 마지막 1명이 오늘의 커피 당첨</span>
            </div>
          ) : (
            <div className="random-config">
              <div className="amount-field-header">
                <label htmlFor="total-amount-input" className="field-label">
                  총 금액
                </label>
                <span className="field-hint">100원 단위 자동 분배</span>
              </div>

              <div className="amount-input-wrap">
                <input
                  id="total-amount-input"
                  type="number"
                  inputMode="numeric"
                  className="amount-input tabular-nums"
                  value={totalAmount || ''}
                  onChange={(e) => setTotalAmount(Math.max(0, parseInt(e.target.value, 10) || 0))}
                  placeholder="예: 20000"
                  min={0}
                  step={100}
                />
                {totalAmount > 0 && (
                  <button
                    type="button"
                    className="amount-clear-btn"
                    onClick={() => setTotalAmount(0)}
                    aria-label="총 금액 초기화"
                    title="금액 초기화"
                  >
                    <X size={15} aria-hidden="true" />
                  </button>
                )}
                <span className="amount-currency" aria-hidden="true">
                  원
                </span>
              </div>

              <div className="quick-amount-chips" role="group" aria-label="원터치 퀵 금액">
                {QUICK_AMOUNT_CHIPS.map((chip) => {
                  const isActive = chip.mode === 'set' && totalAmount === chip.value;
                  return (
                    <button
                      key={chip.label}
                      type="button"
                      className={`quick-chip tabular-nums ${chip.mode === 'add' ? 'is-add' : ''} ${isActive ? 'is-active' : ''}`}
                      onClick={() => handleQuickChipClick(chip)}
                      aria-label={chip.ariaLabel}
                      aria-pressed={chip.mode === 'set' ? isActive : undefined}
                    >
                      {chip.label}
                    </button>
                  );
                })}
              </div>

              <div className="random-preview">
                <div className="random-preview-header">
                  <div>
                    <h3 className="preview-title">순위별 결제 금액</h3>
                    <p className="preview-subtitle">도착 순위에 따라 금액이 배정됩니다</p>
                  </div>
                  <button
                    type="button"
                    className={`ui-btn ui-btn-secondary reroll-btn ${isCalculating ? 'is-spinning' : ''}`}
                    onClick={() => calculateRandomAmounts(true)}
                    aria-label="순위별 결제 금액 재분배"
                  >
                    <Shuffle size={14} aria-hidden="true" />
                    <span>재분배</span>
                  </button>
                </div>

                <div className={`preview-list ${isCalculating ? 'is-calculating' : ''}`}>
                  {randomAmountsPool.map((amt, idx) => (
                    <div key={idx} className={`preview-item ${idx === 0 && amt > 0 ? 'is-top' : ''}`}>
                      <span className={`preview-rank-badge tabular-nums ${idx === 0 && amt > 0 ? 'is-top' : ''}`}>
                        {idx + 1}위
                      </span>
                      <span className={`preview-amount tabular-nums ${amt === 0 ? 'is-zero' : ''}`}>
                        {amt.toLocaleString()}원
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </section>

        {/* 참가자 관리 카드 */}
        <section className="ui-card setup-card" aria-labelledby="setup-players-heading">
          <div className="setup-card-header participants-header">
            <div className="participants-title-group">
              <h2 id="setup-players-heading" className="setup-section-title">
                <Users size={17} className="setup-title-icon" aria-hidden="true" />
                <span>참가자</span>
              </h2>
              <span className="player-count-badge tabular-nums" aria-label={`총 ${players.length}명, 최대 20명`}>
                {players.length}/20
              </span>
            </div>

            <div className="group-actions">
              <button
                type="button"
                className="ui-btn ui-btn-ghost compact-group-btn"
                onClick={openLoadModal}
              >
                <DownloadCloud size={15} aria-hidden="true" />
                <span>불러오기</span>
              </button>
              <button
                type="button"
                className="ui-btn ui-btn-secondary compact-group-btn"
                onClick={openSaveModal}
              >
                <Save size={15} aria-hidden="true" />
                <span>저장</span>
              </button>
            </div>
          </div>

          <div className="player-list">
            {players.map((p, index) => {
              const playerColor = PLAYER_COLORS[index % PLAYER_COLORS.length];
              return (
                <div
                  key={p.id}
                  className={`player-item ${draggedIndex === index ? 'is-dragging' : ''}`}
                  draggable
                  data-index={index}
                  data-player-id={p.id}
                  onDragStart={(e) => handleDragStart(e, index)}
                  onDragOver={(e) => handleDragOver(e, index)}
                  onDragEnd={handleDragEnd}
                >
                  <div
                    className="drag-handle"
                    style={{ touchAction: 'none' }}
                    onTouchStart={() => handleTouchStart(index)}
                    onTouchMove={handleTouchMove}
                    onTouchEnd={handleTouchEnd}
                    onTouchCancel={handleTouchEnd}
                    aria-hidden="true"
                  >
                    <GripVertical size={18} aria-hidden="true" />
                  </div>

                  <span
                    className="player-color-dot"
                    style={{ backgroundColor: playerColor }}
                    aria-hidden="true"
                  />

                  <span className="player-number tabular-nums" aria-hidden="true">
                    {index + 1}
                  </span>

                  <input
                    ref={(el) => {
                      if (el) {
                        playerInputRefs.current.set(p.id, el);
                      } else {
                        playerInputRefs.current.delete(p.id);
                      }
                    }}
                    type="text"
                    className="player-name-input"
                    value={p.name}
                    onChange={(e) => updatePlayerName(p.id, e.target.value)}
                    onFocus={(e) => e.target.select()}
                    onKeyDown={(e) => handlePlayerKeyDown(e, index)}
                    placeholder={`참가자 ${index + 1}`}
                    aria-label={`${index + 1}번 참가자 이름`}
                  />

                  {players.length > 2 && (
                    <button
                      type="button"
                      className="ui-icon-btn player-remove-btn"
                      onClick={() => handleRemovePlayer(p.id)}
                      aria-label={`${p.name.trim() || `참가자 ${index + 1}`} 삭제`}
                      title="참가자 삭제"
                    >
                      <X size={16} aria-hidden="true" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {players.length < 20 && (
            <button
              type="button"
              className="ui-btn ui-btn-secondary add-player-btn"
              onClick={handleAddPlayer}
            >
              <Plus size={18} aria-hidden="true" />
              <span>참가자 추가</span>
            </button>
          )}
        </section>
      </div>

      {/* 하단 Sticky CTA Dock */}
      <div className="setup-cta-dock">
        <div className="cta-summary tabular-nums">{ctaSummaryText}</div>
        <button
          type="button"
          className="ui-btn ui-btn-primary start-race-btn"
          onClick={handleStart}
        >
          <Play size={18} aria-hidden="true" />
          <span>레이스 시작</span>
        </button>
      </div>

      {/* 그룹 불러오기 모달 */}
      <Modal
        open={isLoadModalOpen}
        onClose={() => setIsLoadModalOpen(false)}
        title="저장된 참가자 불러오기"
        subtitle="선택한 그룹으로 현재 참가자 목록을 채웁니다."
        size="md"
        footer={
          <button
            type="button"
            className="ui-btn ui-btn-secondary"
            onClick={() => setIsLoadModalOpen(false)}
          >
            닫기
          </button>
        }
      >
        {!savedGroups ? (
          <p className="modal-empty-text">저장된 그룹을 불러오는 중...</p>
        ) : savedGroups.length === 0 ? (
          <p className="modal-empty-text">저장된 참가자 그룹이 없습니다.</p>
        ) : (
          <div className="saved-group-list">
            {savedGroups.map((group) => (
              <div key={group._id} className="saved-group-row">
                <button
                  type="button"
                  className="saved-group-select-btn"
                  onClick={() => handleLoadGroup(group)}
                >
                  <span className="saved-group-title-row">
                    <strong className="saved-group-name">{group.title}</strong>
                    <span className="saved-group-count tabular-nums">{group.players.length}명</span>
                  </span>
                  <span className="saved-group-members">
                    {group.players.map((member) => member.name).join(', ')}
                  </span>
                </button>
                <button
                  type="button"
                  className="ui-icon-btn saved-group-delete-btn"
                  onClick={() => setDeleteTarget({ id: group._id, title: group.title })}
                  aria-label={`${group.title} 그룹 삭제`}
                  title="그룹 삭제"
                >
                  <Trash2 size={16} aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>
        )}
      </Modal>

      {/* 그룹 저장 모달 */}
      <Modal
        open={isSaveModalOpen}
        onClose={() => {
          if (!isSavingGroup) setIsSaveModalOpen(false);
        }}
        title="현재 참가자 목록 저장"
        subtitle={`참가자 ${players.length}명을 저장합니다. 같은 이름이 있으면 덮어씁니다.`}
        size="md"
        footer={
          <>
            <button
              type="button"
              className="ui-btn ui-btn-secondary"
              onClick={() => setIsSaveModalOpen(false)}
              disabled={isSavingGroup}
            >
              취소
            </button>
            <button
              type="button"
              className="ui-btn ui-btn-primary"
              onClick={handleSaveGroup}
              disabled={isSavingGroup}
            >
              {isSavingGroup ? '저장 중...' : '저장하기'}
            </button>
          </>
        }
      >
        <div className="save-modal-body">
          <label htmlFor="save-group-title-input" className="field-label">
            그룹 이름
          </label>
          <input
            id="save-group-title-input"
            type="text"
            className="modal-text-input"
            placeholder="예: 우리 팀 커피 모임"
            value={saveTitle}
            onChange={(e) => setSaveTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void handleSaveGroup();
              }
            }}
            autoFocus
          />

          <div className="modal-saved-section">
            <h3 className="modal-saved-heading">저장된 그룹 목록 (선택 시 이름 자동 입력)</h3>
            {!isAuthenticated ? (
              <p className="modal-helper-text">
                로그인하면 기존 그룹을 확인하고 덮어쓸 수 있습니다. 저장하기를 누르면 로그인 후 자동으로 저장됩니다.
              </p>
            ) : !savedGroups ? (
              <p className="modal-helper-text">불러오는 중...</p>
            ) : savedGroups.length === 0 ? (
              <p className="modal-helper-text">저장된 그룹이 없습니다.</p>
            ) : (
              <div className="modal-existing-list">
                {savedGroups.map((group) => (
                  <button
                    key={group._id}
                    type="button"
                    className={`modal-existing-item ${saveTitle.trim() === group.title ? 'is-selected' : ''}`}
                    onClick={() => setSaveTitle(group.title)}
                  >
                    <span className="modal-existing-name">{group.title}</span>
                    <span className="modal-existing-count tabular-nums">{group.players.length}명</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </Modal>

      {/* 그룹 삭제 확인 다이얼로그 */}
      <ConfirmDialog
        open={deleteTarget !== null}
        title="저장된 그룹 삭제"
        description={
          deleteTarget
            ? `'${deleteTarget.title}' 그룹을 삭제할까요? 삭제 후에는 복구할 수 없습니다.`
            : ''
        }
        confirmLabel="삭제"
        cancelLabel="취소"
        variant="danger"
        isLoading={isDeletingGroup}
        onConfirm={handleConfirmDeleteGroup}
        onCancel={() => {
          if (!isDeletingGroup) setDeleteTarget(null);
        }}
      />
    </div>
  );
}
