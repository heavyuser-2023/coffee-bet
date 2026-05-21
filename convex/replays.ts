import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { auth } from "./auth";

/**
 * 💡 게임 플레이 리플레이를 저장합니다.
 * 기기 식별자(deviceId) 또는 로그인 유저 ID(userId) 당 최대 20개까지만 보관되며, 
 * 초과 시 가장 오래된 리플레이가 자동 삭제됩니다.
 */
export const saveReplay = mutation({
  args: {
    deviceId: v.string(),
    players: v.array(
      v.object({
        id: v.string(),
        name: v.string(),
      })
    ),
    amountsPool: v.array(v.number()),
    gameMode: v.string(),
    raceResults: v.array(v.string()),
    trajectory: v.string(), // JSON.stringify(TrajectoryFrame[])
  },
  handler: async (ctx, args) => {
    const userId = await auth.getUserId(ctx); // 로그인 상태이면 ID 반환, 비로그인이면 null
    
    let existingReplays = [];
    if (userId !== null) {
      // 로그인 사용자: userId 기반 조회
      existingReplays = await ctx.db
        .query("replays")
        .withIndex("by_userId", (q) => q.eq("userId", userId))
        .order("asc")
        .collect();
    } else {
      // 비로그인 사용자: deviceId 기반 조회 (로그인 연결이 안 된 기기 리플레이만 대상)
      existingReplays = await ctx.db
        .query("replays")
        .withIndex("by_deviceId", (q) => q.eq("deviceId", args.deviceId))
        .filter((q) => q.eq(q.field("userId"), undefined))
        .order("asc")
        .collect();
    }

    // 20개 상한 관리: 새 리플레이를 저장하면 20개가 넘어가므로 오래된 순서대로 삭제
    if (existingReplays.length >= 20) {
      const deleteCount = existingReplays.length - 20 + 1;
      for (let i = 0; i < deleteCount; i++) {
        await ctx.db.delete(existingReplays[i]._id);
      }
    }

    // 새 리플레이 추가
    const replayId = await ctx.db.insert("replays", {
      userId: userId !== null ? userId : undefined,
      deviceId: args.deviceId,
      players: args.players,
      amountsPool: args.amountsPool,
      gameMode: args.gameMode,
      raceResults: args.raceResults,
      trajectory: args.trajectory,
      createdAt: Date.now(),
    });

    return replayId;
  },
});

/**
 * 💡 고유 리플레이 ID를 통해 저장된 리플레이 정보를 가져옵니다.
 * 외부 공유용이므로 인증 여부와 상관없이 누구나 조회할 수 있습니다.
 */
export const getReplay = query({
  args: { id: v.string() },
  handler: async (ctx, args) => {
    try {
      const normalizedId = ctx.db.normalizeId("replays", args.id);
      if (!normalizedId) return null;
      return await ctx.db.get(normalizedId);
    } catch (e) {
      console.error("리플레이 조회 중 오류:", e);
      return null;
    }
  },
});

/**
 * 💡 테스트용: 특정 기기의 전체 리플레이 목록을 조회합니다.
 */
export const getReplaysByDevice = query({
  args: { deviceId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("replays")
      .withIndex("by_deviceId", (q) => q.eq("deviceId", args.deviceId))
      .collect();
  },
});

/**
 * 💡 기기 ID 또는 로그인 계정 ID를 기준으로 최근 리플레이 목록을 최신순으로 가져옵니다.
 */
export const getReplays = query({
  args: { deviceId: v.string() },
  handler: async (ctx, args) => {
    const userId = await auth.getUserId(ctx);
    if (userId !== null) {
      return await ctx.db
        .query("replays")
        .withIndex("by_userId", (q) => q.eq("userId", userId))
        .order("desc")
        .collect();
    } else {
      return await ctx.db
        .query("replays")
        .withIndex("by_deviceId", (q) => q.eq("deviceId", args.deviceId))
        .filter((q) => q.eq(q.field("userId"), undefined))
        .order("desc")
        .collect();
    }
  },
});


