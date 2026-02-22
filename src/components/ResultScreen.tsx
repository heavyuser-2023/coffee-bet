import type { Player } from '../types';
import './ResultScreen.css';
import { RotateCcw, Trophy, Award } from 'lucide-react';

interface Props {
  players: Player[];
  amountsPool: number[];
  raceResults: string[]; // player_id array
  onRestart: () => void;
}

const PLAYER_COLORS = ['#ef4444', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6'];

export function ResultScreen({ players, amountsPool, raceResults, onRestart }: Props) {
  // 매핑 결과 계산
  // raceResults의 순서대로 amountsPool의 금액을 받음
  const finalResults = raceResults.map((id, index) => {
    const player = players.find(p => p.id === id)!;
    const amount = amountsPool[index] || 0;
    const color = PLAYER_COLORS[players.findIndex(p => p.id === id) % PLAYER_COLORS.length];
    return { player, amount, rank: index + 1, color };
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
              className={`result-item fadeIn ${index === 0 ? 'first-place' : ''}`}
              style={{ animationDelay: `${index * 0.15}s` }}
            >
              <div className="rank">
                {index === 0 ? <Trophy className="icon-gold" size={24} /> : 
                 index === 1 ? <Award className="icon-silver" size={24} /> : 
                 <span className="rank-text">{res.rank}위</span>}
              </div>
              <div className="player-info">
                <span className="dot" style={{ backgroundColor: res.color }}></span>
                <span className="name">{res.player.name}</span>
              </div>
              <div className="amount">
                {res.amount > 0 ? (
                  <span className="amount-value text-danger">{res.amount.toLocaleString()}원</span>
                ) : (
                  <span className="amount-value text-success">공짜! 🥳</span>
                )}
              </div>
            </div>
          ))}
        </div>
        
        <div className="summary">
          총 결제 금액: <strong>{amountsPool.reduce((a, b) => a + b, 0).toLocaleString()}원</strong>
        </div>
      </div>

      <button className="btn-primary restart-btn" onClick={onRestart}>
        <RotateCcw size={20} className="icon-mr" /> 다시 하기
      </button>
    </div>
  );
}
