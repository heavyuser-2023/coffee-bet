import { useState, useEffect, useId, useRef, useMemo, type FormEvent } from 'react';
import type { GameMode, Player, TrajectoryFrame } from '../types';
import './ResultScreen.css';
import {
  BarChart3,
  ChevronRight,
  Coffee,
  LogIn,
  RotateCcw,
  Save,
  Share2,
  SlidersHorizontal,
} from 'lucide-react';
import { useMutation, useQuery, useConvexAuth } from 'convex/react';

import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { PLAYER_COLORS } from '../constants';
import { computeOutcome } from '../game/outcome';
import { buildWittyLines, normalizeName, summarize, type GameRecord } from '../game/stats';
import { Modal } from './ui/Modal';
import type { ToastTone } from './ui/Toast';

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
  raceResults: string[];
  gameMode: GameMode;
  onRestart: () => void;
  onQuickRematch: () => void;
  onOpenStats: () => void;
  onSignIn: () => Promise<void>;
  onNotify: (msg: string, tone?: ToastTone) => void;
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
  onQuickRematch,
  onOpenStats,
  onSignIn,
  onNotify,
  trajectory,
  videoBlob,
  deviceId,
}: Props) {
  const { isAuthenticated } = useConvexAuth();
  const saveGroup = useMutation(api.participants.saveGroup);
  const saveReplayMutation = useMutation(api.replays.saveReplay);
  const generateUploadUrl = useMutation(api.replays.generateUploadUrl);
  const recordGame = useMutation(api.gameRecords.recordGame);
  const gameHistory = useQuery(api.gameRecords.listRecords, { deviceId });

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [groupTitle, setGroupTitle] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [autoSavedId, setAutoSavedId] = useState<string | null>(null);
  const [isAutoSaving, setIsAutoSaving] = useState(false);
  const hasRequestedSave = useRef(false);
  const groupInputRef = useRef<HTMLInputElement>(null);

  const saveFormId = useId();
  const groupInputId = useId();

  useEffect(() => {
    if (!isModalOpen || !isAuthenticated) return;
    const rafId = window.requestAnimationFrame(() => {
      groupInputRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(rafId);
  }, [isModalOpen, isAuthenticated]);

  useEffect(() => {
    if (hasRequestedSave.current) return;
    const hasTrajectory = !!trajectory && trajectory.length > 0;
    if (!videoBlob && !hasTrajectory) return;

    const performAutoSave = async () => {
      hasRequestedSave.current = true;
      setIsAutoSaving(true);
      try {
        // 1) 녹화 영상이 있으면 Convex 스토리지에 업로드 → storageId 확보
        let videoStorageId: Id<'_storage'> | undefined = undefined;
        if (videoBlob) {
          try {
            const uploadUrl = await generateUploadUrl();
            // 저장 Content-Type은 컨테이너 타입만 남김(예: video/mp4) — 일부 엄격한 플레이어가
            // "video/webm;codecs=vp9" 같은 비표준 헤더를 거부하는 문제 방지
            const contentType = (videoBlob.type || 'video/webm').split(';')[0];
            const res = await fetch(uploadUrl, {
              method: 'POST',
              headers: { 'Content-Type': contentType },
              body: videoBlob,
            });
            if (res.ok) {
              const { storageId } = await res.json();
              videoStorageId = storageId as Id<'_storage'>;
            } else {
              console.error('영상 업로드 실패:', res.status);
            }
          } catch (uploadErr) {
            console.error('영상 업로드 중 오류:', uploadErr);
          }
        }

        // 2) 메타데이터 + (영상 storageId | 궤적 폴백) 저장
        const replayId = await saveReplayMutation({
          deviceId,
          players: players.map((p) => ({ id: p.id, name: p.name })),
          amountsPool,
          gameMode,
          raceResults,
          videoStorageId,
          trajectory: hasTrajectory ? JSON.stringify(trajectory) : undefined,
        });
        setAutoSavedId(replayId);
      } catch (e) {
        console.error('리플레이 자동 저장 중 오류:', e);
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
    videoBlob,
  ]);

  // ------------------ 당첨 기록 & 오늘의 커피 통계 ------------------
  // 몰빵(all-in) 모드는 금액 개념 없이 판수·승패만 기록하므로 금액 풀을 0으로 정규화
  const effectiveAmountsPool = useMemo(
    () => (gameMode === 'random' ? amountsPool : amountsPool.map(() => 0)),
    [gameMode, amountsPool],
  );

  // 이 결과 화면(=게임 1판)을 식별하는 ID와 시각. 서버 중복 저장 방지 및 통계 문구 고정에 사용
  const [clientGameId] = useState(
    () => `${deviceId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
  );
  const [finishedAt] = useState(() => Date.now());
  const currentRecord = useMemo<GameRecord>(
    () => ({
      clientGameId,
      createdAt: finishedAt,
      gameMode,
      results: computeOutcome(players, raceResults, effectiveAmountsPool).map((o) => ({
        name: o.player.name,
        rank: o.rank,
        amount: o.amount,
        isLoser: o.isLoser,
      })),
    }),
    [clientGameId, finishedAt, gameMode, players, raceResults, effectiveAmountsPool],
  );

  // 이전 기록 + 이번 판을 합산한 참가자별 전적 (몇 판 했는지 / 몇 번 이겼는지 표시용)
  const allRecordsWithCurrent = useMemo(() => {
    const base = gameHistory ?? [];
    return [...base.filter((r) => r.clientGameId !== currentRecord.clientGameId), currentRecord];
  }, [gameHistory, currentRecord]);

  const playerStatsMap = useMemo(() => {
    const summary = summarize(allRecordsWithCurrent);
    return new Map(summary.people.map((p) => [p.name, p]));
  }, [allRecordsWithCurrent]);

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
    }).catch((e) => console.error('게임 기록 저장 중 오류:', e));
  }, [recordGame, deviceId, currentRecord]);

  // 이전 기록 + 이번 판으로 만든 한마디 (서버 저장 완료를 기다리지 않고 바로 계산)
  const wittyLines = useMemo(
    () =>
      gameHistory
        ? buildWittyLines(gameHistory, currentRecord, { random: seededRandom(currentRecord.clientGameId) })
        : null,
    [gameHistory, currentRecord],
  );

  const handleOpenSaveModal = () => {
    setIsModalOpen(true);
  };

  const handleModalSignIn = async () => {
    setIsSigningIn(true);
    try {
      await onSignIn();
    } finally {
      setIsSigningIn(false);
    }
  };

  const confirmSave = async () => {
    if (!groupTitle.trim()) {
      onNotify('그룹 이름을 입력해주세요.', 'error');
      return;
    }
    setIsSaving(true);
    try {
      await saveGroup({
        title: groupTitle.trim(),
        players: players.map((p) => ({ id: p.id, name: p.name })),
      });
      onNotify(`'${groupTitle.trim()}' 그룹이 저장되었습니다!`, 'success');
      setIsModalOpen(false);
      setGroupTitle('');
    } catch (e) {
      console.error(e);
      onNotify('저장 중 오류가 발생했습니다.', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    void confirmSave();
  };

  const copyToClipboard = async (url: string) => {
    if (navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(url);
        onNotify('리플레이 공유 링크가 클립보드에 복사되었습니다.', 'success');
        return;
      } catch (err) {
        console.error('클립보드 API 복사 실패:', err);
      }
    }

    // Fallback 복사 방식
    const tempInput = document.createElement('input');
    tempInput.value = url;
    document.body.appendChild(tempInput);
    tempInput.select();
    try {
      document.execCommand('copy');
      onNotify('리플레이 공유 링크가 복사되었습니다.', 'success');
    } catch (err) {
      console.error('Fallback 복사 실패:', err);
      onNotify('링크 복사에 실패했습니다. 다시 시도해주세요.', 'error');
    }
    document.body.removeChild(tempInput);
  };

  const handleShareReplay = async () => {
    if (isAutoSaving || !autoSavedId) {
      onNotify('리플레이를 저장하는 중입니다. 잠시만 기다려주세요.', 'default');
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

  // 매핑 결과 계산 (raceResults의 순서대로 effectiveAmountsPool의 금액을 받음)
  const totalBill = effectiveAmountsPool.reduce((a, b) => a + b, 0);
  const hasAmount = totalBill > 0;
  const finalResults = computeOutcome(players, raceResults, effectiveAmountsPool).map((outcome) => {
    const playerIdx = players.findIndex((p) => p.id === outcome.player.id);
    return {
      ...outcome,
      color: PLAYER_COLORS[(playerIdx >= 0 ? playerIdx : 0) % PLAYER_COLORS.length],
    };
  });

  const losers = finalResults.filter((r) => r.isLoser);
  const isRandomWithAmount = gameMode === 'random' && hasAmount;
  const soleLoser = losers.length === 1 ? losers[0] : null;
  const soleLoserStat = soleLoser
    ? playerStatsMap.get(normalizeName(soleLoser.player.name))
    : undefined;

  return (
    <div className="result-container">
      {/* 당첨자 스포트라이트 히어로 카드 */}
      {losers.length > 0 && (
        <section className="ui-card result-hero-card" aria-label="당첨자 스포트라이트">
          <div className="result-hero-header">
            <span className="result-hero-badge">
              <Coffee size={14} aria-hidden="true" />
              <span>
                {isRandomWithAmount
                  ? losers.length > 1
                    ? '공동 최다 부담'
                    : '최다 부담'
                  : losers.length > 1
                    ? '공동 당첨 · 오늘의 커피'
                    : '오늘의 커피 당첨'}
              </span>
            </span>
            <span className="result-hero-mode tabular-nums">
              {isRandomWithAmount
                ? `총 ${totalBill.toLocaleString()}원`
                : `${finalResults.length}명 레이스`}
            </span>
          </div>

          {soleLoser ? (
            <div className="result-hero-single">
              <div className="result-hero-identity">
                <span
                  className="result-hero-dot"
                  style={{
                    backgroundColor: soleLoser.color,
                    boxShadow: `0 0 16px ${soleLoser.color}`,
                  }}
                  aria-hidden="true"
                />
                <h2 className="result-hero-name">{soleLoser.player.name}</h2>
              </div>

              <div className="result-hero-metrics">
                <div className="result-hero-primary tabular-nums">
                  {isRandomWithAmount
                    ? `${soleLoser.amount.toLocaleString()}원`
                    : '오늘 커피 쏘는 날'}
                </div>
                <div className="result-hero-record tabular-nums">
                  {soleLoserStat
                    ? `${soleLoserStat.games}전 ${soleLoserStat.wins}승 · ${soleLoserStat.losses}회 당첨`
                    : '첫 기록'}
                </div>
              </div>
            </div>
          ) : (
            <ul className="result-hero-co-list">
              {losers.map((loser) => {
                const stat = playerStatsMap.get(normalizeName(loser.player.name));
                return (
                  <li key={loser.player.id} className="result-hero-co-item">
                    <div className="result-hero-co-left">
                      <span
                        className="result-hero-dot is-compact"
                        style={{
                          backgroundColor: loser.color,
                          boxShadow: `0 0 12px ${loser.color}`,
                        }}
                        aria-hidden="true"
                      />
                      <span className="result-hero-co-name">{loser.player.name}</span>
                    </div>
                    <div className="result-hero-co-right tabular-nums">
                      <span className="result-hero-co-value">
                        {isRandomWithAmount
                          ? `${loser.amount.toLocaleString()}원`
                          : '오늘 당첨'}
                      </span>
                      <span className="result-hero-co-stat">
                        {stat ? `${stat.games}전 ${stat.wins}승` : '첫 기록'}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      {/* 순위표 카드 */}
      <section className="ui-card result-panel" aria-label="레이스 순위표">
        <div className="result-panel-header">
          <h3 className="result-panel-title">전체 순위</h3>
          <span className="result-panel-count tabular-nums">{finalResults.length}명</span>
        </div>

        <ul className="result-list">
          {finalResults.map((res, index) => {
            const stat = playerStatsMap.get(normalizeName(res.player.name));
            const rankBadgeClass = res.isLoser
              ? 'is-loser'
              : res.rank === 1
                ? 'is-first'
                : res.rank === 2
                  ? 'is-second'
                  : res.rank === 3
                    ? 'is-third'
                    : '';

            const primaryOutcomeText =
              gameMode === 'all-in'
                ? res.isLoser
                  ? '오늘 당첨'
                  : '통과'
                : res.isLoser
                  ? hasAmount
                    ? `${res.amount.toLocaleString()}원`
                    : '오늘 당첨'
                  : res.amount > 0
                    ? `${res.amount.toLocaleString()}원`
                    : hasAmount
                      ? '공짜!'
                      : '통과';

            const outcomeToneClass = res.isLoser
              ? 'is-danger'
              : res.amount > 0
                ? 'is-warning'
                : 'is-success';

            const recordCaption = stat
              ? `${res.rank}위 · ${stat.games}전 ${stat.wins}승`
              : `${res.rank}위 · 첫 기록`;

            return (
              <li
                key={res.player.id}
                className={`result-item ${res.isLoser ? 'is-loser' : ''}`}
                style={{ animationDelay: `${index * 0.08}s` }}
              >
                <div className="result-item-left">
                  <span
                    className={`result-rank-badge tabular-nums ${rankBadgeClass}`}
                    aria-label={res.isLoser ? `${res.rank}위 당첨` : `${res.rank}위`}
                  >
                    {res.isLoser ? (
                      <Coffee size={15} aria-hidden="true" />
                    ) : (
                      <span>{res.rank}위</span>
                    )}
                  </span>

                  <span
                    className="result-player-dot"
                    style={{
                      backgroundColor: res.color,
                      boxShadow: `0 0 8px ${res.color}`,
                    }}
                    aria-hidden="true"
                  />

                  <span className="result-player-name">{res.player.name}</span>
                </div>

                <div className="result-outcome">
                  <span className={`result-outcome-main tabular-nums ${outcomeToneClass}`}>
                    {primaryOutcomeText}
                  </span>
                  <span className="result-outcome-sub tabular-nums">{recordCaption}</span>
                </div>
              </li>
            );
          })}
        </ul>

        {gameMode === 'all-in' ? (
          <div className="result-summary tabular-nums">
            총 <strong>{allRecordsWithCurrent.length}번</strong>의 게임 · 오늘의 커피는{' '}
            <strong>{losers.map((r) => r.player.name).join(', ')}</strong>님
          </div>
        ) : hasAmount ? (
          <div className="result-summary tabular-nums">
            총 결제 금액 <strong>{totalBill.toLocaleString()}원</strong>
          </div>
        ) : null}
      </section>

      {/* 오늘의 커피 통계 위트 카드 */}
      <section className="ui-card witty-card" aria-label="오늘의 커피 통계">
        <div className="witty-header">
          <div className="witty-title-wrap">
            <BarChart3 size={16} className="witty-title-icon" aria-hidden="true" />
            <h3>오늘의 커피 통계</h3>
          </div>
          <button type="button" className="witty-more" onClick={onOpenStats}>
            <span>기록 보기</span>
            <ChevronRight size={15} aria-hidden="true" />
          </button>
        </div>
        {wittyLines ? (
          <ul className="witty-lines">
            {wittyLines.map((line, i) => (
              <li key={line} style={{ animationDelay: `${0.25 + i * 0.22}s` }}>
                {line}
              </li>
            ))}
          </ul>
        ) : (
          <p className="witty-loading">통계를 계산하는 중...</p>
        )}
      </section>

      {/* 재경기 중심 하단 액션 동선 */}
      <div className="result-actions">
        <button
          type="button"
          className="ui-btn ui-btn-primary result-cta-primary"
          onClick={onQuickRematch}
        >
          <RotateCcw size={18} aria-hidden="true" />
          <span>바로 한 판 더</span>
        </button>

        <button
          type="button"
          className="ui-btn ui-btn-secondary result-cta-secondary"
          onClick={onRestart}
        >
          <SlidersHorizontal size={17} aria-hidden="true" />
          <span>설정 변경</span>
        </button>

        <div className="result-sub-actions">
          <button
            type="button"
            className="ui-btn ui-btn-secondary result-sub-btn"
            onClick={handleShareReplay}
            disabled={isAutoSaving || !autoSavedId}
          >
            <Share2 size={16} aria-hidden="true" />
            <span>{isAutoSaving ? '저장 중...' : '리플레이 공유'}</span>
          </button>

          <button
            type="button"
            className="ui-btn ui-btn-secondary result-sub-btn"
            onClick={handleOpenSaveModal}
            disabled={isSaving}
          >
            <Save size={16} aria-hidden="true" />
            <span>{isSaving ? '저장 중...' : '참가자 저장'}</span>
          </button>
        </div>
      </div>

      {/* 참가자 저장 모달 */}
      <Modal
        open={isModalOpen}
        onClose={() => {
          if (!isSaving && !isSigningIn) setIsModalOpen(false);
        }}
        title="참가자 그룹 저장"
        subtitle={
          isAuthenticated
            ? `현재 참가자 ${players.length}명을 그룹으로 저장합니다.`
            : '참가자 그룹을 저장하려면 Google 로그인이 필요합니다.'
        }
        size="sm"
        closedby={isSaving || isSigningIn ? 'none' : 'any'}
        footer={
          isAuthenticated ? (
            <>
              <button
                type="button"
                className="ui-btn ui-btn-secondary"
                onClick={() => setIsModalOpen(false)}
                disabled={isSaving}
              >
                취소
              </button>
              <button
                type="submit"
                form={saveFormId}
                className="ui-btn ui-btn-primary"
                disabled={isSaving}
              >
                {isSaving ? '저장 중...' : '저장하기'}
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="ui-btn ui-btn-secondary"
                onClick={() => setIsModalOpen(false)}
                disabled={isSigningIn}
              >
                닫기
              </button>
              <button
                type="button"
                className="ui-btn ui-btn-primary"
                onClick={handleModalSignIn}
                disabled={isSigningIn}
              >
                <LogIn size={16} aria-hidden="true" />
                <span>{isSigningIn ? '연결 중...' : 'Google로 로그인하기'}</span>
              </button>
            </>
          )
        }
      >
        <div className="result-save-modal-body">
          {isAuthenticated ? (
            <form id={saveFormId} onSubmit={handleSaveSubmit} className="result-save-form">
              <label htmlFor={groupInputId} className="result-save-label">
                그룹 이름
              </label>
              <input
                ref={groupInputRef}
                id={groupInputId}
                type="text"
                value={groupTitle}
                onChange={(e) => setGroupTitle(e.target.value)}
                placeholder="예: 대학 동창, 개발팀 회식"
                className="result-save-input"
                maxLength={40}
                disabled={isSaving}
              />
            </form>
          ) : (
            <p className="result-save-auth-desc">
              로그인하면 현재 참가자 구성을 계정에 저장하고 다음 내기에서 바로 불러올 수 있습니다.
            </p>
          )}

          <div className="result-save-preview" aria-label="저장될 참가자 목록">
            {players.map((p, index) => (
              <span key={p.id} className="result-save-chip">
                <span
                  className="result-save-chip-dot"
                  style={{
                    backgroundColor: PLAYER_COLORS[index % PLAYER_COLORS.length],
                  }}
                  aria-hidden="true"
                />
                <span>{p.name}</span>
              </span>
            ))}
          </div>
        </div>
      </Modal>
    </div>
  );
}
