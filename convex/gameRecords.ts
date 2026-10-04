import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { auth } from "./auth";

// 통계 계산에 불러오는 최근 기록 최대 개수(식별자별). 하루 수십 판을 해도 수개월 치를 담는 양
const MAX_RECORDS = 2000;
const MAX_NAME_LENGTH = 40;

const resultValidator = v.object({
  name: v.string(),
  rank: v.number(),
  amount: v.number(),
  isLoser: v.boolean(),
});

/**
 * 💡 이 기기/계정에서 볼 수 있는 게임 기록을 최신순으로 모읍니다.
 * - 비로그인: 이 기기에서 비로그인 상태로 한 게임
 * - 로그인: 계정에 저장된 게임 + 이 기기에서 비로그인 상태로 했던 게임 (로그인 전 기록도 이어서 보이도록)
 */
async function collectRecords(ctx: QueryCtx, deviceId: string): Promise<Doc<"gameRecords">[]> {
  const userId = await auth.getUserId(ctx);
  const deviceRecords = await ctx.db
    .query("gameRecords")
    .withIndex("by_deviceId", (q) => q.eq("deviceId", deviceId))
    .filter((q) => q.eq(q.field("userId"), undefined))
    .order("desc")
    .take(MAX_RECORDS);
  if (userId === null) return deviceRecords;

  const userRecords = await ctx.db
    .query("gameRecords")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .order("desc")
    .take(MAX_RECORDS);
  return [...userRecords, ...deviceRecords]
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, MAX_RECORDS);
}

/**
 * 💡 게임 1판의 결과를 기록합니다. (결과 화면 진입 시 자동 호출)
 * 같은 clientGameId로 다시 호출되면 새로 저장하지 않고 기존 기록 ID를 돌려줍니다.
 */
export const recordGame = mutation({
  args: {
    deviceId: v.string(),
    clientGameId: v.string(),
    gameMode: v.string(),
    results: v.array(resultValidator),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("gameRecords")
      .withIndex("by_clientGameId", (q) => q.eq("clientGameId", args.clientGameId))
      .first();
    if (existing) return existing._id;

    if (args.results.length < 2 || args.results.length > 20) {
      throw new Error("참가자 수가 올바르지 않습니다.");
    }
    const results = args.results.map((r) => ({
      name: r.name.trim().replace(/\s+/g, " ").slice(0, MAX_NAME_LENGTH) || "이름 없음",
      rank: Math.max(1, Math.round(r.rank)),
      amount: Number.isFinite(r.amount) ? Math.max(0, Math.round(r.amount)) : 0,
      isLoser: r.isLoser,
    }));
    if (!results.some((r) => r.isLoser)) {
      throw new Error("걸린 사람이 없는 기록입니다.");
    }

    const userId = await auth.getUserId(ctx);
    return await ctx.db.insert("gameRecords", {
      userId: userId !== null ? userId : undefined,
      deviceId: args.deviceId,
      clientGameId: args.clientGameId,
      gameMode: args.gameMode,
      results,
      createdAt: Date.now(),
    });
  },
});

/**
 * 💡 통계 계산용 게임 기록 목록 (최신순, 최대 MAX_RECORDS개)
 */
export const listRecords = query({
  args: { deviceId: v.string() },
  handler: async (ctx, args) => {
    const records = await collectRecords(ctx, args.deviceId);
    return records.map((r) => ({
      _id: r._id,
      clientGameId: r.clientGameId,
      gameMode: r.gameMode,
      results: r.results,
      createdAt: r.createdAt,
    }));
  },
});

/**
 * 💡 잘못 기록된 게임(테스트 판 등)을 통계에서 지웁니다.
 * 자신의 계정 기록이거나, 같은 기기의 비로그인 기록만 지울 수 있습니다.
 */
export const deleteRecord = mutation({
  args: { id: v.id("gameRecords"), deviceId: v.string() },
  handler: async (ctx, args) => {
    const record = await ctx.db.get(args.id);
    if (!record) return;
    const userId = await auth.getUserId(ctx);
    const isOwner =
      record.userId !== undefined
        ? userId !== null && record.userId === userId
        : record.deviceId === args.deviceId;
    if (!isOwner) throw new Error("Unauthorized");
    await ctx.db.delete(args.id);
  },
});
