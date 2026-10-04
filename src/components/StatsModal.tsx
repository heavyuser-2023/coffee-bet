import { useMemo, useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { ChevronLeft, ChevronRight, Trash2, X } from 'lucide-react';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import {
  currentStreak,
  getPeriod,
  inPeriod,
  personTimeline,
  summarize,
  type PeriodKind,
} from '../game/stats';
import './StatsModal.css';

interface Props {
  deviceId: string;
  onClose: () => void;
}

const TABS: { kind: PeriodKind; label: string }[] = [
  { kind: 'week', label: '주간' },
  { kind: 'month', label: '월간' },
  { kind: 'all', label: '전체' },
];

const RECENT_LIMIT = 15;
const DOTS_LIMIT = 10;

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
const pad2 = (n: number) => String(n).padStart(2, '0');
// 예: 10/4(일) 17:16
const formatGameTime = (ts: number) => {
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()}(${WEEKDAYS[d.getDay()]}) ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};

/**
 * 💡 당첨 기록·통계 모달
 * 주간/월간/전체 기간별로 누가 몇 번 걸렸는지 순위를 보여주고, 사람을 누르면 개인 기록을 펼쳐 보여준다.
 */
export function StatsModal({ deviceId, onClose }: Props) {
  const records = useQuery(api.gameRecords.listRecords, { deviceId });
  const deleteRecord = useMutation(api.gameRecords.deleteRecord);

  const [kind, setKind] = useState<PeriodKind>('week');
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [now] = useState(() => Date.now());

  const all = useMemo(() => records ?? [], [records]); // 최신순
  const period = useMemo(() => getPeriod(kind, offset, now), [kind, offset, now]);
  const inRange = useMemo(() => all.filter((r) => inPeriod(r, period)), [all, period]);
  const summary = useMemo(() => summarize(inRange), [inRange]);

  const oldestAt = all.length > 0 ? all[all.length - 1].createdAt : now;
  const canGoPrev = kind !== 'all' && period.start > oldestAt;
  const canGoNext = kind !== 'all' && offset < 0;
  const maxLosses = Math.max(1, ...summary.people.map((p) => p.losses));

  const changeKind = (next: PeriodKind) => {
    setKind(next);
    setOffset(0);
    setSelected(null);
  };

  const movePeriod = (delta: number) => {
    setOffset((o) => Math.min(0, o + delta));
    setSelected(null);
  };

  const handleDelete = async (id: string, label: string) => {
    if (!window.confirm(`${label} 게임 기록을 삭제할까요?\n삭제하면 통계에서도 빠집니다.`)) return;
    try {
      await deleteRecord({ id: id as Id<'gameRecords'>, deviceId });
    } catch (e) {
      console.error('게임 기록 삭제 실패:', e);
      alert('기록을 삭제하지 못했습니다.');
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content glass-panel stats-modal" onClick={(e) => e.stopPropagation()}>
        <div className="stats-title-row">
          <h3>📊 커피 당첨 기록</h3>
          <button className="stats-close-icon" onClick={onClose} aria-label="닫기" title="닫기">
            <X size={18} />
          </button>
        </div>

        <div className="stats-tabs" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.kind}
              role="tab"
              aria-selected={kind === t.kind}
              className={`stats-tab ${kind === t.kind ? 'active' : ''}`}
              onClick={() => changeKind(t.kind)}
            >
              {t.label}
            </button>
          ))}
        </div>

        {kind !== 'all' && (
          <div className="stats-period-nav">
            <button onClick={() => movePeriod(-1)} disabled={!canGoPrev} aria-label="이전 기간">
              <ChevronLeft size={18} />
            </button>
            <div className="stats-period-label">
              <strong>{period.title}</strong>
              <span>{period.subtitle}</span>
            </div>
            <button onClick={() => movePeriod(1)} disabled={!canGoNext} aria-label="다음 기간">
              <ChevronRight size={18} />
            </button>
          </div>
        )}

        <div className="stats-body">
          {records === undefined ? (
            <p className="stats-empty">불러오는 중...</p>
          ) : summary.games === 0 ? (
            <p className="stats-empty">
              {all.length === 0
                ? '아직 게임 기록이 없어요. 레이스가 끝나면 자동으로 기록됩니다 ☕'
                : '이 기간에는 게임 기록이 없어요 ☕'}
            </p>
          ) : (
            <>
              <div className="stats-summary">
                <div>
                  <span className="stats-summary-value">{summary.games}</span>
                  <span className="stats-summary-label">게임</span>
                </div>
                <div>
                  <span className="stats-summary-value">{summary.people.length}</span>
                  <span className="stats-summary-label">참가자</span>
                </div>
                <div>
                  <span className="stats-summary-value">
                    {summary.totalPaid > 0 ? `${summary.totalPaid.toLocaleString()}원` : '-'}
                  </span>
                  <span className="stats-summary-label">총 결제</span>
                </div>
              </div>

              <h4 className="stats-section-title">누가 제일 많이 걸렸을까?</h4>
              <ul className="stats-ranking">
                {summary.people.map((p, index) => {
                  const isOpen = selected === p.name;
                  const isKing = index === 0 && p.losses > 0;
                  return (
                    <li key={p.name} className={`stats-person ${isOpen ? 'open' : ''}`}>
                      <button
                        className="stats-person-row"
                        onClick={() => setSelected(isOpen ? null : p.name)}
                        aria-expanded={isOpen}
                      >
                        <span className="stats-rank">{isKing ? '👑' : p.losses === 0 ? '🍀' : index + 1}</span>
                        <span className="stats-name">{p.name}</span>
                        <span className="stats-bar" aria-hidden>
                          <span style={{ width: `${(p.losses / maxLosses) * 100}%` }} />
                        </span>
                        <span className="stats-losses">{p.losses}회</span>
                      </button>
                      <div className="stats-person-sub">
                        {p.games}판 중 {p.losses}번 당첨 · 당첨률 {Math.round(p.lossRate * 100)}%
                        {p.paid > 0 && ` · ${p.paid.toLocaleString()}원`}
                      </div>
                      {isOpen && <PersonDetail name={p.name} records={all} />}
                    </li>
                  );
                })}
              </ul>

              <h4 className="stats-section-title">최근 게임</h4>
              <ul className="stats-games">
                {inRange.slice(0, RECENT_LIMIT).map((r) => {
                  const losers = r.results.filter((x) => x.isLoser).map((x) => x.name);
                  const time = formatGameTime(r.createdAt);
                  return (
                    <li key={r._id} className="stats-game">
                      <span className="stats-game-time">{time}</span>
                      <span className="stats-game-loser">☕ {losers.join(', ')}</span>
                      <span className="stats-game-count">{r.results.length}명</span>
                      <button
                        className="stats-game-delete"
                        onClick={() => handleDelete(r._id, time)}
                        aria-label={`${time} 게임 기록 삭제`}
                        title="기록 삭제"
                      >
                        <Trash2 size={14} />
                      </button>
                    </li>
                  );
                })}
              </ul>
              {inRange.length > RECENT_LIMIT && (
                <p className="stats-more">외 {inRange.length - RECENT_LIMIT}게임</p>
              )}
            </>
          )}
        </div>

        <div className="modal-actions" style={{ justifyContent: 'center' }}>
          <button className="btn-close" onClick={onClose}>닫기</button>
        </div>
      </div>
    </div>
  );
}

