const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  const consoleMsgs = [];
  page.on('console', msg => {
    const text = msg.text();
    consoleMsgs.push(`[${msg.type()}] ${text}`);
    console.log(`BROWSER CONSOLE: ${text}`);
  });

  page.on('pageerror', err => {
    console.error(`BROWSER ERROR: ${err.message}`);
  });

  try {
    console.log("Navigating to local site...");
    await page.goto('http://localhost:5174/coffee-bet/');
    await page.waitForTimeout(2000); // 넉넉히 대기
    
    // 1회차 테스트
    console.log("\n--- Round 1 Start ---");
    // "게임 시작" 버튼 클릭
    // SetupScreen에 "게임 시작" 버튼이 있을 것임. css 클래스 혹은 텍스트로 찾자.
    const startButton = page.locator('button:has-text("레이스 시작")');
    if (await startButton.count() === 0) {
      throw new Error("SetupScreen에서 '레이스 시작' 버튼을 찾을 수 없습니다.");
    }
    await startButton.first().click();
    console.log("Clicked '레이스 시작'!");
    
    // 레이스 화면 진입 대기
    await page.waitForSelector('.race-container', { timeout: 5000 });
    console.log("RaceScreen active. Waiting for race to finish...");
    
    // 레이스 완료(결과 화면 진입) 대기 (결과 헤더나 텍스트 감지)
    // 30초 넉넉하게 대기
    await page.waitForSelector('.result-container', { timeout: 50000 });
    console.log("ResultScreen active! Round 1 Finished.");
    
    // "다시 하기" 버튼 찾기
    const restartButton = page.locator('button:has-text("다시 하기")');
    if (await restartButton.count() === 0) {
      throw new Error("ResultScreen에서 '다시 하기' 버튼을 찾을 수 없습니다.");
    }
    
    await page.waitForTimeout(2000); // 2초 대기 후 클릭
    await restartButton.first().click();
    console.log("Clicked '다시 하기'!");
    
    // 다시 셋업 화면으로 돌아왔는지 체크
    await page.waitForSelector('.setup-container', { timeout: 5000 });
    console.log("Returned to SetupScreen successfully.");

    // 2회차 테스트
    console.log("\n--- Round 2 Start ---");
    await page.waitForTimeout(1000);
    const startButton2 = page.locator('button:has-text("레이스 시작")');
    await startButton2.first().click();
    console.log("Clicked '레이스 시작' for Round 2!");
    
    await page.waitForSelector('.race-container', { timeout: 5000 });
    console.log("RaceScreen active for Round 2. Waiting for race to finish...");
    
    await page.waitForSelector('.result-container', { timeout: 50000 });
    console.log("ResultScreen active! Round 2 Finished.");

    await page.waitForTimeout(2000);
    const restartButton2 = page.locator('button:has-text("다시 하기")');
    await restartButton2.first().click();
    console.log("Clicked '다시 하기' for Round 2!");
    
    await page.waitForSelector('.setup-container', { timeout: 5000 });
    console.log("Returned to SetupScreen successfully after Round 2.");

    console.log("\n✅ Test Success: Both game rounds ran and restarted without issues!");

  } catch (error) {
    console.error("\n❌ Test Failed with Error:", error);
    try {
      await page.screenshot({ path: '/Users/heavyuser/workspace/coffee-bet/scratch/timeout_screenshot.png', fullPage: true });
      console.log("Saved timeout screenshot to scratch/timeout_screenshot.png");
    } catch (screenshotErr) {
      console.error("Failed to take screenshot:", screenshotErr);
    }
  } finally {
    await browser.close();
    console.log("Browser closed.");
  }
})();
