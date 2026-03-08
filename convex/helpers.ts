import { customCtx, customMutation, customQuery } from "convex-helpers/server/customFunctions";
import { mutation, query } from "./_generated/server";
import { auth } from "./auth";

/**
 * 💡 인증된 사용자만 접근할 수 있는 Query를 위한 래퍼 함수입니다.
 */
export const authenticatedQuery = customQuery(
  query,
  customCtx(async (ctx) => {
    const userId = await auth.getUserId(ctx);
    if (userId === null) {
      throw new Error("Not logged in");
    }
    return { userId };
  })
);

/**
 * 💡 인증된 사용자만 접근할 수 있는 Mutation을 위한 래퍼 함수입니다.
 */
export const authenticatedMutation = customMutation(
  mutation,
  customCtx(async (ctx) => {
    const userId = await auth.getUserId(ctx);
    if (userId === null) {
      throw new Error("Not logged in");
    }
    return { userId };
  })
);
