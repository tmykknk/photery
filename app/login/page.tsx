import { isValidSiteAuthToken, siteAuthCookieName } from "@/app/lib/auth-token";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import LoginForm from "./LoginForm";

interface LoginPageProps {
  searchParams: Promise<{
    error?: string;
  }>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const { error } = await searchParams;
  const cookieStore = await cookies();
  const authToken = cookieStore.get(siteAuthCookieName)?.value;
  const isAuthenticated = await isValidSiteAuthToken(
    authToken,
    process.env.VIEW_PASSWORD,
  );

  if (isAuthenticated) {
    redirect("/");
  }

  return (
    <div
      className="flex min-h-screen items-center justify-center bg-gray-50 p-4"
    >
      <div className="w-full max-w-sm rounded-lg border bg-white p-6 shadow-sm">
        <h1 className="mb-4 text-center text-xl font-bold text-gray-900">
          パスワードを入力
        </h1>
        <LoginForm hasError={Boolean(error)} />
      </div>
    </div>
  );
}
