import { useState } from 'react'
import './App.css'
import { SetupScreen } from './components/SetupScreen'
import { RaceScreen } from './components/RaceScreen'
import { ResultScreen } from './components/ResultScreen'
import type { GameMode, Player, GameState } from './types'

function App() {
  const [gameState, setGameState] = useState<GameState>('setup');
  const [players, setPlayers] = useState<Player[]>([
    { id: '1', name: '참가자 1' },
    { id: '2', name: '참가자 2' }
  ]);
  const [totalAmount, setTotalAmount] = useState<number>(10000);
  const [gameMode, setGameMode] = useState<GameMode>('all-in');
  const [amountsPool, setAmountsPool] = useState<number[]>([]);
  const [raceResults, setRaceResults] = useState<string[]>([]); // array of player ids in order of finish

  const handleStartRace = (amounts: number[]) => {
    // 순위별 금액 배열 (내림차순 정렬 혹은 섞인 순서 등 상황에 맞게)
    // SetupScreen에서 이미 정해서 넘겨줌
    setAmountsPool(amounts);
    setGameState('race');
  }

  const handleRaceFinish = (results: string[]) => {
    setRaceResults(results);
    setGameState('result');
  }

  const handleRestart = () => {
    setGameState('setup');
    setAmountsPool([]);
    setRaceResults([]);
  }

  return (
    <div className="app-container">
      {gameState === 'setup' && (
        <SetupScreen 
          players={players} 
          setPlayers={setPlayers}
          totalAmount={totalAmount}
          setTotalAmount={setTotalAmount}
          gameMode={gameMode}
          setGameMode={setGameMode}
          onStart={handleStartRace}
        />
      )}
      
      {gameState === 'race' && (
        <RaceScreen 
          players={players}
          amountsPool={amountsPool}
          onFinish={handleRaceFinish}
        />
      )}

      {gameState === 'result' && (
        <ResultScreen 
          players={players}
          amountsPool={amountsPool}
          raceResults={raceResults}
          onRestart={handleRestart}
        />
      )}
    </div>
  )
}

export default App
