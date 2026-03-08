import { v } from "convex/values";
import { authenticatedMutation, authenticatedQuery } from "./helpers";

export const saveGroup = authenticatedMutation({
  args: {
    title: v.string(),
    players: v.array(
      v.object({
        id: v.string(),
        name: v.string(),
      })
    ),
  },
  handler: async (ctx, args) => {
    // 이미 같은 이름의 그룹이 있는지 확인하고 있다면 덮어쓰기(업데이트)
    const existingGroup = await ctx.db
      .query("participantGroups")
      .withIndex("by_userId", (q) => q.eq("userId", ctx.userId))
      .filter((q) => q.eq(q.field("title"), args.title))
      .first();

    if (existingGroup) {
      await ctx.db.patch(existingGroup._id, {
        players: args.players,
      });
      return existingGroup._id;
    }

    // 없다면 새로 생성
    const newGroupId = await ctx.db.insert("participantGroups", {
      userId: ctx.userId,
      title: args.title,
      players: args.players,
    });
    return newGroupId;
  },
});

export const getGroups = authenticatedQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("participantGroups")
      .withIndex("by_userId", (q) => q.eq("userId", ctx.userId))
      .order("desc") // 최신순 정렬 등을 위해 기본 정렬(생성 시간 기반)
      .collect();
  },
});
export const deleteGroup = authenticatedMutation({
  args: { id: v.id("participantGroups") },
  handler: async (ctx, args) => {
    const group = await ctx.db.get(args.id);
    if (!group) throw new Error("Group not found");
    if (group.userId !== ctx.userId) throw new Error("Unauthorized");
    
    await ctx.db.delete(args.id);
  },
});
