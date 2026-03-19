import { mutation } from "./_generated/server";
import { auth } from "./auth";

/**
 * 💡 계정 삭제 Mutation
 * Apple App Store 가이드라인 4에 따라 계정 삭제 기능을 제공합니다.
 * 사용자의 모든 관련 데이터(세션, 계정, 토큰, 참가자 그룹 등)를 삭제합니다.
 *
 * ⚠️ authenticatedMutation 대신 일반 mutation을 사용합니다.
 *    현재 세션을 삭제하는 과정에서 인증 컨텍스트가 무효화되므로,
 *    인증 확인을 수동으로 먼저 수행한 뒤 데이터를 삭제합니다.
 */
export const deleteAccount = mutation({
  args: {},
  handler: async (ctx) => {
    // 수동으로 인증 확인 (세션 삭제 전에 userId를 먼저 확보)
    const userId = await auth.getUserId(ctx);
    if (userId === null) {
      throw new Error("Not logged in");
    }

    // 1. 사용자의 참가자 그룹 삭제
    const groups = await ctx.db
      .query("participantGroups")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect();
    for (const group of groups) {
      await ctx.db.delete(group._id);
    }

    // 2. 사용자의 auth 계정 및 관련 인증 코드 삭제
    const accounts = await ctx.db
      .query("authAccounts")
      .withIndex("userIdAndProvider", (q) => q.eq("userId", userId))
      .collect();
    for (const account of accounts) {
      const verificationCodes = await ctx.db
        .query("authVerificationCodes")
        .withIndex("accountId", (q) => q.eq("accountId", account._id))
        .collect();
      for (const code of verificationCodes) {
        await ctx.db.delete(code._id);
      }
      await ctx.db.delete(account._id);
    }

    // 3. 세션 목록을 먼저 수집 (verifier 삭제에 필요)
    const sessions = await ctx.db
      .query("authSessions")
      .withIndex("userId", (q) => q.eq("userId", userId))
      .collect();
    const sessionIds = new Set(sessions.map((s) => s._id));

    // 4. authVerifiers 삭제 (세션이 아직 존재하는 상태에서, 해당 사용자의 세션 ID 기반 필터링)
    const verifiers = await ctx.db.query("authVerifiers").collect();
    for (const verifier of verifiers) {
      if (verifier.sessionId && sessionIds.has(verifier.sessionId)) {
        await ctx.db.delete(verifier._id);
      }
    }

    // 5. auth 세션 및 관련 리프레시 토큰 삭제
    for (const session of sessions) {
      const refreshTokens = await ctx.db
        .query("authRefreshTokens")
        .withIndex("sessionId", (q) => q.eq("sessionId", session._id))
        .collect();
      for (const token of refreshTokens) {
        await ctx.db.delete(token._id);
      }
      await ctx.db.delete(session._id);
    }

    // 6. 사용자 문서 삭제
    await ctx.db.delete(userId);
  },
});
