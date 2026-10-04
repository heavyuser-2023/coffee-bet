import { useState, useEffect, useRef, useMemo } from 'react';
import type { GameMode, Player, TrajectoryFrame } from '../types';
import './ResultScreen.css';
import { RotateCcw, Trophy, Save, Share2, ChevronRight } from 'lucide-react';
import { useMutation, useQuery, useConvexAuth } from 'convex/react';

import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { PLAYER_COLORS } from '../constants';
import { computeOutcome } from '../game/outcome';
import { buildWittyLines, type GameRecord } from '../game/stats';
import { StatsModal } from './StatsModal';

// 문자열 시드 고정 난수 — 같은 게임이면 통계 문구가 다시 그려져도 바뀌지 않게 한다
function seededRandom(seedText: string) {
  let h = 2166136261;
  for (let i = 0; i < seedText.length; i++) h = Math.imul(h ^ seedText.charCodeAt(i), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

interface Props {
  players: Player[];
  amountsPool: number[];
  raceResults: string[]; // player_id array
  gameMode: GameMode;
  onRestart: () => void;
  trajectory?: TrajectoryFrame[];
  videoBlob?: Blob | null;
  deviceId: string;
}

export function ResultScreen({
  players,
  amountsPool,
  raceResults,
  gameMode,
  onRestart,
  trajectory,
  videoBlob,
  deviceId
}: Props) {
  const { isAuthenticated } = useConvexAuth();
  const saveGroup = useMutation(api.participants.saveGroup);
  const saveReplayMutation = useMutation(api.replays.saveReplay);
  const generateUploadUrl = useMutation(api.replays.generateUploadUrl);
  const recordGame = useMutation(api.gameRecords.recordGame);
  const gameHistory = useQuery(api.gameRecords.listRecords, { deviceId });
  const [isStatsOpen, setIsStatsOpen] = useState(false);
  
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [groupTitle, setGroupTitle] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [autoSavedId, setAutoSavedId] = useState<string | null>(null);
  const [isAutoSaving, setIsAutoSaving] = useState(false);
  const hasRequestedSave = useRef(false);

  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = window.setTimeout(() => {
      setToastMessage(null);
      toastTimerRef.current = null;
    }, 4000);
  };

  useEffect(() => {
    if (hasRequestedSave.current) return;
    const hasTrajectory = !!trajectory && trajectory.length > 0;
    if (!videoBlob && !hasTrajectory) return;

    const performAutoSave = async () => {
      hasRequestedSave.current = true;
      setIsAutoSaving(true);
      try {
        // 1) 녹화 영상이 있으면 Convex 스토리지에 업로드 → storageId 확보
        let videoStorageId: Id<"_storage"> | undefined = undefined;
        if (videoBlob) {
          try {
            const uploadUrl = await generateUploadUrl();
            // 저장 Content-Type은 컨테이너 타입만 남김(예: video/mp4) — 일부 엄격한 플레이어가
            // "video/webm;codecs=vp9" 같은 비표준 헤더를 거부하는 문제 방지
            const contentType = (videoBlob.type || "video/webm").split(";")[0];
            const res = await fetch(uploadUrl, {
              method: "POST",
              headers: { "Content-Type": contentType },
              body: videoBlob,
            });
            if (res.ok) {
              const { storageId } = await res.json();
              videoStorageId = storageId as Id<"_storage">;
            } else {
              console.error("영상 업로드 실패:", res.status);
            }
          } catch (uploadErr) {
            console.error("영상 업로드 중 오류:", uploadErr);
          }
        }

        // 2) 메타데이터 + (영상 storageId | 궤적 폴백) 저장
        const replayId = await saveReplayMutation({
          deviceId,
          players: players.map(p => ({ id: p.id, name: p.name })),
          amountsPool,
          gameMode,
          raceResults,
          videoStorageId,
          trajectory: hasTrajectory ? JSON.stringify(trajectory) : undefined,
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
    generateUploadUrl,
    deviceId,
    players,
    amountsPool,
    gameMode,
    raceResults,
    trajectory,
    videoBlob
  ]);

  // ------------------ 당첨 기록 & 오늘의 커피 통계 ------------------
  // 이 결과 화면(=게임 1판)을 식별하는 ID와 시각. 서버 중복 저장 방지 및 통계 문구 고정에 사용
  const [clientGameId] = useState(() => `${deviceId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
  const [finishedAt] = useState(() => Date.now());
  const currentRecord = useMemo<GameRecord>(() => ({
    clientGameId,
    createdAt: finishedAt,
    gameMode,
    results: computeOutcome(players, raceResults, amountsPool).map((o) => ({
      name: o.player.name,
      rank: o.rank,
      amount: o.amount,
      isLoser: o.isLoser,
    })),
  }), [clientGameId, finishedAt, gameMode, players, raceResults, amountsPool]);

  // 게임이 끝날 때마다 누가 걸렸는지 서버에 기록 (주간/월간 통계의 원천)
  const hasRecordedGame = useRef(false);
  useEffect(() => {
    if (hasRecordedGame.current) return;
    if (currentRecord.results.length < 2 || !currentRecord.results.some((r) => r.isLoser)) return;
    hasRecordedGame.current = true;
    recordGame({
      deviceId,
      clientGameId: currentRecord.clientGameId,
      gameMode: currentRecord.gameMode,
      results: currentRecord.results,
    }).catch((e) => console.error("게임 기록 저장 중 오류:", e));
  }, [recordGame, deviceId, currentRecord]);

  // 이전 기록 + 이번 판으로 만든 한마디 (서버 저장 완료를 기다리지 않고 바로 계산)
  const wittyLines = useMemo(
    () => (gameHistory
      ? buildWittyLines(gameHistory, currentRecord, { random: seededRandom(currentRecord.clientGameId) })
      : null),
    [gameHistory, currentRecord]
  );

  const handleSaveGroup = () => {
    if (!isAuthenticated) {
      showToast("참가자를 저장하려면 상단의 로그인 버튼을 눌러주세요.");
      return;
    }
    setIsModalOpen(true);
  };

  const confirmSave = async () => {
    if (!groupTitle.trim()) {
      showToast("그룹 이름을 입력해주세요.");
      return;
    }
    setIsSaving(true);
    try {
      await saveGroup({
        title: groupTitle.trim(),
        players: players.map(p => ({ id: p.id, name: p.name }))
      });
      showToast(`'${groupTitle.trim()}' 그룹이 저장되었습니다! ✅`);
      setIsModalOpen(false);
      setGroupTitle('');
    } catch (e) {
      console.error(e);
      showToast("저장 중 오류가 발생했습니다.");
    } finally {
      setIsSaving(false);
    }
  };

  const copyToClipboard = async (url: string) => {
    if (navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(url);
        showToast("리플레이 공유 링크가 클립보드에 복사되었습니다! 🔗");
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
      showToast("리플레이 공유 링크가 복사되었습니다! 🔗");
    } catch (err) {
      console.error("Fallback 복사 실패:", err);
      alert(`링크 복사에 실패했습니다. 주소를 직접 복사해주세요:\n${url}`);
    }
    document.body.removeChild(tempInput);
  };

  const handleShareReplay = async () => {
    if (isAutoSaving || !autoSavedId) {
      showToast("리플레이를 저장하는 중입니다. 잠시만 기다려주세요.");
      return;
    }
    
    // 리플레이 URL 빌드
    const shareUrl = `${window.location.origin}${window.location.pathname}?replay=${autoSavedId}`;

    // Web Share API를 지원하면 기기 네이티브 공유창 활성화
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'Coffee Bet - 마블 레이스 결과',
          text: '오늘의 커피 내기 결과, 마블 레이스 리플레이로 확인해보세요!',
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

  // 매핑 결과 계산 (raceResults의 순서대로 amountsPool의 금액을 받음)
  const totalBill = amountsPool.reduce((a, b) => a + b, 0);
  const hasAmount = totalBill > 0;
  const finalResults = computeOutcome(players, raceResults, amountsPool).map((outcome) => ({
    ...outcome,
    color: PLAYER_COLORS[players.findIndex(p => p.id === outcome.player.id) % PLAYER_COLORS.length],
  }));

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
                      ? '오늘은 쏘는 날! 💸'
                      : (hasAmount ? `${res.amount.toLocaleString()}원` : '오늘은 쏘는 날! 💸')
                    }
                  </span>
                ) : res.amount > 0 ? (
                  <span className="amount-value text-warning">
                    {res.amount.toLocaleString()}원
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

      <div className="glass-panel witty-card fadeIn">
        <div className="witty-header">
          <h3>📊 오늘의 커피 통계</h3>
          <button className="witty-more" onClick={() => setIsStatsOpen(true)}>
            기록 보기 <ChevronRight size={14} />
          </button>
        </div>
        {wittyLines ? (
          <ul className="witty-lines">
            {wittyLines.map((line, i) => (
              <li key={line} style={{ animationDelay: `${0.5 + i * 0.35}s` }}>{line}</li>
            ))}
          </ul>
        ) : (
          <p className="witty-loading">통계를 계산하는 중...</p>
        )}
      </div>

      <div className="action-buttons">
        <button
          className="share-replay-btn"
          onClick={handleShareReplay}
          disabled={isAutoSaving || !autoSavedId}
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

      {toastMessage && (
        <div className="toast-notification fadeIn">
          {toastMessage}
        </div>
      )}

      {isStatsOpen && <StatsModal deviceId={deviceId} onClose={() => setIsStatsOpen(false)} />}

      {isModalOpen && (
        <div className="modal-overlay" onClick={() => !isSaving && setIsModalOpen(false)}>
          <div className="modal-content glass-panel" onClick={(e) => e.stopPropagation()}>
            <h3>참가자 그룹 저장</h3>
            <p>저장할 그룹의 이름을 입력해주세요.<br/>(예: 대학 동창, 개발팀 회식)</p>
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
