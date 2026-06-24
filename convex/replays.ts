import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { auth } from "./auth";

// 식별자(로그인 userId / 비로그인 deviceId)당 보관하는 리플레이 최대 개수.
// 초과 시 가장 오래된 리플레이와 그에 연결된 영상 파일을 함께 삭제해 서버 용량을 상한 내로 유지한다.
const MAX_REPLAYS_PER_IDENTITY = 10;

/**
 * 💡 리플레이 영상 업로드용 단기 URL을 발급합니다.
 * 클라이언트는 이 URL로 녹화된 영상(Blob)을 POST 업로드한 뒤,
 * 반환받은 storageId를 saveReplay에 전달합니다.
 */
export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    return await ctx.storage.generateUploadUrl();
  },
});

/**
 * 💡 게임 플레이 리플레이를 저장합니다.
 * 기기 식별자(deviceId) 또는 로그인 유저 ID(userId) 당 MAX_REPLAYS_PER_IDENTITY(10)개까지만 보관되며,
 * 초과 시 가장 오래된 리플레이가 (연결된 영상 파일과 함께) 자동 삭제됩니다.
 *
 * videoStorageId(녹화 영상)가 있으면 재생 시 영상을 그대로 틀어 100% 동일하게 재현하며,
 * trajectory(궤적)는 영상 미지원 환경 폴백 및 구버전 호환을 위해 함께 보관합니다.
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
    videoStorageId: v.optional(v.id("_storage")),
    trajectory: v.optional(v.string()), // JSON.stringify(TrajectoryFrame[])
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

    // 상한 관리: 새 리플레이를 저장하면 상한을 넘으므로 오래된 순서대로 삭제
    if (existingReplays.length >= MAX_REPLAYS_PER_IDENTITY) {
      const deleteCount = existingReplays.length - MAX_REPLAYS_PER_IDENTITY + 1;
      for (let i = 0; i < deleteCount; i++) {
        const old = existingReplays[i];
        // 연결된 녹화 영상이 있으면 스토리지에서도 함께 제거(고아 파일 방지)
        if (old.videoStorageId) {
          await ctx.storage.delete(old.videoStorageId);
        }
        await ctx.db.delete(old._id);
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
      videoStorageId: args.videoStorageId,
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
      const replay = await ctx.db.get(normalizedId);
      if (!replay) return null;
      // 녹화 영상이 있으면 재생 가능한 단기 URL을 함께 반환(없으면 궤적 폴백)
      const videoUrl = replay.videoStorageId
        ? await ctx.storage.getUrl(replay.videoStorageId)
        : null;
      return { ...replay, videoUrl };
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


