import { useQuery } from 'convex/react';
import { Coffee, Film, Play } from 'lucide-react';
import { api } from '../../convex/_generated/api';
import { computeOutcome } from '../game/outcome';
import { Modal } from './ui/Modal';
import './ReplayListModal.css';

export interface ReplayListModalProps {
  open: boolean;
  deviceId: string;
  onClose: () => void;
  onSelectReplay: (id: string) => void;
}

export function ReplayListModal({
  open,
  deviceId,
  onClose,
  onSelectReplay,
}: ReplayListModalProps) {
  const savedReplays = useQuery(api.replays.getReplays, open ? { deviceId } : 'skip');

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="최근 게임 리플레이"
      subtitle="최근 진행한 게임 리플레이 (최대 10개 보관)"
      size="md"
    >
      {savedReplays === undefined ? (
        <div className="replay-list-empty">
          <div className="replay-list-spinner" aria-hidden="true" />
          <p>리플레이 목록을 불러오는 중입니다...</p>
        </div>
      ) : savedReplays.length === 0 ? (
        <div className="replay-list-empty">
          <span className="replay-list-empty-icon" aria-hidden="true">
            <Film size={24} />
          </span>
          <p className="replay-list-empty-title">저장된 리플레이가 없습니다</p>
          <p className="replay-list-empty-desc">
            마블 레이스를 완료하면 최근 10개의 경기가 자동으로 저장됩니다.
          </p>
        </div>
      ) : (
        <ul className="replay-list">
          {savedReplays.map((replay) => {
            const dateStr = new Date(replay.createdAt).toLocaleString('ko-KR', {
              month: 'short',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            });
            const isAllIn = replay.gameMode === 'all-in';
            const modeText = isAllIn ? '한 명 몰빵' : '랜덤 분배';
            const playerNames = replay.players.map((p) => p.name).join(', ');
            const outcomes = computeOutcome(
              replay.players,
              replay.raceResults,
              replay.amountsPool,
            );
            const losers = outcomes.filter((o) => o.isLoser);
            const loserNames = losers.map((o) => o.player.name).join(', ');
            const maxPaid = losers[0]?.amount ?? 0;

            return (
              <li key={replay._id}>
                <button
                  type="button"
                  className="replay-card"
                  onClick={() => {
                    onSelectReplay(replay._id);
                    onClose();
                  }}
                >
                  <div className="replay-card-main">
                    <div className="replay-card-top">
                      <span className="replay-card-date tabular-nums">{dateStr}</span>
                      <span
                        className={`replay-mode-badge ${isAllIn ? 'is-all-in' : 'is-random'}`}
                      >
                        {modeText}
                      </span>
                    </div>

                    <div className="replay-card-players">{playerNames}</div>

                    {loserNames && (
                      <div className="replay-card-loser">
                        <Coffee size={14} aria-hidden="true" />
                        <span>{loserNames}</span>
                        {!isAllIn && maxPaid > 0 && (
                          <span className="replay-card-amount tabular-nums">
                            ({maxPaid.toLocaleString()}원)
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  <span className="replay-card-play" aria-hidden="true">
                    <Play size={15} />
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Modal>
  );
}
