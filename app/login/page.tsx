import PasswordInput from "./PasswordInput";

interface LoginPageProps {
  searchParams: Promise<{
    error?: string;
  }>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const { error } = await searchParams;

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 p-4">
      <div className="w-full max-w-sm rounded-lg border bg-white p-6 shadow-sm">
        <h1 className="text-xl font-bold text-gray-900 text-center mb-4">
          パスワードを入力
        </h1>
        <form action="/api/auth" method="post" className="space-y-4">
          <PasswordInput />
          {error ? (
            <p className="text-xs text-red-500">パスワードが違います</p>
          ) : null}
          <button
            type="submit"
            className="cursor-pointer w-full rounded-md bg-blue-600 p-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            閲覧する
          </button>
        </form>
      </div>
    </div>
  );
}
