import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// The schema is normally optional, but we define it here to
// explicitly state our data types.
export default defineSchema({
  ...authTables,
  participantGroups: defineTable({
    userId: v.string(), // 사용자 고유 식별자 (Google OAuth)
    title: v.string(), // 그룹 제목 (직장, 동창, 가족 등)
    players: v.array(
      v.object({
        id: v.string(),
        name: v.string(),
      })
    ), // 저장할 참가자 리스트
  }).index("by_userId", ["userId"]),

  replays: defineTable({
    userId: v.optional(v.string()), // 로그인 유저 ID
    deviceId: v.string(), // 비로그인/로그인 공통 기기 고유 ID
    players: v.array(
      v.object({
        id: v.string(),
        name: v.string(),
      })
    ),
    amountsPool: v.array(v.number()),
    gameMode: v.string(),
    raceResults: v.array(v.string()),
    // 신규 방식: 라이브 레이스를 그대로 녹화한 영상(Convex 파일 스토리지)을 재생 → 100% 동일 재현
    videoStorageId: v.optional(v.id("_storage")),
    // 구(舊) 방식 호환 및 영상 미지원 환경(WKWebView 등) 폴백용 궤적 데이터
    trajectory: v.optional(v.string()), // JSON Stringified TrajectoryFrame[]
    createdAt: v.number(),
  })
    .index("by_userId", ["userId"])
    .index("by_deviceId", ["deviceId"]),

  // 게임 1판의 결과(누가 걸렸는지) 기록 — 주간/월간 당첨 통계의 원천 데이터.
  // 리플레이(최대 10개 보관)와 달리 통계를 위해 계속 누적한다. 참가자는 이름으로 식별한다.
  gameRecords: defineTable({
    userId: v.optional(v.string()), // 로그인 유저 ID
    deviceId: v.string(), // 비로그인/로그인 공통 기기 고유 ID
    clientGameId: v.string(), // 클라이언트가 만든 게임 ID (중복 저장 방지)
    gameMode: v.string(),
    results: v.array(
      v.object({
        name: v.string(),
        rank: v.number(), // 레이스 도착 순위 (1부터)
        amount: v.number(), // 이 사람이 낸 금액
        isLoser: v.boolean(), // 이번 판에 '걸린' 사람인지
      })
    ),
    createdAt: v.number(),
  })
    .index("by_userId", ["userId"])
    .index("by_deviceId", ["deviceId"])
    .index("by_clientGameId", ["clientGameId"]),
});
