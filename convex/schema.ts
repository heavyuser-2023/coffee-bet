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
    trajectory: v.string(), // JSON Stringified TrajectoryFrame[]
    createdAt: v.number(),
  })
    .index("by_userId", ["userId"])
    .index("by_deviceId", ["deviceId"]),
});
