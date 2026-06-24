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
});