// 사람을 눌렀을 때 펼쳐지는 개인 통산 기록 (기간과 무관하게 전체 기록 기준)
function PersonDetail({ name, records }: { name: string; records: Parameters<typeof personTimeline>[0] }) {
  const timeline = useMemo(() => personTimeline(records, name), [records, name]);
  const losses = timeline.filter((g) => g.isLoser).length;
  const paid = timeline.reduce((sum, g) => sum + g.amount, 0);
  const streak = currentStreak(timeline);
  const recent = timeline.slice(-DOTS_LIMIT);

  return (
    <div className="stats-detail fadeIn">
      <div className="stats-detail-line">
        통산 <strong>{timeline.length}판 중 {losses}번</strong> 당첨
        {timeline.length > 0 && ` (${Math.round((losses / timeline.length) * 100)}%)`}
        {paid > 0 && ` · 누적 ${paid.toLocaleString()}원`}
      </div>
      {streak && streak.count >= 2 && (
        <div className="stats-detail-line">
          {streak.kind === 'lose' ? `🔥 현재 ${streak.count}연속 당첨 중` : `🍀 현재 ${streak.count}판 연속 생존 중`}
        </div>
      )}
      <div className="stats-detail-dots" aria-label={`최근 ${recent.length}판 결과`}>
        <span className="stats-detail-dots-label">최근 {recent.length}판</span>
        {recent.map((g) => (
          <span
            key={g.clientGameId}
            className={`stats-dot ${g.isLoser ? 'lose' : 'survive'}`}
            title={`${formatGameTime(g.createdAt)} · ${g.isLoser ? '당첨' : '생존'}`}
          />
        ))}
      </div>
    </div>
  );
}
