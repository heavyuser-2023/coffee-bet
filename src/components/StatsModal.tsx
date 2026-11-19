import { useId, useMemo, useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clover,
  Crown,
  Trash2,
} from 'lucide-react';
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
import { Modal } from './ui/Modal';
import { ConfirmDialog } from './ui/ConfirmDialog';
import type { ToastTone } from './ui/Toast';
import './StatsModal.css';

interface Props {
  open: boolean;
  deviceId: string;
  onClose: () => void;
  onNotify?: (msg: string, tone?: ToastTone) => void;
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

interface DeleteTarget {
  id: string;
  label: string;
}

/**
 * 당첨 기록·통계 모달
 * 주간/월간/전체 기간별로 누가 몇 번 걸렸는지 순위를 보여주고, 사람을 누르면 개인 기록을 펼쳐 보여준다.
 */
export function StatsModal({ open, deviceId, onClose, onNotify }: Props) {
  const records = useQuery(api.gameRecords.listRecords, open ? { deviceId } : 'skip');
  const deleteRecord = useMutation(api.gameRecords.deleteRecord);

  const [kind, setKind] = useState<PeriodKind>('week');
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const listIdPrefix = useId();

  const all = useMemo(() => records ?? [], [records]); // 최신순
  const period = useMemo(() => getPeriod(kind, offset, now), [kind, offset, now]);
  const inRange = useMemo(() => all.filter((r) => inPeriod(r, period)), [all, period]);
  const summary = useMemo(() => summarize(inRange), [inRange]);

  const oldestAt = all.length > 0 ? all[all.length - 1].createdAt : now;
  const canGoPrev = kind !== 'all' && period.start > oldestAt;
  const canGoNext = kind !== 'all' && offset < 0;
  const maxLosses = Math.max(1, ...summary.people.map((p) => p.losses));
  const maxWins = Math.max(0, ...summary.people.map((p) => p.wins));

  const changeKind = (next: PeriodKind) => {
    setNow(Date.now());
    setKind(next);
    setOffset(0);
    setSelected(null);
  };

  const movePeriod = (delta: number) => {
    setNow(Date.now());
    setOffset((o) => Math.min(0, o + delta));
    setSelected(null);
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      await deleteRecord({ id: deleteTarget.id as Id<'gameRecords'>, deviceId });
      setDeleteTarget(null);
      onNotify?.('게임 기록을 삭제했습니다.', 'success');
    } catch (e) {
      console.error('게임 기록 삭제 실패:', e);
      onNotify?.('기록을 삭제하지 못했습니다.', 'error');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title="커피 당첨 기록"
        size="md"
        footer={
          <button type="button" className="ui-btn ui-btn-secondary" onClick={onClose}>
            닫기
          </button>
        }
      >
        <div className="stats-modal-content">
          <div className="stats-tabs" role="tablist" aria-label="통계 기간">
            {TABS.map((t) => {
              const isActive = kind === t.kind;
              return (
                <button
                  key={t.kind}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  className={`stats-tab ${isActive ? 'is-active' : ''}`}
                  onClick={() => changeKind(t.kind)}
                >
                  {t.label}
                </button>
              );
            })}
          </div>

          {kind !== 'all' && (
            <div className="stats-period-nav">
              <button
                type="button"
                className="stats-period-nav-btn"
                onClick={() => movePeriod(-1)}
                disabled={!canGoPrev}
                aria-label="이전 기간"
              >
                <ChevronLeft size={18} aria-hidden="true" />
              </button>
              <div className="stats-period-label">
                <strong>{period.title}</strong>
                <span className="tabular-nums">{period.subtitle}</span>
              </div>
              <button
                type="button"
                className="stats-period-nav-btn"
                onClick={() => movePeriod(1)}
                disabled={!canGoNext}
                aria-label="다음 기간"
              >
                <ChevronRight size={18} aria-hidden="true" />
              </button>
            </div>
          )}

          <div className="stats-body">
            {records === undefined ? (
              <div className="stats-state-box">
                <div className="stats-spinner" aria-hidden="true" />
                <p className="stats-empty">기록을 불러오는 중...</p>
              </div>
            ) : summary.games === 0 ? (
              <div className="stats-state-box">
                <p className="stats-empty">
                  {all.length === 0
                    ? '아직 게임 기록이 없어요. 레이스가 끝나면 자동으로 기록됩니다.'
                    : '이 기간에는 게임 기록이 없어요.'}
                </p>
              </div>
            ) : (
              <>
                <div className="stats-summary">
                  <div className="stats-kpi-card">
                    <span className="stats-summary-value tabular-nums">{summary.games}회</span>
                    <span className="stats-summary-label">진행한 게임</span>
                  </div>
                  <div className="stats-kpi-card">
                    <span className="stats-summary-value tabular-nums">{summary.people.length}명</span>
                    <span className="stats-summary-label">참가자</span>
                  </div>
                  <div className="stats-kpi-card">
                    <span className="stats-summary-value tabular-nums">
                      {summary.totalPaid > 0 ? `${summary.totalPaid.toLocaleString()}원` : `${maxWins}승`}
                    </span>
                    <span className="stats-summary-label">
                      {summary.totalPaid > 0 ? '분배 총액' : '최다 승리'}
                    </span>
                  </div>
                </div>

                <section className="stats-section" aria-label="당첨 순위">
                  <h3 className="stats-section-title">누가 제일 많이 걸렸을까?</h3>
                  <ul className="stats-ranking">
                    {summary.people.map((p, index) => {
                      const isOpen = selected === p.name;
                      const isKing = index === 0 && p.losses > 0;
                      const detailId = `${listIdPrefix}-detail-${index}`;
                      return (
                        <li key={p.name} className={`stats-person ${isOpen ? 'is-open' : ''}`}>
                          <button
                            type="button"
                            className="stats-person-row"
                            onClick={() => setSelected(isOpen ? null : p.name)}
                            aria-expanded={isOpen}
                            aria-controls={detailId}
                          >
                            <span
                              className={`stats-rank ${isKing ? 'is-king' : p.losses === 0 ? 'is-lucky' : ''}`}
                              aria-hidden="true"
                            >
                              {isKing ? (
                                <Crown size={15} />
                              ) : p.losses === 0 ? (
                                <Clover size={15} />
                              ) : (
                                index + 1
                              )}
                            </span>
                            <span className="stats-person-main">
                              <span className="stats-person-top">
                                <span className="stats-name">{p.name}</span>
                                <span className="stats-bar" aria-hidden="true">
                                  <span style={{ width: `${(p.losses / maxLosses) * 100}%` }} />
                                </span>
                                <span className="stats-losses tabular-nums">{p.losses}회</span>
                                <ChevronDown
                                  size={15}
                                  className={`stats-chevron ${isOpen ? 'is-open' : ''}`}
                                  aria-hidden="true"
                                />
                              </span>
                              <span className="stats-person-sub tabular-nums">
                                {p.games}번 중 {p.wins}번 승리 · {p.losses}번 당첨 (승률{' '}
                                {Math.round(p.winRate * 100)}%)
                                {p.paid > 0 && ` · ${p.paid.toLocaleString()}원`}
                              </span>
                            </span>
                          </button>
                          {isOpen && <PersonDetail id={detailId} name={p.name} records={all} />}
                        </li>
                      );
                    })}
                  </ul>
                </section>

                <section className="stats-section" aria-label="최근 게임 기록">
                  <h3 className="stats-section-title">최근 게임</h3>
                  <ul className="stats-games">
                    {inRange.slice(0, RECENT_LIMIT).map((r) => {
                      const losers = r.results.filter((x) => x.isLoser).map((x) => x.name);
                      const time = formatGameTime(r.createdAt);
                      return (
                        <li key={r._id} className="stats-game">
                          <div className="stats-game-info">
                            <span className="stats-game-loser">☕ {losers.join(', ')}</span>
                            <span className="stats-game-meta tabular-nums">
                              {time} · {r.results.length}명 참가
                            </span>
                          </div>
                          <button
                            type="button"
                            className="stats-game-delete"
                            onClick={() => setDeleteTarget({ id: r._id, label: time })}
                            aria-label={`${time} 게임 기록 삭제`}
                            title="기록 삭제"
                          >
                            <Trash2 size={16} aria-hidden="true" />
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                  {inRange.length > RECENT_LIMIT && (
                    <p className="stats-more tabular-nums">외 {inRange.length - RECENT_LIMIT}게임</p>
                  )}
                </section>
              </>
            )}
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={deleteTarget !== null}
        title="게임 기록을 삭제할까요?"
        description={
          deleteTarget
            ? `${deleteTarget.label} 게임 기록을 삭제하면 통계에서도 빠집니다.`
            : ''
        }
        confirmLabel="삭제"
        cancelLabel="취소"
        variant="danger"
        isLoading={isDeleting}
        onConfirm={handleConfirmDelete}
        onCancel={() => {
          if (!isDeleting) setDeleteTarget(null);
        }}
      />
    </>
  );
}

// 사람을 눌렀을 때 펼쳐지는 개인 통산 기록 (기간과 무관하게 전체 기록 기준)
function PersonDetail({
  id,
  name,
  records,
}: {
  id: string;
  name: string;
  records: Parameters<typeof personTimeline>[0];
}) {
  const timeline = useMemo(() => personTimeline(records, name), [records, name]);
  const losses = timeline.filter((g) => g.isLoser).length;
  const wins = timeline.length - losses;
  const paid = timeline.reduce((sum, g) => sum + g.amount, 0);
  const streak = currentStreak(timeline);
  const recent = timeline.slice(-DOTS_LIMIT);

  return (
    <div id={id} className="stats-detail">
      <div className="stats-detail-line tabular-nums">
        통산 <strong>{timeline.length}번 중 {wins}번 승리 · {losses}번 당첨</strong>
        {timeline.length > 0 && ` (승률 ${Math.round((wins / timeline.length) * 100)}%)`}
        {paid > 0 && ` · 누적 ${paid.toLocaleString()}원`}
      </div>
      {streak && streak.count >= 2 && (
        <div className={`stats-detail-streak ${streak.kind === 'lose' ? 'is-lose' : 'is-win'}`}>
          {streak.kind === 'lose'
            ? `현재 ${streak.count}연속 당첨 중`
            : `현재 ${streak.count}번 연속 승리 중`}
        </div>
      )}
      <div className="stats-detail-dots" aria-label={`최근 ${recent.length}판 결과`}>
        <span className="stats-detail-dots-label">최근 {recent.length}판</span>
        <div className="stats-dots-row">
          {recent.map((g) => (
            <span
              key={g.clientGameId}
              className={`stats-dot ${g.isLoser ? 'is-lose' : 'is-survive'}`}
              title={`${formatGameTime(g.createdAt)} · ${g.isLoser ? '당첨' : '승리'}`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
