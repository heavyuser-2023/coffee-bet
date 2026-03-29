import { convexAuth } from "@convex-dev/auth/server";
import Google from "@auth/core/providers/google";


export const { auth, signIn, signOut, store } = convexAuth({
  providers: [
    Google({
      authorization: {
        params: {
          prompt: "select_account",
        },
      },
    }),
  ],
  callbacks: {
    async redirect({ redirectTo }) {
      // 모바일 앱의 Custom URL Scheme 콜백 허용
      if (redirectTo.startsWith("com.heavyuser73.coffeebet://")) {
        return redirectTo;
      }
      // GitHub Pages 클라이언트 앱 URL 허용
      if (redirectTo.startsWith("https://heavyuser-2023.github.io/")) {
        return redirectTo;
      }
      // 상대 경로("/" 등)는 SITE_URL 기반 절대 URL로 변환
      // (defaultRedirectCallback 동작 재현 — setURLSearchParam은 절대 URL만 처리 가능)
      if (redirectTo.startsWith("/") || redirectTo.startsWith("?")) {
        const siteUrl = ((globalThis as any).process?.env?.SITE_URL ?? "").replace(/\/$/, "");
        return `${siteUrl}${redirectTo}`;
      }
      return redirectTo;
    },
  },
});
