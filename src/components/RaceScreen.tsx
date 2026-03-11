import { useEffect, useRef, useState } from 'react';
import Matter from 'matter-js';
import type { Player } from '../types';
import './RaceScreen.css';

interface Props {
  players: Player[];
  amountsPool: number[];
  onFinish: (results: string[]) => void;
}

const PLAYER_COLORS = [
  '#ef4444', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6',
  '#ec4899', '#14b8a6', '#f97316', '#6366f1', '#84cc16',
  '#a855f7', '#06b6d4', '#eab308', '#f43f5e', '#d946ef',
  '#0ea5e9', '#22c55e', '#e11d48', '#4f46e5', '#ca8a04'
];

export function RaceScreen({ players, onFinish }: Props) {
  const sceneRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<Matter.Engine | null>(null);
  const renderRef = useRef<Matter.Render | null>(null);
  const [finishedPlayers, setFinishedPlayers] = useState<string[]>([]);
  const finishedRef = useRef<string[]>([]);
  
  const runnerRef = useRef<Matter.Runner | null>(null);
  
  // 선두(1위) 구슬 라벨 추적 레이더
  const leaderRef = useRef<string | null>(null);
  const slowMoTimeoutRef = useRef<number | null>(null); // NodeJS.Timeout 타입 대신 브라우저 환경 호환을 위해 number 사용

  useEffect(() => {
    if (!sceneRef.current) return;

    const Engine = Matter.Engine,
          Render = Matter.Render,
          Runner = Matter.Runner,
          Bodies = Matter.Bodies,
          Composite = Matter.Composite,
          Events = Matter.Events;

    // Create engine
    const engine = Engine.create();
    engineRef.current = engine;
    
    // Create renderer
    const width = sceneRef.current.clientWidth;
    const viewHeight = 500;
    const worldHeight = 3500; // 긴 트랙!
    
    const render = Render.create({
      element: sceneRef.current,
      engine: engine,
      options: {
        width,
        height: viewHeight,
        background: 'transparent',
        wireframes: false,
        hasBounds: true // Enable bounds for camera panning
      }
    });
    renderRef.current = render;

    // Boundary walls (약간 안쪽으로 기울어지게 해서 구슬이 구석에 끼는 것을 방지하거나, 공을 안쪽으로 튕겨내는 마찰/restitution 부여)
    const wallOptions = { 
      isStatic: true, 
      restitution: 0.8, 
      friction: 0,
      render: { fillStyle: 'rgba(255,255,255,0.1)' } 
    };
    const leftWall = Bodies.rectangle(0, worldHeight / 2, 40, worldHeight, wallOptions); // 벽 두께를 키움
    const rightWall = Bodies.rectangle(width, worldHeight / 2, 40, worldHeight, wallOptions);
    
    // Top funnel
    const funnelLeft = Bodies.rectangle(width / 2 - 120, 40, 200, 20, { 
      isStatic: true, 
      angle: Math.PI / 5,
      render: { fillStyle: 'rgba(255,255,255,0.2)' }
    });
    const funnelRight = Bodies.rectangle(width / 2 + 120, 40, 200, 20, { 
      isStatic: true, 
      angle: -Math.PI / 5,
      render: { fillStyle: 'rgba(255,255,255,0.2)' }
    });

    // Bottleneck (순서가 뒤바뀌는 좁은 병목 구간)
    const bottleneckY = 1200;
    const gap = 38; // 둘이 동시에 못들어가도록 구슬 지름(24)보다 조금 큰 38

    const funnelLength = 300;
    const funnelAngle = Math.PI / 6; // 30도 경사
    const funnelDx = (funnelLength / 2) * Math.cos(funnelAngle);
    const funnelDy = (funnelLength / 2) * Math.sin(funnelAngle);

    // 깔때기가 끝나는 점이 (width/2 - gap/2, bottleneckY)가 되도록 중심 이동
    const funnelLeftCenterX = (width / 2 - gap / 2) - funnelDx;
    const funnelLeftCenterY = bottleneckY - funnelDy;

    const bottleNeckFunnelLeft = Bodies.rectangle(funnelLeftCenterX, funnelLeftCenterY, funnelLength, 20, { 
      isStatic: true, angle: funnelAngle, render: { fillStyle: 'rgba(236,72,153,0.3)' }
    });
    
    // 오른쪽 깔때기
    const funnelRightCenterX = (width / 2 + gap / 2) + funnelDx;
    const funnelRightCenterY = bottleneckY - funnelDy;

    const bottleNeckFunnelRight = Bodies.rectangle(funnelRightCenterX, funnelRightCenterY, funnelLength, 20, { 
      isStatic: true, angle: -funnelAngle, render: { fillStyle: 'rgba(236,72,153,0.3)' }
    });

    // 좁은 터널 (벽의 두께가 20)
    const channelLength = 300;
    const channelY = bottleneckY + channelLength / 2; // 깔때기 끝점에서 시작하여 아래로 이어짐

    const channelLeft = Bodies.rectangle(width / 2 - gap / 2 - 10, channelY, 20, channelLength, wallOptions);
    const channelRight = Bodies.rectangle(width / 2 + gap / 2 + 10, channelY, 20, channelLength, wallOptions);
    
    // 터널 입구 모서리에 구슬이 걸리지 않도록 둥근 범퍼 추가
    const bumperLeft = Bodies.circle(width / 2 - gap / 2 - 10, bottleneckY, 10, wallOptions);
    const bumperRight = Bodies.circle(width / 2 + gap / 2 + 10, bottleneckY, 10, wallOptions);

    // 중간 회전 막대기(Mid Spinner) - 입구가 좁아지는 병목 지점 위
    const midSpinnerY = bottleneckY - 50;
    const midSpinner = Bodies.rectangle(width / 2, midSpinnerY, 150, 15, {
      isStatic: true,
      render: { fillStyle: '#3b82f6' } // 파란색 포인트 컬러
    });

    Composite.add(engine.world, [
      leftWall, rightWall, 
      funnelLeft, funnelRight,
      bottleNeckFunnelLeft, bottleNeckFunnelRight,
      channelLeft, channelRight,
      bumperLeft, bumperRight,
      midSpinner
    ]);

    // Pegs (핀)
    const pegs = [];
    const spacingX = width / 6;

    // 양쪽 끝에 공이 걸리지 않도록 여백(margin)을 충분히 크게 확보 (벽 두께 포함)
    const sideMargin = 55; 

    // Upper pegs (top ~ bottleneck)
    for (let y = 120; y < bottleneckY - 100; y += 45) {
      const isEven = Math.floor(y / 45) % 2 === 0;
      const cols = isEven ? 5 : 6;
      const startX = isEven ? spacingX : spacingX / 2;
      for (let col = 0; col < cols; col++) {
        const x = startX + col * spacingX;
        // 여백 검사 강화
        if (x > sideMargin && x < width - sideMargin) {
          pegs.push(Bodies.circle(x, y, 6, {
            isStatic: true, restitution: 0.6, render: { fillStyle: '#8b5cf6' }
          }));
        }
      }
    }

    // Lower pegs (bottleneck ~ final funnel)
    const finalFunnelY = worldHeight - 350;
    for (let y = bottleneckY + 360; y < finalFunnelY - 80; y += 45) {
      const isEven = Math.floor(y / 45) % 2 === 0;
      const cols = isEven ? 5 : 6;
      const startX = isEven ? spacingX : spacingX / 2;
      for (let col = 0; col < cols; col++) {
        const x = startX + col * spacingX;
        // 여백 검사 강화
        if (x > sideMargin && x < width - sideMargin) {
          pegs.push(Bodies.circle(x, y, 6, {
            isStatic: true, restitution: 0.5, render: { fillStyle: '#10b981' }
          }));
        }
      }
    }
    
    // 벽면 직하강 방지용 삼각형 톱니(Zigzag Bumper) 추가
    // 아이폰13mini(width 375) 기준으로 크기를 비율에 맞게 조정하여 볼 끼임 방지
    const scaleRatio = width / 375;
    const bumperRadius = 25 * scaleRatio;
    const bumperOffsetX = 10 * scaleRatio;
    
    const wallBumpers = [];
    // 상단 구간 벽 범퍼
    for (let y = 160; y < bottleneckY - 100; y += 100) {
      wallBumpers.push(
        // angle Math.PI: 왼쪽 벽면에 붙어서 꼭지점이 우측(트랙 안쪽)을 향함
        Bodies.polygon(bumperOffsetX, y, 3, bumperRadius, { isStatic: true, angle: Math.PI, restitution: 0.5, render: { fillStyle: 'rgba(236,72,153,0.4)' } }) 
      );
      wallBumpers.push(
        // angle 0: 오른쪽 벽면에 붙어서 꼭지점이 좌측(트랙 안쪽)을 향함
        Bodies.polygon(width - bumperOffsetX, y + 50, 3, bumperRadius, { isStatic: true, angle: 0, restitution: 0.5, render: { fillStyle: 'rgba(236,72,153,0.4)' } }) 
      );
    }
    // 하단 구간 벽 범퍼
    for (let y = bottleneckY + 400; y < finalFunnelY - 100; y += 100) {
      wallBumpers.push(
        Bodies.polygon(bumperOffsetX, y, 3, bumperRadius, { isStatic: true, angle: Math.PI, restitution: 0.5, render: { fillStyle: 'rgba(16,185,129,0.4)' } })
      );
      wallBumpers.push(
        Bodies.polygon(width - bumperOffsetX, y + 50, 3, bumperRadius, { isStatic: true, angle: 0, restitution: 0.5, render: { fillStyle: 'rgba(16,185,129,0.4)' } })
      );
    }
    
    Composite.add(engine.world, [...pegs, ...wallBumpers]);

    // Final Funnel (도착지 전 한 줄 서기 구간, 도착 순서를 확실히 보장하기 위함)
    const finalFunnelLeftCenterX = (width / 2 - gap / 2) - funnelDx;
    const finalFunnelLeftCenterY = finalFunnelY - funnelDy;
    const finalFunnelLeft = Bodies.rectangle(finalFunnelLeftCenterX, finalFunnelLeftCenterY, funnelLength, 20, { 
      isStatic: true, angle: funnelAngle, render: { fillStyle: 'rgba(16,185,129,0.3)' }
    });
    
    const finalFunnelRightCenterX = (width / 2 + gap / 2) + funnelDx;
    const finalFunnelRightCenterY = finalFunnelY - funnelDy;
    const finalFunnelRight = Bodies.rectangle(finalFunnelRightCenterX, finalFunnelRightCenterY, funnelLength, 20, { 
      isStatic: true, angle: -funnelAngle, render: { fillStyle: 'rgba(16,185,129,0.3)' }
    });

    const finalBumperLeft = Bodies.circle(width / 2 - gap / 2 - 10, finalFunnelY, 10, wallOptions);
    const finalBumperRight = Bodies.circle(width / 2 + gap / 2 + 10, finalFunnelY, 10, wallOptions);

    const finalChannelLength = 200;
    const finalChannelY = finalFunnelY + finalChannelLength / 2;
    // 터널 공간이 1열만 생기게 유지하되, 너무 좁아서 걸리지 않게 wallOptions에서 마찰 강제 0
    const smoothWallOptions = { isStatic: true, friction: 0, render: { fillStyle: 'rgba(255,255,255,0.1)' } };

    const finalChannelLeft = Bodies.rectangle(width / 2 - gap / 2 - 10, finalChannelY, 20, finalChannelLength, smoothWallOptions);
    const finalChannelRight = Bodies.rectangle(width / 2 + gap / 2 + 10, finalChannelY, 20, finalChannelLength, smoothWallOptions);

    // 회전 막대기 (역전 요소) 추가
    // 윗 깔때기(finalFunnelY) 바로 위 중앙에 배치하여 타이밍에 따라 구슬을 위로 쳐올리게 만듦
    const spinnerY = finalFunnelY - 50; 
    const spinner = Bodies.rectangle(width / 2, spinnerY, 180, 15, {
      isStatic: true,
      render: { fillStyle: '#f59e0b' } // 주황색 포인트 컬러
    });

    Composite.add(engine.world, [
      finalFunnelLeft, finalFunnelRight, 
      finalBumperLeft, finalBumperRight, 
      finalChannelLeft, finalChannelRight,
      spinner
    ]);

    // Bottom sensor (Finish line - 센서를 터널 중간이나 끝부분 약간 위에 길게 두어 반드시 통과를 인지)
    const sensorY = finalChannelY + finalChannelLength / 2 - 30; // 터널 끝단에서 살짝 위
    const finishLine = Bodies.rectangle(width / 2, sensorY, gap * 1.5, 30, {
      isStatic: true,
      isSensor: true,
      render: { fillStyle: 'rgba(239, 68, 68, 0.4)' }, // 빨간줄 반투명 설정
      label: 'FinishLine'
    });
    
    // Add Slots at the bottom (장식용 목표 지점)
    const slotWalls: Matter.Body[] = [];
    const slotCount = players.length;
    const slotWidth = width / slotCount;
    for (let i = 1; i < slotCount; i++) {
      const x = i * slotWidth;
      const y = worldHeight - 40;
      slotWalls.push(Bodies.rectangle(x, y, 10, 80, smoothWallOptions));
      // 슬롯 벽 꼭대기에 확실히 둥근 범퍼를 크게 달아서 끼임 방지
      slotWalls.push(Bodies.circle(x, y - 40, 8, smoothWallOptions));
    }
    const ground = Bodies.rectangle(width / 2, worldHeight + 20, width, 40, smoothWallOptions); // 바닥 안전망 늘림
    Composite.add(engine.world, [finishLine, ...slotWalls, ground]);

    // Add Player Marbles
    const marbles = players.map((p, index) => {
      // 겹치지 않게 출발 X를 고르게 분배하거나 Y를 다르게 줌
      const startX = width / 2 + (Math.random() * 20 - 10);
      return Bodies.circle(startX, -(index * 40) - 40, 11, { // 구슬 반지름 12 -> 11 로 줄여 상대적으로 틈새 통과 유리하게
        restitution: 0.85,
        friction: 0.0001, // 덜 걸리도록 매우 작은 마찰
        frictionStatic: 0, // 정지 마찰력 없애서 멈춤 현상 방지
        frictionAir: 0.02, // 떨어지는 속도가 너무 빨라 튕겨나가지 않게 약간의 공기저항 추가
        density: 0.05,
        label: `player_${p.id}`,
        render: {
          fillStyle: PLAYER_COLORS[index % PLAYER_COLORS.length],
          strokeStyle: '#fff',
          lineWidth: 2
        }
      });
    });
    Composite.add(engine.world, marbles);

    // Camera Panning Logic & Spinner Rotation
    Events.on(engine, 'beforeUpdate', () => {
      // 1. 역전 막대기(Spinner) 및 중간 막대기 계속 회전
      Matter.Body.setAngle(spinner, spinner.angle + 0.02); // 0.02 라디안씩 천천히 회전
      Matter.Body.setAngle(midSpinner, midSpinner.angle - 0.025); // 중간 막대기는 반대 방향으로 약간 빠르게 회전

      // 2. 결승선을 통과하지 않은 구슬만 추적
      const activeMarbles = marbles.filter(m => !finishedRef.current.includes(m.label.split('_')[1]));
      
      if (activeMarbles.length > 0) {
        // 가장 아래에 있는 구슬(선두)을 기준으로 카메라 이동 및 순위 역전 감지
        // 레이스의 긴장감을 위해 제일 앞서가는(선두) 구슬을 포커스로 잡자 (단 너무 벌어지면 평균)
        let maxY = 0;
        let currentLeader: string | null = null;
        for (const m of activeMarbles) {
          if (m.position.y > maxY) {
            maxY = m.position.y;
            currentLeader = m.label;
          }
        }

        // 선두(1위) 역전 시 슬로우 모션 효과 타격감 추가
        if (currentLeader && leaderRef.current && currentLeader !== leaderRef.current) {
          // 역전 감지됨!
          if (engine.timing) {
            engine.timing.timeScale = 0.2; // 20% 속도로 슬로우 모션
          }
          
          if (slowMoTimeoutRef.current) {
            clearTimeout(slowMoTimeoutRef.current);
          }
          
          slowMoTimeoutRef.current = setTimeout(() => {
            if (engine.timing) {
              engine.timing.timeScale = 1.0; // 원상 복구
            }
          }, 1500); // 1.5초 동안 지속
        }
        
        // 현재 선두 업데이트
        leaderRef.current = currentLeader;
        
        let targetMinY = maxY - (viewHeight * 0.7); // 화면 하단부에 선두가 위치하도록
        let currentMinY = render.bounds.min.y;
        
        // 부드럽게 이동 (Lerp)
        let newMinY = currentMinY + (targetMinY - currentMinY) * 0.1;
        
        // Clamp (화면 이탈 방지)
        newMinY = Math.max(0, Math.min(worldHeight - viewHeight, newMinY));

        render.bounds.min.x = 0;
        render.bounds.max.x = width;
        render.bounds.min.y = newMinY;
        render.bounds.max.y = newMinY + viewHeight;
      }
    });

    // Collision Event for Finish Line
    Events.on(engine, 'collisionStart', (event) => {
      const pairs = event.pairs;
      for (const pair of pairs) {
        let marbleBody = null;
        if (pair.bodyA.label === 'FinishLine' && pair.bodyB.label?.startsWith('player_')) {
          marbleBody = pair.bodyB;
        } else if (pair.bodyB.label === 'FinishLine' && pair.bodyA.label?.startsWith('player_')) {
          marbleBody = pair.bodyA;
        }

        if (marbleBody) {
          const playerId = marbleBody.label.split('_')[1];
          if (!finishedRef.current.includes(playerId)) {
            finishedRef.current.push(playerId);
            setFinishedPlayers([...finishedRef.current]);

            if (finishedRef.current.length === players.length) {
              setTimeout(() => {
                onFinish(finishedRef.current);
              }, 2000); // 2초 대기 후 결과 화면으로
            }
          }
        }
      }
    });

    Render.run(render);
    const runner = Runner.create();
    runnerRef.current = runner;
    Runner.run(runner, engine);

    return () => {
      Render.stop(render);
      Runner.stop(runner);
      if (engineRef.current) {
         Events.off(engineRef.current, 'beforeUpdate');
         Events.off(engineRef.current, 'collisionStart');
         Composite.clear(engineRef.current.world, false, true);
         Engine.clear(engineRef.current);
      }
      if (render.canvas) {
        render.canvas.remove();
      }
    };
  }, [players, onFinish]);

  return (
    <div className="race-container">
      <div className="race-header">
        <h2>🔥 마블 레이스 🔥</h2>
        <div className="live-rank">
          {finishedPlayers.map((id, index) => {
            const p = players.find(p => p.id === id);
            const color = PLAYER_COLORS[players.findIndex(player => player.id === id) % PLAYER_COLORS.length];
            return (
              <div key={id} className="rank-badge fadeIn" style={{ borderLeft: `4px solid ${color}` }}>
                <span className="rank-num">{index + 1}위</span>
                <span className="rank-name">{p?.name}</span>
              </div>
            );
          })}
        </div>
      </div>
      
      {/* 범례 표시 */}
      <div className="player-legend">
        {players.map((p, i) => (
          <div key={p.id} className="legend-item">
            <span className="dot" style={{ backgroundColor: PLAYER_COLORS[i % PLAYER_COLORS.length] }}></span>
            {p.name}
          </div>
        ))}
      </div>

      <div className="glass-panel canvas-container" ref={sceneRef}></div>
    </div>
  );
}
