const { execSync } = require('child_process');

const deviceId = "test-device-limit-" + Date.now();
console.log(`Starting Replay Limit test. Target deviceId: ${deviceId}`);

const mockPayload = JSON.stringify({
  deviceId: deviceId,
  players: [
    { id: "1", name: "Alice" },
    { id: "2", name: "Bob" }
  ],
  amountsPool: [10000, 0],
  gameMode: "random",
  raceResults: ["1", "2"],
  trajectory: JSON.stringify([
    { elapsed: 0, positions: [{ id: "1", x: 100, y: 100 }, { id: "2", x: 120, y: 100 }] },
    { elapsed: 100, positions: [{ id: "1", x: 150, y: 110 }, { id: "2", x: 160, y: 110 }] }
  ])
});

// 25번 리플레이 저장 Mutation 호출
console.log("Saving 25 replays...");
for (let i = 1; i <= 25; i++) {
  try {
    execSync(`npx convex run replays:saveReplay '${mockPayload}'`, { stdio: 'ignore' });
    process.stdout.write('.');
  } catch (error) {
    console.error(`\nError saving replay ${i}:`, error.message);
    process.exit(1);
  }
}
console.log("\nSaved 25 replays successfully.");

// getReplaysByDevice 쿼리 호출해서 남은 리플레이 확인
console.log("Checking saved replays count for this device...");
try {
  const getPayload = JSON.stringify({ deviceId });
  const resultRaw = execSync(`npx convex run replays:getReplaysByDevice '${getPayload}'`, { encoding: 'utf-8' });
  const list = JSON.parse(resultRaw.trim());
  
  console.log(`Saved items count: ${list.length}`);
  
  if (list.length === 20) {
    console.log("✅ Success: The number of replays is capped at exactly 20!");
    process.exit(0);
  } else {
    console.error(`❌ Fail: Replays count is ${list.length}, expected exactly 20.`);
    process.exit(1);
  }
} catch (error) {
  console.error("Failed to query replays from Convex:", error);
  process.exit(1);
}
