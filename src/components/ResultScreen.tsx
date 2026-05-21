import { useState, useEffect, useRef } from 'react';
import type { GameMode, Player, TrajectoryFrame } from '../types';
import './ResultScreen.css';
import { RotateCcw, Trophy, Save, Share2 } from 'lucide-react';
import { useMutation, useConvexAuth } from 'convex/react';

import { api } from '../../convex/_generated/api';

interface Props {
  players: Player[];
  amountsPool: number[];
  raceResults: string[]; // player_id array
  gameMode: GameMode;
  onRestart: () => void;
  trajectory?: TrajectoryFrame[];
  deviceId: string;
}

const PLAYER_COLORS = ['#ef4444', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6'];

export function ResultScreen({ 
  players, 
  amountsPool, 
  raceResults, 
  gameMode, 
  onRestart,
  trajectory,
  deviceId
}: Props) {
  const { isAuthenticated } = useConvexAuth();
  const saveGroup = useMutation(api.participants.saveGroup);
  const saveReplayMutation = useMutation(api.replays.saveReplay);
  
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [groupTitle, setGroupTitle] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [autoSavedId, setAutoSavedId] = useState<string | null>(null);
  const [isAutoSaving, setIsAutoSaving] = useState(false);
  const hasRequestedSave = useRef(false);

  useEffect(() => {
    if (hasRequestedSave.current) return;
    if (!trajectory || trajectory.length === 0) return;

    const performAutoSave = async () => {
      hasRequestedSave.current = true;
      setIsAutoSaving(true);
      try {
        const replayId = await saveReplayMutation({
          deviceId,
          players: players.map(p => ({ id: p.id, name: p.name })),
          amountsPool,
          gameMode,
          raceResults,
          trajectory: JSON.stringify(trajectory)
        });
        setAutoSavedId(replayId);
      } catch (e) {
        console.error("리플레이 자동 저장 중 오류:", e);
      } finally {
        setIsAutoSaving(false);
      }
    };

    performAutoSave();
  }, [
    saveReplayMutation,
    deviceId,
    players,
    amountsPool,
    gameMode,
    raceResults,
    trajectory
  ]);

  const handleSaveGroup = () => {
    if (!isAuthenticated) {
      alert("참가자를 저장하려면 상단의 로그인 버튼을 눌러주세요.");
      return;
    }
    setIsModalOpen(true);
  };

  const confirmSave = async () => {
    if (!groupTitle.trim()) {
      alert("그룹 이름을 입력해주세요.");
      return;
    }
    setIsSaving(true);
    try {
      await saveGroup({
        title: groupTitle.trim(),
        players: players.map(p => ({ id: p.id, name: p.name }))
      });
      alert("성공적으로 저장되었습니다!");
      setIsModalOpen(false);
      setGroupTitle('');
    } catch (e) {
      console.error(e);
      alert("저장 중 오류가 발생했습니다.");
    } finally {
      setIsSaving(false);
    }
  };

  const copyToClipboard = async (url: string) => {
    if (navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(url);
        alert("리플레이 공유 링크가 클립보드에 복사되었습니다! 🔗");
        return;
      } catch (err) {
        console.error("클립보드 API 복사 실패:", err);
      }
    }
    
    // Fallback 복사 방식
    const tempInput = document.createElement('input');
    tempInput.value = url;
    document.body.appendChild(tempInput);
    tempInput.select();
    try {
      document.execCommand('copy');
      alert("리플레이 공유 링크가 복사되었습니다! 🔗");
    } catch (err) {
      console.error("Fallback 복사 실패:", err);
      alert(`링크 복사에 실패했습니다. 주소를 직접 복사해주세요:\n${url}`);
    }
    document.body.removeChild(tempInput);
  };

  const handleShareReplay = async () => {
    if (isAutoSaving || !autoSavedId) {
      alert("리플레이가 저장되는 중입니다. 잠시만 기다려주세요.");
      return;
    }
    
    // 리플레이 URL 빌드
    const shareUrl = `${window.location.origin}${window.location.pathname}?replay=${autoSavedId}`;

    // Web Share API를 지원하면 기기 네이티브 공유창 활성화
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'Coffee Bet - 마블 레이스 결과',
          text: '오늘의 커피 룰렛 결과 리플레이를 지금 바로 확인해보세요!',
          url: shareUrl,
        });
      } catch (shareErr) {
        // 공유를 취소하지 않은 다른 오류 시에만 클립보드로 복사 처리
        if (shareErr instanceof Error && shareErr.name !== 'AbortError') {
          await copyToClipboard(shareUrl);
        }
      }
    } else {
      await copyToClipboard(shareUrl);
    }
  };

  // 매핑 결과 계산
  const totalBill = amountsPool.reduce((a, b) => a + b, 0);
  const hasAmount = totalBill > 0;

  // raceResults의 순서대로 amountsPool의 금액을 받음
  const finalResults = raceResults.map((id, index) => {
    const player = players.find(p => p.id === id)!;
    const amount = amountsPool[index] || 0;
    const color = PLAYER_COLORS[players.findIndex(p => p.id === id) % PLAYER_COLORS.length];
    const rank = index + 1;
    
    // 금액이 지정된 경우: 해당 순위의 배분 금액이 0원보다 크면 벌칙자
    // 금액이 지정되지 않은 경우: 레이스의 최하위(마지막 인덱스)를 벌칙자로 판정
    const isLoser = hasAmount ? (amount > 0) : (index === raceResults.length - 1);

    return { player, amount, rank, color, isLoser };
  });

  return (
    <div className="result-container">
      <div className="header">
        <h1>🎉 최종 결과</h1>
        <p>오늘의 커피 결제 내역입니다!</p>
      </div>

      <div className="glass-panel result-panel">
        <div className="result-list">
          {finalResults.map((res, index) => (
            <div 
              key={res.player.id} 
              className={`result-item fadeIn ${res.isLoser ? 'last-place' : ''}`}
              style={{ animationDelay: `${index * 0.15}s` }}
            >
              <div className="rank">
                {res.isLoser ? <Trophy className="icon-gold" size={24} /> : 
                 <span className="rank-text">{res.rank}위</span>}
              </div>
              <div className="player-info">
                <span className="dot" style={{ backgroundColor: res.color }}></span>
                <span className="name">{res.player.name}</span>
              </div>
              <div className="amount">
                {res.isLoser ? (
                  <span className="amount-value text-danger">
                    {gameMode === 'all-in'
                      ? '모두 쏜다! 💸'
                      : (hasAmount ? `${res.amount.toLocaleString()}원` : '모두 쏜다! 💸')
                    }
                  </span>
                ) : (
                  <span className="amount-value text-success">
                    {hasAmount ? '공짜! 🥳' : '통과! 🎉'}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
        
        {hasAmount && gameMode !== 'all-in' && (
          <div className="summary">
            총 결제 금액: <strong>{totalBill.toLocaleString()}원</strong>
          </div>
        )}
      </div>

      <div className="action-buttons">
        <button 
          className="share-replay-btn" 
          onClick={handleShareReplay} 
          disabled={isAutoSaving || !autoSavedId || !trajectory || trajectory.length === 0}
        >
          <Share2 size={20} className="icon-mr" /> 
          {isAutoSaving ? "리플레이 저장 중..." : "게임 리플레이 공유"}
        </button>

        <div style={{ display: 'flex', gap: '12px', width: '100%' }}>
          <button className="btn-secondary save-group-btn" onClick={handleSaveGroup} disabled={isSaving} style={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
            <Save size={20} className="icon-mr" /> 
            {isSaving ? "저장 중..." : "참가자 저장"}
          </button>
          
          <button className="btn-primary restart-btn" onClick={onRestart} style={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
            <RotateCcw size={20} className="icon-mr" /> 다시 하기
          </button>
        </div>
      </div>

      {isModalOpen && (
        <div className="modal-overlay">
          <div className="modal-content glass-panel">
            <h3>참가자 그룹 저장</h3>
            <p>이 그룹의 이름을 입력해주세요.<br/>(예: 대학 동창, 개발팀 회식)</p>
            <input 
              type="text" 
              value={groupTitle} 
              onChange={e => setGroupTitle(e.target.value)}
              placeholder="그룹 이름 입력"
              className="group-input"
              autoFocus
            />
            <div className="modal-actions">
              <button className="btn-outline" onClick={() => setIsModalOpen(false)}>취소</button>
              <button className="btn-primary" onClick={confirmSave}>저장하기</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
